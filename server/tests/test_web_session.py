"""CAR-217 — the business web app's session: a refresh cookie, not a bearer token.

The web app cannot hold its access token anywhere but memory (no localStorage),
so the httpOnly `carma_refresh` cookie `POST /api/auth/login` now sets is what
survives a reload. These tests hold the shape of that contract:

  * a successful login sets the cookie, and it is httpOnly;
  * a browser-style login (the `X-Requested-With` header `lib/auth/authApi.ts`
    always sends) already gets the short web TTL on its *first* token, not
    just from a follow-up refresh — a mobile-style login (no header) keeps
    the long-lived one, unchanged;
  * the cookie can be traded for a fresh, short-lived access token — repeatedly,
    since a reload does this on every visit;
  * every refresh rotates the cookie, so replaying an already-used one past a
    short grace window is treated as a stolen copy and ends every session on
    the account — but *inside* that window it is treated as two tabs racing
    the same refresh, not an attack, and the session survives;
  * logout revokes the session server-side and clears the cookie, not just the
    second of those;
  * `/refresh` and `/logout` refuse a request without the browser-only header —
    the CSRF guard `SameSite=Lax` will not always be enough on its own for.

Mobile is untouched: it never reads `Set-Cookie` and never calls either route.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient, Response
from jose import jwt
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import JWT_ALGO, hash_password, hash_refresh_token
from app.models import RefreshToken, User
from app.models.enums import UserRole
from app.services import auth as auth_service
from app.services.auth import REFRESH_COOKIE_NAME

PASSWORD = "CorrectHorse1"
BROWSER_HEADERS = {"X-Requested-With": "XMLHttpRequest"}


async def _business_driver(db: AsyncSession, email: str) -> User:
    user = User(
        id=uuid.uuid4().hex,
        email=email,
        password_hash=hash_password(PASSWORD),
        name="Web Session Test",
        role=UserRole.BUSINESS,
    )
    db.add(user)
    await db.commit()
    return user


async def _cleanup(db: AsyncSession, email: str) -> None:
    user = await db.scalar(select(User).where(User.email == email))
    if user is not None:
        await db.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id))
        await db.execute(delete(User).where(User.id == user.id))
        await db.commit()


def _decode(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGO])


async def _login(client: AsyncClient, email: str) -> Response:
    r = await client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200
    return r


def _with_cookie(raw: str) -> dict[str, str]:
    """A per-request cookie override, not `client.cookies.set(...)`.

    The shared `db_api_client` jar already holds whichever cookie the last
    real `Set-Cookie` response set, at the domain/path the ASGI test
    transport assigns it. Setting a *second* value for the same name on the
    jar (even with a matching `path=`) does not overwrite that entry — the
    domain httpx infers for a manually-set cookie differs from the one it
    infers for a response-set one, so the jar ends up holding two, and
    `client.cookies.get(...)` (and, request-dependently, which one actually
    gets sent) raises `CookieConflict`/becomes ambiguous. Passing the value
    directly on the call sends exactly this cookie for this one request
    without touching the jar at all.
    """
    return {REFRESH_COOKIE_NAME: raw}


# ─── login sets the cookie ────────────────────────────────────────────────────


async def test_login_sets_an_httponly_refresh_cookie(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    email = f"web-login-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        r = await _login(db_api_client, email)

        set_cookie = r.headers.get("set-cookie", "")
        assert REFRESH_COOKIE_NAME in set_cookie
        assert "httponly" in set_cookie.lower()
        assert "path=/api/auth" in set_cookie.lower()

        row = await db_session.scalar(select(RefreshToken).where(RefreshToken.user_id == r.json()["user"]["id"]))
        assert row is not None
        assert row.revoked_at is None
    finally:
        await _cleanup(db_session, email)


async def test_a_mobile_style_login_keeps_the_long_lived_token(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """`_login` here sends no `X-Requested-With` — exactly mobile's `client.ts`,
    which never has and which CAR-217 does not touch. This is the contract
    mobile must keep seeing: unchanged `JWT_EXPIRES_MINUTES`, every time."""
    email = f"web-ttl-mobile-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        r = await _login(db_api_client, email)
        payload = _decode(r.json()["token"])
        lifetime = payload["exp"] - payload["iat"]
        assert lifetime == settings.jwt_expires_minutes * 60
    finally:
        await _cleanup(db_session, email)


async def test_a_browser_style_login_already_gets_the_short_web_ttl(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The one difference from the test above is `X-Requested-With` — the same
    header `lib/auth/authApi.ts` sends on every call. `/api/auth/login`'s
    response shape does not change for it (still `{token, user}`, mobile's
    contract untouched); only the token's own lifetime does. This is what
    makes the *first* token a web session ever holds already short-lived,
    with no separate round trip to downgrade it — see
    `services/auth.py::login_with_password`."""
    email = f"web-ttl-browser-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        r = await db_api_client.post(
            "/api/auth/login", json={"email": email, "password": PASSWORD}, headers=BROWSER_HEADERS
        )
        assert r.status_code == 200
        payload = _decode(r.json()["token"])
        lifetime = payload["exp"] - payload["iat"]
        assert lifetime == settings.web_access_token_expires_minutes * 60
    finally:
        await _cleanup(db_session, email)


