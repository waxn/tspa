import httpx
import pytest

from app.api import widgets


@pytest.fixture
def fake_net(monkeypatch):
    """Route widget HTTP calls to canned responses instead of the network."""
    routes: dict[str, httpx.Response | Exception] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        r = routes.get(str(request.url))
        if isinstance(r, Exception):
            raise r
        return r or httpx.Response(404)

    real = httpx.AsyncClient
    monkeypatch.setattr(widgets.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    widgets.state.clear()
    widgets._history.clear()
    return routes


def test_dig():
    d = {"a": {"b": [{"c": 5}, {"c": 6}]}, "n": 0}
    assert widgets.dig(d, "a.b.1.c") == 6 and widgets.dig(d, "n") == 0
    assert widgets.dig(d, "a.x") is None and widgets.dig(d, "a.b.9.c") is None and widgets.dig(None, "a") is None


def test_status_widget_up_down_and_history(authed, fake_net):
    fake_net["http://up.local/"] = httpx.Response(200)
    fake_net["http://down.local/"] = httpx.ConnectError("nope")
    fake_net["http://sick.local/"] = httpx.Response(503)
    ids = {}
    for name in ("up", "down", "sick"):
        r = authed.post("/api/widgets", json={"name": name, "url": f"http://{name}.local/"})
        assert r.status_code == 201
        ids[name] = str(r.json()["id"])
    st = authed.post("/api/widgets/refresh").json()
    assert st[ids["up"]]["up"] is True and st[ids["up"]]["ms"] is not None
    assert st[ids["down"]]["up"] is False and st[ids["down"]]["error"] == "ConnectError"
    assert st[ids["sick"]]["up"] is False and st[ids["sick"]]["error"] == "HTTP 503"
    st = authed.post("/api/widgets/refresh").json()
    up_hist, down_hist = st[ids["up"]]["history"], st[ids["down"]]["history"]
    assert len(up_hist) >= 2 and set(up_hist) == {1}  # every check so far saw it up
    assert len(down_hist) >= 2 and set(down_hist) == {0}
    assert authed.get("/api/widgets/state").json().keys() == st.keys()


def test_stat_widget_pulls_json_fields(authed, fake_net):
    fake_net["http://immich.local/api/server/statistics"] = httpx.Response(200, json={"photos": 1234, "usage": {"bytes": 5}})
    w = authed.post("/api/widgets", json={
        "name": "Immich", "kind": "stat", "url": "http://immich.local/api/server/statistics",
        "headers": {"x-api-key": "secret"},
        "fields": [{"label": "photos", "path": "photos"}, {"label": "gone", "path": "nope"}],
    }).json()
    assert w["headers"] == '{"x-api-key": "secret"}'
    st = authed.post("/api/widgets/refresh").json()[str(w["id"])]
    assert [v["value"] for v in st["values"]] == [1234, None] and st["up"]


def test_api_key_header_is_sent(authed, monkeypatch):
    seen = {}

    def handler(request):
        seen["key"] = request.headers.get("x-api-key")
        return httpx.Response(200, json={})

    real = httpx.AsyncClient
    monkeypatch.setattr(widgets.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    authed.post("/api/widgets", json={"name": "x", "kind": "stat", "url": "http://x.local/", "headers": '{"x-api-key": "abc"}'})
    authed.post("/api/widgets/refresh")
    assert seen["key"] == "abc"


def test_validation(authed):
    assert authed.post("/api/widgets", json={"name": "x", "url": "ftp://x"}).status_code == 422
    assert authed.post("/api/widgets", json={"name": "x", "url": "file:///etc/passwd"}).status_code == 422
    assert authed.post("/api/widgets", json={"name": "", "url": "http://x"}).status_code == 422
    assert authed.post("/api/widgets", json={"name": "x", "url": "http://x", "headers": "{oops"}).status_code == 422
    assert authed.post("/api/widgets", json={"name": "x", "url": "http://x", "kind": "weird"}).status_code == 422
    assert authed.post("/api/widgets", json={"url": "http://x"}).status_code == 422


def test_update_delete_and_list_order(authed, fake_net):
    a = authed.post("/api/widgets", json={"name": "a", "url": "http://a/", "pos": 2}).json()
    b = authed.post("/api/widgets", json={"name": "b", "url": "http://b/", "pos": 1}).json()
    assert [w["name"] for w in authed.get("/api/widgets").json()] == ["b", "a"]
    assert authed.patch(f"/api/widgets/{a['id']}", json={"name": "A2"}).json()["name"] == "A2"
    assert authed.patch(f"/api/widgets/{a['id']}", json={"url": "gopher://"}).status_code == 422
    assert authed.delete(f"/api/widgets/{b['id']}").status_code == 204
    assert authed.delete(f"/api/widgets/{b['id']}").status_code == 404
    assert [w["name"] for w in authed.get("/api/widgets").json()] == ["A2"]


def test_probe_lists_json_paths(authed, fake_net):
    fake_net["http://s.local/stats"] = httpx.Response(200, json={"photos": 3, "users": [{"name": "a"}], "usage": {"bytes": 9}})
    out = authed.post("/api/widgets/probe", json={"url": "http://s.local/stats"}).json()
    paths = {f["path"]: f["value"] for f in out["fields"]}
    assert out["json"] and paths["photos"] == 3 and paths["usage.bytes"] == 9 and paths["users.0.name"] == "a"
    fake_net["http://s.local/page"] = httpx.Response(200, text="<html>")
    assert authed.post("/api/widgets/probe", json={"url": "http://s.local/page"}).json()["json"] is False
    fake_net["http://dead.local/"] = httpx.ConnectError("x")
    assert authed.post("/api/widgets/probe", json={"url": "http://dead.local/"}).status_code == 502
    assert authed.post("/api/widgets/probe", json={"url": "ssh://x"}).status_code == 422


def test_requires_login(client):
    assert client.get("/api/widgets").status_code == 401
    assert client.post("/api/widgets/probe", json={"url": "http://x"}).status_code == 401
