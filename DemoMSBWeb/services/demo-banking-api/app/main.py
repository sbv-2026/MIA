from __future__ import annotations

import os
import json
import re
from urllib.request import Request as UrlRequest, urlopen
from urllib.error import HTTPError, URLError
from pydantic import BaseModel, ConfigDict, Field, field_validator
import yaml
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles

from .config import ContextReaderConfigManager
from .assistant_data import AssistantDataStore
from .context_store import ContextNotFoundError, InMemoryContextStore
from .models import AppErrorRecord, ContextSource, DemoSessionRequest, DisbursementRequest, NavigationContextRequest, RouteId, ScreenContext, ScreenState
from .scenarios import DisbursementScenarioEngine, ScenarioConfigError
from .lc_fields import LC_INFORMATION_FIELDS

PROJECT_ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = Path(os.getenv("CONTEXT_READER_CONFIG", PROJECT_ROOT / "config/context-reader.yaml"))
SCENARIO_PATH = Path(os.getenv("DEMO_SCENARIO_CONFIG", PROJECT_ROOT / "config/demo-transaction-scenarios.yaml"))
WEB_DIST = PROJECT_ROOT / "apps/web/dist"

GUARANTEE_ERRORS = {
    "50001": {
        "title": "Không đủ vai trò thực hiện Bảo lãnh",
        "message": "Quý khách không thể tạo lệnh do không phải là Kế toán trưởng hoặc Kế toán trưởng ủy quyền. Vui lòng kiểm tra lại.",
    },
    "50002": {
        "title": "Chưa xác định Người đại diện vay vốn",
        "message": "Dịch vụ tín dụng yêu cầu người dùng cuối phải là Người đại diện vay vốn. Vui lòng kiểm tra lại.",
    },
}


def assistant_config() -> dict[str, object]:
    assistant_url = os.getenv("ASSISTANT_URL", "http://localhost:8090/assistant/").strip()
    parsed = urlsplit(assistant_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise RuntimeError("INVALID_ASSISTANT_URL")
    normalized_url = assistant_url if assistant_url.endswith("/") else assistant_url + "/"
    return {
        "assistantUrl": normalized_url,
        "assistantOrigin": f"{parsed.scheme}://{parsed.netloc}",
        "contractVersion": "1.0",
        "scenarioContractVersion": "1.1",
        "enabled": os.getenv("MIA_SCENARIOS_ENABLED", "true").lower() != "false",
    }


def guarantee_error_config() -> dict[str, object]:
    # Prefer the correctly-spelled setting, while retaining compatibility with
    # existing local .env files. An empty legacy value must not mask it.
    configured = (
        os.getenv("CONFIG_GUARANTEE_ERROR", "").strip()
        or os.getenv("CONFIG_GURANTEE_ERROR", "").strip()
    )
    if not configured:
        return {"enabled": False}
    error_code = {"maloi1": "50001", "maloi2": "50002"}.get(configured.lower(), configured)
    definition = GUARANTEE_ERRORS.get(error_code)
    if definition is None:
        raise HTTPException(status_code=500, detail="CONFIG_GUARANTEE_ERROR must be Maloi1, Maloi2, 50001 or 50002")
    return {
        "enabled": True,
        "feature": "Bảo lãnh",
        "operation": "guarantee.create",
        "error": {"errorCode": error_code, **definition},
    }

config_manager = ContextReaderConfigManager(CONFIG_PATH)
context_store = InMemoryContextStore()
scenario_engine = DisbursementScenarioEngine(SCENARIO_PATH)
assistant_data_store = AssistantDataStore(
    Path(os.getenv("DEMO_USERS_CONFIG", PROJECT_ROOT / "config/demo-users.yaml")),
    Path(os.getenv("DEMO_ASSISTANT_DATA_CONFIG", PROJECT_ROOT / "config/demo-assistant-data.yaml")),
)
app = FastAPI(title="DemoMSBWeb Banking API", version="0.1.0")


class SupportSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    phoneNumber: str = Field(default="", max_length=32, pattern=r"^[+\d ()-]*$")
    companyName: str = Field(default="", max_length=256)
    screenshot: str = Field(min_length=1, max_length=6_000_000)
    consent: bool
    errorId: str = Field(min_length=1, max_length=128)
    screenUrl: str = Field(default="", max_length=2048)
    recipientEmails: list[str] = Field(min_length=1, max_length=10)

    @field_validator("recipientEmails")
    @classmethod
    def valid_recipient_emails(cls, values):
        normalized = [value.strip().lower() for value in values]
        if any(not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value) for value in normalized):
            raise ValueError("RECIPIENT_EMAIL_INVALID")
        if len(set(normalized)) != len(normalized):
            raise ValueError("RECIPIENT_EMAIL_DUPLICATE")
        return normalized


class PresentedErrorSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    errorId: str = Field(min_length=1, max_length=128)
    errorCode: str = Field(min_length=1, max_length=64)
    scenarioId: str = Field(min_length=1, max_length=128)
    operation: str = Field(min_length=1, max_length=128)
    field: str | None = Field(default=None, max_length=128)
    title: str | None = Field(default=None, max_length=256)
    message: str = Field(min_length=1, max_length=2000)


class LcDraftSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fields: dict[str, str] = Field(max_length=50)
    missingFields: list[str] = Field(max_length=50)


lc_drafts: dict[str, dict[str, object]] = {}


@app.get('/api/host/lc-fields/{session_id}')
def get_lc_fields(session_id: str):
    if session_id not in assistant_data_store.sessions:
        raise HTTPException(status_code=404, detail='SESSION_NOT_FOUND')
    return {'screenId': 'letter-of-credit-issue', 'step': 'Thông tin L/C', 'fields': LC_INFORMATION_FIELDS}


@app.post("/api/host/lc-draft/{session_id}")
def save_lc_draft(session_id: str, request: LcDraftSubmission):
    if session_id not in assistant_data_store.sessions:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    if any(len(key) > 64 or len(value) > 1000 for key, value in request.fields.items()):
        raise HTTPException(status_code=422, detail="LC_DRAFT_INVALID")
    payload = {"fields": request.fields, "missingFields": request.missingFields, "updatedAt": datetime.now(UTC).isoformat()}
    lc_drafts[session_id] = payload
    return payload


@app.get("/api/host/lc-draft/{session_id}")
def get_lc_draft(session_id: str):
    if session_id not in assistant_data_store.sessions:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    return lc_drafts.get(session_id, {"fields": {}, "missingFields": []})


