import base64
import json
import os
import uuid
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.error_flow import ErrorHelpFlow
from app.support_delivery import SupportOutbox, SupportRequest
from app.models import AgentChatRequest
from app.main import knowledge_store, advisory_agent
from test_scenarios import request


def error_request():
    body = request()
    context = body['contextSnapshot']['context']
    context.update(screenId='domestic-disbursement-create', routeId='disbursement', screenState='error', lastOperation='disbursement.domestic.submit', lastErrorId='e1', errorCode='11001')
    now = context['capturedAt']
    body['contextSnapshot']['error'] = dict(errorId='e1', errorCode='11001', operation=context['lastOperation'], screenId=context['screenId'], field='accountNumber', kind='inline', occurredAt=now, observedAt=now, source='host-provider')
    body.update(message='Tôi cần kiểm tra bước nào?', actionId='advisory:explain')
    return AgentChatRequest.model_validate(body)


def test_three_turn_budget_context_and_restart(tmp_path, monkeypatch):
    monkeypatch.setenv('MIA_SUPPORT_DB', str(tmp_path / 'flow.db'))
    prompts = []
    def stream(prompt, **kwargs):
        if 'Classify Vietnamese user intent' in kwargs['system_prompt']:
            yield 'token', '{"intent":"followup"}'
            return
        prompts.append(prompt)
        yield 'token', 'Vấn đề: Kiểm tra lại thông tin bên thụ hưởng.\n1. Đối chiếu số tài khoản.'
    gateway = SimpleNamespace(stream=stream, config=SimpleNamespace(provider='glm', model='glm-5.2'))
    flow = ErrorHelpFlow(knowledge_store, advisory_agent, gateway)
    req = error_request()
    initial = flow.answer(req)
    assert initial['advisory']['level'] == 1 and not prompts
    assert initial['steps'] == knowledge_store.exact_lookup(req.context_snapshot.error.operation, '11001')[0]['steps']
    req.action_id = 'advisory:more'
    req.action_id = 'advisory:followup'
    for turn in range(1, 4):
        answer = flow.answer(req)
        assert answer['advisory']['turns'] == turn
        assert len(answer['advisory']['history']) == turn
        assert initial['advisory']['description'] in prompts[-1]
    assert 'Kiểm tra lại thông tin' in prompts[-1]
    flow = ErrorHelpFlow(knowledge_store, advisory_agent, gateway)
    req.context_snapshot.error.error_id = 'new-presentation-of-same-code'
    req.context_snapshot.context.screen_id = 'another-screen'
    # Ignoring the handoff buttons and typing again continues model chat.
    assert flow.answer(req)['advisory']['level'] == 2
    assert len(prompts) == 4
    req.session_id = 'another-session'
    assert flow.state(req.session_id, req.context_snapshot)['turns'] == 0


def test_first_text_followup_and_confirmed_switch(tmp_path, monkeypatch):
    monkeypatch.setenv('MIA_SUPPORT_DB', str(tmp_path / 'intent.db'))
    prompts = []
    def stream(prompt, **kwargs):
        prompts.append(json.loads(prompt) if 'Classify Vietnamese user intent' in kwargs['system_prompt'] else prompt)
        if 'Classify Vietnamese user intent' in kwargs['system_prompt']:
            yield 'token', json.dumps(dict(intent='switch', actionId='todos', label='xem việc cần làm') if 'việc cần làm' in prompt else dict(intent='followup'))
        else:
            yield 'token', 'Vấn đề: Cần đối chiếu thông tin.\n1. Kiểm tra số tài khoản.'
    flow = ErrorHelpFlow(knowledge_store, advisory_agent, SimpleNamespace(stream=stream, config=SimpleNamespace(provider='glm', model='test')))
    req = error_request()
    flow.answer(req)
    req.action_id = None
    answer = flow.answer(req)
    assert answer['advisory']['turns'] == 1
    assert answer['reasoning']['provider'] == 'glm'
    req.message = 'Tôi muốn xem việc cần làm'
    answer = flow.answer(req)
    assert 'đúng không' in answer['text']
    assert 'navigation' not in answer
    assert answer['advisory']['turns'] == 1
    req.message = 'không'
    assert 'tiếp tục hỗ trợ lỗi' in flow.answer(req)['text']
    req.message = 'Tôi muốn xem việc cần làm'
    flow.answer(req)
    req.message = 'đồng ý'
    assert flow.answer(req)['confirmedIntent']['actionId'] == 'todos'
    assert 'pendingIntent' not in flow.state(req.session_id, req.context_snapshot)


