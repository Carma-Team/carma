"""The rate limiter, in its own module so routers can reach it.

`main` imports the routers, so the routers cannot import `main` to get at the
limiter. One small module breaks the cycle.

The default limits here are the floor for every endpoint. Routes that cost real
money or guard a credential declare a tighter limit of their own — see
`routers/auth.py`.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=["500/hour", "30/minute"])
