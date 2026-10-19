def test_task_crud(authed):
    r = authed.post("/api/tasks", json={"title": "Bio project", "due_at": "2026-10-24T12:00:00Z", "kind": "assignment"})
    assert r.status_code == 201
    tid = r.json()["id"]
    assert r.json()["due_at"].startswith("2026-10-24T12:00")

    assert authed.patch(f"/api/tasks/{tid}", json={"done_at": "2026-10-20T01:00:00Z"}).json()["done_at"]
    assert [t["title"] for t in authed.get("/api/tasks").json()] == ["Bio project"]

    assert authed.delete(f"/api/tasks/{tid}").status_code == 204
    assert authed.get("/api/tasks").json() == []
    assert authed.patch(f"/api/tasks/{tid}", json={}).status_code == 404


def test_note_update_bumps_timestamp(authed):
    n = authed.post("/api/notes", json={"title": "idea", "body": "x"}).json()
    n2 = authed.patch(f"/api/notes/{n['id']}", json={"body": "y"}).json()
    assert n2["body"] == "y" and n2["updated_at"] >= n["updated_at"]


def test_stream_newest_first(authed):
    authed.post("/api/stream", json={"body": "first"})
    authed.post("/api/stream", json={"body": "second"})
    assert [e["body"] for e in authed.get("/api/stream").json()] == ["second", "first"]


def test_project_and_reminder(authed):
    assert authed.post("/api/projects", json={"name": "bio"}).status_code == 201
    r = authed.post("/api/reminders", json={"text": "va state test", "fire_at": "2026-10-19T20:00:00Z"})
    assert r.status_code == 201
