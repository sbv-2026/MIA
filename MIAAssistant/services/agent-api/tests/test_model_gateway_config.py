import json

import httpx

from app import model_gateway
from app.model_gateway import ModelGateway, ModelGatewayConfig


def test_switching_provider_selects_only_its_credentials(monkeypatch):
    monkeypatch.setenv("MIA_MODEL_BASE_URL", "https://legacy-glm.example/v1")
    monkeypatch.setenv("MIA_MODEL_API_KEY", "legacy-glm-key")
    monkeypatch.setenv("MIA_MODEL_NAME", "legacy-glm")
    monkeypatch.setenv("MIA_GLM_BASE_URL", "https://glm.example/v1")
    monkeypatch.setenv("MIA_GLM_API_KEY", "glm-key")
    monkeypatch.setenv("MIA_GLM_MODEL", "glm-model")
    monkeypatch.setenv("MIA_GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("MIA_GEMINI_MODEL", "gemini-model")

    monkeypatch.setenv("MIA_MODEL_PROVIDER", "glm")
    glm = ModelGatewayConfig.from_env()
    assert (glm.base_url, glm.api_key, glm.model, glm.api_style) == (
        "https://glm.example/v1", "glm-key", "glm-model", "chat-completions"
    )

    monkeypatch.setenv("MIA_MODEL_PROVIDER", "gemini")
    gemini = ModelGatewayConfig.from_env()
    assert (gemini.base_url, gemini.api_key, gemini.model, gemini.api_style) == (
        "https://generativelanguage.googleapis.com/v1beta/openai/",
        "gemini-key", "gemini-model", "chat-completions"
    )


def test_gemini_does_not_reuse_legacy_glm_key(monkeypatch):
    monkeypatch.setenv("MIA_MODEL_PROVIDER", "gemini")
    monkeypatch.setenv("MIA_MODEL_API_KEY", "legacy-glm-key")
    monkeypatch.setenv("MIA_MODEL_NAME", "legacy-glm")
    monkeypatch.delenv("MIA_GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("MIA_GEMINI_MODEL", raising=False)
    assert not ModelGatewayConfig.from_env().enabled


def test_glm_legacy_configuration_still_works(monkeypatch):
    monkeypatch.setenv("MIA_MODEL_PROVIDER", "glm")
    for name in ("MIA_GLM_BASE_URL", "MIA_GLM_API_KEY", "MIA_GLM_MODEL", "MIA_GLM_API_STYLE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MIA_MODEL_BASE_URL", "https://legacy-glm.example/v1")
    monkeypatch.setenv("MIA_MODEL_API_KEY", "legacy-glm-key")
    monkeypatch.setenv("MIA_MODEL_NAME", "legacy-glm")
    config = ModelGatewayConfig.from_env()
    assert config.enabled
    assert config.model == "legacy-glm"


def test_gemini_stream_uses_selected_endpoint_and_chat_payload(monkeypatch):
    config = ModelGatewayConfig(
        "gemini", "https://generativelanguage.googleapis.com/v1beta/openai/",
        "gemini-key", "gemini-test", "chat-completions", 5,
    )
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"xin chào"}}]}\n\ndata: [DONE]\n\n')

    original_client = httpx.Client
    monkeypatch.setattr(model_gateway.httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(respond), **kwargs))
    assert list(ModelGateway(config).stream("hello", system_prompt="system", max_output_tokens=100)) == [("token", "xin chào")]
    assert str(requests[0].url) == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    assert requests[0].headers["Authorization"] == "Bearer gemini-key"
    payload = json.loads(requests[0].content)
    assert payload["model"] == "gemini-test"
    assert payload["stream"] is True
    assert "stream_options" not in payload


def test_chat_stream_sends_native_file_part(monkeypatch):
    config = ModelGatewayConfig(
        'gemini', 'https://model.example/v1/', 'key', 'model', 'chat-completions', 5,
    )
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"{}"}}]}\n\ndata: [DONE]\n\n')

    original_client = httpx.Client
    monkeypatch.setattr(model_gateway.httpx, 'Client', lambda **kwargs: original_client(transport=httpx.MockTransport(respond), **kwargs))
    result = list(ModelGateway(config).stream(
        'extract', system_prompt='system', max_output_tokens=100,
        input_file={'name': 'PO.pdf', 'mimeType': 'application/pdf', 'contentBase64': 'UERG'},
    ))
    assert result == [('token', '{}')]
    content = json.loads(requests[0].content)['messages'][1]['content']
    assert content[1] == {'type': 'file', 'file': {
        'filename': 'PO.pdf', 'file_data': 'data:application/pdf;base64,UERG',
    }}


def test_gemini_structured_stream_uses_native_inline_data(monkeypatch):
    config = ModelGatewayConfig(
        "gemini", "https://generativelanguage.googleapis.com/v1beta/openai/",
        "gemini-key", "gemini-test", "chat-completions", 5,
    )
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(
            200,
            text='data: {"candidates":[{"content":{"parts":[{"text":"{\\\"extractedFields\\\":"}]}}]}\n\n'
                 'data: {"candidates":[{"content":{"parts":[{"text":"{\\\"currency\\\":\\\"USD\\\"}}"}]}}],'
                 '"usageMetadata":{"promptTokenCount":10}}\n\n',
        )

    original_client = httpx.Client
    monkeypatch.setattr(
        model_gateway.httpx, "Client",
        lambda **kwargs: original_client(transport=httpx.MockTransport(respond), **kwargs),
    )
    schema = {
        "type": "object",
        "properties": {"extractedFields": {"type": "object"}},
        "required": ["extractedFields"],
    }
    result = list(ModelGateway(config).stream(
        "extract", system_prompt="system", max_output_tokens=100,
        input_file={
            "name": "PO.pdf", "mimeType": "application/pdf",
            "contentBase64": "UERG",
        },
        response_schema=schema,
    ))
    assert result[0] == ("token", '{"extractedFields":')
    assert result[1] == ("token", '{"currency":"USD"}}')
    assert result[2][0] == "usage"
    request = requests[0]
    assert str(request.url) == (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-test:streamGenerateContent?alt=sse"
    )
    assert request.headers["x-goog-api-key"] == "gemini-key"
    payload = json.loads(request.content)
    assert payload["contents"][0]["parts"][0]["inlineData"] == {
        "mimeType": "application/pdf", "data": "UERG",
    }
    assert payload["generationConfig"]["responseJsonSchema"] == schema
