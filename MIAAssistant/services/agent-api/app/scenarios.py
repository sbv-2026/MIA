"""Published, deterministic conversation scenarios. No transaction tools."""
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from string import Formatter
from threading import RLock
from typing import Literal
import unicodedata

import yaml
from pydantic import Field, model_validator
from .models import ContextSnapshot
from .scenario_models import AssistantData, Feature, WireModel


class TodoType(WireModel):
    todoType: str = Field(min_length=1, max_length=128)
    todoName: str = Field(min_length=1, max_length=128)
    priority: int
    enabled: bool
    screenId: str = Field(min_length=1, max_length=128)


class Offering(WireModel):
    id: str = Field(min_length=1, max_length=128)
    productName: str = Field(min_length=1, max_length=128)
    description: str = Field(min_length=1)
    details: str = Field(min_length=1)
    screenId: str | None = Field(default=None, min_length=1, max_length=128)
    priority: int
    validFrom: datetime
    validUntil: datetime

    @model_validator(mode="after")
    def valid_dates(self):
        if self.validFrom.tzinfo is None or self.validUntil.tzinfo is None or self.validFrom >= self.validUntil:
            raise ValueError("Invalid offering validity range")
        return self


class Guide(WireModel):
    screenId: str = Field(min_length=1, max_length=128)
    operation: str = Field(min_length=1, max_length=128)
    topic: str = Field(min_length=1, max_length=128)
    steps: list[str] = Field(min_length=1)


class ScenarioConfig(WireModel):
    version: Literal["1.0"]
    status: Literal["published"]
    maxSpokenTodoTypes: int = Field(default=2, ge=1, le=100, strict=True)
    templates: dict[str, str]
    todoTypes: list[TodoType]
    offerings: list[Offering]
    guides: list[Guide]

    @model_validator(mode="after")
    def valid_config(self):
        fields = {
            "greeting": {"address", "pronoun"},
            "todos": {"address", "pronoun", "spokenTodoCount", "groups"},
            "offering": {"address", "pronoun", "productName"},
            "error": {"address", "errorCode"},
            "confirm": {"address", "featureName"},
            "guideHome": {"address"},
        }
        if set(self.templates) != set(fields):
            raise ValueError("Missing or unknown speech template")
        for key, template in self.templates.items():
            parsed = list(Formatter().parse(template))
            found = {field for _, field, _, _ in parsed if field is not None}
            if found != fields[key] or any(spec or conversion for _, _, spec, conversion in parsed):
                raise ValueError("Invalid template placeholders")
        for items, key in ((self.todoTypes, "todoType"), (self.offerings, "id")):
            if len({getattr(item, key) for item in items}) != len(items):
                raise ValueError("Duplicate configuration id")
        if len({(item.screenId, item.operation, item.topic) for item in self.guides}) != len(self.guides):
            raise ValueError("Duplicate guide")
        return self


class ScenarioRequest(WireModel):
    sessionId: str = Field(min_length=1, max_length=128)
    contextSnapshot: ContextSnapshot
    assistantData: AssistantData
    features: list[Feature] = Field(max_length=100)
    actionId: str | None = Field(default=None, max_length=256)
    message: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def bound_session(self):
        if self.contextSnapshot.context.session_id != self.sessionId or self.assistantData.sessionId != self.sessionId:
            raise ValueError("SESSION_MISMATCH")
        if len({f.screenId for f in self.features}) != len(self.features):
            raise ValueError("Duplicate supported screen")
        now = datetime.now(UTC)
        age = now - self.assistantData.capturedAt
        if age > timedelta(minutes=5) or age < timedelta(minutes=-1):
            raise ValueError("ASSISTANT_DATA_STALE")
        context = self.contextSnapshot.context
        if context.captured_at.tzinfo is None:
            raise ValueError("CONTEXT_TIMEZONE_REQUIRED")
        age = now - context.captured_at
        if age > timedelta(minutes=5) or age < timedelta(minutes=-1):
            raise ValueError("CONTEXT_SNAPSHOT_STALE")
        error = self.contextSnapshot.error
        if error and (error.observed_at.tzinfo is None or now - error.observed_at > timedelta(minutes=5) or now - error.observed_at < timedelta(minutes=-1)):
            raise ValueError("ERROR_SNAPSHOT_STALE")
        return self


