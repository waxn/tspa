import pytest

from .conftest import PASSWORD

ENDPOINTS = ["projects", "tasks", "notes", "stream", "reminders"]


@pytest.mark.parametrize("name", ENDPOINTS)
def test_api_requires_login(client, name):
    assert client.get(f"/api/{name}").status_code == 401
    assert client.post(f"/api/{name}", json={}).status_code == 401


def test_index_redirects_when_logged_out(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "/login"


def test_bad_password_rejected(client):
    r = client.post("/login", data={"password": "nope"}, follow_redirects=False)
    assert r.headers["location"] == "/login?error=1"
    assert client.get("/api/tasks").status_code == 401


def test_login_throttled(client):
    for _ in range(5):
        client.post("/login", data={"password": "nope"})
    assert client.post("/login", data={"password": PASSWORD}).status_code == 429


def test_logout(authed):
    authed.post("/logout")
    assert authed.get("/api/tasks").status_code == 401
