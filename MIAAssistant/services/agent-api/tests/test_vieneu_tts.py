import pytest
from fastapi import HTTPException

from app.vieneu_tts import open_vieneu_stream, vieneu_tts_config


def test_disabled_proxy_rejects_without_calling_cloud(monkeypatch):
    monkeypatch.setenv("MIA_VIENEU_TTS_ENABLED", "false")
    with pytest.raises(HTTPException) as error:
        open_vieneu_stream("Xin chào", "http://localhost:8081")
    assert error.value.status_code == 404
    assert error.value.detail == "VIENEU_TTS_DISABLED"


def test_proxy_rejects_unlisted_origin(monkeypatch):
    monkeypatch.setenv("MIA_VIENEU_TTS_ENABLED", "true")
    monkeypatch.setenv("VIENEU_API_KEY", "vn_test_secret")
    monkeypatch.setenv("MIA_VIENEU_TTS_ALLOWED_ORIGINS", "https://bank.example")
    with pytest.raises(HTTPException) as error:
        open_vieneu_stream("Xin chào", "https://attacker.example")
    assert error.value.status_code == 403
    assert error.value.detail == "VIENEU_TTS_ORIGIN_NOT_ALLOWED"


def test_openai_compatible_request_selects_voice_by_gender(monkeypatch):
    monkeypatch.setenv("MIA_VIENEU_TTS_ENABLED", "true")
    monkeypatch.setenv("VIENEU_API_KEY", "vn_test_secret")
    monkeypatch.setenv("VIENEU_TTS_URL", "https://api.vieneu.invalid/api/v1/audio/speech")
    monkeypatch.setenv("VIENEU_MODEL", "vieneu-v4")
    monkeypatch.setenv("VIENEU_VOICE", "Quang Định")
    monkeypatch.setenv("VIENEU_VOICE_MALE", "Quang Định")
    monkeypatch.setenv("VIENEU_VOICE_FEMALE", "Mai An")
    captured = []

    class Response:
        status_code = 200
        headers = {"Content-Type": "audio/wav"}
        def iter_bytes(self): return iter([b"RIFF"])
        def close(self): pass

    class Client:
        def __init__(self, **_kwargs): pass
        def build_request(self, method, url, **kwargs):
            captured.append((method, url, kwargs))
            return object()
        def send(self, _request, stream):
            assert stream is True
            return Response()
        def close(self): pass

    monkeypatch.setattr("app.vieneu_tts.httpx.Client", Client)
    for gender, expected_voice in (("Nam", "Quang Định"), ("Nữ", "Mai An"), ("Không xác định", "Quang Định")):
        chunks, _headers = open_vieneu_stream("Xin chào", "http://localhost:8081", gender)
        assert b"".join(chunks) == b"RIFF"
        body = captured[-1][2]["json"]
        assert body == {"input": "Xin chào", "model": "vieneu-v4", "voice": expected_voice, "response_format": "wav"}


def test_config_accepts_full_endpoint_and_legacy_base_url(monkeypatch):
    monkeypatch.setenv("VIENEU_TTS_URL", "https://api.vieneu.io/api/v1/audio/speech")
    assert vieneu_tts_config().endpoint_url.endswith("/audio/speech")
    monkeypatch.delenv("VIENEU_TTS_URL")
    monkeypatch.setenv("VIENEU_API_BASE_URL", "https://api.vieneu.io/api/v1/")
    assert vieneu_tts_config().endpoint_url == "https://api.vieneu.io/api/v1/audio/speech"
