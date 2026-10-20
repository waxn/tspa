from ..models import Note, Project, Reminder, StreamEntry, Task
from . import capture, system, widgets
from .crud import crud_router

routers = [
    crud_router("/api/projects", Project, Project.name),
    crud_router("/api/tasks", Task, Task.due_at),
    crud_router("/api/notes", Note, Note.updated_at.desc(), touch="updated_at"),
    crud_router("/api/stream", StreamEntry, StreamEntry.created_at.desc()),
    crud_router("/api/reminders", Reminder, Reminder.fire_at),
    capture.router,
    widgets.router,
    system.router,
]
