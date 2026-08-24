from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.models import Business, Trip, TripStatus, User, UserRole
from app.schemas.stats import DrivingStats, EventCounts, RecentScore, StatsOut
from app.schemas.user import (
    ContactMatchOut,
    MatchContactsOut,
    UpdateLocationIn,
    UpdateProfileIn,
    UserOut,
)
from app.services import friends, rewards, trips


async def profile_out(db: AsyncSession, user: User) -> UserOut:
    """UserOut plus the business fields, which only a BUSINESS account has.

    Looked up on demand rather than eager-loaded in `current_user`: this costs one
    indexed query on the handful of business requests instead of a join on every
    authenticated request in the app.
    """
    out = UserOut.model_validate(user)
    # Only a DRIVER ever holds vouchers, but the sum is 0 for anyone else either
    # way — no need to gate this on role.
    reserved = await rewards.reserved_points(db, user.id)
    out.reserved_points = reserved
    out.available_points = user.points - reserved
    if user.role == UserRole.BUSINESS:
        business = await db.scalar(select(Business).where(Business.owner_user_id == user.id))
        if business is not None:
            out.business_id = business.id
            out.business_category = business.category.value.lower()
    return out


async def update_profile(db: AsyncSession, user: User, dto: UpdateProfileIn) -> User:
    for field, value in dto.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    return user


async def update_location(db: AsyncSession, user: User, dto: UpdateLocationIn) -> User:
    user.last_lat = dto.lat
    user.last_lng = dto.lng
    user.last_location_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(user)
    return user


async def delete_account(db: AsyncSession, user: User) -> None:
    user_id = user.id
    await db.delete(user)
    await db.commit()
    audit("user.deleted", user_id=user_id)


def canonical_phone(raw: str) -> str | None:
    """One agreed spelling of a number: E.164. `None` if it can't be read as one.

    A bare `0…` is assumed Israeli — CARMA's market — so `0501234567` and
    `+972501234567` collapse to the same string. This is the form both sides
    hash for contact matching, so the client must normalise identically.
    """
    compact = re.sub(r"[^\d+]", "", raw)
    digits = compact.lstrip("+")
    if not digits:
        return None
    if digits.startswith("972"):
        return f"+{digits}"
    if digits.startswith("0"):
        return f"+972{digits[1:]}"
    if compact.startswith("+"):
        return compact  # already international, some other country
    return None


def phone_hash(raw: str) -> str | None:
    """SHA-256 of the canonical number — the contact-matching wire format."""
    canonical = canonical_phone(raw)
    return hashlib.sha256(canonical.encode()).hexdigest() if canonical else None


def phone_candidates(raw: str) -> list[str]:
    """Spellings of a number that could be sitting in `users.phone`.

    OTP signup stores E.164 (`+972501234567`); the email/password path accepts
    free-form input, so `0501234567` is just as likely. Search has to match a
    number the user typed either way.
    """
    canonical = canonical_phone(raw)
    if canonical is None:
        return []
    forms = {canonical}
    if canonical.startswith("+972"):
        forms.add(f"0{canonical[4:]}")
    return sorted(forms)


async def search_by_phone(db: AsyncSession, current: User, phone: str) -> User:
    """Find one driver by phone number. Never matches the caller themselves."""
    candidates = phone_candidates(phone)
    found = (
        await db.scalar(
            select(User).where(
                User.phone.in_(candidates),
                User.id != current.id,
                User.role == UserRole.DRIVER,
            )
        )
        if candidates
        else None
    )
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No user with this phone")
    return found


async def match_contacts(db: AsyncSession, current: User, hashes: list[str]) -> MatchContactsOut:
    """Which of the caller's address-book numbers belong to CARMA drivers.

    The client sends SHA-256 hashes of canonical numbers, never the numbers
    themselves, and nothing about a non-match is stored or logged — the address
    book belongs to people who never signed up for anything. Hashing a phone
    number is weak on its own (the number space is small enough to enumerate),
    so treat it as retention hygiene rather than a privacy guarantee.

    Hashing every registered phone per call is O(users). That is nothing at
    CARMA's size; if the user table ever reaches six figures, store the hash as
    an indexed column instead of recomputing it here.
    """
    wanted = {h.strip().lower() for h in hashes}
    if not wanted:
        return MatchContactsOut(matches=[])

    rows = (
        await db.execute(
            select(User.id, User.name, User.city, User.phone).where(
                User.phone.is_not(None),
                User.role == UserRole.DRIVER,
                User.id != current.id,
            )
        )
    ).all()

    hits = [(digest, row) for row in rows if (digest := phone_hash(row.phone or "")) in wanted]
    statuses = await friends.status_map(db, current.id, [row.id for _, row in hits])

    return MatchContactsOut(
        matches=[
            ContactMatchOut(
                phone_hash=digest,
                id=row.id,
                name=row.name,
                city=row.city,
                friend_status=statuses.get(row.id, "none"),
            )
            for digest, row in hits
        ]
    )


async def stats(db: AsyncSession, user: User) -> StatsOut:
    user_id = user.id
    completed = select(Trip).where(Trip.user_id == user_id, Trip.status == TripStatus.COMPLETED)

    recent_rows = (await db.scalars(completed.order_by(Trip.start_time.desc()).limit(14))).all()
    recent_scores = [
        RecentScore(date=t.start_time.date().isoformat(), score=t.avg_score or 0.0) for t in reversed(recent_rows)
    ]

    agg = (
        await db.execute(
            select(
                func.count(Trip.id),
                func.coalesce(func.sum(Trip.distance_km), 0.0),
                func.coalesce(func.sum(Trip.points), 0),
                func.coalesce(func.sum(Trip.duration_seconds), 0),
                func.coalesce(func.avg(Trip.avg_score), 0.0),
                func.coalesce(func.sum(Trip.hard_brakes), 0),
                func.coalesce(func.sum(Trip.aggressive_accels), 0),
                func.coalesce(func.sum(Trip.sharp_turns), 0),
                func.coalesce(func.sum(Trip.touch_epochs), 0),
            )
            .select_from(Trip)
            .where(Trip.user_id == user_id, Trip.status == TripStatus.COMPLETED)
        )
    ).one()

    safe_trips_count = (
        await db.scalar(
            select(func.count(Trip.id)).where(
                Trip.user_id == user_id,
                Trip.status == TripStatus.COMPLETED,
                Trip.avg_score >= 90,
            )
        )
        or 0
    )

    streak = await trips.current_streak(db, user_id, datetime.now(UTC))

    return StatsOut(
        stats=DrivingStats(
            total_trips=int(agg[0] or 0),
            total_distance=float(agg[1] or 0.0),
            total_points=int(agg[2] or 0),
            average_score=int(round(agg[4] or 0.0)),
            safe_trips_count=int(safe_trips_count),
            total_duration_seconds=int(agg[3] or 0),
            current_streak=streak,
            # The stored record is written on the next save, so a run that just
            # gained a day is briefly ahead of it. Report the larger of the two
            # rather than writing on a read — nobody should ever see a current
            # streak above their own record.
            best_streak=max(user.best_streak, streak),
            recent_scores=recent_scores,
            event_counts=EventCounts(
                hard_brakes=int(agg[5] or 0),
                aggressive_accels=int(agg[6] or 0),
                sharp_turns=int(agg[7] or 0),
                touch_epochs=int(agg[8] or 0),
            ),
        )
    )
