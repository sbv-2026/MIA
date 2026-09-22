from __future__ import annotations

import json
import re
from pathlib import Path
from threading import RLock
from typing import Any

import yaml
from pydantic import ValidationError
from .models import (
    AdvisoryResponse,
    AdvisoryStep,
    AdvisorySuggestion,
    Citation,
    ContextSnapshot,
    CurrentErrorSnapshot,
    ScreenContext,
)


class KnowledgeConfigError(RuntimeError):
    pass


class AdvisoryUnavailableError(RuntimeError):
    pass


class PublishedKnowledgeStore:
    """Read-only demo index. Stage 4 can replace this behind the same lookup API."""

    def __init__(self, path: Path):
        self._path = path
        self._lock = RLock()
        self._payload: dict[str, Any] = {}
        self.reload()

    def reload(self) -> None:
        try:
            payload = yaml.safe_load(self._path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, yaml.YAMLError) as exc:
            raise KnowledgeConfigError(f"Unable to load advisory knowledge: {exc}") from exc
        if not isinstance(payload, dict) or payload.get("status") != "published":
            raise KnowledgeConfigError("Advisory knowledge must be a published dataset")
        if not isinstance(payload.get("definitions"), list) or not payload["definitions"]:
            raise KnowledgeConfigError("Published dataset must contain definitions")
        suggestions = payload.get("suggestions")
        flow = payload.get("suggestionFlow")
        if not isinstance(suggestions, dict) or not isinstance(flow, dict):
            raise KnowledgeConfigError("Published dataset must define suggestions and suggestionFlow")
        for suggestion_id, suggestion in suggestions.items():
            try:
                candidate = AdvisorySuggestion.model_validate(suggestion)
            except ValidationError as exc:
                raise KnowledgeConfigError(f"Invalid suggestion {suggestion_id!r}") from exc
            if candidate.id != suggestion_id:
                raise KnowledgeConfigError(f"Suggestion key and id differ for {suggestion_id!r}")
        for intent, suggestion_ids in flow.items():
            if not isinstance(suggestion_ids, list) or not suggestion_ids:
                raise KnowledgeConfigError(f"Suggestion flow {intent!r} must be a non-empty list")
            if any(item not in suggestions for item in suggestion_ids):
                raise KnowledgeConfigError(f"Suggestion flow {intent!r} contains an unknown suggestion")
        model_escalation = payload.get("modelEscalation")
        try:
            max_output_tokens = int((model_escalation or {}).get("maxOutputTokens", 0))
        except (TypeError, ValueError) as exc:
            raise KnowledgeConfigError("modelEscalation maxOutputTokens must be an integer") from exc
        if (
            not isinstance(model_escalation, dict)
            or model_escalation.get("action") != "clarify"
            or not isinstance(model_escalation.get("systemPrompt"), str)
            or not 1 <= max_output_tokens <= 4096
        ):
            raise KnowledgeConfigError("modelEscalation must define clarify, systemPrompt and maxOutputTokens")
        keys: set[tuple[str, str]] = set()
        for definition in payload["definitions"]:
            if not isinstance(definition, dict):
                raise KnowledgeConfigError("Every error definition must be an object")
            key = (str(definition.get("operation", "")), str(definition.get("errorCode", "")))
            if not all(key) or key in keys or not definition.get("steps") or not definition.get("chunkId"):
                raise KnowledgeConfigError(f"Invalid or duplicate error definition: {key}")
            keys.add(key)
        with self._lock:
            self._payload = payload

    @property
    def dataset_version(self) -> str:
        with self._lock:
            return str(self._payload["datasetVersion"])

    def exact_lookup(self, operation: str, error_code: str) -> tuple[dict[str, Any], Citation] | None:
        with self._lock:
            definition = next((item for item in self._payload["definitions"]
                               if item["operation"] == operation and str(item["errorCode"]) == error_code), None)
            if definition is None:
                return None
            source = self._payload["source"]
            citation = Citation(
                sourceId=source["sourceId"], fileName=source["fileName"],
                documentVersion=source["documentVersion"], page=None,
                section=definition.get("section"), chunkId=definition["chunkId"],
                datasetVersion=self._payload["datasetVersion"],
            )
            return dict(definition), citation

    def suggestions_for(self, intent: str) -> list[AdvisorySuggestion]:
        with self._lock:
            suggestions = self._payload["suggestions"]
            ids = self._payload["suggestionFlow"].get(
                intent, self._payload["suggestionFlow"]["explain"]
            )
            return [AdvisorySuggestion.model_validate(suggestions[item]) for item in ids]

    @property
    def model_escalation(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._payload.get("modelEscalation") or {})