# ─── refresh trades the cookie for a new access token ────────────────────────


async def test_refresh_returns_a_fresh_short_lived_access_token(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    email = f"web-refresh-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        login = await _login(db_api_client, email)

        r = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        assert r.status_code == 200
        assert r.json()["token"] != login.json()["token"]
        assert r.json()["user"]["email"] == email

        payload = _decode(r.json()["token"])
        assert payload["exp"] - payload["iat"] == settings.web_access_token_expires_minutes * 60
    finally:
        await _cleanup(db_session, email)


async def test_refresh_rotates_the_cookie(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    email = f"web-rotate-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        await _login(db_api_client, email)
        original_cookie = db_api_client.cookies.get(REFRESH_COOKIE_NAME)

        await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        rotated_cookie = db_api_client.cookies.get(REFRESH_COOKIE_NAME)

        assert rotated_cookie is not None
        assert rotated_cookie != original_cookie
    finally:
        await _cleanup(db_session, email)


async def test_refresh_with_no_cookie_is_rejected(db_api_client: AsyncClient) -> None:
    r = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
    assert r.status_code == 401


async def test_refresh_with_an_expired_cookie_is_rejected(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    email = f"web-expired-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        await _login(db_api_client, email)
        user = await db_session.scalar(select(User).where(User.email == email))
        row = await db_session.scalar(select(RefreshToken).where(RefreshToken.user_id == user.id))
        row.expires_at = datetime.now(UTC) - timedelta(days=1)
        await db_session.commit()

        r = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        assert r.status_code == 401
    finally:
        await _cleanup(db_session, email)


# ─── reuse of a rotated token ends every session on the account ──────────────


async def test_reusing_a_rotated_refresh_token_after_the_grace_window_is_treated_as_theft(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The cookie replayed here is the *original* one — already spent by the
    refresh above, and old enough that this cannot be the same browser's own
    request arriving a moment late (see the grace-window test below for that
    case). A legitimate browser never replays a token like this; only a copy
    taken before rotation would. So this must not just fail — it must take
    down the (rotated) session that is still legitimately live."""
    email = f"web-theft-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        await _login(db_api_client, email)
        stolen_cookie = db_api_client.cookies.get(REFRESH_COOKIE_NAME)

        await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        live_cookie = db_api_client.cookies.get(REFRESH_COOKIE_NAME)
        assert live_cookie != stolen_cookie

        # Push the rotated-away row's `revoked_at` outside the grace window —
        # otherwise this replay would be indistinguishable from the benign
        # same-session race the grace window exists to allow.
        stolen_row = await db_session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(stolen_cookie))
        )
        stolen_row.revoked_at = datetime.now(UTC) - timedelta(seconds=auth_service.REUSE_GRACE_SECONDS + 5)
        await db_session.commit()

        replay = await db_api_client.post(
            "/api/auth/refresh", headers=BROWSER_HEADERS, cookies=_with_cookie(stolen_cookie)
        )
        assert replay.status_code == 401

        also_dead = await db_api_client.post(
            "/api/auth/refresh", headers=BROWSER_HEADERS, cookies=_with_cookie(live_cookie)
        )
        assert also_dead.status_code == 401, "reuse of an old cookie must revoke the live session too"
    finally:
        await _cleanup(db_session, email)


async def test_two_tabs_racing_the_same_refresh_do_not_revoke_each_other(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Both tabs read the cookie before either's request lands — the second
    to arrive presents a token its own session already rotated away a moment
    earlier. That must read as the same session running a heartbeat behind,
    not as a stolen token, and the session must still work afterward."""
    email = f"web-race-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        await _login(db_api_client, email)
        shared_cookie = db_api_client.cookies.get(REFRESH_COOKIE_NAME)

        winner = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        assert winner.status_code == 200

        loser = await db_api_client.post(
            "/api/auth/refresh", headers=BROWSER_HEADERS, cookies=_with_cookie(shared_cookie)
        )
        assert loser.status_code == 200, "a same-session race must not be treated as theft"
        assert loser.json()["user"]["email"] == email

        # The session must be genuinely alive, not just answering once more
        # on its way to being cut — a real subsequent refresh still works.
        again = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        assert again.status_code == 200
    finally:
        await _cleanup(db_session, email)


async def test_the_grace_window_reaches_exactly_one_hop_not_the_whole_chain(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """T1 -> T2 -> T3, both rotations genuine and back to back. Replaying T1
    within the grace window must still be cut as reuse — its successor (T2)
    is itself already revoked, which is what a token from *two* rotations
    back looks like, not two tabs racing the same one."""
    email = f"web-depth-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        await _login(db_api_client, email)
        t1 = db_api_client.cookies.get(REFRESH_COOKIE_NAME)

        r2 = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        assert r2.status_code == 200
        t2 = db_api_client.cookies.get(REFRESH_COOKIE_NAME)
        assert t2 != t1

        r3 = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        assert r3.status_code == 200
        t3 = db_api_client.cookies.get(REFRESH_COOKIE_NAME)
        assert t3 != t2

        # T1 well inside REUSE_GRACE_SECONDS of *its own* rotation, but two
        # generations behind the chain's actual head (T3).
        replay = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS, cookies=_with_cookie(t1))
        assert replay.status_code == 401, "a token two rotations behind must not ride the grace window to T3"

        # And, as with any detected reuse, the real live session (T3) is cut too.
        also_dead = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS, cookies=_with_cookie(t3))
        assert also_dead.status_code == 401
    finally:
        await _cleanup(db_session, email)


async def test_only_one_of_two_concurrent_claims_on_the_same_token_can_win(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The atomic-claim guarantee `_try_rotate` exists for. `row` here is
    never re-fetched between the two calls — its own `revoked_at` attribute
    stays `None` in memory for both, standing in for two requests that both
    read the row as unrevoked before either commits. Without an atomic,
    conditional claim, a plain "check the attribute, then write" rotation
    would let a second such caller mint its own independent child too: fine
    when both callers are the same legitimate session (see the grace-window
    tests above), not fine when one of them is holding a stolen copy of
    `row` — two children that never intersect again would let the theft ride
    forever, with no future reuse of *either* copy ever revealing it."""
    email = f"web-atomic-claim-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        await _login(db_api_client, email)
        raw = db_api_client.cookies.get(REFRESH_COOKIE_NAME)
        row = await db_session.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)))
        assert row.revoked_at is None

        first = await auth_service._try_rotate(db_session, row)
        assert first is not None, "the first claim must win"
        await db_session.commit()

        second = await auth_service._try_rotate(db_session, row)
        assert second is None, "a second claim against the same row must not also win"
    finally:
        await _cleanup(db_session, email)


async def test_either_side_of_a_response_order_race_still_refreshes_after_the_grace_window(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Not a naturally occurring state anymore — `_try_rotate`'s atomic claim
    (see the test above) means the real API can no longer produce two
    children from one still-live parent. Constructed by hand here to check
    the fallback property behind that fix: a row's validity is self
    contained, never derived from what some other row's pointer says about
    it. Whichever child's `Set-Cookie` reaches the browser last is the one it
    keeps; the `replaced_by_id` bookkeeping on the shared parent only ever
    points at *one* of them (last write wins on that column) — this proves
    the other child is not somehow second-class, and unlike the grace-window
    recovery itself, that has nothing to do with timing, so it must still hold well
    past `REUSE_GRACE_SECONDS`.
    """
    email = f"web-fork-{uuid.uuid4().hex[:8]}@carmatest.com"
    user = await _business_driver(db_session, email)
    try:
        await _login(db_api_client, email)
        parent_cookie = db_api_client.cookies.get(REFRESH_COOKIE_NAME)
        parent = await db_session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(parent_cookie))
        )

        # Two children minted from the same still-unrevoked parent — exactly
        # what two requests racing ahead of each other's commit produce.
        # `_mint_refresh_token` isn't used here on purpose: calling it twice
        # from this single test session would flush the first call's
        # `replaced_by_id` write before the second ran, serialising exactly
        # the interleaving this test needs to not happen.
        raw_a, raw_b = "child-a-raw-token-value", "child-b-raw-token-value"
        future = datetime.now(UTC) + timedelta(days=30)
        db_session.add(RefreshToken(user_id=user.id, token_hash=hash_refresh_token(raw_a), expires_at=future))
        db_session.add(RefreshToken(user_id=user.id, token_hash=hash_refresh_token(raw_b), expires_at=future))
        await db_session.flush()
        child_b = await db_session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw_b))
        )
        parent.revoked_at = datetime.now(UTC)
        # B's commit "won" the race on the parent's bookkeeping column — A's
        # response is what actually reached the browser regardless.
        parent.replaced_by_id = child_b.id
        await db_session.commit()

        # Long past the grace window — this is not about racing a rotation,
        # it is about a plain, independent row being used for the first time.
        used_a = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS, cookies=_with_cookie(raw_a))
        assert used_a.status_code == 200, "a valid row must work regardless of what its parent's pointer says"
    finally:
        await _cleanup(db_session, email)


