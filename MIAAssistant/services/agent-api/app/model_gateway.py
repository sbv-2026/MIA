from __future__ import annotations

import json
import os
import time
from collections.abc import Iterator
from dataclasses import dataclass
from urllib.parse import urljoin

import httpx


class ModelGatewayError(RuntimeError):
    pass


@dataclass(frozen=True)
class ModelGatewayConfig:
    provider: str
    base_url: str
    api_key: str
    model: str
    api_style: str
    timeout_seconds: float

    @classmethod
    def from_env(cls) -> "ModelGatewayConfig":
        provider = os.getenv("MIA_MODEL_PROVIDER", "external-model").strip().lower()
        legacy_base_url = os.getenv("MIA_MODEL_BASE_URL", "").strip()
        legacy_api_key = os.getenv("MIA_MODEL_API_KEY", "").strip()
        legacy_model = os.getenv("MIA_MODEL_NAME", "").strip()
        legacy_api_style = os.getenv("MIA_MODEL_API_STYLE", "chat-completions").strip()
        if provider == "glm":
            base_url = os.getenv("MIA_GLM_BASE_URL", "").strip() or legacy_base_url
            api_key = os.getenv("MIA_GLM_API_KEY", "").strip() or legacy_api_key
            model = os.getenv("MIA_GLM_MODEL", "").strip() or legacy_model
            api_style = os.getenv("MIA_GLM_API_STYLE", "").strip() or legacy_api_style
        elif provider == "gemini":
            base_url = os.getenv("MIA_GEMINI_BASE_URL", "").strip() or "https://generativelanguage.googleapis.com/v1beta/openai/"
            api_key = os.getenv("MIA_GEMINI_API_KEY", "").strip()
            model = os.getenv("MIA_GEMINI_MODEL", "").strip()
            api_style = "chat-completions"
        else:
            base_url, api_key, model, api_style = legacy_base_url, legacy_api_key, legacy_model, legacy_api_style
        return cls(
            provider=provider,
            base_url=base_url,
            api_key=api_key,
            model=model,
            api_style=api_style,
            timeout_seconds=float(os.getenv("MIA_MODEL_TIMEOUT_SECONDS", "45")),
        )

    @property
    def enabled(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)


