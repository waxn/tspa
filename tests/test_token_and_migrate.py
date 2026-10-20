from sqlalchemy import text
from sqlmodel import SQLModel

from app.config import get_settings
from app.db import engine, init_db

TOKEN = "t" * 32


def test_bearer_token_works_for_capture(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "api_token", TOKEN)
    assert client.post("/api/capture", json={"text": "hi"}).status_code == 401
    h = {"Authorization": f"Bearer {TOKEN}"}
    assert client.post("/api/capture", json={"text": "hi from my phone"}, headers=h).status_code == 201
    assert client.get("/api/stream", headers=h).json()[0]["body"] == "hi from my phone"
    assert client.get("/api/stream", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/api/stream", headers={"Authorization": TOKEN}).status_code == 401


def test_short_token_is_ignored(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "api_token", "short")
    assert client.get("/api/stream", headers={"Authorization": "Bearer short"}).status_code == 401
    monkeypatch.setattr(get_settings(), "api_token", "")
    assert client.get("/api/stream", headers={"Authorization": "Bearer "}).status_code == 401


def test_old_database_gains_new_columns():
    SQLModel.metadata.drop_all(engine)
    with engine.begin() as c:
        c.execute(text("CREATE TABLE streamentry (id INTEGER PRIMARY KEY, body VARCHAR NOT NULL, created_at DATETIME)"))
        c.execute(text("INSERT INTO streamentry (body) VALUES ('old thought')"))
    init_db()
    init_db()  # idempotent
    with engine.begin() as c:
        row = c.execute(text("SELECT body, summary, triaged, suggest FROM streamentry")).one()
    assert tuple(row) == ("old thought", "", 0, "")