def test_model_cannot_switch_to_unsupported_feature(tmp_path, monkeypatch):
    monkeypatch.setenv('MIA_SUPPORT_DB', str(tmp_path / 'unsupported.db'))
    def stream(prompt, **kwargs):
        yield 'token', '{"intent":"switch","actionId":"navigate:unknown","label":"tính năng lạ"}' if 'Classify Vietnamese user intent' in kwargs['system_prompt'] else 'Vấn đề: Kiểm tra thông tin.\n1. Đối chiếu số tài khoản.'
    flow = ErrorHelpFlow(knowledge_store, advisory_agent, SimpleNamespace(stream=stream, config=SimpleNamespace(provider='glm', model='test')))
    req = error_request()
    req.action_id = 'advisory:followup'
    answer = flow.answer(req)
    assert answer['advisory']['turns'] == 1
    assert 'confirmedIntent' not in answer


def test_confirmed_intent_dispatches_to_scenario(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app, error_help
    req = error_request()
    req.action_id = 'advisory:followup'
    monkeypatch.setattr(error_help, 'answer', lambda request, **kwargs: {'confirmedIntent': {'actionId': 'todos', 'message': 'Tôi muốn xem việc cần làm'}})
    response = TestClient(app).post('/api/agent/chat', json=req.model_dump(by_alias=True, mode='json'))
    assert response.status_code == 200
    answer = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith('data: ') and 'speechText' in line))
    assert 'advisory' not in answer
    assert 'confirmedIntent' not in answer


def support_request(consent=True):
    req = error_request()
    png = b'\x89PNG\r\n\x1a\n' + b'\x00\x00\x00\rIHDR' + (1).to_bytes(4, 'big') * 2
    return SupportRequest.model_validate(dict(sessionId=req.session_id, contextSnapshot=req.context_snapshot.model_dump(by_alias=True, mode='json'), contact=dict(username='so', fullName='Số', phoneNumber='0901234567', companyName='Doanh nghiệp demo', address='anh Sô'), recipientEmails=['customer@example.com'], screenshot='data:image/png;base64,' + base64.b64encode(png).decode(), consent=consent))


def test_support_consent_and_partial_retry_are_idempotent(tmp_path, monkeypatch):
    with pytest.raises(ValidationError):
        support_request(False)
    outbox = SupportOutbox(tmp_path / 'outbox.db')
    calls = []
    monkeypatch.setattr(outbox, 'email', lambda payload, image: calls.append(('email', payload)) or 'sent')
    monkeypatch.setattr(outbox, 'zalo', lambda payload: 'pending-configuration')
    state = dict(description='Mô tả lỗi', steps=['Bước gốc'], history=[dict(question='Câu hỏi', answer='Trả lời')])
    first = outbox.submit(support_request(), state)
    assert first['channels'] == dict(email='sent', zalo='pending-configuration')
    assert 'qua email' in first['message']
    assert calls[0][1]['contact']['companyName'] == 'Doanh nghiệp demo'
    assert calls[0][1]['conversation'] == state['history']
    monkeypatch.setattr(outbox, 'zalo', lambda payload: calls.append(('zalo', payload)) or 'sent')
    second = outbox.submit(support_request(), state)
    third = SupportOutbox(tmp_path / 'outbox.db').submit(support_request(), state)
    assert second['ticketId'] == third['ticketId'] == first['ticketId']
    assert second['channels'] == dict(email='sent', zalo='sent')
    assert [channel for channel, _ in calls] == ['email', 'zalo']


def test_zalo_requires_acknowledgement(monkeypatch):
    monkeypatch.setenv('MIA_SUPPORT_ZALO_WEBHOOK_URL', 'https://chatbot.example/support')
    monkeypatch.setattr('app.support_delivery.httpx.post', lambda *a, **k: SimpleNamespace(raise_for_status=lambda: None, json=lambda: dict(accepted=False)))
    with pytest.raises(ValueError, match='ACKNOWLEDGED'):
        SupportOutbox.zalo(dict(ticketId='test'))


