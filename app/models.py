from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    color: str = "green"
    status: str = "active"  # active | paused | done
    description: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class Task(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str
    notes: str = ""
    kind: str = "todo"  # todo | assignment
    due_at: datetime | None = None
    priority: int = 0
    done_at: datetime | None = None
    project_id: int | None = Field(default=None, foreign_key="project.id")
    created_at: datetime = Field(default_factory=utcnow)


class Note(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str
    body: str = ""
    project_id: int | None = Field(default=None, foreign_key="project.id")
    pinned: bool = False
    updated_at: datetime = Field(default_factory=utcnow)


class StreamEntry(SQLModel, table=True):
    """A captured thought. `triaged` flips once it has been sorted (or dismissed) out of the inbox."""

    id: int | None = Field(default=None, primary_key=True)
    body: str
    created_at: datetime = Field(default_factory=utcnow)
    summary: str = ""  # AI headline, filled in after capture
    tags: str = ""  # space-separated, AI-suggested
    suggest: str = ""  # JSON: what the AI thinks this should become
    triaged: bool = False


class Reminder(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    text: str
    fire_at: datetime
    fired_at: datetime | None = None
    task_id: int | None = Field(default=None, foreign_key="task.id")


class PushSubscription(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    endpoint: str = Field(index=True, unique=True)
    p256dh: str
    auth: str


class Widget(SQLModel, table=True):
    """A dashboard tile for a self-hosted service. `kind`: status (up/down + latency) or stat (numbers from a JSON API)."""

    id: int | None = Field(default=None, primary_key=True)
    name: str
    kind: str = "status"
    url: str
    headers: str = "{}"  # JSON object, e.g. {"x-api-key": "..."}
    fields: str = "[]"  # JSON list of {label, path, fmt, suffix} for kind=stat
    pos: int = 0
