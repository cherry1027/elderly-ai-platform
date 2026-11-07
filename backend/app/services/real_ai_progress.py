"""Request-local, provisional progress; never a saved result or a new paid action."""

from collections.abc import Awaitable, Callable
from contextvars import ContextVar

turn_progress: ContextVar[Callable[[dict], Awaitable[None]] | None] = ContextVar("memy_turn_progress", default=None)


async def emit_progress(event: dict) -> None:
    sink = turn_progress.get()
    if sink is not None:
        await sink(event)
