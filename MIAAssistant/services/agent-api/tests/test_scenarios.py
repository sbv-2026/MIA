from datetime import UTC, datetime, timedelta
from pathlib import Path
import json
import pytest
import yaml
from fastapi.testclient import TestClient
from app.main import app, scenario_store, model_gateway, error_help
from app.scenario_models import AssistantData
from app.scenarios import ScenarioRequest, ScenarioStore
from app.model_gateway import ModelGatewayConfig

client = TestClient(app)


def request(address="anh Minh", pronoun="anh"):
    now = datetime.now(UTC).isoformat()
    return {
        "sessionId": "scenario-session",
        "contextSnapshot": {"context": {"schemaVersion": "1.0", "sessionId": "scenario-session", "screenId": "home", "routeId": "home", "screenState": "idle", "lastOperation": "dashboard.view", "lastErrorId": None, "errorCode": None, "locale": "vi-VN", "capturedAt": now, "source": "host-api"}, "error": None},
        "assistantData": {"sessionId": "scenario-session", "recipient": {"address": address, "pronoun": pronoun}, "todoList": [{"id": "a" + str(i), "todoType": "approval"} for i in range(3)] + [{"id": "d" + str(i), "todoType": "documents"} for i in range(2)] + [{"id": "p", "todoType": "payment"}], "offeringIds": ["business-credit"], "capturedAt": now},
        "features": [{"screenId": "home", "routeId": "home", "name": "Trang chủ"}, {"screenId": "domestic-disbursement-create", "routeId": "disbursement", "name": "Tạo yêu cầu giải ngân"}, {"screenId": "single-transfer-create", "routeId": "transfer", "name": "Chuyển tiền"}, {"screenId": "certificate-of-deposit", "routeId": "home", "name": "Chứng chỉ tiền gửi"}],
    }


def test_bootstrap_uses_name_gender_two_groups_and_delays():
    answer = client.post("/api/agent/bootstrap", json=request()).json()
    assert answer["utterances"][0] == {"kind": "greeting", "text": "Xin chào anh Minh, MIA sẵn sàng hỗ trợ anh ạ.", "delayMs": 0, "hideAfterMs": 1000}
    assert "5 việc cần làm" in answer["utterances"][1]["text"]
    assert "3 việc phê duyệt, 2 việc bổ sung hồ sơ" in answer["utterances"][1]["text"]
    assert "thanh toán" not in answer["utterances"][1]["text"]
    assert answer["utterances"][2]["delayMs"] == 2000
    assert "Anh Minh ơi" not in answer["utterances"][2]["text"]
    assert answer["utterances"][2]["text"].startswith("MIA thấy với số dư bình quân 3 ngày gần nhất")
    female = client.post("/api/agent/bootstrap", json=request("chị Lan", "chị")).json()
    assert female["utterances"][0]["text"] == "Xin chào chị Lan, MIA sẵn sàng hỗ trợ chị ạ."
    fallback = client.post("/api/agent/bootstrap", json=request("anh/chị", "anh/chị")).json()
    assert fallback["utterances"][0]["text"] == "Xin chào anh/chị, MIA sẵn sàng hỗ trợ anh/chị ạ."


def test_bootstrap_exposes_normalized_custom_emotion_phrases(monkeypatch):
    monkeypatch.setenv("MIA_EMOTION_PHRASES", "Ngán quá; PHÁT BỰC ;;")
    answer = client.post("/api/agent/bootstrap", json=request()).json()
    assert "ngan qua" in answer["emotionPhrases"]
    assert "phat buc" in answer["emotionPhrases"]