class ModelGateway:
    """Server-side streaming adapter for OpenAI Responses or compatible chat APIs."""

    def __init__(self, config: ModelGatewayConfig | None = None):
        self.config = config or ModelGatewayConfig.from_env()

    def stream(
        self, prompt: str, *, system_prompt: str, max_output_tokens: int,
        timeout_seconds: float | None = None,
        input_file: dict[str, str] | None = None,
        response_schema: dict[str, object] | None = None,
    ) -> Iterator[tuple[str, object]]:
        if not self.config.enabled:
            raise ModelGatewayError("MODEL_GATEWAY_NOT_CONFIGURED")
        if self.config.provider == "gemini" and response_schema:
            yield from self._stream_gemini_structured(
                prompt,
                system_prompt=system_prompt,
                max_output_tokens=max_output_tokens,
                timeout_seconds=timeout_seconds,
                input_file=input_file,
                response_schema=response_schema,
            )
            return
        if self.config.api_style == "responses":
            path = "responses"
            user_input: object = prompt
            if input_file:
                file_data = f'data:{input_file["mimeType"]};base64,{input_file["contentBase64"]}'
                user_input = [{'role': 'user', 'content': [
                    {'type': 'input_text', 'text': prompt},
                    {'type': 'input_file', 'filename': input_file['name'], 'file_data': file_data},
                ]}]
            payload = {
                "model": self.config.model,
                "instructions": system_prompt,
                "input": user_input,
                "max_output_tokens": max_output_tokens,
                "store": False,
                "stream": True,
            }
        elif self.config.api_style == "chat-completions":
            path = "chat/completions"
            user_content: object = prompt
            if input_file:
                file_data = f'data:{input_file["mimeType"]};base64,{input_file["contentBase64"]}'
                user_content = [
                    {'type': 'text', 'text': prompt},
                    {'type': 'file', 'file': {'filename': input_file['name'], 'file_data': file_data}},
                ]
            payload = {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                "max_tokens": max_output_tokens,
                "stream": True,
            }
            if self.config.provider.strip().lower() == "openai":
                payload["stream_options"] = {"include_usage": True}
        else:
            raise ModelGatewayError("MODEL_GATEWAY_API_STYLE_INVALID")

        url = urljoin(self.config.base_url.rstrip("/") + "/", path)
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        request_timeout = timeout_seconds or self.config.timeout_seconds
        deadline = time.monotonic() + request_timeout
        try:
            with httpx.Client(timeout=request_timeout) as client:
                with client.stream("POST", url, headers=headers, json=payload) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        if time.monotonic() >= deadline:
                            raise ModelGatewayError("MODEL_GATEWAY_DEADLINE_EXCEEDED")
                        if not line.startswith("data: "):
                            continue
                        raw = line[6:]
                        if raw == "[DONE]":
                            break
                        event = json.loads(raw)
                        if self.config.api_style == "responses":
                            if (
                                event.get("type") == "response.output_text.delta"
                                and event.get("delta")
                            ):
                                yield "token", str(event["delta"])
                            elif event.get("type") == "response.completed":
                                yield "usage", (event.get("response") or {}).get("usage") or {}
                        else:
                            choices = event.get("choices") or []
                            delta = (
                                (choices[0].get("delta") or {}).get("content")
                                if choices
                                else None
                            )
                            if delta:
                                yield "token", str(delta)
                            if event.get("usage"):
                                yield "usage", event["usage"]
        except ModelGatewayError:
            raise
        except (httpx.HTTPError, json.JSONDecodeError, KeyError, TypeError) as exc:
            raise ModelGatewayError("MODEL_GATEWAY_STREAM_FAILED") from exc

    def _stream_gemini_structured(
        self, prompt: str, *, system_prompt: str, max_output_tokens: int,
        timeout_seconds: float | None,
        input_file: dict[str, str] | None,
        response_schema: dict[str, object],
    ) -> Iterator[tuple[str, object]]:
        """Use Gemini's native API for schema-constrained streamed JSON.

        The OpenAI-compatible endpoint is useful for plain chat, but native
        inlineData and responseJsonSchema are the reliable document extraction
        contract. Files accepted by this service are capped at 10 MB, so an
        inline part avoids upload lifecycle polling for this one-shot request.
        """
        parts: list[dict[str, object]] = []
        if input_file:
            parts.append({"inlineData": {
                "mimeType": input_file["mimeType"],
                "data": input_file["contentBase64"],
            }})
        parts.append({"text": prompt})
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": max_output_tokens,
                "responseMimeType": "application/json",
                "responseJsonSchema": response_schema,
            },
        }
        root = self.config.base_url.split("/openai", 1)[0].rstrip("/")
        url = f"{root}/models/{self.config.model}:streamGenerateContent?alt=sse"
        headers = {
            "x-goog-api-key": self.config.api_key,
            "Content-Type": "application/json",
        }
        request_timeout = timeout_seconds or self.config.timeout_seconds
        deadline = time.monotonic() + request_timeout
        try:
            with httpx.Client(timeout=request_timeout) as client:
                with client.stream("POST", url, headers=headers, json=payload) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        if time.monotonic() >= deadline:
                            raise ModelGatewayError("MODEL_GATEWAY_DEADLINE_EXCEEDED")
                        if not line.startswith("data: "):
                            continue
                        event = json.loads(line[6:])
                        candidates = event.get("candidates") or []
                        content = (candidates[0].get("content") or {}) if candidates else {}
                        for part in content.get("parts") or []:
                            if part.get("text"):
                                yield "token", str(part["text"])
                        usage = event.get("usageMetadata")
                        if usage:
                            yield "usage", usage
        except ModelGatewayError:
            raise
        except (httpx.HTTPError, json.JSONDecodeError, KeyError, TypeError) as exc:
            raise ModelGatewayError("MODEL_GATEWAY_STREAM_FAILED") from exc
