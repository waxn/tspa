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

STATIC = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


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


app.mount("/static", StaticFiles(directory=STATIC), name="static")
