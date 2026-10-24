"""Bounded, per-process throttling keyed only by a verified user ID.

These are development/pilot safeguards, not distributed or edge rate limits.
No tokens, addresses, story content or other request data are retained.
"""

from collections import deque
import time
from uuid import UUID

from app.core.errors import APIError


class UserRateLimiter:
    def __init__(self, requests_per_minute: int, *, max_users: int = 4096, clock=time.monotonic):
        if type(requests_per_minute) is not int or not 1 <= requests_per_minute <= 600:
            raise ValueError("Invalid request allowance.")
        if type(max_users) is not int or not 1 <= max_users <= 4096:
            raise ValueError("Invalid registry bound.")
        self.requests_per_minute = requests_per_minute
        self.max_users = max_users
        self.clock = clock
        self._users: dict[UUID, deque[float]] = {}

    def check(self, user_id: UUID) -> None:
        """Call after online Auth succeeds; the following update never awaits."""
        now = self.clock()
        cutoff = now - 60
        attempts = self._users.get(user_id)
        if attempts is None:
            if len(self._users) >= self.max_users:
                # Only expired entries may be removed. Evicting an active user
                # would allow a cycling identity to reset their allowance.
                self._users = {
                    key: values for key, values in self._users.items()
                    if values and values[-1] > cutoff
                }
            if len(self._users) >= self.max_users:
                raise APIError(503, "API_BUSY", "The service is busy; retry shortly.")
            attempts = self._users[user_id] = deque()
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()
        if len(attempts) >= self.requests_per_minute:
            raise APIError(429, "RATE_LIMITED", "Too many requests; retry later.")
        attempts.append(now)
