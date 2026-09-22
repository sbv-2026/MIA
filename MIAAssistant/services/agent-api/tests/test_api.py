from datetime import UTC, datetime
import json

from fastapi.testclient import TestClient

from app.main import app, model_gateway
from app.model_gateway import ModelGatewayConfig, ModelGatewayError

client = TestClient(app)


def snapshot(code: str = "11001") -> dict:
    now = datetime.now(UTC).isoformat()
    return {
        "context": {"schemaVersion": "1.0", "sessionId": "s1", "screenId": "domestic-disbursement-create", "routeId": "disbursement", "screenState": "error", "lastOperation": "disbursement.domestic.submit", "lastErrorId": "e1", "errorCode": code, "locale": "vi-VN", "capturedAt": now, "source": "host-api"},
        "error": {"errorId": "e1", "errorCode": code, "operation": "disbursement.domestic.submit", "screenId": "domestic-disbursement-create", "field": "accountNumber", "kind": "inline", "occurredAt": now, "observedAt": now, "source": "host-provider"},
    }


def test_health_and_ready():
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/health").status_code == 200
    assert client.get("/readyz").json()["contractVersion"] == "1.0"


def test_vieneu_tts_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("MIA_VIENEU_TTS_ENABLED", raising=False)
    monkeypatch.delenv("VIENEU_API_KEY", raising=False)
    capability = client.get("/readyz").json()["vieneuTts"]
    assert capability == {
        "enabled": False,
        "ready": False,
        "endpoint": "/api/tts/vieneu/stream",
        "provider": "vieneu-cloud",
    }


def test_vieneu_tts_capability_requires_key(monkeypatch):
    monkeypatch.setenv("MIA_VIENEU_TTS_ENABLED", "true")
    monkeypatch.delenv("VIENEU_API_KEY", raising=False)
    assert client.get("/readyz").json()["vieneuTts"]["ready"] is False
    monkeypatch.setenv("VIENEU_API_KEY", "vn_test_secret")
    assert client.get("/readyz").json()["vieneuTts"]["ready"] is True


def test_vieneu_tts_stream_is_proxied_without_exposing_key(monkeypatch):
    monkeypatch.setenv("MIA_VIENEU_TTS_ENABLED", "true")
    monkeypatch.setenv("VIENEU_API_KEY", "vn_test_secret")
    monkeypatch.setattr(
        "app.main.open_vieneu_stream",
        lambda text, origin, gender: (iter([b"frame-1", b"frame-2"]), {"X-Upstream-Content-Type": "audio/wav"}),
    )
    response = client.post(
        "/api/tts/vieneu/stream",
        json={"text": "Xin chào", "gender": "Nữ"},
        headers={"Origin": "http://localhost:8081"},
    )
    assert response.status_code == 200
    assert response.content == b"frame-1frame-2"
    assert response.headers["content-type"].startswith("audio/wav")
    assert "vn_test_secret" not in response.text


