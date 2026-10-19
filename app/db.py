from collections.abc import Iterator

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

_url = get_settings().database_url
_kwargs: dict = {"connect_args": {"check_same_thread": False}}
if _url in ("sqlite://", "sqlite:///:memory:"):
    _kwargs["poolclass"] = StaticPool

engine = create_engine(_url, **_kwargs)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
