import hmac
import time

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from pwdlib import PasswordHash

from .config import get_settings, stored_password_hash

hasher = PasswordHash.recommended()
router = APIRouter()

_fails: dict[str, list[float]] = {}
MAX_FAILS, WINDOW = 5, 300


MIN_TOKEN = 24


def _token_ok(request: Request) -> bool:
    token = get_settings().api_token
    header = request.headers.get("authorization", "")
    if len(token) < MIN_TOKEN or not header.lower().startswith("bearer "):
        return False
    return hmac.compare_digest(header[7:].strip().encode(), token.encode())


def require_user(request: Request) -> None:
    if not request.session.get("user") and not _token_ok(request):
        raise HTTPException(status_code=401, detail="not logged in")


def _throttled(ip: str) -> bool:
    now = time.time()
    recent = [t for t in _fails.get(ip, []) if now - t < WINDOW]
    _fails[ip] = recent
    return len(recent) >= MAX_FAILS


@router.post("/login")
def login(request: Request, password: str = Form(...)):
    ip = request.client.host if request.client else "?"
    if _throttled(ip):
        raise HTTPException(status_code=429, detail="too many attempts, wait a few minutes")
    stored = stored_password_hash()
    if not stored or not hasher.verify(password, stored):
        _fails.setdefault(ip, []).append(time.time())
        return RedirectResponse("/login?error=1", status_code=303)
    request.session["user"] = "me"
    return RedirectResponse("/", status_code=303)


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


auth_dep = [Depends(require_user)]
