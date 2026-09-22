from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from .scenario_models import AssistantData, Feature

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


class ErrorKind(StrEnum):
    INLINE = "inline"
    POPUP = "popup"
    PAGE = "page"
    TOAST = "toast"


class ErrorSnapshotSource(StrEnum):
    HOST_PROVIDER = "host-provider"
    NETWORK_INTERCEPTOR = "network-interceptor"
    DOM_EXTRACTOR = "dom-extractor"


class CurrentErrorSnapshot(StrictModel):
    error_id: str = Field(alias="errorId", min_length=1, max_length=128)
    error_code: str = Field(alias="errorCode", min_length=1, max_length=128)
    operation: str = Field(min_length=1, max_length=128)
    screen_id: str = Field(alias="screenId", min_length=1, max_length=128)
    field: str | None = Field(default=None, max_length=128)
    kind: ErrorKind
    occurred_at: datetime = Field(alias="occurredAt")
    observed_at: datetime = Field(alias="observedAt")
    source: ErrorSnapshotSource


class ContextSnapshot(StrictModel):
    context: ScreenContext
    error: CurrentErrorSnapshot | None = None

    @model_validator(mode="after")
    def context_and_error_are_consistent(self) -> "ContextSnapshot":
        if self.error is None:
            if self.context.error_code or self.context.last_error_id:
                raise ValueError("context with an error requires an error snapshot")
            return self
        if self.context.session_id == "" or self.error.screen_id != self.context.screen_id:
            raise ValueError("error snapshot must belong to the current screen")
        if self.context.error_code != self.error.error_code or self.context.last_error_id != self.error.error_id:
            raise ValueError("context and error snapshot identifiers are inconsistent")
        if self.context.last_operation != self.error.operation:
            raise ValueError("context and error snapshot operations are inconsistent")
        return self


class AgentChatRequest(StrictModel):
    session_id: str = Field(alias="sessionId", min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=1000)
    context_snapshot: ContextSnapshot = Field(alias="contextSnapshot")
    assistant_data: AssistantData | None = Field(alias="assistantData", default=None)
    features: list[Feature] = Field(default_factory=list, max_length=100)
    action_id: str | None = Field(alias="actionId", default=None, max_length=256)

    @model_validator(mode="after")
    def snapshot_belongs_to_session(self) -> "AgentChatRequest":
        if self.context_snapshot and self.context_snapshot.context.session_id != self.session_id:
            raise ValueError("context snapshot belongs to another session")
        if self.assistant_data and self.assistant_data.sessionId != self.session_id:
            raise ValueError("assistant data belongs to another session")
        return self


class Citation(StrictModel):
    source_id: str = Field(alias="sourceId")
    file_name: str = Field(alias="fileName")
    document_version: str = Field(alias="documentVersion")
    page: int | None = None
    section: str | None = None
    chunk_id: str = Field(alias="chunkId")
    dataset_version: str = Field(alias="datasetVersion")


class AdvisoryStep(StrictModel):
    order: int = Field(ge=1)
    instruction: str = Field(min_length=1)
    citations: list[str]


class AdvisorySuggestion(StrictModel):
    id: str
    label: str
    action: Literal["ask-follow-up", "navigate", "simplify", "expand", "clarify", "repeat"]
    route_id: RouteId | None = Field(alias="routeId", default=None)


class AdvisoryResponse(StrictModel):
    error_summary: str = Field(alias="errorSummary")
    steps: list[AdvisoryStep]
    clarification_question: str | None = Field(alias="clarificationQuestion", default=None)
    suggestions: list[AdvisorySuggestion]
    citations: list[Citation]
    speech_text: str = Field(alias="speechText")


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


class BridgeMessageType(StrEnum):
    ASSISTANT_READY = "assistant.ready"
    HOST_CONTEXT_CHANGED = "host.context.changed"
    HOST_CONTEXT_SNAPSHOT = "host.context.snapshot"
    ASSISTANT_CONTEXT_REQUESTED = "assistant.context.requested"
    ASSISTANT_NAVIGATION_REQUESTED = "assistant.navigation.requested"
    HOST_NAVIGATION_COMPLETED = "host.navigation.completed"
    ASSISTANT_PANEL_CHANGED = "assistant.panel.changed"
    HOST_ERROR_CHANGED = "host.error.changed"


class AssistantReadyPayload(StrictModel):
    assistant_instance_id: str = Field(alias="assistantInstanceId", min_length=1, max_length=128)
    supported_contract_versions: list[str] = Field(alias="supportedContractVersions", min_length=1)

    @model_validator(mode="after")
    def supports_current_contract(self) -> "AssistantReadyPayload":
        if "1.0" not in self.supported_contract_versions:
            raise ValueError("assistant must support contract version 1.0")
        return self


class ContextRequestedPayload(StrictModel):
    session_id: str = Field(alias="sessionId", min_length=1, max_length=128)
    reason: Literal["assistant-panel-opened", "context-missing", "context-stale"]


class NavigationRequestedPayload(StrictModel):
    route_id: RouteId = Field(alias="routeId")


class NavigationCompletedPayload(StrictModel):
    route_id: RouteId = Field(alias="routeId")
    screen_id: str = Field(alias="screenId", min_length=1, max_length=128)
    status: Literal["success", "rejected"]
    reason: str | None = Field(default=None, max_length=256)


class PanelChangedPayload(StrictModel):
    state: Literal["open", "closed"]


class ErrorChangedPayload(StrictModel):
    session_id: str = Field(alias="sessionId", min_length=1, max_length=128)
    screen_id: str = Field(alias="screenId", min_length=1, max_length=128)
    last_error_id: str | None = Field(alias="lastErrorId", max_length=128)
    has_error: bool = Field(alias="hasError")

    @model_validator(mode="after")
    def error_id_matches_flag(self) -> "ErrorChangedPayload":
        if self.has_error != bool(self.last_error_id):
            raise ValueError("hasError and lastErrorId are inconsistent")
        return self


class BridgeEnvelope(StrictModel):
    contract_version: Literal["1.0"] = Field(alias="contractVersion")
    request_id: str = Field(alias="requestId", min_length=1, max_length=128)
    type: BridgeMessageType
    timestamp: datetime
    payload: dict[str, Any]

    @model_validator(mode="after")
    def payload_matches_message_type(self) -> "BridgeEnvelope":
        payload_models: dict[BridgeMessageType, type[BaseModel]] = {
            BridgeMessageType.ASSISTANT_READY: AssistantReadyPayload,
            BridgeMessageType.HOST_CONTEXT_CHANGED: ScreenContext,
            BridgeMessageType.HOST_CONTEXT_SNAPSHOT: ContextSnapshot,
            BridgeMessageType.ASSISTANT_CONTEXT_REQUESTED: ContextRequestedPayload,
            BridgeMessageType.ASSISTANT_NAVIGATION_REQUESTED: NavigationRequestedPayload,
            BridgeMessageType.HOST_NAVIGATION_COMPLETED: NavigationCompletedPayload,
            BridgeMessageType.ASSISTANT_PANEL_CHANGED: PanelChangedPayload,
            BridgeMessageType.HOST_ERROR_CHANGED: ErrorChangedPayload,
        }
        payload_models[self.type].model_validate(self.payload)
        return self