def test_three_groups_full_list_and_unknown_references(tmp_path):
    payload = yaml.safe_load(scenario_store.path.read_text(encoding="utf-8"))
    payload["maxSpokenTodoTypes"] = 3
    path = tmp_path / "scenarios.yaml"
    path.write_text(yaml.safe_dump(payload, allow_unicode=True), encoding="utf-8")
    store = ScenarioStore(path)
    req = ScenarioRequest.model_validate(request())
    assert "6 việc cần làm" in store.bootstrap(req)["utterances"][1]["text"]
    req.actionId = "todos"
    todos_answer = store.answer(req)
    assert "todoList" not in todos_answer
    assert len(todos_answer["suggestions"]) == 3
    assert all(item["actionId"].startswith("todo-type:") for item in todos_answer["suggestions"])
    req.assistantData.todoList[0].todoType = "unknown"
    with pytest.raises(ValueError, match="UNKNOWN_TODO_TYPE"):
        store.bootstrap(req)


def test_empty_data_omits_reminders_and_offering():
    body = request()
    body["assistantData"].update(todoList=[], offeringIds=[])
    result = client.post("/api/agent/bootstrap", json=body).json()
    assert [item["kind"] for item in result["utterances"]] == ["greeting"]
    assert not any(item["id"] == "offering" for item in result["suggestions"])


def test_session_stale_and_forged_fallback_are_rejected():
    for field in ("assistantData",):
        body = request()
        body[field]["sessionId"] = "another-session"
        assert client.post("/api/agent/bootstrap", json=body).status_code == 422
    body = request()
    body["assistantData"]["capturedAt"] = (datetime.now(UTC) - timedelta(minutes=6)).isoformat()
    assert client.post("/api/agent/bootstrap", json=body).status_code == 422
    body = request("anh/chị Minh", "anh/chị")
    assert client.post("/api/agent/bootstrap", json=body).status_code == 422


def test_navigation_requires_proposal_and_guide_drill_down():
    req = ScenarioRequest.model_validate(request("chị Lan", "chị"))
    req.actionId = "navigate:single-transfer-create"
    answer = scenario_store.answer(req)
    assert answer["text"] == "Chị Lan muốn truy cập vào “Chuyển tiền”, đúng không ạ?"
    assert answer["navigation"]["screenId"] == "single-transfer-create"
    req.actionId = "navigate:unlisted"
    with pytest.raises(ValueError):
        scenario_store.answer(req)
    req.actionId = "guide"
    answer = scenario_store.answer(req)
    assert answer["text"].startswith("Chị Lan muốn tìm hướng dẫn")
    req.actionId = "guide-feature:single-transfer-create"
    choices = scenario_store.answer(req)["suggestions"]
    req.actionId = choices[0]["actionId"]
    answer = scenario_store.answer(req)
    assert answer["steps"] and answer["citations"]


def test_certificate_offering_uses_id_and_proposes_product_screen():
    req = ScenarioRequest.model_validate(request("chị Lan", "chị"))
    req.actionId = "offering:business-credit"
    answer = scenario_store.answer(req)
    assert answer["text"].startswith("Chứng chỉ tiền gửi")
    assert answer["navigation"]["screenId"] == "certificate-of-deposit"
    assert answer["navigation"]["routeId"] == "home"


def test_last_known_good_reload_and_invalid_limits(tmp_path):
    path = tmp_path / "scenarios.yaml"
    path.write_text(scenario_store.path.read_text(encoding="utf-8"), encoding="utf-8")
    store = ScenarioStore(path)
    for value in (0, -1, True, 2.5):
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        payload["maxSpokenTodoTypes"] = value
        path.write_text(yaml.safe_dump(payload, allow_unicode=True), encoding="utf-8")
        with pytest.raises(ValueError):
            store.reload()
        assert store.config().maxSpokenTodoTypes == 2


def test_shared_contract_vectors():
    path = Path(__file__).resolve().parents[3] / "packages/contracts/test-vectors/scenario-data.json"
    for case in json.loads(path.read_text(encoding="utf-8")):
        try:
            AssistantData.model_validate(case["data"])
            valid = True
        except ValueError:
            valid = False
        assert valid == case["valid"], case["name"]


