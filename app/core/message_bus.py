import asyncio
from collections import defaultdict
from typing import Any, Awaitable, Callable

Handler = Callable[[Any], Awaitable[None]]


class MessageBus:
    """Async pub/sub bus. Decouples connections from UI and repositories."""

    def __init__(self) -> None:
        self._subscribers: dict[str, list[Handler]] = defaultdict(list)

    def subscribe(self, event: str, handler: Handler) -> None:
        self._subscribers[event].append(handler)

    def unsubscribe(self, event: str, handler: Handler) -> None:
        self._subscribers[event].remove(handler)

    async def publish(self, event: str, payload: Any = None) -> None:
        for handler in self._subscribers[event]:
            asyncio.create_task(handler(payload))


bus = MessageBus()