def test_arbitrary_host_origin_is_allowed():
    response = client.options("/api/agent/chat", headers={
        "Origin": "https://any-host.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"


def test_assistant_can_be_embedded_by_any_host():
    response = client.get("/assistant/")
    assert "frame-ancestors *" in response.headers["content-security-policy"]


def test_chat_requires_snapshot():
    assert client.post("/api/agent/chat", json={"sessionId": "s1", "message": "Giải thích"}).status_code == 422


def test_chat_returns_grounded_sse():
    response = client.post("/api/agent/chat", json={"sessionId": "s1", "message": "Giải thích", "contextSnapshot": snapshot()})
    assert response.status_code == 200
    assert "guide-account-not-found-inline" in response.text


def test_chat_accepts_dom_extractor_snapshot():
    payload = snapshot()
    payload["context"]["source"] = "dom-extractor"
    payload["error"]["source"] = "dom-extractor"

    response = client.post("/api/agent/chat", json={
        "sessionId": "s1",
        "message": "Giải thích lỗi này",
        "contextSnapshot": payload,
    })

    assert response.status_code == 200
    assert '"errorSource": "dom-extractor"' in response.text
    assert "guide-account-not-found-inline" in response.text


def sse_events(body: str) -> dict[str, dict]:
    events = {}
    for block in body.strip().split("\n\n"):
        lines = block.splitlines()
        event = next(line[7:] for line in lines if line.startswith("event: "))
        data = next(line[6:] for line in lines if line.startswith("data: "))
        events[event] = json.loads(data)
    return events


def test_suggestion_flow_escalates_to_clarify_from_yaml():
    initial = client.post("/api/agent/chat", json={
        "sessionId": "s1", "message": "Giải thích lỗi này", "contextSnapshot": snapshot(),
    })
    assert [item["id"] for item in sse_events(initial.text)["response"]["suggestions"]] == [
        "simplify", "expand", "repeat",
    ]
    expanded = client.post("/api/agent/chat", json={
        "sessionId": "s1", "message": "Nói kỹ hơn", "contextSnapshot": snapshot(),
    })
    assert sse_events(expanded.text)["response"]["suggestions"][0]["id"] == "clarify"


def test_clarify_streams_model_tokens_without_exposing_secret(monkeypatch):
    monkeypatch.setattr(model_gateway, "config", ModelGatewayConfig(
        provider="test-provider",
        base_url="https://model.invalid/v1",
        api_key="secret-key",
        model="test-model",
        api_style="responses",
        timeout_seconds=1,
    ))
    captured = {}

    def stream(prompt, **kwargs):
        captured["prompt"] = prompt
        yield "token", "Vấn đề: Hướng dẫn "
        yield "token", "đã làm rõ.\n1. Kiểm tra thông tin."
        yield "usage", {"input_tokens": 10, "output_tokens": 5}

    monkeypatch.setattr(model_gateway, "stream", stream)
    response = client.post("/api/agent/chat", json={
        "sessionId": "s1",
        "message": "Làm rõ thêm cho số tài khoản 001100999999",
        "contextSnapshot": snapshot(),
    })
    events = sse_events(response.text)
    assert response.status_code == 200
    assert "event: token" in response.text
    assert "secret-key" not in response.text
    assert "001100999999" not in captured["prompt"]
    assert events["trace"]["escalation"]["provider"] == "test-provider"
    assert events["response"]["errorSummary"] == "Hướng dẫn đã làm rõ."
    assert events["usage"]["usage"]["output_tokens"] == 5


def test_advisory_yaml_can_be_reloaded():
    response = client.post("/api/config/advisory-knowledge/reload")
    assert response.status_code == 200
    assert response.json()["datasetVersion"] == "demo-2026.09.2"


def test_guarantee_errors_use_published_guidance():
    expected_chunks = {
        "50001": "guide-guarantee-chief-accountant-role",
        "50002": "guide-guarantee-borrower-representative-role",
    }
    for code, chunk_id in expected_chunks.items():
        payload = snapshot(code)
        payload["context"].update(
            screenId="home", routeId="home", screenState="error",
            lastOperation="guarantee.create",
        )
        payload["error"].update(
            operation="guarantee.create", screenId="home", field=None, kind="popup",
        )
        response = client.post("/api/agent/chat", json={
            "sessionId": "s1", "message": "Giải thích lỗi này", "contextSnapshot": payload,
        })
        assert response.status_code == 200
        assert chunk_id in response.text


def test_lc_po_extraction_returns_values_and_only_missing_fields(monkeypatch):
    import base64
    monkeypatch.setattr('app.main._lc_field_definitions', lambda _session_id: [
        {'key': key, 'label': key, 'required': True}
        for key in ('lcType', 'issueMode', 'currency', 'amount', 'applicantName',
                    'beneficiaryName', 'swift', 'incoterms', 'goodsDescription')
    ])
    po = b"Currency: USD\nAmount: 50,000\nBuyer: ACME VIETNAM\nSeller: GLOBAL PARTS LTD\nSWIFT: BOFAUS3N\nIncoterms: CIF HAI PHONG"
    response = client.post("/api/agent/lc/extract", json={
        "sessionId": "s1", "fileName": "PO-001.txt",
        "contentBase64": base64.b64encode(po).decode(),
        "lcType": "LC thường", "issueMode": "LC nháp",
    })
    assert response.status_code == 200
    result = response.json()
    assert result["fields"]["currency"] == "USD"
    assert result["fields"]["amount"] == "50,000"
    assert result["fields"]["swift"] == "BOFAUS3N"
    assert "currency" not in result["missingFields"]

def test_pdf_document_text_uses_page_extraction(monkeypatch):
    class FakePage:
        def extract_text(self):
            return "Currency: USD\nAmount: 425,000.00"

    class FakeReader:
        pages = [FakePage()]

    monkeypatch.setattr('app.main.PdfReader', lambda *_args, **_kwargs: FakeReader())
    from app.main import _document_text
    assert _document_text(b"%PDF sample", "PO.pdf") == "Currency: USD\nAmount: 425,000.00"


def test_lc_pdf_layout_maps_sample_fields_without_model(monkeypatch):
    import base64
    from types import SimpleNamespace
    import app.main as main

    keys = (
        'lcType', 'issueMode', 'currency', 'amount', 'applicantName',
        'applicantTaxNo', 'applicantAddress', 'applicantCity',
        'beneficiaryName', 'beneficiaryTaxNo', 'beneficiaryAddress',
        'swift', 'latestShipmentDate', 'loadingPort', 'dischargePort',
        'partialShipments', 'transshipment', 'goodsDescription',
    )
    monkeypatch.setattr(main, '_lc_field_definitions', lambda _session_id: [
        {'key': key, 'label': key, 'required': True} for key in keys
    ])
    monkeypatch.setattr(main.model_gateway, 'config', SimpleNamespace(enabled=False))
    monkeypatch.setattr(main, '_document_text', lambda *_args: """BUYER (APPLICANT FOR L/C):
SELLER (BENEFICIARY FOR L/C):
Global Trading Corp LLC
123 Ocean Avenue, Suite 400
New York, NY 10001, USA
Tax ID: US-998877665
Attn: Mr. David Miller
Vietnam Agriculture Export JSC
Lot 12, Tan Binh Industrial Park
Ho Chi Minh City, Vietnam
Tax ID: 0301234567
Attn: Ms. Nguyen Van A
Advising Bank:
Vietcombank, HCMC Branch
(SWIFT: BFTVVNVX)
Incoterms:
CIF Haiphong Port, Vietnam
Latest Shipment Date:
November 15, 2026
Port of Loading:
Cat Lai Port, Ho Chi Minh City,
Vietnam
Port of Discharge:
Haiphong Port, Vietnam
Partial /
Transshipment:
Allowed / Not Allowed
RICE-ST25
Vietnamese ST25 Jasmine Rice
5% Broken, 2026 Crop
Packed in 50kg PP bags
500.00
USD 850.00
TOTAL CONTRACT AMOUNT:
500.00
USD 425,000.00
Currency: USD""")

    response = client.post('/api/agent/lc/extract', json={
        'sessionId': 's1', 'fileName': 'PO_Sample_2026.pdf',
        'contentBase64': base64.b64encode(b'%PDF sample').decode(),
        'lcType': 'LC thuong', 'issueMode': 'LC chinh thuc',
    })
    assert response.status_code == 200
    fields = response.json()['fields']
    assert fields['currency'] == 'USD'
    assert fields['amount'] == '425,000.00'
    assert fields['applicantName'] == 'Global Trading Corp LLC'
    assert fields['applicantTaxNo'] == 'US-998877665'
    assert fields['beneficiaryName'] == 'Vietnam Agriculture Export JSC'
    assert fields['beneficiaryTaxNo'] == '0301234567'
    assert fields['swift'] == 'BFTVVNVX'
    assert fields['latestShipmentDate'] == 'November 15, 2026'
    assert fields['loadingPort'] == 'Cat Lai Port, Ho Chi Minh City, Vietnam'
    assert fields['dischargePort'] == 'Haiphong Port, Vietnam'
    assert fields['partialShipments'] == 'Allowed'
    assert fields['transshipment'] == 'Not Allowed'
    assert 'Vietnamese ST25 Jasmine Rice' in fields['goodsDescription']


def test_lc_extraction_uses_pre_extracted_text_and_structured_stream(monkeypatch):
    import base64
    import app.main as main

    keys = ("lcType", "issueMode", "currency", "amount", "applicantName", "beneficiaryName")
    monkeypatch.setattr(main, "_lc_field_definitions", lambda _session_id: [
        {"key": key, "label": key, "required": True} for key in keys
    ])
    document_text = (
        "PURCHASE ORDER 991. Purchaser Northwind Imports Incorporated, Toronto, Canada. "
        "Exporter Mekong Components Company, Can Tho, Vietnam. Contract value EUR 81,250."
    )
    monkeypatch.setattr(main, "_document_text", lambda *_args: document_text)
    monkeypatch.setattr(main.model_gateway, "config", ModelGatewayConfig(
        "test-provider", "https://model.invalid/v1", "key", "test-model",
        "chat-completions", 5,
    ))
    captured = {}

    def stream(prompt, **kwargs):
        captured["prompt"] = prompt
        captured.update(kwargs)
        yield "token", '{"extractedFields":{"currency":"EUR","amount":"81,250",'
        yield "token", '"applicantName":"Northwind Imports Incorporated",'
        yield "token", '"beneficiaryName":"Mekong Components Company"}}'

    monkeypatch.setattr(main.model_gateway, "stream", stream)
    response = client.post("/api/agent/lc/extract", json={
        "sessionId": "s-general", "fileName": "different-layout.txt",
        "contentBase64": base64.b64encode(document_text.encode()).decode(),
        "lcType": "LC thuong", "issueMode": "LC chinh thuc",
    })
    assert response.status_code == 200
    result = response.json()
    assert result["fields"]["applicantName"] == "Northwind Imports Incorporated"
    assert result["fields"]["beneficiaryName"] == "Mekong Components Company"
    assert result["fields"]["amount"] == "81,250"
    assert captured["input_file"] is None
    assert captured["max_output_tokens"] == 2500
    assert captured["timeout_seconds"] == 5
    assert captured["response_schema"]["properties"]["extractedFields"]["properties"]["currency"]
    assert result["reasoning"]["documentInput"] == "pre-extracted-text"
    assert result["reasoning"]["structuredOutput"] is True


def test_lc_model_failure_returns_local_mapping_without_duplicate_retry(monkeypatch):
    import base64
    import app.main as main

    monkeypatch.setattr(main, "_lc_field_definitions", lambda _session_id: [
        {"key": key, "label": key, "required": True}
        for key in ("lcType", "issueMode", "currency", "amount", "beneficiaryName")
    ])
    monkeypatch.setattr(main.model_gateway, "config", ModelGatewayConfig(
        "glm", "https://model.invalid/v1", "key", "test-model",
        "chat-completions", 45,
    ))
    monkeypatch.setenv("MIA_LC_EXTRACTION_TIMEOUT_SECONDS", "3")
    calls = []

    def fail_stream(_prompt, **kwargs):
        calls.append(kwargs)
        raise ModelGatewayError("MODEL_GATEWAY_DEADLINE_EXCEEDED")
        yield  # pragma: no cover

    monkeypatch.setattr(main.model_gateway, "stream", fail_stream)
    po = b"Currency: USD\nAmount: 50,000\nSeller: GLOBAL PARTS LTD"
    response = client.post("/api/agent/lc/extract", json={
        "sessionId": "s1", "fileName": "PO-001.txt",
        "contentBase64": base64.b64encode(po).decode(),
        "lcType": "LC thuong", "issueMode": "LC chinh thuc",
    })

    assert response.status_code == 200
    result = response.json()
    assert result["fields"]["currency"] == "USD"
    assert result["fields"]["amount"] == "50,000"
    assert result["fields"]["beneficiaryName"] == "GLOBAL PARTS LTD"
    assert result["reasoning"]["modelError"] == "ModelGatewayError"
    assert len(calls) == 1
    assert calls[0]["timeout_seconds"] == 3


def test_lc_extraction_uses_inline_file_when_local_text_is_empty(monkeypatch):
    import base64
    import app.main as main

    keys = ("lcType", "issueMode", "currency", "amount")
    monkeypatch.setattr(main, "_lc_field_definitions", lambda _session_id: [
        {"key": key, "label": key, "required": True} for key in keys
    ])
    monkeypatch.setattr(main, "_document_text", lambda *_args: "")
    monkeypatch.setattr(main.model_gateway, "config", ModelGatewayConfig(
        "gemini", "https://generativelanguage.googleapis.com/v1beta/openai/",
        "key", "gemini-test", "chat-completions", 5,
    ))
    captured = {}

    def stream(_prompt, **kwargs):
        captured.update(kwargs)
        yield "token", '{"extractedFields":{"currency":"USD","amount":"9,900"}}'

    monkeypatch.setattr(main.model_gateway, "stream", stream)
    response = client.post("/api/agent/lc/extract", json={
        "sessionId": "s-scan", "fileName": "scanned.pdf",
        "contentBase64": base64.b64encode(b"%PDF image-only").decode(),
        "lcType": "LC thuong", "issueMode": "LC chinh thuc",
    })
    assert response.status_code == 200
    assert captured["input_file"]["mimeType"] == "application/pdf"
    assert captured["response_schema"] is not None
    assert response.json()["reasoning"]["documentInput"] == "inline-file"
