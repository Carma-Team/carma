"""Seed the database with reference data and investor-demo drivers.

Usage: python -m app.seed
       python -m app.seed --driver-scores-only   (backfill NULL driver_score, no reseed)
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy import update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.database import SessionLocal
from app.models import (
    Business,
    BusinessBranch,
    BusinessCategory,
    FriendStatus,
    Redemption,
    Reward,
    Trip,
    TripStatus,
    User,
    UserFriend,
    UserRole,
)
from app.services.business import ensure_owner_membership

# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Reference data — businesses (existing + new demo partners)
# ---------------------------------------------------------------------------

BUSINESSES = [
    # existing
    {"name": "Paz", "category": BusinessCategory.FUEL, "location_lat": 32.0853, "location_lng": 34.7818, "address": "תל אביב"},
    {"name": "Arcaffe", "category": BusinessCategory.FOOD, "location_lat": 32.0809, "location_lng": 34.7806, "address": "תל אביב"},
    {"name": "Lime", "category": BusinessCategory.ECO, "location_lat": 32.0668, "location_lng": 34.7647, "address": "תל אביב"},
    {"name": "Cinema City", "category": BusinessCategory.ENTERTAINMENT, "location_lat": 32.1093, "location_lng": 34.8555, "address": "גלילות"},
    {"name": "Super-Pharm", "category": BusinessCategory.SHOPPING, "location_lat": 32.0721, "location_lng": 34.7787, "address": "תל אביב"},
    # new demo partners
    {"name": "Am:pm", "category": BusinessCategory.SHOPPING, "location_lat": 32.0752, "location_lng": 34.7797, "address": "תל אביב"},
    {"name": "Yellow", "category": BusinessCategory.ECO, "location_lat": 32.0613, "location_lng": 34.7726, "address": "תל אביב"},
    {"name": "Aroma", "category": BusinessCategory.FOOD, "location_lat": 32.0733, "location_lng": 34.7779, "address": "תל אביב"},
    {"name": "yes Planet", "category": BusinessCategory.ENTERTAINMENT, "location_lat": 32.0580, "location_lng": 34.7680, "address": "תל אביב"},
    {"name": "ביטוח ישיר", "category": BusinessCategory.OTHER, "location_lat": 32.0700, "location_lng": 34.7900, "address": "תל אביב"},
    {"name": "McDonald's", "name_he": "מקדונלד'ס", "category": BusinessCategory.FOOD, "location_lat": 32.0763, "location_lng": 34.7745, "address": "תל אביב"},
]

# ---------------------------------------------------------------------------
# Reference data — rewards (existing + new, spanning 80–1800 pts)
# ---------------------------------------------------------------------------

REWARDS = [
    # existing
    {
        "business": "Paz",
        "title_he": '50 ש"ח הנחה בתדלוק',
        "title_en": "50 ILS Discount at Paz Gas Stations",
        "desc": '50 ש"ח הנחה בתדלוק בכל תחנות פז',
        "desc_en": "50 ILS Discount at All Paz Gas Stations",
        "cat": BusinessCategory.FUEL,
        "cost": 500,
        "emoji": "⛽",
    },
    {
        "business": "Arcaffe",
        "title_he": "קפה ומאפה חינם",
        "title_en": "Free Coffee and Pastry",
        "desc": "קפה ומאפה חינם בכל סניפי ארקפה",
        "desc_en": "Free Coffee and Pastry at All Arcaffe Branches",
        "cat": BusinessCategory.FOOD,
        "cost": 200,
        "emoji": "☕",
    },
    {
        "business": "Lime",
        "title_he": "15 דקות קורקינט Lime חינם",
        "desc": "15 דקות נסיעה חינם בקורקינט חשמלי Lime",
        "title_en": "15 Minutes Free Lime Electric Scooter",
        "desc_en": "15 Minutes Free Electric Scooter Rental at Lime",
        "cat": BusinessCategory.ECO,
        "cost": 300,
        "emoji": "🛴",
    },
    {
        "business": "Cinema City",
        "title_he": "כרטיס VIP לסרט",
        "desc": "כרטיס כניסה למתחם ה-VIP",
        "title_en": "VIP Ticket for Movie",
        "desc_en": "VIP Entry Ticket to the Cinema City",
        "cat": BusinessCategory.ENTERTAINMENT,
        "cost": 1200,
        "emoji": "🎬",
    },
    {
        "business": "Super-Pharm",
        "title_he": "20% הנחה בקוסמטיקה",
        "desc": "קופון הנחה למחלקת הקוסמטיקה בסופר-פארם",
        "title_en": "20% Discount on Cosmetics",
        "desc_en": "Discount Coupon for the Cosmetics Department at Super-Pharm",
        "cat": BusinessCategory.SHOPPING,
        "cost": 400,
        "emoji": "🧴",
    },
    # new — low entry point (achievable fast, builds aspiration)
    {
        "business": "Am:pm",
        "title_he": "שתייה קרה חינם",
        "desc": "שתייה קרה לבחירה חינם בכל סניפי Am:pm",
        "title_en": "Free Refreshment",
        "desc_en": "Free Refreshment at Any Am:pm Branch",
        "cat": BusinessCategory.SHOPPING,
        "cost": 80,
        "emoji": "🥤",
    },
    {
        "business": "Aroma",
        "title_he": "קפה גדול חינם",
        "desc": "קפה גדול לבחירה חינם בכל סניפי ארומה",
        "title_en": "Free Large Coffee",
        "desc_en": "Free Large Coffee at Any Aroma Branch",
        "cat": BusinessCategory.FOOD,
        "cost": 120,
        "emoji": "☕",
    },
    {
        "business": "Yellow",
        "title_he": "30 דקות אופניים חשמליים Yellow",
        "desc": "30 דקות נסיעה חינם באופניים חשמליים Yellow",
        "title_en": "30 Minutes Free Yellow Electric Bike",
        "desc_en": "30 Minutes Free Electric Bike Rental at Yellow",
        "cat": BusinessCategory.ECO,
        "cost": 450,
        "emoji": "🚲",
    },
    {
        "business": "yes Planet",
        "title_he": "משחק בולינג לזוג",
        "desc": "משחק בולינג לזוג ב-yes Planet כולל השכרת נעליים",
        "title_en": "Bowling Game for Two",
        "desc_en": "Bowling Game for Two at yes Planet including shoe rental",
        "cat": BusinessCategory.ENTERTAINMENT,
        "cost": 800,
        "emoji": "🎳",
    },
    {
        "business": "Paz",
        "title_he": '100 ש"ח הנחה בתדלוק',
        "desc": '100 ש"ח הנחה בתדלוק בכל תחנות פז',
        "title_en": "100 ILS Discount at Paz Gas Stations",
        "desc_en": "100 ILS Discount at All Paz Gas Stations",
        "cat": BusinessCategory.FUEL,
        "cost": 950,
        "emoji": "⛽",
    },
    {
        "business": "ביטוח ישיר",
        "title_he": "15% הנחה על ביטוח רכב",
        "desc": "15% הנחה על פוליסת ביטוח רכב שנתית — בלעדי לנהגי CARMA",
        "title_en": "15% Discount on Car Insurance",
        "desc_en": "15% Discount on Annual Car Insurance Policy — Exclusive to CARMA Drivers",
        "cat": BusinessCategory.OTHER,
        "cost": 5500,
        "emoji": "🛡️",
    },
    {
        "business": "McDonald's",
        "title_he": "גלידה פיצוץ",
        "title_en": "McFlurry",
        "desc": "גלידה פיצוץ חינם בכל סניפי מקדונלד'ס",
        "desc_en": "A free McFlurry Ice Cream Blast at any McDonald's branch",
        "cat": BusinessCategory.FOOD,
        "cost": 120,
        "emoji": "🍦",
        "icon": "ice-cream-outline",
    },
    {
        "business": "McDonald's",
        "title_he": "צ'יפס קטן חינם",
        "title_en": "Free Fries",
        "desc": "צ'יפס קטן חינם בכל סניפי מקדונלד'ס",
        "desc_en": "A small french fries at any McDonald's branch",
        "cat": BusinessCategory.FOOD,
        "cost": 150,
        "emoji": "🍟",
        "icon": "fast-food-outline",
    },
    {
        "business": "McDonald's",
        "title_he": "ארוחה חינם",
        "title_en": "Free Meal",
        "desc": "ארוחה חינם (המבורגר + צ'יפס + שתייה) בכל סניפי מקדונלד'ס",
        "desc_en": "Free meal (burger + fries + drink) at any McDonald's branch",
        "cat": BusinessCategory.FOOD,
        "cost": 350,
        "emoji": "🍔",
        "icon": "fast-food-outline",
    },
]

# ---------------------------------------------------------------------------
# Investor-demo leaderboard population (Tel Aviv, all public)
# ---------------------------------------------------------------------------

# CBS settlement codes (CAR-218). The seed used to store labels, and stored
# them in two languages: "Tel Aviv" for the leaderboard rows, "תל אביב" for Daniel.
_TEL_AVIV = "5000"
_RAMAT_GAN = "8600"

LEADERBOARD_USERS: list[dict[str, Any]] = [
    {"email": "tamar@carma.app", "name": "תמר רוזן",  "city_code": _TEL_AVIV,  "age": 30, "license_year": 2012, "driver_score": 73.5, "total_points": 4200, "level": 4, "total_distance": 210.0},
    {"email": "ron@carma.app",   "name": "רון ביטון", "city_code": _RAMAT_GAN, "age": 31, "license_year": 2013, "driver_score": 70.0, "total_points": 3100, "level": 3, "total_distance": 160.0},
    {"email": "omer@carma.app",  "name": "עומר פרץ",  "city_code": _RAMAT_GAN, "age": 23, "license_year": 2021, "driver_score": 66.5, "total_points": 1850, "level": 3, "total_distance": 95.0},
    {"email": "eli@carma.app",   "name": "אלי גולן",  "city_code": _TEL_AVIV,  "age": 35, "license_year": 2008, "driver_score": 61.0, "total_points": 950,  "level": 2, "total_distance": 55.0},
]

# Dan follows these four (shows in his Friends leaderboard)
DAN_FRIEND_EMAILS = [lu["email"] for lu in LEADERBOARD_USERS]

# ---------------------------------------------------------------------------
# Yoni — investor-demo protagonist (Tel Aviv, ranked near bottom → motivation)
# ---------------------------------------------------------------------------

YONI_FRIENDS = ["tamar@carma.app", "ron@carma.app", "omer@carma.app"]

# Yoni's trip history — 12 trips over ~4 weeks, arc of gradual improvement
# Columns: date_str, start_hour_utc, dur_sec, dist_km, score,
#          hard_brakes, aggr_accels, sharp_turns, risk_mult, touch_epochs, points,
#          start_loc, end_loc, ai_insight
_YONI_TRIPS: list[tuple[Any, ...]] = [
    # Phase 1 — rough start
    ("2026-05-15", 7,  1320, 10.0, 62, 4, 2, 1, 1.0, 0, 150, "כיכר המדינה",      "תל אביב - מרכז",  None),
    ("2026-05-17", 16, 1200,  8.0, 58, 5, 2, 0, 1.0, 1, 120, "תל אביב - צפון",   "יפו",              "בלימות תכופות — הגדל מרחק מהרכב לפניך."),
    ("2026-05-18",  7, 1680, 12.0, 65, 3, 2, 1, 1.0, 0, 180, "פלורנטין",          "רמת אביב",        None),
    ("2026-05-20", 16, 1320,  9.0, 60, 4, 1, 1, 1.0, 1, 140, "תל אביב - לב",     "נווה צדק",        None),
    # Phase 2 — slight improvement
    ("2026-05-22",  7, 1560, 11.0, 68, 3, 1, 1, 1.0, 0, 190, "הצפון הישן",        "תל אביב",         None),
    ("2026-05-24", 15, 1440, 10.0, 65, 3, 1, 0, 1.0, 0, 160, "תל אביב",           "רמת אביב ג׳",    None),
    ("2026-05-26",  7, 1800, 13.0, 70, 2, 1, 1, 1.0, 0, 220, "תל אביב - מרכז",   "אוניברסיטת ת״א", None),
    ("2026-05-28", 16, 1320,  9.0, 67, 3, 1, 0, 1.0, 0, 170, "כיכר רבין",         "כיכר המדינה",    None),
    # Phase 3 — steady progress
    ("2026-05-30",  7, 1560, 11.0, 72, 2, 1, 0, 1.0, 0, 200, "תל אביב",           "הרצליה",          None),
    ("2026-06-02", 16, 1440, 10.0, 71, 2, 1, 0, 1.0, 0, 185, "רחוב דיזנגוף",     "תל אביב - דרום", None),
    ("2026-06-09",  7, 1320,  9.0, 73, 2, 0, 0, 1.0, 0, 180, "תל אביב",           "יפו",             None),
    # Demo trip — score 74, 2 hard brakes on Dizengoff, 2 phone touches on coastal road
    ("2026-06-14",  7, 1500,  9.2, 74, 2, 1, 0, 1.0, 2, 200, "דיזנגוף, תל אביב", "כביש החוף",      "שתי בלימות חזקות בדיזנגוף ופעמיים נגיעה בטלפון בכביש החוף — נסה להתרכז בדרך."),
]

_YONI_TOTAL_POINTS = sum(t[10] for t in _YONI_TRIPS)   # 2 095
_YONI_TOTAL_DISTANCE = round(sum(t[3] for t in _YONI_TRIPS), 1)  # 120.2

async def backfill_driver_scores(db: AsyncSession) -> None:
    """Fill driver_score (scoring.md "The driver's own score") where it is NULL.

    Seeded users get their trips inserted directly, bypassing the live save path
    that normally maintains driver_score — leaving the demo leaderboard blank.
    v1-era trips (score_v2 NULL) contribute their avg_score. Never overwrites a
    score the live path already computed.
    """
    from app.services import scoring

    now = datetime.now(UTC)
    users = (await db.scalars(select(User).where(User.driver_score.is_(None)))).all()
    for user in users:
        rows = (
            await db.execute(
                select(Trip.score_v2, Trip.avg_score, Trip.distance_km, Trip.start_time).where(
                    Trip.user_id == user.id
                )
            )
        ).all()
        history = []
        for score_v2, avg_score, km, start in rows:
            score = score_v2 if score_v2 is not None else avg_score
            if score is None:
                continue
            aware_start = start if start.tzinfo else start.replace(tzinfo=UTC)
            history.append(
                scoring.TripHistoryPoint(
                    trip_score=score,
                    distance_km=km or 0.0,
                    age_days=max(0.0, (now - aware_start).total_seconds() / 86400.0),
                )
            )
        user.driver_score = scoring.compute_driver_score(history)


async def run() -> None:
    async with SessionLocal() as db:

        # --- Businesses ---
        biz_by_name: dict[str, Business] = {}
        for biz in BUSINESSES:
            name = cast(str, biz["name"])
            existing_b = await db.scalar(select(Business).where(Business.name == name))
            if existing_b is None:
                new_biz = Business(**biz)
                db.add(new_biz)
                biz_by_name[name] = new_biz
            else:
                for k, v in biz.items():
                    setattr(existing_b, k, v)
                biz_by_name[name] = existing_b
        await db.flush()

        # Every business needs at least one branch (CAR-341 continuation) —
        # a fresh dev DB migrates before it seeds, so 0034_business_branches's
        # own backfill never sees these rows; only a re-run against an
        # already-seeded DB would.
        for seeded_biz in biz_by_name.values():
            has_branch = await db.scalar(select(BusinessBranch.id).where(BusinessBranch.business_id == seeded_biz.id))
            if has_branch is None:
                db.add(
                    BusinessBranch(
                        business_id=seeded_biz.id,
                        address=seeded_biz.address,
                        location_lat=seeded_biz.location_lat,
                        location_lng=seeded_biz.location_lng,
                    )
                )
        await db.flush()

        # --- Rewards ---
        reward_map: dict[tuple[str, str], Reward] = {}
        for r in REWARDS:
            biz_row: Business = biz_by_name[cast(str, r["business"])]
            existing_r = await db.scalar(
                select(Reward).where(Reward.business_id == biz_row.id, Reward.title_he == r["title_he"])
            )
            data: dict[str, Any] = dict(
                business_id=biz_row.id,
                title_he=r["title_he"],
                title_en=r.get("title_en"),
                description_he=r["desc"],
                description_en=r.get("desc_en"),
                category=r["cat"],
                cost_points=r["cost"],
                image_icon=r.get("icon", "gift-outline"),
                stock=100,
                is_active=True,
            )
            if existing_r is None:
                new_r = Reward(**data)
                db.add(new_r)
                reward_map[(cast(str, r["business"]), cast(str, r["title_he"]))] = new_r
            else:
                for k, v in data.items():
                    setattr(existing_r, k, v)
                reward_map[(cast(str, r["business"]), cast(str, r["title_he"]))] = existing_r
        await db.flush()

        # Deactivate any stale reward no longer in REWARDS (e.g. after a rename),
        # so renamed/removed rewards don't linger in the marketplace as duplicates.
        seeded_reward_ids = {r.id for r in reward_map.values()}
        await db.execute(
            sql_update(Reward)
            .where(Reward.id.not_in(seeded_reward_ids), Reward.is_active.is_(True))
            .values(is_active=False)
        )
        await db.flush()

        # --- Legacy test driver (daniel@carma.app) ---
        daniel = await db.scalar(select(User).where(User.email == "daniel@carma.app"))
        if daniel is None:
            db.add(
                User(
                    email="daniel@carma.app",
                    password_hash=hash_password("password123"),
                    name="דניאל כהן",
                    role=UserRole.DRIVER,
                    city_code=_TEL_AVIV,
                    age=22,
                    license_year=2021,
                    points=1250,
                    total_points=1250,
                    total_distance=120.3,
                    level=2,
                )
            )
        else:
            # Fix level to match actual points (level 2 threshold = 500, level 3 = 1 500)
            daniel.level = 2
            daniel.total_points = 1250
            daniel.points = 1250

        # --- Leaderboard demo users ---
        for lu in LEADERBOARD_USERS:
            existing_lu = await db.scalar(select(User).where(User.email == lu["email"]))
            if existing_lu is None:
                db.add(
                    User(
                        email=lu["email"],
                        password_hash=hash_password("password123"),
                        name=lu["name"],
                        role=UserRole.DRIVER,
                        city_code=lu["city_code"],
                        age=lu["age"],
                        license_year=lu["license_year"],
                        driver_score=lu["driver_score"],
                        points=lu["total_points"],
                        total_points=lu["total_points"],
                        total_distance=lu["total_distance"],
                        level=lu["level"],
                    )
                )
            else:
                existing_lu.name = lu["name"]
                existing_lu.city_code = lu["city_code"]
                existing_lu.driver_score = lu["driver_score"]
                existing_lu.points = lu["total_points"]
                existing_lu.total_points = lu["total_points"]
                existing_lu.total_distance = lu["total_distance"]
                existing_lu.level = lu["level"]
        await db.flush()

        # --- Dan Ofri ---
        # A real driver, not a demo fixture: on a fresh DB this creates a plain
        # account with no trips or points. On every other run it is left alone
        # entirely — his points, level and driver_score are the app's own
        # output from real trips, and seeding must never overwrite them.
        dan = await db.scalar(select(User).where(User.email == "ofridan@gmail.com"))
        if dan is None:
            dan = User(
                email="ofridan@gmail.com",
                password_hash=hash_password("Dan1234"),
                name="דן עופרי",
                role=UserRole.DRIVER,
                city_code=_RAMAT_GAN,
                age=32,
                license_year=2012,
            )
            db.add(dan)
            await db.flush()

        # Dan is a real driver now (CAR-190 follow-up) — his trips, redemptions
        # and points are the app's live data, so seeding never deletes or
        # recomputes them. Only his Friends graph is kept in sync with the
        # current mock roster, additively, since it costs him nothing real.
        for friend_email in DAN_FRIEND_EMAILS:
            friend = await db.scalar(select(User).where(User.email == friend_email))
            if friend is None:
                continue
            already_follows = await db.scalar(
                select(UserFriend.id).where(UserFriend.follower_id == dan.id, UserFriend.followee_id == friend.id)
            )
            if already_follows is None:
                db.add(UserFriend(follower_id=dan.id, followee_id=friend.id, status=FriendStatus.ACCEPTED))

        await db.flush()

        # --- Yoni — investor-demo protagonist ---
        yoni = await db.scalar(select(User).where(User.email == "yoni@carma.app"))
        if yoni is None:
            yoni = User(
                email="yoni@carma.app",
                password_hash=hash_password("Yoni1234"),
                name="יוני כהן",
                role=UserRole.DRIVER,
                city_code=_TEL_AVIV,
                age=26,
                license_year=2019,
                points=_YONI_TOTAL_POINTS,
                total_points=_YONI_TOTAL_POINTS,
                total_distance=_YONI_TOTAL_DISTANCE,
                level=3,
            )
            db.add(yoni)
        else:
            yoni.name = "יוני כהן"
            yoni.password_hash = hash_password("Yoni1234")
            yoni.points = _YONI_TOTAL_POINTS
            yoni.total_points = _YONI_TOTAL_POINTS
            yoni.total_distance = _YONI_TOTAL_DISTANCE
            yoni.level = 3
        await db.flush()

        # Reset Yoni's trip history for idempotent re-runs.
        # Also clear any redemptions so the demo always starts with a clean voucher list.
        await db.execute(sql_delete(Trip).where(Trip.user_id == yoni.id))
        await db.execute(sql_delete(Redemption).where(Redemption.user_id == yoni.id))
        await db.execute(sql_delete(UserFriend).where(UserFriend.follower_id == yoni.id))
        await db.flush()

        # --- Yoni's trips ---
        for idx, row in enumerate(_YONI_TRIPS):
            date_str, start_h, dur_sec, dist_km, score, n_hb, n_aa, n_st, risk, n_te, pts, sloc, eloc, insight = row
            y, mo, d = int(date_str[:4]), int(date_str[5:7]), int(date_str[8:10])
            t_start = datetime(y, mo, d, start_h, 0, tzinfo=UTC)
            t_end = t_start + timedelta(seconds=dur_sec)
            db.add(
                Trip(
                    user_id=yoni.id,
                    start_time=t_start,
                    end_time=t_end,
                    duration_seconds=dur_sec,
                    distance_km=dist_km,
                    avg_score=float(score),
                    points=pts,
                    risk_multiplier=risk,
                    status=TripStatus.COMPLETED,
                    hard_brakes=n_hb,
                    aggressive_accels=n_aa,
                    sharp_turns=n_st,
                    touch_epochs=n_te,
                    start_location=sloc,
                    end_location=eloc,
                    ai_insight=insight,
                    synced_at=t_end,
                    idempotency_key=f"seed-trip-yoni-{idx:02d}",
                )
            )

        # --- Business owner login (the only way to exercise /api/business/*) ---
        # Every seeded Business has owner_user_id=NULL, so without this there is no
        # account that can reach the business dashboard at all. Aroma is arbitrary —
        # it just needs one business with a real owner behind it.
        aroma = await db.scalar(select(Business).where(Business.name == "Aroma"))
        biz_owner = await db.scalar(select(User).where(User.email == "aroma@carma.app"))
        if biz_owner is None:
            biz_owner = User(
                email="aroma@carma.app",
                password_hash=hash_password("Aroma1234"),
                name="ארומה תל אביב",
                role=UserRole.BUSINESS,
                city_code=_TEL_AVIV,
            )
            db.add(biz_owner)
            await db.flush()
        if aroma is not None:
            aroma.owner_user_id = biz_owner.id
            # CAR-74: authorization for /api/business/* comes from this row now,
            # not from owner_user_id alone — without it the seeded owner 403s.
            await ensure_owner_membership(db, aroma.id, biz_owner.id)

        # --- Yoni follows friends (Friends leaderboard) ---
        for friend_email in YONI_FRIENDS:
            friend = await db.scalar(select(User).where(User.email == friend_email))
            if friend is not None:
                db.add(UserFriend(follower_id=yoni.id, followee_id=friend.id, status=FriendStatus.ACCEPTED))

        await db.flush()
        await backfill_driver_scores(db)
        await db.commit()

    print("Seed completed OK")
    print("  Dan account : ofridan@gmail.com  (real driver — untouched by seeding)")
    print(f"  Yoni login  : yoni@carma.app / Yoni1234  (Level 3, {_YONI_TOTAL_POINTS} pts, {len(_YONI_TRIPS)} trips — demo protagonist)")
    print("  Test login  : daniel@carma.app / password123")
    print("  Business    : aroma@carma.app / Aroma1234  (owns Aroma — /api/business/rewards)")
    print(f"  Leaderboard : {len(LEADERBOARD_USERS)} demo users seeded")
    print(f"  Rewards     : {len(REWARDS)} active rewards (80-5500 pts)")


async def run_driver_scores_only() -> None:
    async with SessionLocal() as db:
        await backfill_driver_scores(db)
        await db.commit()
    print("driver_score backfill completed OK")


if __name__ == "__main__":
    import sys

    if "--driver-scores-only" in sys.argv:
        asyncio.run(run_driver_scores_only())
    else:
        asyncio.run(run())
