"""
Redis-backed sliding-window rate limiter for Gemini API calls.

Uses a Redis sorted set keyed by timestamp to enforce an RPM (requests
per minute) ceiling. Calls are permitted at full speed up to the limit,
then block until the window rolls over. No fixed sleep between calls.

Exponential backoff for 429 responses is handled separately by
Celery's retry mechanism — this module only gates outbound requests.
"""

import os
import time

import redis as redis_lib


_redis_client = None


def _get_redis():
    """Lazy-initialize the Redis client."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_lib.Redis.from_url(
            os.environ.get("REDIS_URL", "redis://redis:6379/0"),
            decode_responses=True,
        )
    return _redis_client


# Redis key for the rate limiter sorted set
_RATE_LIMIT_KEY = "anexcel:gemini_rate_limiter"

# How long to sleep between polls when the window is full (seconds)
_POLL_INTERVAL = 0.5


def acquire(max_rpm: int = 15) -> None:
    """
    Block until a slot is available in the current 60-second window.

    Uses a Redis sorted set where each member is a unique request ID
    and the score is the timestamp. On each call:
    1. Remove entries older than 60 seconds.
    2. If count < max_rpm, add a new entry and return immediately.
    3. Otherwise, sleep briefly and retry.

    Args:
        max_rpm: Maximum requests per minute (default: 15 for Gemini free tier).
    """
    r = _get_redis()
    window_seconds = 60.0

    while True:
        now = time.time()
        window_start = now - window_seconds

        # Use a pipeline for atomic read-after-clean
        pipe = r.pipeline(transaction=True)

        # 1. Remove entries older than the window
        pipe.zremrangebyscore(_RATE_LIMIT_KEY, "-inf", window_start)

        # 2. Count remaining entries in the window
        pipe.zcard(_RATE_LIMIT_KEY)

        results = pipe.execute()
        current_count = results[1]

        if current_count < max_rpm:
            # 3. Slot available — claim it
            # Use a unique member: timestamp with enough precision to avoid collisions
            member = f"{now:.6f}:{os.getpid()}"
            r.zadd(_RATE_LIMIT_KEY, {member: now})

            # Set expiry on the key so it auto-cleans if the worker dies
            r.expire(_RATE_LIMIT_KEY, int(window_seconds) + 10)
            return

        # 4. Window is full — wait and retry
        # Calculate how long until the oldest entry expires
        oldest_entries = r.zrange(_RATE_LIMIT_KEY, 0, 0, withscores=True)
        if oldest_entries:
            oldest_time = oldest_entries[0][1]
            wait_time = max(oldest_time + window_seconds - now, _POLL_INTERVAL)
            # Don't wait longer than the poll interval to stay responsive
            wait_time = min(wait_time, _POLL_INTERVAL * 4)
        else:
            wait_time = _POLL_INTERVAL

        time.sleep(wait_time)