def normalized(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text.lower().replace("đ", "d")) if unicodedata.category(c) != "Mn")


class ScenarioStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock = RLock()
        self.reload()

    def reload(self):
        candidate = ScenarioConfig.model_validate(yaml.safe_load(self.path.read_text(encoding="utf-8")))
        with self.lock:
            self.active = candidate

    def config(self):
        with self.lock:
            return self.active.model_copy(deep=True)

    @staticmethod
    def speech(config, recipient, key, **values):
        text = config.templates[key].format(address=recipient.address, pronoun=recipient.pronoun, **values)
        # Capitalize sentence starts without lowercasing configured names/products.
        import re
        return re.sub(r"(^|[.!?]\s+)(\w)", lambda m: m[1] + m[2].upper(), text)

    def offering(self, config, data):
        now = datetime.now(UTC)
        return next(iter(sorted((o for o in config.offerings if o.id in data.offeringIds and o.validFrom <= now < o.validUntil), key=lambda o: (-o.priority, o.id))), None)

    def menu(self, req, config):
        choices = []
        if any(t.enabled and any(todo.todoType == t.todoType for todo in req.assistantData.todoList) for t in config.todoTypes):
            choices.append({"id": "todos", "label": "Việc cần làm", "actionId": "todos"})
        offering = self.offering(config, req.assistantData)
        if offering:
            choices.append({"id": "offering", "label": "Đề xuất sản phẩm", "actionId": f"offering:{offering.id}"})
        choices.append({"id": "transactions", "label": "Thực hiện giao dịch", "actionId": "transactions"})
        if req.contextSnapshot.error:
            choices.append({"id": "error", "label": "Hỗ trợ lỗi hiện tại", "actionId": "error"})
        choices.extend([
            {"id": "guide", "label": "Hướng dẫn sử dụng", "actionId": "guide"},
            {"id": "other", "label": "Yêu cầu khác", "actionId": "other"},
        ])
        return choices

    def bootstrap(self, req):
        config = self.config()
        known_types = {item.todoType for item in config.todoTypes}
        if any(todo.todoType not in known_types for todo in req.assistantData.todoList):
            raise ValueError("UNKNOWN_TODO_TYPE")
        if any(item not in {o.id for o in config.offerings} for item in req.assistantData.offeringIds):
            raise ValueError("UNKNOWN_OFFERING")
        recipient = req.assistantData.recipient
        utterances = []
        # Errors take precedence on every screen, including Home. Guarantee
        # failures are presented on Home, so checking Home first would return
        # the greeting sequence and silently omit the automatic error prompt.
        if req.contextSnapshot.error:
            utterances.append({"kind": "error", "text": self.speech(
                config, recipient, "error", errorCode=req.contextSnapshot.error.error_code,
            ), "delayMs": 0, "hideAfterMs": None})
        elif req.contextSnapshot.context.screen_id == "home":
            utterances.append({"kind": "greeting", "text": self.speech(config, recipient, "greeting"), "delayMs": 0, "hideAfterMs": 1000})
            counts = Counter(todo.todoType for todo in req.assistantData.todoList)
            selected = sorted((t for t in config.todoTypes if t.enabled and counts[t.todoType]), key=lambda t: (-t.priority, t.todoType))[:config.maxSpokenTodoTypes]
            if selected:
                groups = ", ".join(f"{counts[t.todoType]} việc {t.todoName}" for t in selected)
                utterances.append({"kind": "todos", "text": self.speech(config, recipient, "todos", spokenTodoCount=sum(counts[t.todoType] for t in selected), groups=groups), "delayMs": 0, "hideAfterMs": None})
            offering = self.offering(config, req.assistantData)
            if offering:
                offering_text = self.speech(config, recipient, "offering", productName=offering.productName)
                # The direct address is spoken by the todo reminder immediately before
                # the offering, so do not repeat it in the same Home sequence.
                if selected:
                    import re
                    offering_text = re.sub(rf"^{re.escape(recipient.address)}\s*ơi[.!]?\s*", "", offering_text, flags=re.I)
                    offering_text = offering_text[:1].upper() + offering_text[1:]
                if offering.id == "business-credit":
                    offering_text = "MIA thấy với số dư bình quân 3 ngày gần nhất, " + offering_text[:1].lower() + offering_text[1:]
                utterances.append({"kind": "offering", "text": offering_text, "delayMs": 2000, "hideAfterMs": None})
        return {"sessionId": req.sessionId, "utterances": utterances, "suggestions": self.menu(req, config)}

    def answer(self, req):
        config = self.config()
        self.bootstrap(req)  # Validate references even for direct action requests.
        action = req.actionId
        text = normalized(req.message.strip())
        if not action:
            matches = [f for f in req.features if any(normalized(alias) in text for alias in [f.name, *f.aliases] if alias.strip())]
            if "huong dan" in text:
                action = "guide-feature:" + matches[0].screenId if len(matches) == 1 else "guide"
            elif len(matches) == 1:
                action = "navigate:" + matches[0].screenId
            elif len(matches) > 1:
                return self.response("MIA cần xác nhận tính năng.", suggestions=[self.nav_choice(f) for f in matches])
            elif "viec" in text:
                action = "todos"
            elif "huong dan" in text:
                action = "guide"
            elif "san pham" in text or "offering" in text:
                offering = self.offering(config, req.assistantData)
                action = "offering:" + offering.id if offering else "other"
            else:
                action = "other"
        if req.actionId == "other":
            return self.response("Bạn có thể nhập yêu cầu hoặc bấm Nói. MIA sẽ hỏi thêm nếu cần và xác nhận tính năng bạn muốn mở.")
        if action == "todos":
            types = {t.todoType: t for t in config.todoTypes}
            counts = Counter(todo.todoType for todo in req.assistantData.todoList)
            choices = []
            for type_id, count in sorted(counts.items(), key=lambda pair: (-types[pair[0]].priority, pair[0])):
                item = types[type_id]
                target = next((f for f in req.features if f.screenId == item.screenId), None)
                choices.append({"id": type_id, "label": f"{count} việc {item.todoName}", "actionId": "todo-type:" + type_id if target else "unavailable"})
            return self.response("Chọn nhóm việc cần làm." if counts else "Hiện không có việc cần làm.", suggestions=choices)
        if action.startswith("offering:"):
            offering = self.offering(config, req.assistantData)
            if not offering or action != "offering:" + offering.id:
                raise ValueError("OFFERING_UNAVAILABLE")
            navigation = None
            category_path = None
            if offering.screenId:
                feature = next((item for item in req.features if item.screenId == offering.screenId), None)
                if feature:
                    navigation = feature.model_dump(exclude={"aliases", "categoryPath"})
                    category_path = feature.categoryPath
            return self.response(
                f"{offering.productName}. {req.assistantData.recipient.pronoun[:1].upper() + req.assistantData.recipient.pronoun[1:]} có muốn mở trang thông tin sản phẩm không ạ?",
                steps=[offering.description, offering.details],
                citations=[self.citation(config, "offering:" + offering.id)],
                navigation=navigation,
                categoryPath=category_path,
            )
        if action == "guide" and req.contextSnapshot.context.screen_id == "home":
            return self.response(self.speech(config, req.assistantData.recipient, "guideHome"), suggestions=[{"id": f.screenId, "label": f.name, "actionId": "guide-feature:" + f.screenId} for f in req.features if f.screenId != "home"])
        if action == "guide" or action.startswith("guide-feature:"):
            screen_id = action.split(":", 1)[1] if action.startswith("guide-feature:") else req.contextSnapshot.context.screen_id
            feature = next((f for f in req.features if f.screenId == screen_id), None)
            if not feature:
                return self.response("Chưa có hướng dẫn cho màn hình này.")
            guides = [g for g in config.guides if g.screenId == screen_id and (action.startswith("guide-feature:") or g.operation == req.contextSnapshot.context.last_operation)]
            return self.response("Chọn chủ đề hướng dẫn.", suggestions=[{"id": str(i), "label": g.topic, "actionId": "guide-topic:" + str(config.guides.index(g))} for i, g in enumerate(guides)]) if guides else self.response("Chưa có hướng dẫn được xuất bản cho màn hình này.")
        if action.startswith("guide-topic:"):
            try:
                index = int(action.split(":", 1)[1])
                if index < 0:
                    raise ValueError()
                guide = config.guides[index]
            except (ValueError, IndexError):
                raise ValueError("GUIDE_UNAVAILABLE")
            feature = next((f for f in req.features if f.screenId == guide.screenId), None)
            if not feature:
                raise ValueError("GUIDE_UNAVAILABLE")
            return self.response(guide.topic, steps=guide.steps, citations=[self.citation(config, guide.topic)], suggestions=[self.nav_choice(feature)])
        if action.startswith("todo:"):
            todo = next((item for item in req.assistantData.todoList if item.id == action.split(":", 1)[1]), None)
            kind = next((item for item in config.todoTypes if todo and item.todoType == todo.todoType and item.enabled), None)
            feature = next((item for item in req.features if kind and item.screenId == kind.screenId), None)
            if not todo or not feature:
                raise ValueError("TODO_UNAVAILABLE")
            text = f"{req.assistantData.recipient.address[:1].upper() + req.assistantData.recipient.address[1:]} muốn xem chi tiết {kind.todoName} đúng không ạ?"
            navigation = {**feature.model_dump(exclude={"aliases", "categoryPath"}), "todoId": todo.id}
            return self.response(f"{text}: {todo.loanAccount}" if todo.loanAccount else text, navigation=navigation, categoryPath=feature.categoryPath, speechText=text)
        if action.startswith("navigate:"):
            feature = next((f for f in req.features if f.screenId == action.split(":", 1)[1]), None)
            if not feature:
                raise ValueError("NAVIGATION_UNAVAILABLE")
            return self.response(self.speech(config, req.assistantData.recipient, "confirm", featureName=feature.name), navigation=feature.model_dump(exclude={"aliases", "categoryPath"}), categoryPath=feature.categoryPath)
        if action == "unavailable":
            return self.response("Tính năng này chưa được Host hỗ trợ.")
        if action == "error":
            error = req.contextSnapshot.error
            if not error:
                raise ValueError("ERROR_CONTEXT_REQUIRED")
            return self.response(self.speech(
                config, req.assistantData.recipient, "error", errorCode=error.error_code,
            ), suggestions=[{"id": "explain", "label": "Đồng ý hỗ trợ", "actionId": "advisory:explain"}])
        return self.response("MIA có thể hỗ trợ phần nào ạ? Vui lòng chọn gợi ý hoặc nói rõ tính năng cần tìm.", suggestions=self.menu(req, config))

    @staticmethod
    def nav_choice(feature):
        return {"id": feature.screenId, "label": " › ".join(feature.categoryPath) if feature.categoryPath else "Truy cập " + feature.name, "actionId": "navigate:" + feature.screenId}

    @staticmethod
    def citation(config, section):
        return {"fileName": "mia-scenarios.yaml", "section": section, "version": config.version}

    @staticmethod
    def response(text, steps=None, suggestions=None, citations=None, **extra):
        steps = steps or []
        return {"text": text, "speechText": " ".join([text, *steps]), "steps": steps, "suggestions": suggestions or [], "citations": citations or [], **extra}
