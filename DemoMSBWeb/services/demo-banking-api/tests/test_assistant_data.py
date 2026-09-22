from pathlib import Path
import yaml
import pytest
from fastapi.testclient import TestClient
from app.assistant_data import AssistantDataStore
from app.main import app, assistant_data_store


def store(tmp_path, users):
    users_path = tmp_path / "users.yaml"
    data_path = tmp_path / "data.yaml"
    users_path.write_text(yaml.safe_dump({"version": "1.0", "users": users}, allow_unicode=True), encoding="utf-8")
    data_path.write_text('version: "1.0"\ncustomers: {}\n', encoding="utf-8")
    return AssistantDataStore(users_path, data_path)


@pytest.mark.parametrize("username,name,gender,address,pronoun", [
    ("minh", "Minh", "Nam", "anh Minh", "anh"),
    ("lan", "Lan", "Nữ", "chị Lan", "chị"),
    ("other", "Tên không suy đoán", "Không xác định", "anh/chị", "anh/chị"),
])
def test_configured_recipient(tmp_path, username, name, gender, address, pronoun):
    config = store(tmp_path, [{"username": username, "name": name, "gender": gender}])
    assert config.create_session("s1", "  " + username + "  ") == name
    assert config.get("s1")["recipient"] == {"address": address, "pronoun": pronoun}
    config.create_session("s2", "not-declared")
    assert config.get("s2")["recipient"] == {"address": "anh/chị", "pronoun": "anh/chị"}
    assert config.get("s1")["recipient"]["address"] == address


@pytest.mark.parametrize("users", [
    [{"username": "x", "name": "", "gender": "Nam"}],
    [{"username": "x", "name": "X", "gender": "male"}],
    [{"username": "x", "gender": "Nam"}],
    [{"username": "x", "name": "X", "gender": "Nam"}, {"username": " x ", "name": "Y", "gender": "Nữ"}],
])
def test_invalid_user_configuration(tmp_path, users):
    with pytest.raises(ValueError):
        store(tmp_path, users)


def test_reload_preserves_active_config_and_existing_sessions(tmp_path):
    config = store(tmp_path, [{"username": "minh", "name": "Minh", "gender": "Nam"}])
    config.create_session("old", "minh")
    config.users_path.write_text("invalid: true", encoding="utf-8")
    with pytest.raises(ValueError):
        config.reload()
    config.create_session("last-good", "minh")
    assert config.get("last-good")["recipient"]["address"] == "anh Minh"
    config.users_path.write_text(yaml.safe_dump({"version": "1.0", "users": [{"username": "minh", "name": "Mai", "gender": "Nữ"}]}, allow_unicode=True), encoding="utf-8")
    config.reload()
    config.create_session("new", "minh")
    assert config.get("old")["recipient"]["address"] == "anh Minh"
    assert config.get("new")["recipient"]["address"] == "chị Mai"


def test_api_user_fallback_session_binding_and_logout():
    client = TestClient(app)
    configured = client.get("/api/config/demo-users")
    assert configured.status_code == 200
    assert configured.json()["users"] == [user.model_dump(include={"username", "name", "gender"}) for user in assistant_data_store.users.users]
    configured_male = next(user for user in assistant_data_store.users.users if user.gender == "Nam")
    configured_female = next(user for user in assistant_data_store.users.users if user.gender == "Nữ")
    male = client.post("/api/demo/session", json={"username": f" {configured_male.username} "}).json()
    female = client.post("/api/demo/session", json={"username": configured_female.username}).json()
    unknown = client.post("/api/demo/session", json={"username": "unknown"}).json()
    assert male["displayName"] == (configured_male.fullName or configured_male.name)
    assert female["displayName"] == (configured_female.fullName or configured_female.name)
    assert unknown["displayName"] == "Khách hàng"
    assert client.get("/api/host/assistant-data/" + male["sessionId"]).json()["recipient"]["address"] == f"anh {configured_male.name}"
    assert client.get("/api/host/assistant-data/" + female["sessionId"]).json()["recipient"]["address"] == f"chị {configured_female.name}"
    assert client.get("/api/host/assistant-data/" + unknown["sessionId"]).json()["recipient"]["address"] == "anh/chị"
    assert client.get("/api/host/assistant-data/not-a-session").status_code == 404
    client.delete("/api/demo/session/" + male["sessionId"])
    assert client.get("/api/host/assistant-data/" + male["sessionId"]).status_code == 404
    assert client.get("/api/host/context/" + male["sessionId"]).status_code == 404
    assert client.get("/api/host/assistant-data/" + female["sessionId"]).status_code == 200


def test_login_username_is_case_insensitive_and_uses_same_customer_data():
    client = TestClient(app)
    lower = client.post("/api/demo/session", json={"username": "so"}).json()
    mixed = client.post("/api/demo/session", json={"username": "  So  "}).json()
    upper = client.post("/api/demo/session", json={"username": "SO"}).json()

    for session in (mixed, upper):
        assert session["displayName"] == lower["displayName"]
        assert assistant_data_store.support_profile(session["sessionId"])["username"] == "so"
        actual = client.get(f"/api/host/assistant-data/{session['sessionId']}").json()
        expected = client.get(f"/api/host/assistant-data/{lower['sessionId']}").json()
        assert actual["recipient"] == expected["recipient"]
        assert actual["todoList"] == expected["todoList"]
        assert actual["offeringIds"] == expected["offeringIds"]

    for session in (lower, mixed, upper):
        client.delete(f"/api/demo/session/{session['sessionId']}")


