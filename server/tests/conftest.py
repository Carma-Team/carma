"""Shared pytest fixtures.

Most of the suite is pure-unit or in-process ASGI (no DB). The `db_session`
fixture here is for the few tests that must prove real persistence — e.g. that a
trip save actually writes Event rows. It reuses the app's own engine/sessionmaker
so it exercises the same configuration the server runs with.

When Postgres is unreachable (a plain `git clone` with no Docker) the fixture
skips rather than fails — the same contract the smoke test uses. CI provides a
live Postgres for the typecheck-test job, so these tests do run there.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.limiter import limiter


@pytest.fixture(autouse=True)
def _no_rate_limiting() -> Iterator[None]:
    """Keep the limiter out of everyone else's way.

    The auth routes allow 5 requests a minute from one address, and the whole
    suite shares one. Tests that exercise a limit turn it back on themselves —
    see `rate_limited`.
    """
    limiter.enabled = False
    yield
    limiter.enabled = False


@pytest.fixture
def rate_limited() -> Iterator[None]:
    """Turn the limiter on for one test, with a clean counter either side."""
    limiter.reset()
    limiter.enabled = True
    try:
        yield
    finally:
        limiter.enabled = False
        limiter.reset()


@pytest_asyncio.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    """Yield a real AsyncSession, or skip the test if no database is reachable.

    A fresh engine is created per test rather than reusing the app's module-level
    one: asyncpg connections are bound to the event loop that opened them, and
    pytest-asyncio runs each test on its own loop, so a shared engine would leak
    connections across loops (flaky skips, 'never awaited' warnings).
    """
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 — any connection failure means "no DB here, skip"
        await engine.dispose()
        pytest.skip("PostgreSQL not reachable — start Docker DB to run this test")

    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:
        async with session_factory() as session:
            yield session
    finally:
        await engine.dispose()
