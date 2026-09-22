from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_host_is_healthy(): assert client.get("/health").json() == {"status": "ok"}

def test_assistant_runtime_config(monkeypatch):
    monkeypatch.setenv("ASSISTANT_URL", "http://127.0.0.1:8090/assistant")
    assert client.get("/api/config/assistant").json() == {
        "assistantUrl": "http://127.0.0.1:8090/assistant/",
        "assistantOrigin": "http://127.0.0.1:8090",
        "contractVersion": "1.0",
        "scenarioContractVersion": "1.1",
        "enabled": True,
    }

    csp = client.get("/health").headers["content-security-policy"]
    assert "connect-src 'self' http://127.0.0.1:8090" in csp
    assert "frame-src http://127.0.0.1:8090" in csp

def test_guarantee_error_runtime_config_supports_named_scenarios(monkeypatch):
    monkeypatch.setenv("CONFIG_GURANTEE_ERROR", "Maloi1")
    first = client.get("/api/config/guarantee-error")
    assert first.status_code == 200
    assert first.json()["error"]["errorCode"] == "50001"
    assert first.json()["operation"] == "guarantee.create"

    monkeypatch.setenv("CONFIG_GURANTEE_ERROR", "Maloi2")
    second = client.get("/api/config/guarantee-error")
    assert second.status_code == 200
    assert second.json()["error"]["errorCode"] == "50002"

def test_guarantee_error_prefers_canonical_setting_when_legacy_is_empty(monkeypatch):
    monkeypatch.setenv("CONFIG_GURANTEE_ERROR", "")
    monkeypatch.setenv("CONFIG_GUARANTEE_ERROR", "Maloi2")
    response = client.get("/api/config/guarantee-error")
    assert response.status_code == 200
    assert response.json()["error"]["errorCode"] == "50002"

def test_guarantee_error_runtime_config_can_be_disabled(monkeypatch):
    monkeypatch.setenv("CONFIG_GURANTEE_ERROR", "")
    monkeypatch.setenv("CONFIG_GUARANTEE_ERROR", "")
    assert client.get("/api/config/guarantee-error").json() == {"enabled": False}

def test_transaction_is_host_owned():
    session = client.post("/api/demo/session", json={"username":"demo"}).json()["sessionId"]
    response = client.post("/api/host/disbursement", json={"sessionId":session,"paymentPurpose":"Hàng hóa","transferType":"Chuyển thường","bank":"MSB","accountNumber":"999000000001","accountName":"","amount":10000000,"content":"Thanh toán"})
    assert response.status_code == 200
    assert response.json()["error"]["errorCode"] == "21001"

def test_beneficiary_lookup_and_unknown_account_error():
    found = client.get("/api/host/beneficiaries/001100123456")
    assert found.status_code == 200
    assert found.json()["beneficiaryName"] == "CÔNG TY TNHH THƯƠNG MẠI MINH AN"
    assert client.get("/api/host/beneficiaries/123456789").status_code == 404

    session = client.post("/api/demo/session", json={"username":"demo"}).json()["sessionId"]
    response = client.post("/api/host/disbursement", json={"sessionId":session,"paymentPurpose":"Hàng hóa","transferType":"Chuyển thường","bank":"MSB","accountNumber":"123456789","accountName":"","amount":10000000,"content":"Thanh toán"})
    assert response.json()["error"]["errorCode"] == "11001"

def test_agent_api_is_not_exposed(): assert client.post("/api/agent/chat", json={}).status_code in {404, 405}

def test_lc_draft_is_saved_per_authenticated_demo_session():
    session = client.post("/api/demo/session", json={"username":"demo"}).json()["sessionId"]
    payload = {"fields": {"lcType": "LC thường", "currency": "USD"}, "missingFields": ["amount"]}
    saved = client.post(f"/api/host/lc-draft/{session}", json=payload)
    assert saved.status_code == 200
    loaded = client.get(f"/api/host/lc-draft/{session}")
    assert loaded.json()["fields"]["currency"] == "USD"
    assert loaded.json()["missingFields"] == ["amount"]
