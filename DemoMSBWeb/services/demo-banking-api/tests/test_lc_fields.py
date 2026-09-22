from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_lc_field_catalog_is_host_owned_and_session_scoped():
    assert client.get('/api/host/lc-fields/not-a-session').status_code == 404
    session = client.post('/api/demo/session', json={'username': 'demo'}).json()['sessionId']
    response = client.get(f'/api/host/lc-fields/{session}')
    assert response.status_code == 200
    result = response.json()
    assert result['step'] == 'Thông tin L/C'
    keys = {field['key'] for field in result['fields']}
    assert {'currency', 'applicantName', 'beneficiaryName', 'goodsDescription'} <= keys
    definitions = {field['key']: field for field in result['fields']}
    assert definitions['partialShipments']['kind'] == 'choice'
    assert definitions['partialShipments']['options'] == ['Cho phép', 'Không cho phép']
    assert definitions['requiredDocuments']['kind'] == 'checkbox'
    assert len(definitions['requiredDocuments']['options']) > 1