def test_every_configured_user_has_home_data_or_an_empty_default():
    configured_users = {user.username for user in assistant_data_store.users.users}
    for username in configured_users:
        session = "verify-menu-" + username
        assistant_data_store.create_session(session, username)
        assert "todoList" in assistant_data_store.get(session)
        assistant_data_store.delete(session)

    # The demo set covers reminders + offer, reminders only, offer only and no proactive item.
    from app.assistant_data import CustomerData
    profiles = [assistant_data_store.data.customers.get(username, CustomerData()) for username in configured_users]
    assert any(profile.todoList and profile.offeringIds for profile in profiles)
    assert any(profile.todoList and not profile.offeringIds for profile in profiles)
    assert any(not profile.todoList and profile.offeringIds for profile in profiles)
    assert any(not profile.todoList and not profile.offeringIds for profile in profiles)


def test_todo_details_statistics_and_legacy_bridge():
    client = TestClient(app)
    session = client.post("/api/demo/session", json={"username": "so"}).json()["sessionId"]
    details = client.get(f"/api/host/assistant-data/{session}?details=true").json()
    assert details["statistics"] == {"total": 6, "byType": {
        "overdue-loan": 3, "document-debt": 2, "password-change": 1}}
    loans = [todo for todo in details["todoList"] if todo["todotype"] == "overdue-loan"]
    assert len({todo["loanAccount"] for todo in loans}) == 3
    assert {todo["business"] for todo in details["todoList"] if todo["todotype"] == "document-debt"} == {
        "Giải ngân", "Thanh toán T/T từ vốn tự có"}
    bridge = client.get(f"/api/host/assistant-data/{session}").json()
    assert "statistics" not in bridge
    assert bridge["todoList"] == [{"id": todo["todolistID"], "todoType": todo["todotype"],
                                  **{key: value for key, value in todo.items()
                                     if key not in ("todolistID", "todotype") and value is not None}}
                                  for todo in details["todoList"]]


def test_credit_accounts_match_customer_todos_and_are_session_scoped():
    client = TestClient(app)
    session = client.post("/api/demo/session", json={"username": "so"}).json()["sessionId"]
    todos = client.get(f"/api/host/assistant-data/{session}?details=true").json()["todoList"]
    loans = client.get(f"/api/host/credit-information/{session}").json()["loans"]
    assert len(loans) == 3
    for loan in loans:
        todo = next(todo for todo in todos if todo["todolistID"] == loan["todoId"])
        assert loan["accountNumber"] == todo["loanAccount"]
        assert loan["overduePrincipal"] + loan["overdueInterest"] == todo["amount"]
        assert loan["maturityDate"] == todo["dueDate"]
    other = client.post("/api/demo/session", json={"username": "Ly"}).json()["sessionId"]
    assert client.get(f"/api/host/credit-information/{other}").json()["loans"] == []
    client.delete(f"/api/demo/session/{session}")
    assert client.get(f"/api/host/credit-information/{session}").status_code == 404


@pytest.mark.parametrize("todo", [
    {"todolistID": "x", "todotype": "overdue-loan", "dueDate": "2026-09-15"},
    {"todolistID": "x", "todotype": "document-debt", "dueDate": "2026-09-15"},
    {"todolistID": "x", "todotype": "password-change", "dueDate": "invalid"},
    {"todolistID": "x", "todotype": "other", "dueDate": "2026-09-15"},
])
def test_todos_require_valid_type_specific_details(todo):
    from app.assistant_data import Todo
    with pytest.raises(ValueError):
        Todo.model_validate(todo)


def test_full_name_and_support_metadata_do_not_change_conversational_name(tmp_path):
    import yaml
    from app.assistant_data import AssistantDataStore
    users = tmp_path / "users.yaml"
    data = tmp_path / "data.yaml"
    users.write_text(yaml.safe_dump({"version": "1.0", "users": [{"username": "test", "name": "Minh", "Full name": "Nguyễn Văn Minh", "gender": "Nam", "user_email": "minh@example.com", "CIF_Number": "123", "phoneNumber": "0901234567", "Corp_name": "MSB"}]}, allow_unicode=True), encoding="utf-8")
    data.write_text('version: "1.0"\ncustomers: {}\n', encoding="utf-8")
    store = AssistantDataStore(users, data)
    assert store.create_session("session", "test") == "Nguyễn Văn Minh"
    assert store.get("session")["recipient"]["address"] == "anh Minh"
    assert store.support_profile("session")["user_email"] == "minh@example.com"
    assert store.support_profile("session")["CIF_Number"] == "123"


def test_incomplete_email_does_not_break_configured_users():
    from app.assistant_data import DemoUser
    user = DemoUser.model_validate({"username": "test", "name": "Test", "gender": "Nam", "user_email": "unfinished@"})
    assert user.user_email == ""