def test_error_invitation_is_personalized_and_clarification_history_excludes_name(monkeypatch):
    error_help.clear("scenario-session")
    body = request()
    context = body["contextSnapshot"]["context"]
    context.update(screenId="domestic-disbursement-create", routeId="disbursement", screenState="error", lastOperation="disbursement.domestic.submit", lastErrorId="e1", errorCode="11001")
    now = datetime.now(UTC).isoformat()
    body["contextSnapshot"]["error"] = {"errorId": "e1", "errorCode": "11001", "operation": "disbursement.domestic.submit", "screenId": context["screenId"], "field": "accountNumber", "kind": "inline", "occurredAt": now, "observedAt": now, "source": "host-provider"}
    result = client.post("/api/agent/bootstrap", json=body).json()
    assert "Anh Minh" in result["utterances"][0]["text"]
    assert "mã lỗi 11001" in result["utterances"][0]["text"]
    monkeypatch.setattr(model_gateway, "config", ModelGatewayConfig(provider="test", base_url="https://invalid/v1", api_key="secret", model="test", api_style="responses", timeout_seconds=1))
    captured = []
    def stream(prompt, **kwargs):
        captured.append(prompt)
        yield "token", "Vấn đề: Nội dung đã làm rõ.\n1. Kiểm tra thông tin."
    monkeypatch.setattr(model_gateway, "stream", stream)
    body.update(actionId="advisory:explain", message="Giải thích")
    assert client.post("/api/agent/chat", json=body).status_code == 200
    body.update(actionId="advisory:clarify", message="Làm rõ thêm")
    result = client.post("/api/agent/chat", json=body)
    assert "Anh Minh, MIA" in result.text
    assert "anh Minh" in captured[-1] and "secret" not in captured[-1]
    assert "previousGuidance" in captured[-1]
    assert client.post("/api/agent/chat", json=body).status_code == 200
    assert "Nội dung đã làm rõ" in captured[-1]


def test_home_guarantee_error_takes_priority_over_greeting():
    body = request()
    context = body["contextSnapshot"]["context"]
    now = datetime.now(UTC).isoformat()
    context.update(screenState="error", lastOperation="guarantee.create", lastErrorId="g1", errorCode="50002")
    body["contextSnapshot"]["error"] = {
        "errorId": "g1", "errorCode": "50002", "operation": "guarantee.create",
        "screenId": "home", "field": None, "kind": "popup",
        "occurredAt": now, "observedAt": now, "source": "host-provider",
    }

    result = client.post("/api/agent/bootstrap", json=body).json()

    assert [item["kind"] for item in result["utterances"]] == ["error"]
    assert "mã lỗi 50002" in result["utterances"][0]["text"]


@pytest.mark.parametrize("todos,offers,expected", [(False, False, ["transactions", "guide", "other"]), (True, False, ["todos", "transactions", "guide", "other"]), (False, True, ["offering", "transactions", "guide", "other"]), (True, True, ["todos", "offering", "transactions", "guide", "other"])])
def test_contextual_menu(todos, offers, expected):
    body = request()
    if not todos:
        body["assistantData"]["todoList"] = []
    if not offers:
        body["assistantData"]["offeringIds"] = []
    result = client.post("/api/agent/bootstrap", json=body).json()
    assert [item["id"] for item in result["suggestions"]] == expected


def test_freeform_model_proposes_only_supported_navigation(monkeypatch):
    monkeypatch.setattr(model_gateway, "config", ModelGatewayConfig("test", "http://model.invalid", "test", "test", "chat-completions", 1))
    def stream(*args, **kwargs):
        yield "token", json.dumps({"screenIds": ["single-transfer-create"], "question": "Confirm?"})
    monkeypatch.setattr(model_gateway, "stream", stream)
    body = request()
    body.update(message="I need to send money to my supplier", actionId="freeform")
    response = client.post("/api/agent/chat", json=body)
    answer = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith("data: ")))
    assert answer["navigation"]["screenId"] == "single-transfer-create"
    assert "confirmed" not in answer["navigation"]
    monkeypatch.setattr(model_gateway, "stream", lambda *args, **kwargs: iter([("token", '{"screenIds":["forged-screen"],"question":"Which feature?"}')]))
    response = client.post("/api/agent/chat", json=body)
    answer = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith("data: ")))
    assert "navigation" not in answer
    assert answer["suggestions"] == []