def test_email_contains_contact_context_and_png(monkeypatch):
    for name, value in dict(MIA_SUPPORT_SMTP_HOST='smtp.example', MIA_SUPPORT_EMAIL_TO='support@example.com', MIA_SUPPORT_EMAIL_FROM='unused@example.com', MIA_SUPPORT_SMTP_USER='mia@example.com').items():
        monkeypatch.setenv(name, value)
    messages = []
    class SMTP:
        def __init__(self, *args, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def starttls(self, **kwargs): pass
        def login(self, *args): pass
        def send_message(self, message): messages.append(message); return {}
    monkeypatch.setattr('app.support_delivery.smtplib.SMTP', SMTP)
    assert SupportOutbox.email(dict(ticketId='MIA-TEST', errorCode='11001', contact=dict(username='so', CIF_Number='CIF123', address='anh Sô', user_email='customer@example.com', phoneNumber='0901234567'), recipientEmails=['customer@example.com', 'audit@example.com'], description='Mô tả lỗi', publishedSteps=['Bước gốc'], conversation=[dict(question='Câu hỏi', answer='Trả lời')], screenshot='excluded'), b'png-attachment') == 'sent'
    assert messages[0]['From'] == 'mia@example.com'
    assert set(value.strip() for value in messages[0]['Cc'].split(',')) == {'customer@example.com', 'audit@example.com'}
    assert messages[0]['Reply-To'] == 'mia@example.com'
    assert messages[0]['Subject'] == 'CIF CIF123User so_ErrorCode 11001_ID MIA MIA-TEST'
    body = messages[0].get_body().get_content()
    assert body.startswith('Kinh gửi anh Sô,\n\nMSB xin lỗi vì trải nghiệm chưa tốt trên nền tảng Bussiness Banking.')
    assert 'Trợ lý MIA ghi nhận phẩn hồi của anh Sô' in body
    assert '0901234567' in body and 'Câu hỏi' in body and 'Bước gốc' in body
    assert next(messages[0].iter_attachments()).get_payload(decode=True) == b'png-attachment'


def test_mia_support_endpoint_receives_bubble_info_before_dispatch(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app, error_help, support_outbox
    client = TestClient(app)
    request = support_request()
    state = dict(turns=2, description='Mô tả lỗi', steps=['Bước gốc'], history=[])
    monkeypatch.setattr(error_help, 'state', lambda *args: state)
    dispatches = []
    def dispatch(received, context):
        dispatches.append((received, context))
        return dict(ticketId='MIA-TEST', channels=dict(email='sent', zalo='sent'))
    monkeypatch.setattr(support_outbox, 'submit', dispatch)
    payload = request.model_dump(by_alias=True, mode='json')
    assert client.post('/api/agent/support', json=payload).status_code == 409
    state['turns'] = 3
    state['handoffReady'] = True
    assert client.post('/api/agent/support', json={**payload, 'consent': False}).status_code == 422
    assert not dispatches
    response = client.post('/api/agent/support', json=payload)
    assert response.status_code == 200
    assert response.json()['channels'] == dict(email='sent', zalo='sent')
    assert dispatches[0][0].contact.username == request.contact.username
    assert dispatches[0][0].screenshot == request.screenshot
    assert dispatches[0][1] is state


@pytest.mark.skipif(os.getenv('MIA_E2E_LIVE_MODEL') != 'true', reason='Explicit live GLM check')
def test_live_glm_three_turns():
    import httpx
    req = error_request()
    sid = 'verify-advisory-' + uuid.uuid4().hex[:12]
    req.session_id = sid
    req.context_snapshot.context.session_id = sid
    req.assistant_data.sessionId = sid
    root = os.getenv('MIA_E2E_AGENT_URL', 'http://localhost:8090')
    def call():
        response = httpx.post(root + '/api/agent/chat', json=req.model_dump(by_alias=True, mode='json'), timeout=90)
        response.raise_for_status()
        return json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith('data: ') and 'advisory' in line))
    assert call()['advisory']['level'] == 1
    for turn, question in enumerate(['Tôi chưa hiểu cách đối chiếu bên thụ hưởng, hướng dẫn rõ hơn giúp tôi.', 'Nếu nhập lại vẫn chưa xác định được bên thụ hưởng thì tôi làm gì?', 'Tôi cần kiểm tra lại những bước nào trước khi thử lại?'], 1):
        req.action_id, req.message = 'advisory:followup', question
        answer = call()
        assert answer['reasoning'] == dict(provider='glm', model='z-ai/glm-5.2-hackathon')
        assert answer['advisory']['turns'] == turn
        print('GLM advisory turn', turn, 'verified', flush=True)
    answer = call()
    assert answer['advisory']['level'] == 3 and answer['advisory']['turns'] == 3
    assert 'reasoning' not in answer


