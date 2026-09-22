from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class RouteId(StrEnum):
    HOME = "home"
    TRANSFER = "transfer"
    QR_PAYMENT = "qr-payment"
    DISBURSEMENT = "disbursement"


class ScreenState(StrEnum):
    IDLE = "idle"
    EDITING = "editing"
    SUBMITTING = "submitting"
    SUCCESS = "success"
    ERROR = "error"


class ContextSource(StrEnum):
    HOST_API = "host-api"
    DOM_EXTRACTOR = "dom-extractor"


class ScreenContext(StrictModel):
    schema_version: Literal["1.0"] = Field(alias="schemaVersion")
    session_id: str = Field(alias="sessionId", min_length=1, max_length=128)
    screen_id: str = Field(alias="screenId", min_length=1, max_length=128)
    route_id: RouteId = Field(alias="routeId")
    screen_state: ScreenState = Field(alias="screenState")
    last_operation: str | None = Field(alias="lastOperation", default=None, max_length=128)
    last_error_id: str | None = Field(alias="lastErrorId", default=None, max_length=128)
    error_code: str | None = Field(alias="errorCode", default=None, max_length=128)
    locale: Literal["vi-VN"] = "vi-VN"
    captured_at: datetime = Field(alias="capturedAt")
    source: ContextSource

    @model_validator(mode="after")
    def error_state_is_consistent(self) -> "ScreenContext":
        if self.screen_state == ScreenState.ERROR and not self.last_error_id:
            raise ValueError("lastErrorId is required when screenState is error")
        if self.error_code and not self.last_error_id:
            raise ValueError("errorCode requires lastErrorId")
        return self


class DemoSessionRequest(StrictModel):
    username: str = Field(min_length=1, max_length=128)


class NavigationContextRequest(StrictModel):
    screen_id: str = Field(alias="screenId", min_length=1, max_length=128)
    route_id: RouteId = Field(alias="routeId")
    screen_state: ScreenState = Field(alias="screenState", default=ScreenState.IDLE)
    last_operation: str | None = Field(alias="lastOperation", default=None, max_length=128)


class DisbursementRequest(StrictModel):
    session_id: str = Field(alias="sessionId", min_length=1, max_length=128)
    payment_purpose: str = Field(alias="paymentPurpose", min_length=1, max_length=128)
    transfer_type: str = Field(alias="transferType", min_length=1, max_length=64)
    bank: str = Field(min_length=1, max_length=128)
    account_number: str = Field(alias="accountNumber", min_length=1, max_length=32)
    account_name: str | None = Field(alias="accountName", default=None, max_length=256)
    amount: int = Field(gt=0, le=999_999_999_999)
    content: str = Field(min_length=1, max_length=210)


class AppErrorRecord(StrictModel):
    error_id: str = Field(alias="errorId")
    session_id: str = Field(alias="sessionId")
    screen_id: str = Field(alias="screenId")
    operation: str
    error_code: str = Field(alias="errorCode")
    scenario_id: str = Field(alias="scenarioId")
    field: str | None = None
    title: str | None = None
    message: str
    occurred_at: datetime = Field(alias="occurredAt")


class DomFieldConfig(StrictModel):
    selector: str = Field(min_length=1, max_length=256)
    source: str = Field(min_length=1, max_length=64)

    @field_validator("selector")
    @classmethod
    def selector_must_be_constrained(cls, value: str) -> str:
        lowered = value.lower()
        forbidden = ("script", "iframe", "html", "body", ",", "*")
        if any(token in lowered for token in forbidden):
            raise ValueError("selector contains a forbidden token")
        if not value.startswith('[data-agent-field="'):
            raise ValueError("selector must use an allowlisted data-agent-field attribute")
        return value

    @field_validator("source")
    @classmethod
    def source_must_be_safe(cls, value: str) -> str:
        if value != "textContent" and not value.startswith("data-"):
            raise ValueError("source must be textContent or a data-* attribute")
        return value


class DomScreenConfig(StrictModel):
    route_id: RouteId = Field(alias="routeId")
    fields: dict[str, DomFieldConfig] = Field(min_length=1)


class HostApiConfig(StrictModel):
    context_endpoint: str = Field(alias="contextEndpoint")
    error_endpoint: str = Field(alias="errorEndpoint")

    @field_validator("context_endpoint", "error_endpoint")
    @classmethod
    def endpoint_must_be_relative(cls, value: str) -> str:
        if not value.startswith("/") or "://" in value:
            raise ValueError("endpoint must be an application-relative path")
        return value


class DomExtractorConfig(StrictModel):
    same_origin_required: bool = Field(alias="sameOriginRequired")
    screens: dict[str, DomScreenConfig] = Field(min_length=1)


class RedactionConfig(StrictModel):
    denied_fields: list[str] = Field(alias="deniedFields", min_length=1)


class ContextReaderConfig(StrictModel):
    version: Literal["1.0"]
    mode: ContextSource
    refresh_on: list[Literal[
        "assistant-panel-opened",
        "route-changed",
        "transaction-completed",
    ]] = Field(alias="refreshOn", min_length=1)
    host_api: HostApiConfig = Field(alias="hostApi")
    dom_extractor: DomExtractorConfig = Field(alias="domExtractor")
    redaction: RedactionConfig

