from app import auth, config
from app.config import stored_password_hash


def test_password_from_file(tmp_path, monkeypatch):
    s = config.get_settings()
    f = tmp_path / "pw"
    f.write_text(auth.hasher.hash("from-file-pw") + "\n")
    monkeypatch.setattr(s, "password_hash", "")
    monkeypatch.setattr(s, "password_file", str(f))
    assert auth.hasher.verify("from-file-pw", stored_password_hash())


def test_env_hash_wins_and_missing_file_is_empty(tmp_path, monkeypatch):
    s = config.get_settings()
    monkeypatch.setattr(s, "password_hash", "ENVHASH")
    assert stored_password_hash() == "ENVHASH"
    monkeypatch.setattr(s, "password_hash", "")
    monkeypatch.setattr(s, "password_file", str(tmp_path / "nope"))
    assert stored_password_hash() == ""


def test_login_fails_closed_without_any_password(client, monkeypatch):
    s = config.get_settings()
    monkeypatch.setattr(s, "password_hash", "")
    monkeypatch.setattr(s, "password_file", "")
    r = client.post("/login", data={"password": "anything"}, follow_redirects=False)
    assert r.headers["location"] == "/login?error=1"