def test_followup_streams_and_handoff_does_not_wait_three_turns(tmp_path, monkeypatch):
    monkeypatch.setenv('MIA_SUPPORT_DB', str(tmp_path / 'stream.db'))
    prompts = []
    def stream(prompt, **kwargs):
        prompts.append(prompt)
        yield 'token', 'Vấn đề: Kiểm tra thông tin.\n'
        yield 'token', '1. Đối chiếu tài khoản.'
    flow = ErrorHelpFlow(knowledge_store, advisory_agent, SimpleNamespace(stream=stream, config=SimpleNamespace(provider='glm', model='test')))
    req = error_request()
    initial = flow.answer(req)
    assert 'Anh Minh' in initial['text'] and 'Quý khách' not in initial['text']
    req.action_id = 'advisory:more'
    tokens = []
    answer = flow.answer(req, on_token=tokens.append)
    assert len(tokens) == 2 and answer['advisory']['turns'] == 1
    assert answer['suggestions'][0]['label'] == 'Gửi lỗi tới MSB'
    assert 'tôi đã làm các bước' in prompts[-1]
    req.action_id, req.message = 'advisory:followup', 'Nói rõ hơn'
    flow.answer(req)
    assert 'Nói rõ hơn về:' in prompts[-1]
    req.message = 'Tôi vẫn chưa biết cách xử lý'
    assert flow.answer(req)['advisory']['level'] == 3
    assert flow.state(req.session_id, req.context_snapshot)['handoffReady']


def test_upset_message_is_apologized_confirmed_then_used_for_reasoning(tmp_path, monkeypatch):
    monkeypatch.setenv('MIA_SUPPORT_DB', str(tmp_path / 'emotion.db'))
    prompts = []
    def stream(prompt, **kwargs):
        if 'Infer the customer need' in kwargs['system_prompt']:
            yield 'token', '{"need":"được hướng dẫn kiểm tra lại tài khoản thụ hưởng"}'
        elif 'Classify Vietnamese user intent' in kwargs['system_prompt']:
            yield 'token', '{"intent":"followup"}'
        else:
            prompts.append(prompt)
            yield 'token', 'Vấn đề: Cần kiểm tra tài khoản.\n1. Nhập lại số tài khoản.'
    flow = ErrorHelpFlow(knowledge_store, advisory_agent, SimpleNamespace(stream=stream, config=SimpleNamespace(provider='glm', model='glm-5.2')))
    req = error_request()
    flow.answer(req)
    req.action_id = 'advisory:followup'
    req.message = 'Tôi rất bực mình vì vẫn chưa làm được'
    confirmation = flow.answer(req)
    assert 'xin lỗi vì sự bất tiện' in confirmation['text']
    assert 'Có phải anh muốn' in confirmation['text']
    assert confirmation['advisory']['turns'] == 0
    req.message = 'đồng ý'
    answer = flow.answer(req)
    assert answer['advisory']['turns'] == 1
    assert 'title' in prompts[-1]
    assert 'được hướng dẫn kiểm tra lại tài khoản thụ hưởng' in prompts[-1]


def test_semicolon_separated_emotion_phrases_extend_detection(tmp_path, monkeypatch):
    monkeypatch.setenv('MIA_SUPPORT_DB', str(tmp_path / 'custom-emotion.db'))
    monkeypatch.setenv('MIA_EMOTION_PHRASES', ' ngán tận cổ ; phát điên rồi ;;')
    flow = ErrorHelpFlow(knowledge_store, advisory_agent, SimpleNamespace(
        stream=lambda *args, **kwargs: iter([('token', '{"need":"được hỗ trợ xử lý lỗi"}')]),
        config=SimpleNamespace(provider='test', model='test'),
    ))
    req = error_request()
    flow.answer(req)
    req.action_id = 'advisory:followup'
    req.message = 'Tôi ngán tận cổ vì lỗi này'

    answer = flow.answer(req)

    assert 'xin lỗi vì sự bất tiện' in answer['text']
    assert answer['advisory']['turns'] == 0


def test_model_failure_does_not_repeat_published_steps(tmp_path, monkeypatch):
    from app.model_gateway import ModelGatewayError
    monkeypatch.setenv("MIA_SUPPORT_DB", str(tmp_path / "failure.db"))
    def stream(*args, **kwargs):
        raise ModelGatewayError("unavailable")
        yield
    flow = ErrorHelpFlow(knowledge_store, advisory_agent, SimpleNamespace(stream=stream))
    req = error_request()
    initial = flow.answer(req)
    assert initial["steps"]
    req.action_id = "advisory:more"
    answer = flow.answer(req)
    assert answer["steps"] == []
    assert answer["advisory"]["turns"] == 0
    assert "chưa kết nối" in answer["text"]