async def test_a_logged_out_session_is_never_recovered_via_the_grace_window(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Logout revokes with no successor (`replaced_by_id` stays null), so an
    old cookie presented immediately afterward must not be mistaken for the
    benign race above — there is no rotation chain for it to have fallen
    behind on."""
    email = f"web-logout-race-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        await _login(db_api_client, email)
        await db_api_client.post("/api/auth/logout", headers=BROWSER_HEADERS)

        immediately_after = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        assert immediately_after.status_code == 401
    finally:
        await _cleanup(db_session, email)


# ─── logout ────────────────────────────────────────────────────────────────


async def test_logout_revokes_the_session_and_clears_the_cookie(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    email = f"web-logout-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        await _login(db_api_client, email)

        out = await db_api_client.post("/api/auth/logout", headers=BROWSER_HEADERS)
        assert out.status_code == 200
        set_cookie = out.headers.get("set-cookie", "")
        assert REFRESH_COOKIE_NAME in set_cookie

        again = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        assert again.status_code == 401, "a session logout revoked must not still refresh"
    finally:
        await _cleanup(db_session, email)


async def test_logout_with_no_session_is_a_harmless_no_op(db_api_client: AsyncClient) -> None:
    r = await db_api_client.post("/api/auth/logout", headers=BROWSER_HEADERS)
    assert r.status_code == 200


# ─── the CSRF guard ────────────────────────────────────────────────────────


async def test_refresh_without_the_browser_header_is_refused(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    email = f"web-csrf-refresh-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        await _login(db_api_client, email)
        r = await db_api_client.post("/api/auth/refresh")
        assert r.status_code == 403
    finally:
        await _cleanup(db_session, email)


async def test_logout_without_the_browser_header_is_refused(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    email = f"web-csrf-logout-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _business_driver(db_session, email)
    try:
        await _login(db_api_client, email)
        r = await db_api_client.post("/api/auth/logout")
        assert r.status_code == 403
    finally:
        await _cleanup(db_session, email)
