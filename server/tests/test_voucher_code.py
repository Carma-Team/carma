"""Voucher codes a person can read out and type back in (CAR-64).

A voucher is scanned most of the time, but the manual fallback is the whole
reason the format matters: a camera that will not focus, a cracked screen, a
flat battery. Sixteen characters of `token_urlsafe(12).upper()` — including
`0`/`O` and `1`/`I`/`L` — was not something a cashier could take by voice, and
every misread came back as "voucher not found" with no way to tell a typo from
a fake.

Four properties, each of which a later "tidy-up" could quietly undo:

  1. The alphabet never contains a confusable pair.
  2. The length is fixed, so nobody is asked to read a variable-length string.
  3. A code is unique, and a collision costs a second draw rather than a failed
     redeem.
  4. Three collisions in a row fail loudly and write nothing.

The arithmetic ones need no database. The allocation ones need real rows,
because the point of the check is that it asks the database.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    READABLE_ALPHABET,
    VOUCHER_CODE_LENGTH,
    normalise_voucher_code,
    random_voucher_code,
)
from app.models import Business, BusinessCategory, Redemption, RedemptionStatus, Reward, User
from app.services import business as business_service
from app.services import rewards as rewards_service

CONFUSABLE = "0O1IL"
SAMPLE = 5_000


# ─── Format (no DB) ──────────────────────────────────────────────────────────
def test_the_alphabet_holds_no_confusable_pair() -> None:
    """The reason this issue exists. Losing one of these is a silent regression."""
    for char in CONFUSABLE:
        assert char not in READABLE_ALPHABET, f"{char!r} is the half of a pair a cashier gets wrong"
    assert len(READABLE_ALPHABET) == 31, "23 letters and 8 digits — anything else means a character slipped"


def test_generated_codes_only_ever_use_that_alphabet() -> None:
    unexpected = set("".join(random_voucher_code() for _ in range(SAMPLE))) - set(READABLE_ALPHABET)
    assert not unexpected, f"generator emitted characters outside the alphabet: {sorted(unexpected)}"


def test_every_symbol_is_reachable() -> None:
    """Catches a typo in the alphabet or a generator stuck on part of its range.

    31 symbols over 50,000 draws: a missing one is not sampling noise.
    """
    seen = set("".join(random_voucher_code() for _ in range(SAMPLE)))
    assert seen == set(READABLE_ALPHABET), f"never drawn: {sorted(set(READABLE_ALPHABET) - seen)}"


def test_length_is_ten() -> None:
    """Ten is the decision, not an implementation detail — asserted literally so
    that changing it is a deliberate edit here rather than a silent one."""
    assert VOUCHER_CODE_LENGTH == 10
    assert VOUCHER_CODE_LENGTH <= 64, "must fit the String(64) column"


def test_length_never_varies() -> None:
    """The old generator stripped characters *before* truncating, so codes came
    out anywhere from 13 to 16 long. Nobody noticed, because nobody read them."""
    assert {len(random_voucher_code()) for _ in range(SAMPLE)} == {VOUCHER_CODE_LENGTH}


def test_codes_do_not_repeat() -> None:
    codes = [random_voucher_code() for _ in range(SAMPLE)]
    assert len(set(codes)) == len(codes), "qr_code is UNIQUE — a repeat here is a failed redeem in production"


# ─── Normalisation (no DB) ───────────────────────────────────────────────────
@pytest.mark.parametrize(
    "typed",
    [
        "K7MP3XQZR9",
        "k7mp3xqzr9",
        "K7MP3-XQZR9",
        "k7mp3 xqzr9",
        "  K7MP3-XQZR9  ",
        "K7MP3_XQZR9",
        "K7MP3–XQZR9",  # en dash — what iOS makes of a typed hyphen
        "K7MP3—XQZR9",  # em dash
        "K7MP3−XQZR9",  # minus sign
        "K7MP3־XQZR9",  # Hebrew maqaf
        "K7MP3 XQZR9",  # non-breaking space
    ],
)
def test_every_way_a_cashier_might_type_it_resolves_the_same(typed: str) -> None:
    """Lower case, the grouping the app displays, and whatever the keyboard did
    to the separator on the way."""
    assert normalise_voucher_code(typed) == "K7MP3XQZR9"


def test_normalising_a_generated_code_leaves_it_alone() -> None:
    """Otherwise the stored code and the looked-up code are different strings."""
    for _ in range(500):
        code = random_voucher_code()
        assert normalise_voucher_code(code) == code


@pytest.mark.parametrize("junk", ["", "   ", "---", "___", " - _ - ", "–—", " "])
def test_empty_and_separator_only_input_normalise_to_nothing(junk: str) -> None:
    """Nothing left once the separators go, and nothing is what it must find."""
    assert normalise_voucher_code(junk) == ""


@pytest.mark.parametrize(
    "junk",
    [
        "ＫＭＰ",  # full-width letters
        "K7MP3XQZRש",  # one Hebrew letter smuggled in
        "ß",  # sharp s
        "ı",  # Turkish dotless i
        "café",
        "🎁",
    ],
)
def test_non_ascii_input_is_refused_outright(junk: str) -> None:
    """Not "normalised as best we can" — refused. Every code ever issued is
    A-Z0-9, so nothing real is lost, and the alternative is the aliasing below."""
    assert normalise_voucher_code(junk) == ""


def test_a_code_containing_ss_is_not_reachable_by_typing_a_sharp_s() -> None:
    """The reason non-ASCII is refused *before* the upper-case, not after.

    `"ß".upper()` is `"SS"` — upper-casing outside ASCII is not
    length-preserving. Fold first and a nine-character input stands in for a
    real ten-character code. `"ı".upper()` is a plain `"I"` for the same reason.
    """
    assert normalise_voucher_code("ßMPQRSTVW") != "SSMPQRSTVW"
    assert normalise_voucher_code("ßMPQRSTVW") == ""
    assert normalise_voucher_code("ıMPQRSTVWX") == ""


def test_lower_case_english_still_survives_the_ascii_check() -> None:
    """The guard rejects non-ASCII, not non-upper-case — a cashier typing in
    lower case is the whole point of the exercise."""
    assert normalise_voucher_code("abcdefghjk") == "ABCDEFGHJK"


def test_long_ascii_junk_is_carried_through_without_blowing_up() -> None:
    """No length guard, deliberately: the path parameter is already bounded by
    the request line, and a 5,000-character string simply matches nothing."""
    assert normalise_voucher_code("K" * 5_000) == "K" * 5_000


# ─── Fixtures ────────────────────────────────────────────────────────────────
async def _make_reward(db: AsyncSession) -> tuple[Business, Reward]:
    business = Business(
        name=f"Code Biz {uuid.uuid4().hex[:6]}",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
    )
    db.add(business)
    await db.flush()

    reward = Reward(
        business_id=business.id,
        title_he="הטבת בדיקה",
        description_he="תיאור",
        category=BusinessCategory.FOOD,
        cost_points=10,
    )
    db.add(reward)
    await db.commit()
    await db.refresh(reward)
    await db.refresh(business)
    return business, reward


async def _make_driver(db: AsyncSession) -> User:
    driver = User(
        email=f"_code_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="Code Driver",
        points=10_000,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


async def _cleanup(db: AsyncSession, business_id: str, *driver_ids: str) -> None:
    # Ids, not instances: a failed allocation rolls back, and a rollback expires
    # every instance in the session. Plain strings cannot expire.
    for driver_id in driver_ids:
        driver = await db.get(User, driver_id)
        if driver is not None:
            await db.delete(driver)
    await db.commit()

    business = await db.get(Business, business_id)
    if business is not None:
        await db.delete(business)
    await db.commit()


def _force_codes(monkeypatch: pytest.MonkeyPatch, *codes: str) -> list[str]:
    """Make the generator hand back exactly these, in order.

    A real collision cannot be provoked — that is the point of 31^10 — so the
    only honest way to exercise the retry is to stage one.
    """
    drawn = list(codes)
    handed_out: list[str] = []

    def _staged() -> str:
        code = drawn.pop(0)
        handed_out.append(code)
        return code

    monkeypatch.setattr(rewards_service, "random_voucher_code", _staged)
    return handed_out


# ─── Allocation against the database ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_a_redeemed_voucher_carries_a_readable_code(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        voucher = await rewards_service.redeem(db_session, driver, reward.id)

        assert len(voucher.code) == VOUCHER_CODE_LENGTH
        assert set(voucher.code) <= set(READABLE_ALPHABET)
        assert voucher.qr_data == voucher.code, "the QR payload still falls back to the code"
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_a_taken_code_costs_a_second_draw_not_the_redeem(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The first draw collides with a voucher that already exists; the driver
    never finds out."""
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        taken = await rewards_service.redeem(db_session, driver, reward.id)
        free = random_voucher_code()

        drawn = _force_codes(monkeypatch, taken.code, free)
        voucher = await rewards_service.redeem(db_session, driver, reward.id)

        assert drawn == [taken.code, free], "the generator should have been asked twice"
        assert voucher.code == free
        assert voucher.code != taken.code
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_three_collisions_fail_without_leaving_a_voucher_behind(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A half-built voucher is worse than a refusal.

    The points debit and the insert share one transaction with the allocation,
    so giving up has to take the whole thing with it — no code, no row, and the
    driver's balance untouched.
    """
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        taken = await rewards_service.redeem(db_session, driver, reward.id)
        points_before = (await db_session.scalar(select(User.points).where(User.id == driver_id))) or 0
        vouchers_before = len((await db_session.scalars(select(Redemption.id))).all())

        drawn = _force_codes(monkeypatch, taken.code, taken.code, taken.code)
        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward.id)

        assert exc.value.status_code == 503, "a code we cannot allocate is our problem, not a bad request"
        assert len(drawn) == 3, "it must stop at three, not keep drawing"

        assert (await db_session.scalar(select(User.points).where(User.id == driver_id))) == points_before
        assert len((await db_session.scalars(select(Redemption.id))).all()) == vouchers_before
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_a_cashier_typing_the_code_by_hand_finds_the_voucher(db_session: AsyncSession) -> None:
    """Lower case with the grouping the app shows, through both business routes."""
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        issued = await rewards_service.redeem(db_session, driver, reward.id)
        typed = f"{issued.code[:5]}-{issued.code[5:]}".lower()

        peeked = await business_service.peek_voucher(db_session, business, typed)
        assert peeked.code == issued.code

        consumed = await business_service.consume_voucher(db_session, business, f"  {typed}  ")
        assert consumed.status == "used"
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "typed",
    ["", "   ", "---", "ＫＭＰ", "ß", "K" * 5_000, "NOSUCHCODE", "'; DROP TABLE redemptions;--"],
)
async def test_junk_at_the_counter_is_a_plain_not_found(db_session: AsyncSession, typed: str) -> None:
    """Every one of these has to reach the same dead end as a wrong code.

    Empty and separator-only input normalise to the empty string, and the danger
    is that `qr_code = ''` matches something. Nothing writes an empty code, but
    the assertion is what keeps it that way.
    """
    business, _reward = await _make_reward(db_session)
    business_id = business.id
    try:
        with pytest.raises(HTTPException) as exc:
            await business_service.peek_voucher(db_session, business, typed)
        assert exc.value.status_code == 404
    finally:
        await _cleanup(db_session, business_id)


@pytest.mark.asyncio
async def test_a_lapsed_voucher_typed_in_by_hand_reads_as_expired(db_session: AsyncSession) -> None:
    """Normalisation has to reach the expiry sweep too, not only the lookup.

    `_owned_voucher` settles the TTL by code before it reads the row back. Fold
    the input in one place and both see the same string; fold it in the wrong
    place and a hand-typed code returns a voucher still claiming to be pending.
    """
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        issued = await rewards_service.redeem(db_session, driver, reward.id)
        voucher_id = (await db_session.scalar(select(Redemption.id).where(Redemption.qr_code == issued.code))) or ""

        # Push it past its TTL without waiting five minutes.
        await db_session.execute(
            update(Redemption)
            .where(Redemption.id == voucher_id)
            .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await db_session.commit()

        typed = f"  {issued.code[:5]}-{issued.code[5:].lower()}  "
        peeked = await business_service.peek_voucher(db_session, business, typed)
        assert peeked.status == "expired", "a lapsed voucher must not read as pending just because it was typed"

        with pytest.raises(HTTPException) as exc:
            await business_service.consume_voucher(db_session, business, typed)
        assert exc.value.status_code == 409
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_codes_issued_before_the_change_still_resolve(db_session: AsyncSession) -> None:
    """Old vouchers are 16 characters and may contain 0/O/1/I/L.

    Live ones drain within five minutes of deploy, but USED ones stay for good
    and the driver's history has to keep working. Nothing normalises them away:
    they are already upper case with no separators.
    """
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        legacy = "0OLI1ABCDEF23456"
        db_session.add(
            Redemption(
                user_id=driver.id,
                reward_id=reward.id,
                qr_code=legacy,
                qr_data=legacy,
                status=RedemptionStatus.USED,
                expires_at=datetime.now(UTC) - timedelta(minutes=5),
                used_at=datetime.now(UTC) - timedelta(minutes=5),
            )
        )
        await db_session.commit()

        found = await business_service.peek_voucher(db_session, business, legacy)
        assert found.code == legacy
    finally:
        await _cleanup(db_session, business_id, driver_id)