class AdvisoryAgent:
    def __init__(self, knowledge: PublishedKnowledgeStore):
        self._knowledge = knowledge
        self._last_responses: dict[str, AdvisoryResponse] = {}
        self._error_keys: dict[str, tuple] = {}
        self._history: dict[str, list[dict]] = {}
        self._clarifying: set[str] = set()
        self._lock = RLock()

    def advise(self, session_id: str, message: str, snapshot: ContextSnapshot | None = None) -> tuple[AdvisoryResponse, dict[str, Any]]:
        self.bind(session_id, snapshot)
        intent = self._intent(message)
        if intent == "repeat":
            with self._lock:
                previous = self._last_responses.get(session_id)
            if previous is not None:
                return previous.model_copy(deep=True), {"intent": intent, "reusedPrevious": True}

        context, error = self._read_current_error(snapshot)
        lookup = self._knowledge.exact_lookup(error.operation, error.error_code)
        if lookup is None:
            response = self._unsupported(error)
            self._remember(session_id, response)
            return response, self._trace(context, error, None, intent)

        definition, citation = lookup
        response = self._compose(definition, citation, intent)
        self._remember(session_id, response)
        return response, self._trace(context, error, citation, intent)

    def _read_current_error(
        self, snapshot: ContextSnapshot
    ) -> tuple[ScreenContext, CurrentErrorSnapshot]:
        if snapshot.error is None:
            raise AdvisoryUnavailableError("Không tìm thấy lỗi hiện tại trên màn hình.")
        return snapshot.context, snapshot.error

    @staticmethod
    def intent(message: str) -> str:
        normalized = message.casefold()
        if any(token in normalized for token in ("nhắc lại", "lặp lại", "repeat")):
            return "repeat"
        if any(token in normalized for token in ("đơn giản", "ngắn gọn", "dễ hiểu")):
            return "simplify"
        if any(token in normalized for token in ("làm rõ thêm", "làm rõ", "tra cứu thêm", "clarify")):
            return "clarify"
        if any(token in normalized for token in ("kỹ hơn", "chi tiết", "mở rộng")):
            return "expand"
        return "explain"

    _intent = intent

    def _compose(self, definition: dict[str, Any], citation: Citation, intent: str) -> AdvisoryResponse:
        raw_steps = list(definition["steps"])
        if intent == "simplify":
            summary = f"Mã {definition['errorCode']}: {definition['title']}."
            raw_steps = raw_steps[:1]
        elif intent in ("expand", "clarify"):
            summary = f"{definition['title']}. {definition['description']}"
        else:
            summary = str(definition["description"])
        steps = [AdvisoryStep(order=index, instruction=text, citations=[citation.chunk_id])
                 for index, text in enumerate(raw_steps, start=1)]
        fields = definition.get("clarificationFields") or []
        question = None
        if fields and intent != "simplify":
            question = "Bạn đã kiểm tra hạn mức còn lại trên màn hình chưa?" if fields[0] == "remainingLimitChecked" else "Bạn đang chọn chuyển thường hay chuyển nhanh 24/7?"
        suggestions = self._knowledge.suggestions_for(intent)
        speech = " ".join([summary, *[f"Bước {step.order}: {step.instruction}" for step in steps]])
        return AdvisoryResponse(errorSummary=summary, steps=steps, clarificationQuestion=question,
                                suggestions=suggestions, citations=[citation], speechText=speech)

    def _unsupported(self, error: CurrentErrorSnapshot) -> AdvisoryResponse:
        summary = f"Chưa tìm thấy hướng dẫn đã được phê duyệt cho mã lỗi {error.error_code}."
        return AdvisoryResponse(
            errorSummary=summary, steps=[], clarificationQuestion=None,
            suggestions=[AdvisorySuggestion(id="repeat", label="Thử lại sau", action="repeat")],
            citations=[], speechText=summary,
        )

    def _remember(self, session_id: str, response: AdvisoryResponse) -> None:
        with self._lock:
            self._last_responses[session_id] = response.model_copy(deep=True)
            history = self._history.setdefault(session_id, [])
            history.append({"description": response.error_summary, "steps": [step.instruction for step in response.steps]})
            del history[:-4]

    def clear(self, session_id: str):
        with self._lock:
            self._last_responses.pop(session_id, None)
            self._error_keys.pop(session_id, None)
            self._history.pop(session_id, None)
            self._clarifying.discard(session_id)

    def bind(self, session_id: str, snapshot: ContextSnapshot):
        error = snapshot.error
        key = (snapshot.context.screen_id, error.error_id, error.error_code, error.operation) if error else (snapshot.context.screen_id, None)
        with self._lock:
            if self._error_keys.get(session_id) != key:
                self.clear(session_id)
                self._error_keys[session_id] = key

    def is_clarifying(self, session_id: str):
        with self._lock:
            return session_id in self._clarifying

    def mark_clarifying(self, session_id: str):
        with self._lock:
            self._clarifying.add(session_id)

    def remember(self, session_id: str, response: AdvisoryResponse) -> None:
        self._remember(session_id, response)

    def model_prompt(
        self, session_id: str, snapshot: ContextSnapshot, question: str = "", address: str | None = None
    ) -> tuple[str, AdvisoryResponse, dict[str, Any]]:
        """Build an allowlisted prompt from published guidance, never raw form data."""
        self.bind(session_id, snapshot)
        context, error = self._read_current_error(snapshot)
        lookup = self._knowledge.exact_lookup(error.operation, error.error_code)
        if lookup is None:
            fallback = self._unsupported(error)
            return fallback.error_summary, fallback, self._trace(context, error, None, "clarify")

        definition, citation = lookup
        fallback = self._compose(definition, citation, "clarify")
        guidance = {
            "description": str(definition["description"]),
            "steps": [str(item) for item in definition["steps"]],
        }
        safe_question = question[:500]
        if address:
            name = address.split(" ", 1)[1] if " " in address else ""
            for value in (address, name):
                if value:
                    safe_question = re.sub(re.escape(value), "[khách hàng]", safe_question, flags=re.IGNORECASE)
        safe_question = re.sub(r"\S+@\S+|https?://\S+|\d+|(?i:bearer)\s+\S+", "[đã lọc]", safe_question)
        guidance["question"] = safe_question
        with self._lock:
            guidance["previousGuidance"] = list(self._history.get(session_id, []))
        prompt = (
            "Diễn đạt lại nội dung tư vấn dưới đây cho khách hàng bằng câu ngắn, dễ hiểu. "
            "Chỉ dùng dữ liệu được cung cấp, không thêm dữ kiện mới.\n"
            f"Dữ liệu tư vấn: {json.dumps(guidance, ensure_ascii=False)}"
        )
        return prompt, fallback, self._trace(context, error, citation, "clarify")

    @staticmethod
    def parse_model_response(text: str, fallback: AdvisoryResponse) -> AdvisoryResponse:
        """Convert the model's small text contract into the public advisory schema."""
        summary_match = re.search(r"(?im)^\s*Vấn đề\s*:\s*(.+?)\s*$", text)
        step_matches = re.findall(r"(?im)^\s*(?:Bước\s*)?(\d+)[.):]\s*(.+?)\s*$", text)
        if summary_match is None or not step_matches:
            raise ValueError("MODEL_RESPONSE_FORMAT_INVALID")

        def clean(value: str) -> str:
            return re.sub(r"[*_`]", "", value).strip()

        summary = clean(summary_match.group(1))
        instructions = [clean(instruction) for _, instruction in step_matches]
        if not summary or any(not instruction for instruction in instructions):
            raise ValueError("MODEL_RESPONSE_FORMAT_INVALID")

        citation_ids = fallback.steps[0].citations if fallback.steps else []
        steps = [
            AdvisoryStep(order=index, instruction=instruction, citations=citation_ids)
            for index, instruction in enumerate(instructions, start=1)
        ]
        speech = " ".join([summary, *[f"Bước {step.order}: {step.instruction}" for step in steps]])
        return fallback.model_copy(update={
            "error_summary": summary,
            "steps": steps,
            "clarification_question": None,
            "speech_text": speech,
        })

    def _trace(self, context: ScreenContext, error: CurrentErrorSnapshot, citation: Citation | None, intent: str) -> dict[str, Any]:
        return {
            "agent": "error-advisory", "intent": intent,
            "screenId": context.screen_id, "errorCode": error.error_code,
            "operation": error.operation, "datasetVersion": self._knowledge.dataset_version,
            "contextSource": context.source.value,
            "errorSource": error.source.value,
            "chunkIds": [citation.chunk_id] if citation else [],
        }
