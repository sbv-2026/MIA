import io
import json
from fastapi.testclient import TestClient
from app.main import app


def test_support_uses_host_identity_and_rejects_stale_error(monkeypatch):
    client = TestClient(app)
    session = client.post('/api/demo/session', json=dict(username='so')).json()['sessionId']
    profile = client.get('/api/host/support-profile/' + session).json()
    assert profile['username'] == 'so' and profile['fullName']
    error = client.post('/api/host/disbursement', json=dict(sessionId=session, paymentPurpose='Hàng hóa', transferType='Chuyển thường', bank='MSB', accountNumber='999000000001', accountName='', amount=10000000, content='Thanh toán')).json()['error']
    payload = dict(phoneNumber='0901234567', companyName='Doanh nghiệp demo', recipientEmails=['customer@example.com', 'audit@example.com'], screenshot='data:image/png;base64,test', consent=True, errorId=error['errorId'])
    forwarded = []
    def forward(request, **kwargs):
        forwarded.append(json.loads(request.data))
        return io.BytesIO(json.dumps(dict(ticketId='MIA-TEST', channels=dict(email='sent', zalo='sent'))).encode())
    monkeypatch.setattr('app.main.urlopen', forward)
    assert client.post('/api/host/support/' + session, json={**payload, 'consent': False}).status_code == 422
    assert client.post('/api/host/support/' + session, json={**payload, 'errorId': 'old-error'}).status_code == 409
    assert not forwarded
    assert client.post('/api/host/support/' + session, json=payload).status_code == 200
    assert forwarded[0]['contact'] == {**profile, 'phoneNumber': payload['phoneNumber'], 'companyName': payload['companyName']}
    assert forwarded[0]['recipientEmails'] == payload['recipientEmails']
    assert forwarded[0]['contextSnapshot']['error']['errorCode'] == error['errorCode']
    assert client.post('/api/host/support/' + session, json={**payload, 'username': 'forged'}).status_code == 422
    client.put('/api/host/context/' + session, json=dict(screenId='domestic-disbursement-create', routeId='disbursement', screenState='editing', lastOperation='disbursement.domestic.edit'))
    rule = client.get('/api/config/disbursement-errors').json()['inlineErrors']['accountNumber'][0]
    local_payload = {**payload, 'errorId': 'inline-' + rule['id']}
    assert client.post('/api/host/support/' + session, json=local_payload).status_code == 200
    assert forwarded[-1]['contextSnapshot']['error']['errorCode'] == str(rule['errorCode'])
    assert forwarded[-1]['contextSnapshot']['context']['lastErrorId'] == local_payload['errorId']
    client.delete('/api/demo/session/' + session)
    assert client.get('/api/host/support-profile/' + session).status_code == 404


def test_support_accepts_current_configured_guarantee_error(monkeypatch):
    monkeypatch.setenv('CONFIG_GURANTEE_ERROR', 'Maloi1')
    client = TestClient(app)
    session = client.post('/api/demo/session', json=dict(username='so')).json()['sessionId']
    error_id = 'guarantee-50001-1790000000000'
    payload = dict(
        phoneNumber='0901234567',
        companyName='Doanh nghiệp demo',
        recipientEmails=['customer@example.com'],
        screenshot='data:image/png;base64,test',
        consent=True,
        errorId=error_id,
    )
    forwarded = []

    def forward(request, **kwargs):
        forwarded.append(json.loads(request.data))
        return io.BytesIO(json.dumps(dict(ticketId='MIA-TEST', channels=dict(email='sent', zalo='sent'))).encode())

    monkeypatch.setattr('app.main.urlopen', forward)
    assert client.post('/api/host/support/' + session, json=payload).status_code == 200
    snapshot = forwarded[0]['contextSnapshot']
    assert snapshot['error']['errorId'] == error_id
    assert snapshot['error']['errorCode'] == '50001'
    assert snapshot['error']['operation'] == 'guarantee.create'
    assert snapshot['context']['lastErrorId'] == error_id
    assert client.post('/api/host/support/' + session, json={**payload, 'errorId': 'guarantee-50002-1790000000000'}).status_code == 409


def test_presented_error_registration_supports_any_feature():
    client = TestClient(app)
    session = client.post('/api/demo/session', json=dict(username='so')).json()['sessionId']
    registered = client.put('/api/host/context/' + session + '/error', json={
        'errorId': 'feature-error-1',
        'errorCode': '70001',
        'scenarioId': 'future-feature-error',
        'operation': 'future.feature.submit',
        'field': None,
        'title': 'Lỗi tính năng mới',
        'message': 'Không thể hoàn tất tính năng mới.',
    })
    assert registered.status_code == 200
    assert client.get('/api/host/context/' + session + '/error').json()['errorId'] == 'feature-error-1'
    context = client.get('/api/host/context/' + session).json()
    assert context['lastErrorId'] == 'feature-error-1'
    assert context['lastOperation'] == 'future.feature.submit'
    assert client.delete('/api/host/context/' + session + '/error').status_code == 200
    assert client.get('/api/host/context/' + session + '/error').status_code == 404
