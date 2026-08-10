"""Shared pytest fixtures.

Most of the suite is pure-unit or in-process ASGI (no DB). The `db_session`
fixture here is for the few tests that must prove real persistence — e.g. that a
trip save actually writes Event rows. It reuses the app's own engine/sessionmaker
so it exercises the same configuration the server runs with.

When Postgres is unreachable (a plain `git clone` with no Docker) the fixture
skips rather than fails — the same contract the smoke test uses. CI provides a
live Postgres for the typecheck-test job, so these tests do run there.

**Pick the right client.** `api_client` for a request that never reaches the
database — an auth gate, a routing check, `/health/live`. `db_api_client` the
moment a request touches a table. Building `AsyncClient(ASGITransport(app))` by
hand and letting it fall through to the app's own engine is the one mistake this
file exists to prevent; see `db_api_client` for why.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Iterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.limiter import limiter
from app.database import get_db
from app.main import app


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


@pytest_asyncio.fixture
async def api_client() -> AsyncIterator[AsyncClient]:
    """An in-process client for requests that never reach the database.

    Auth gates, routing checks, `/health/live`. If the request would open a
    connection, use `db_api_client` instead — this one has no override, so it
    would fall through to the app's own engine.
    """
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest_asyncio.fixture
async def db_api_client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """An in-process client whose requests run on the test's own session.

    Without the override, a request would take a connection from the app's
    module-level engine — which was opened on a different event loop, because
    pytest-asyncio gives every test its own. The failure is not local: the
    connection is left in a broken state and the *next* test to use that engine
    dies with `'NoneType' object has no attribute 'send'`. Two PRs have now been
    caught by it, which is why this lives here instead of in a test file.
    """

    async def _use_the_test_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _use_the_test_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def client_from_ip(db_session: AsyncSession) -> AsyncIterator[Callable[[str], AsyncClient]]:
    """Build in-process clients that arrive from an address of your choosing.

    `ASGITransport` writes its `client` argument into `scope["client"]`, which is
    what `core.limiter.client_ip` reads when no proxy is configured — so one test
    can be two different callers without a network. That is the only way to prove
    the sign-in backoff falls on a guesser and not on the account's owner.

    Otherwise identical to `db_api_client`, including the session override, and
    for the same reasons.
    """

    async def _use_the_test_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _use_the_test_session
    clients: list[AsyncClient] = []

    def _from(ip: str) -> AsyncClient:
        client = AsyncClient(transport=ASGITransport(app=app, client=(ip, 12345)), base_url="http://test")
        clients.append(client)
        return client

    try:
        yield _from
    finally:
        for client in clients:
            await client.aclose()
        app.dependency_overrides.pop(get_db, None)
