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
    id: int | None = Field(default=None, primary_key=True)
    body: str
    created_at: datetime = Field(default_factory=utcnow)


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
