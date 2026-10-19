"""In-process pub/sub feeding the SSE stream. Thread-safe publish."""
import asyncio


class Broadcaster:
    def __init__(self) -> None:
        self.subs: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    def attach_loop(self, loop: asyncio.AbstractEventLoop | None) -> None:
        self.loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self.subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.subs.discard(q)

    def _deliver(self, event: dict) -> None:
        for q in list(self.subs):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass

    def publish(self, event: dict) -> None:
        if self.loop and self.loop.is_running():
            self.loop.call_soon_threadsafe(self._deliver, event)
        else:
            self._deliver(event)


bus = Broadcaster()
