import os

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["SECRET_KEY"] = "test"

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.config import get_settings
from sqlmodel import SQLModel

from app.db import engine, init_db
from app.main import app

PASSWORD = "hunter2"


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    monkeypatch.setattr(get_settings(), "password_hash", auth.hasher.hash(PASSWORD))
    auth._fails.clear()
    SQLModel.metadata.drop_all(engine)
    init_db()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def authed(client):
    r = client.post("/login", data={"password": PASSWORD}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/"
    return client