def test_model_clarification_keeps_conversation_and_clear_removes_it(monkeypatch):
    from app.main import feature_history
    monkeypatch.setattr(model_gateway, "config", ModelGatewayConfig("test", "http://model.invalid", "test", "test", "chat-completions", 1))
    prompts = []
    def stream(prompt, **kwargs):
        prompts.append(json.loads(prompt))
        yield "token", '{"screenIds":[],"question":"Which feature do you need?"}'
    monkeypatch.setattr(model_gateway, "stream", stream)
    body = request()
    body.update(actionId="other", message="other")
    client.post("/api/agent/chat", json=body)
    body.update(actionId="freeform", message="Help with my business")
    client.post("/api/agent/chat", json=body)
    body["message"] = "The one for sending supplier payments"
    client.post("/api/agent/chat", json=body)
    assert prompts[-1]["conversation"][-1]["user"] == "Help with my business"
    client.post("/api/agent/session/clear", json=body)
    assert body["sessionId"] not in feature_history


def test_category_resolution_asks_at_parent_level_and_confirms_leaf(monkeypatch):
    monkeypatch.setattr(model_gateway, "config", ModelGatewayConfig("glm", "http://model.invalid", "test", "glm-5.2-test", "chat-completions", 1))
    body = request()
    path = ["Credit", "Disbursement", "Create request"]
    body["features"][1]["categoryPath"] = path
    body.update(message="Credit services please", actionId="freeform")
    def stream(prompt, **kwargs):
        assert json.loads(prompt)["features"][1]["categoryPath"] == path
        assert "level 1" in kwargs["system_prompt"]
        yield "token", '{"screenIds":["domestic-disbursement-create"],"needsClarification":true,"question":"Which credit task?"}'
    monkeypatch.setattr(model_gateway, "stream", stream)
    response = client.post("/api/agent/chat", json=body)
    answer = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith("data: ")))
    assert "navigation" not in answer
    assert answer["text"] == "Which credit task?"
    monkeypatch.setattr(model_gateway, "stream", lambda *args, **kwargs: iter([("token", '{"screenIds":["domestic-disbursement-create"],"needsClarification":false}')]))
    body["message"] = "Create a disbursement request"
    response = client.post("/api/agent/chat", json=body)
    answer = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith("data: ")))
    assert answer["categoryPath"] == path
    assert "categoryPath" not in answer["navigation"]
    assert answer["reasoning"] == {"provider": "glm", "model": "glm-5.2-test"}


def test_model_task_navigation_preserves_identity_and_category(monkeypatch):
    monkeypatch.setattr(model_gateway, "config", ModelGatewayConfig("glm", "http://model.invalid", "test", "glm-5.2-test", "chat-completions", 1))
    body = request()
    kind = scenario_store.config().todoTypes[0]
    body["features"] = [{"routeId": "home", "screenId": kind.screenId, "name": "Loan details", "categoryPath": ["Credit", "Loans", "Details"]}]
    body["assistantData"]["todoList"] = [{"id": "task-42", "todoType": kind.todoType, "loanAccount": "123456789"}]
    body.update(actionId="todo:task-42", message="Selected task")
    def stream(prompt, **kwargs):
        payload = json.loads(prompt)
        assert payload["selectedTask"]["todoId"] == "task-42"
        assert len(payload["features"]) == 1
        yield "token", json.dumps({"screenIds": [kind.screenId], "needsClarification": False})
    monkeypatch.setattr(model_gateway, "stream", stream)
    response = client.post("/api/agent/chat", json=body)
    answer = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith("data: ")))
    assert answer["navigation"]["todoId"] == "task-42"
    assert answer["categoryPath"] == ["Credit", "Loans", "Details"]
    assert "123456789" not in answer["speechText"]
    assert answer["text"].endswith(": 123456789")
    assert answer["speechText"] == "Anh Minh muốn xem chi tiết khoản vay quá hạn đúng không ạ?"
