import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import auth
from .api import routers
from .config import get_settings
from .db import init_db
from .events import bus
from .scheduler import make_scheduler

STATIC = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    bus.attach_loop(asyncio.get_running_loop())
    sched = make_scheduler()
    sched.start()
    yield
    sched.shutdown(wait=False)
    bus.attach_loop(None)


app = FastAPI(title="tspa", lifespan=lifespan)
app.add_middleware(
    SessionMiddleware,
    secret_key=get_settings().secret_key,
    same_site="strict",
    https_only=False,  # set True behind HTTPS in production
    max_age=60 * 60 * 24 * 30,
)
app.include_router(auth.router)
for r in routers:
    app.include_router(r)


@app.get("/login", include_in_schema=False)
def login_page():
    return FileResponse(STATIC / "login.html")


@app.get("/", include_in_schema=False)
def index(request: Request):
    if not request.session.get("user"):
        return RedirectResponse("/login")
    return FileResponse(STATIC / "index.html")


@app.get("/sw.js", include_in_schema=False)
def service_worker():
    return FileResponse(STATIC / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest():
    return FileResponse(STATIC / "manifest.webmanifest", media_type="application/manifest+json")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
