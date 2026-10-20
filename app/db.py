from collections.abc import Iterator

from sqlalchemy import inspect, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

_url = get_settings().database_url
_kwargs: dict = {"connect_args": {"check_same_thread": False}}
if _url in ("sqlite://", "sqlite:///:memory:"):
    _kwargs["poolclass"] = StaticPool

engine = create_engine(_url, **_kwargs)


def _literal(v) -> str:
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def _add_missing_columns() -> None:
    """create_all never alters existing tables; add columns that newer models gained so old databases keep working."""
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col.type.compile(engine.dialect)}'
                if col.default is not None and col.default.is_scalar:
                    ddl += f" DEFAULT {_literal(col.default.arg)}"
                conn.execute(text(ddl))


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