@app.get("/api/host/support-profile/{session_id}")
def support_profile(session_id: str):
    try:
        return assistant_data_store.support_profile(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND") from exc


@app.post("/api/host/support/{session_id}")
def support_submit(session_id: str, request: SupportSubmission):
    if request.consent is not True:
        raise HTTPException(status_code=422, detail="CONSENT_REQUIRED")
    try:
        profile = assistant_data_store.support_profile(session_id)
        context = context_store.get(session_id)
    except (KeyError, ContextNotFoundError) as exc:
        raise HTTPException(status_code=404, detail="SESSION_OR_ERROR_NOT_FOUND") from exc
    try:
        error = context_store.get_error(session_id)
    except ContextNotFoundError:
        error = None
    # Inline validation and incomplete-form popups are rendered locally from
    # published host rules. Resolve their identity against that same config.
    if error is None and context.screen_id == "domestic-disbursement-create":
        config = scenario_engine.public_config()
        rules = [rule for group in config['inlineErrors'].values() for rule in group]
        local_rules = [("inline-" + rule['id'], rule) for rule in rules] + [("local-" + rule['id'], rule) for rule in config['popupErrors']['continue']]
        rule = next((rule for identity, rule in local_rules if identity == request.errorId), None)
        if rule:
            error = AppErrorRecord(errorId=request.errorId, sessionId=session_id, screenId=context.screen_id, operation=config['operation'], errorCode=str(rule['errorCode']), scenarioId=rule['id'], field=rule.get('field'), title=rule.get('title'), message=rule['message'], occurredAt=datetime.now(UTC))
            context = make_context(session_id, context.screen_id, context.route_id, ScreenState.ERROR, error.operation, error)
    # The guarantee demo popup is rendered from published host configuration and
    # therefore has no persisted AppErrorRecord. Rebuild only the currently
    # configured error identity, just as we do for local disbursement rules.
    if error is None and context.screen_id == "home":
        config = guarantee_error_config()
        definition = config.get("error") if config.get("enabled") else None
        error_code = str(definition["errorCode"]) if isinstance(definition, dict) else ""
        prefix = f"guarantee-{error_code}-"
        occurrence = request.errorId.removeprefix(prefix)
        if error_code and request.errorId.startswith(prefix) and occurrence.isdigit():
            error = AppErrorRecord(
                errorId=request.errorId,
                sessionId=session_id,
                screenId=context.screen_id,
                operation=str(config["operation"]),
                errorCode=error_code,
                scenarioId=f"guarantee-{error_code}",
                title=str(definition["title"]),
                message=str(definition["message"]),
                occurredAt=datetime.now(UTC),
            )
            context = make_context(session_id, context.screen_id, context.route_id, ScreenState.ERROR, error.operation, error)
    if not error or error.error_id != request.errorId:
        raise HTTPException(status_code=409, detail="ERROR_CONTEXT_CHANGED")
    now = datetime.now(UTC).isoformat()
    snapshot = {"context": {**context.model_dump(by_alias=True, mode="json"), "capturedAt": now}, "error": {"errorId": error.error_id, "errorCode": error.error_code, "operation": error.operation, "screenId": error.screen_id, "field": error.field, "kind": "inline" if error.field else "popup", "occurredAt": error.occurred_at.isoformat(), "observedAt": now, "source": "host-provider"}}
    payload = {"sessionId": session_id, "contextSnapshot": snapshot, "contact": {**profile, "phoneNumber": request.phoneNumber, "companyName": request.companyName}, "recipientEmails": request.recipientEmails, "screenshot": request.screenshot, "consent": True, "screenUrl": request.screenUrl}
    origin = str(assistant_config()["assistantOrigin"])
    url = os.getenv("MIA_SUPPORT_ASSISTANT_API_URL", origin).rstrip("/") + "/api/agent/support"
    try:
        with urlopen(UrlRequest(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST"), timeout=45) as response:
            return json.load(response)
    except HTTPError as exc:
        detail = json.loads(exc.read()).get("detail", "SUPPORT_UNAVAILABLE")
        raise HTTPException(status_code=exc.code, detail=detail) from exc
    except (URLError, TimeoutError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Không thể chuyển hồ sơ hỗ trợ. Quý khách có thể thử lại.") from exc


def make_context(session_id: str, screen_id: str, route_id: RouteId, state: ScreenState = ScreenState.IDLE, operation: str | None = None, error: AppErrorRecord | None = None) -> ScreenContext:
    return ScreenContext(schemaVersion="1.0", sessionId=session_id, screenId=screen_id, routeId=route_id, screenState=state, lastOperation=operation, lastErrorId=error.error_id if error else None, errorCode=error.error_code if error else None, locale="vi-VN", capturedAt=datetime.now(UTC), source=ContextSource.HOST_API)


@app.middleware("http")
async def host_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.endswith(".html"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
    assistant_origin = assistant_config()["assistantOrigin"]
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        f"connect-src 'self' {assistant_origin}; frame-src {assistant_origin}"
    )
    return response


@app.get("/health")
def health(): return {"status": "ok"}


@app.get("/readyz")
def readyz(): return {"status": "ready", "contextReaderMode": config_manager.active.mode.value, "configVersion": config_manager.active.version}


@app.get("/api/config/context-reader")
def context_config(): return config_manager.active.model_dump(by_alias=True, mode="json")


@app.get("/api/config/assistant")
def get_assistant_config(): return assistant_config()


@app.get("/api/config/guarantee-error")
def get_guarantee_error_config(): return guarantee_error_config()


@app.get("/api/config/demo-users")
def get_demo_users():
    return {"users": assistant_data_store.list_users()}


@app.post("/api/demo/session")
def create_session(request: DemoSessionRequest):
    session_id = f"demo-{uuid4().hex[:12]}"
    context = make_context(session_id, "home", RouteId.HOME)
    context_store.put(context); context_store.clear_error(session_id)
    display_name = assistant_data_store.create_session(session_id, request.username)
    return {"sessionId": session_id, "displayName": display_name, "context": context.model_dump(by_alias=True, mode="json")}


@app.get("/api/host/assistant-data/{session_id}")
def assistant_data(session_id: str, details: bool = False):
    try:
        return assistant_data_store.get(session_id, details=details)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND") from exc


@app.get("/api/host/credit-information/{session_id}")
def credit_information(session_id: str):
    try:
        data = assistant_data_store.get(session_id, details=True)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND") from exc
    loans = []
    for todo in data["todoList"]:
        if todo["todotype"] != "overdue-loan":
            continue
        overdue = int(todo["amount"] or 25_000_000)
        loans.append({
            "todoId": todo["todolistID"], "accountNumber": todo["loanAccount"],
            "disbursedAmount": overdue * 10, "outstanding": overdue * 8,
            "currency": "VND", "disbursementDate": "2025-09-15",
            "maturityDate": todo["dueDate"], "termMonths": 12, "interestRate": 8.5,
            "status": "overdue", "overduePrincipal": overdue * 9 // 10,
            "overdueInterest": overdue - overdue * 9 // 10, "penalty": 0,
            "nextPrincipal": overdue * 9 // 10, "nextInterest": overdue - overdue * 9 // 10,
            "repaymentDate": todo["dueDate"], "collectionAccount": "012345678901",
            "product": "Business credit", "history": [{"date": "2025-09-15", "description": "Disbursement", "amount": overdue * 10}],
            "schedule": [{"date": todo["dueDate"], "principal": overdue * 9 // 10, "interest": overdue - overdue * 9 // 10}],
        })
    return {"loans": loans, "capturedAt": data["capturedAt"]}


@app.post("/api/config/demo-users/reload")
def reload_demo_users():
    try:
        assistant_data_store.reload()
    except (ValueError, OSError, yaml.YAMLError) as exc:
        raise HTTPException(status_code=422, detail="DEMO_CUSTOMER_CONFIG_INVALID") from exc
    return {"activated": True, "appliesTo": "new-sessions"}


@app.delete("/api/demo/session/{session_id}")
def logout(session_id: str):
    assistant_data_store.delete(session_id)
    context_store.delete(session_id)
    lc_drafts.pop(session_id, None)
    return {"loggedOut": True}


@app.put("/api/host/context/{session_id}")
def update_context(session_id: str, request: NavigationContextRequest):
    if session_id not in assistant_data_store.sessions:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    context_store.clear_error(session_id)
    context = make_context(session_id, request.screen_id, request.route_id, request.screen_state, request.last_operation)
    context_store.put(context)
    return context.model_dump(by_alias=True, mode="json")


@app.get("/api/host/context/{session_id}")
def get_context(session_id: str):
    try: return context_store.get(session_id).model_dump(by_alias=True, mode="json")
    except ContextNotFoundError as exc: raise HTTPException(status_code=404, detail="SCREEN_CONTEXT_NOT_FOUND") from exc


@app.get("/api/host/context/{session_id}/error")
def get_error(session_id: str):
    try: return context_store.get_error(session_id).model_dump(by_alias=True, mode="json")
    except ContextNotFoundError as exc: raise HTTPException(status_code=404, detail="APP_ERROR_NOT_FOUND") from exc


@app.put("/api/host/context/{session_id}/error")
def register_presented_error(session_id: str, request: PresentedErrorSubmission):
    if session_id not in assistant_data_store.sessions:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    try:
        context = context_store.get(session_id)
    except ContextNotFoundError as exc:
        raise HTTPException(status_code=404, detail="SCREEN_CONTEXT_NOT_FOUND") from exc
    error = AppErrorRecord(
        **request.model_dump(),
        sessionId=session_id,
        screenId=context.screen_id,
        occurredAt=datetime.now(UTC),
    )
    context_store.put_error(error)
    context_store.put(make_context(session_id, context.screen_id, context.route_id, ScreenState.ERROR, error.operation, error))
    return error.model_dump(by_alias=True, mode="json")


@app.delete("/api/host/context/{session_id}/error")
def clear_presented_error(session_id: str):
    if session_id not in assistant_data_store.sessions:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    context_store.clear_error(session_id)
    return {"cleared": True}


@app.get("/api/config/disbursement-errors")
def disbursement_config():
    try: return scenario_engine.public_config()
    except ScenarioConfigError as exc: raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/host/beneficiaries/{account_number}")
def beneficiary_lookup(account_number: str):
    beneficiary_name = scenario_engine.find_beneficiary(account_number)
    if beneficiary_name is None:
        raise HTTPException(status_code=404, detail={
            "errorCode": "11001",
            "message": "Không tìm thấy tài khoản thụ hưởng tại MSB.",
        })
    return {"accountNumber": account_number, "beneficiaryName": beneficiary_name}


@app.post("/api/host/disbursement")
def disbursement(request: DisbursementRequest):
    result = scenario_engine.evaluate(request); operation = "disbursement.domestic.submit"
    if result.outcome == "error":
        error = AppErrorRecord(errorId=f"err-{uuid4().hex[:12]}", sessionId=request.session_id, screenId="domestic-disbursement-create", operation=operation, errorCode=result.error_code, scenarioId=result.scenario_id, field=result.field, title=result.title, message=result.message or "Yêu cầu không hợp lệ.", occurredAt=datetime.now(UTC))
        context_store.put_error(error); context_store.put(make_context(request.session_id, error.screen_id, RouteId.DISBURSEMENT, ScreenState.ERROR, operation, error))
        return {"outcome": "error", "error": error.model_dump(by_alias=True, mode="json")}
    context_store.clear_error(request.session_id); context_store.put(make_context(request.session_id, "domestic-disbursement-review", RouteId.DISBURSEMENT, ScreenState.SUCCESS, operation))
    return {"outcome": "success", "scenarioId": result.scenario_id, "beneficiaryName": result.beneficiary_name}


if WEB_DIST.is_dir(): app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
