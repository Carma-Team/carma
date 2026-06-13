"""Seed the database with reference data and investor-demo drivers.

Usage: python -m app.seed
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, cast

from sqlalchemy import delete as sql_delete, select

from app.core.security import hash_password
from app.database import SessionLocal
from app.models import (
    Business,
    BusinessCategory,
    FriendStatus,
    Level,
    Redemption,
    RedemptionStatus,
    Reward,
    Trip,
    TripStatus,
    User,
    UserFriend,
    UserRole,
)

# ---------------------------------------------------------------------------
# Reference data — levels
# ---------------------------------------------------------------------------

LEVELS = [
    {"number": 1, "name_he": "מתחיל", "name_en": "Beginner", "min_points": 0, "discount_pct": 0, "bonus_multiplier": 1.0},
    {"number": 2, "name_he": "זהיר", "name_en": "Cautious", "min_points": 500, "discount_pct": 0, "bonus_multiplier": 1.0},
    {"number": 3, "name_he": "מרוכז", "name_en": "Focused", "min_points": 1500, "discount_pct": 5, "bonus_multiplier": 1.0},
    {"number": 4, "name_he": "מיומן", "name_en": "Skilled", "min_points": 3500, "discount_pct": 5, "bonus_multiplier": 1.0},
    {"number": 5, "name_he": "חד", "name_en": "Sharp", "min_points": 5500, "discount_pct": 10, "bonus_multiplier": 1.0},
    {"number": 6, "name_he": "מומחה", "name_en": "Expert", "min_points": 12000, "discount_pct": 10, "bonus_multiplier": 1.0},
    {"number": 7, "name_he": "אשף", "name_en": "Wizard", "min_points": 20000, "discount_pct": 15, "bonus_multiplier": 1.0},
    {"number": 8, "name_he": "מאסטר", "name_en": "Master", "min_points": 32000, "discount_pct": 15, "bonus_multiplier": 1.0},
    {"number": 9, "name_he": "גנרל הכביש", "name_en": "Road General", "min_points": 50000, "discount_pct": 20, "bonus_multiplier": 1.1},
    {"number": 10, "name_he": "אגדה", "name_en": "Legend", "min_points": 75000, "discount_pct": 25, "bonus_multiplier": 1.2},
]

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
]

# ---------------------------------------------------------------------------
# Reference data — rewards (existing + new, spanning 80–1800 pts)
# ---------------------------------------------------------------------------

REWARDS = [
    # existing
    {
        "business": "Paz",
        "title_he": '50 ש"ח הנחה בתדלוק',
        "desc": '50 ש"ח הנחה בתדלוק בכל תחנות פז',
        "cat": BusinessCategory.FUEL,
        "cost": 500,
        "emoji": "⛽",
    },
    {
        "business": "Arcaffe",
        "title_he": "קפה ומאפה חינם",
        "desc": "קפה ומאפה חינם בכל סניפי ארקפה",
        "cat": BusinessCategory.FOOD,
        "cost": 200,
        "emoji": "☕",
    },
    {
        "business": "Lime",
        "title_he": "15 דקות קורקינט Lime חינם",
        "desc": "15 דקות נסיעה חינם בקורקינט חשמלי Lime",
        "cat": BusinessCategory.ECO,
        "cost": 300,
        "emoji": "🛴",
    },
    {
        "business": "Cinema City",
        "title_he": "כרטיס VIP לסרט",
        "desc": "כרטיס כניסה למתחם ה-VIP",
        "cat": BusinessCategory.ENTERTAINMENT,
        "cost": 1200,
        "emoji": "🎬",
    },
    {
        "business": "Super-Pharm",
        "title_he": "20% הנחה בקוסמטיקה",
        "desc": "קופון הנחה למחלקת הקוסמטיקה בסופר-פארם",
        "cat": BusinessCategory.SHOPPING,
        "cost": 400,
        "emoji": "🧴",
    },
    # new — low entry point (achievable fast, builds aspiration)
    {
        "business": "Am:pm",
        "title_he": "שתייה קרה חינם",
        "desc": "שתייה קרה לבחירה חינם בכל סניפי Am:pm",
        "cat": BusinessCategory.SHOPPING,
        "cost": 80,
        "emoji": "🥤",
    },
    {
        "business": "Aroma",
        "title_he": "קפה גדול חינם",
        "desc": "קפה גדול לבחירה חינם בכל סניפי ארומה",
        "cat": BusinessCategory.FOOD,
        "cost": 120,
        "emoji": "☕",
    },
    {
        "business": "Yellow",
        "title_he": "30 דקות אופניים חשמליים Yellow",
        "desc": "30 דקות נסיעה חינם באופניים חשמליים Yellow",
        "cat": BusinessCategory.ECO,
        "cost": 450,
        "emoji": "🚲",
    },
    {
        "business": "yes Planet",
        "title_he": "משחק בולינג לזוג",
        "desc": "משחק בולינג לזוג ב-yes Planet כולל השכרת נעליים",
        "cat": BusinessCategory.ENTERTAINMENT,
        "cost": 800,
        "emoji": "🎳",
    },
    {
        "business": "Paz",
        "title_he": '100 ש"ח הנחה בתדלוק',
        "desc": '100 ש"ח הנחה בתדלוק בכל תחנות פז',
        "cat": BusinessCategory.FUEL,
        "cost": 950,
        "emoji": "⛽",
    },
    {
        "business": "ביטוח ישיר",
        "title_he": "15% הנחה על ביטוח רכב",
        "desc": "15% הנחה על פוליסת ביטוח רכב שנתית — בלעדי לנהגי CARMA",
        "cat": BusinessCategory.OTHER,
        "cost": 5500,
        "emoji": "🛡️",
    },
]

# ---------------------------------------------------------------------------
# Investor-demo leaderboard population (Tel Aviv, all public)
# ---------------------------------------------------------------------------

LEADERBOARD_USERS = [
    # Tel Aviv
    {"email": "yoav@carma.app",   "name": "יואב לוי",    "city": "תל אביב", "age": 28, "license_year": 2015, "total_points": 12400, "level": 6, "total_distance": 596.2},
    {"email": "noa@carma.app",    "name": "נועה שמיר",   "city": "תל אביב", "age": 25, "license_year": 2018, "total_points": 7800,  "level": 5, "total_distance": 374.8},
    {"email": "tamar@carma.app",  "name": "תמר רוזן",    "city": "תל אביב", "age": 30, "license_year": 2012, "total_points": 5200,  "level": 4, "total_distance": 250.1},
    {"email": "eli@carma.app",    "name": "אלי גולן",    "city": "תל אביב", "age": 35, "license_year": 2008, "total_points": 2900,  "level": 3, "total_distance": 139.5},
    {"email": "michal@carma.app", "name": "מיכל דוד",    "city": "תל אביב", "age": 22, "license_year": 2022, "total_points": 1600,  "level": 3, "total_distance": 77.0},
    {"email": "uri@carma.app",    "name": "אורי כהן",    "city": "תל אביב", "age": 24, "license_year": 2020, "total_points": 820,   "level": 2, "total_distance": 39.4},
    # Ramat Gan
    {"email": "ron@carma.app",    "name": "רון ביטון",   "city": "רמת גן",  "age": 31, "license_year": 2013, "total_points": 6100,  "level": 5, "total_distance": 293.5},
    {"email": "shira@carma.app",  "name": "שירה אמיר",   "city": "רמת גן",  "age": 27, "license_year": 2017, "total_points": 3200,  "level": 3, "total_distance": 154.0},
    {"email": "omer@carma.app",   "name": "עומר פרץ",    "city": "רמת גן",  "age": 23, "license_year": 2021, "total_points": 1100,  "level": 2, "total_distance": 53.2},
]

# Dan follows these three (shows in his Friends leaderboard)
DAN_FRIEND_EMAILS = ["yoav@carma.app", "noa@carma.app", "tamar@carma.app"]

# ---------------------------------------------------------------------------
# Dan Ofri trip history — 18 trips over ~3 weeks (total 4 540 pts, 218.4 km)
#
# Columns:
#   date_str, start_hour_utc, dur_sec, dist_km, score,
#   hard_brakes, aggr_accels, sharp_turns, risk_mult, points,
#   start_loc, end_loc, ai_insight
# ---------------------------------------------------------------------------

_DAN_TRIPS: list[tuple] = [
    # Phase 1 — starting out, rough driving (scores 58–70)
    ("2026-05-15", 5,  1440, 8.2,  58, 5, 3, 2, 1.0, 175, "הרצליה פיתוח",    "תל אביב - מרכז",    "בלימות קשות תכופות — נסה להגדיל מרחק מהרכב לפניך."),
    ("2026-05-16", 15, 2100, 12.1, 62, 4, 2, 1, 1.0, 275, "תל אביב - צפון",  "רמת גן",             "שיפור קטן מאתמול! עבוד על העקביות בנהיגה."),
    ("2026-05-17", 19, 2580, 14.5, 65, 4, 2, 1, 1.5, 310, "תל אביב",         "חולון",               "נסיעת ערב — האטה בצמתים תשפר את הציון שלך."),
    ("2026-05-19", 5,  1200, 6.3,  60, 5, 2, 1, 1.0, 145, "תל אביב - לב",    "גבעתיים",             "בוקר עמוס — נסה לצאת מוקדם יותר כדי להפחית לחץ."),
    ("2026-05-20", 13, 3120, 22.0, 68, 3, 2, 2, 1.0, 395, "תל אביב",         "הרצליה",              None),
    ("2026-05-21", 6,  1680, 10.5, 63, 4, 1, 1, 1.0, 235, "גבעתיים",         "תל אביב - לב",       "הפחת תאוצות חזקות — זה חוסך דלק ומשפר ציון."),
    ("2026-05-22", 11, 1440, 8.8,  70, 3, 1, 1, 1.0, 185, "תל אביב",         "יפו",                 None),
    # Phase 2 — CARMA coaching kicks in, gradual improvement (scores 72–85)
    ("2026-05-23", 5,  2280, 13.2, 72, 3, 1, 0, 1.0, 255, "הרצליה",          "תל אביב",             "מגמה חיובית! פחות בלימות קשות מהשבוע שעבר."),
    ("2026-05-25", 14, 1980, 13.7, 76, 2, 1, 0, 1.0, 305, "תל אביב",         "פתח תקווה",           None),
    ("2026-05-26", 19, 2880, 15.4, 78, 2, 1, 0, 1.5, 295, "תל אביב",         "ראשון לציון",         None),
    ("2026-05-27", 5,  1560, 9.6,  76, 2, 1, 0, 1.0, 210, "תל אביב - צפון",  "בני ברק",             None),
    ("2026-05-28", 15, 2520, 16.0, 83, 1, 1, 0, 1.0, 345, "כפר סבא",         "תל אביב",             "שיפור ניכר! הנהיגה שלך הרבה יותר חלקה השבוע."),
    ("2026-05-29", 5,  1260, 7.4,  85, 1, 0, 0, 1.0, 165, "תל אביב",         "רמת השרון",           "כמעט מושלם! רק בלימה קשה אחת."),
    # Phase 3 — skilled driver, high and consistent (scores 84–95)
    ("2026-05-30", 12, 2220, 13.2, 84, 1, 1, 0, 1.0, 260, "רמת גן",          "תל אביב",             None),
    ("2026-06-01", 6,  1860, 11.8, 88, 1, 0, 0, 1.0, 250, "תל אביב",         "הרצליה פיתוח",        "נהיגה מצוינת! שמרת על מרחק בטוח לאורך כל הדרך."),
    ("2026-06-02", 15, 1620, 9.9,  90, 0, 0, 1, 1.0, 200, "תל אביב - מרכז",  "גבעתיים",             None),
    ("2026-06-03", 5,  2460, 17.3, 92, 0, 1, 0, 1.0, 345, "נתניה",           "תל אביב",             "נסיעת בוקר מוצלחת! שמירה מצוינת על מהירות קבועה."),
    ("2026-06-03", 17, 1740, 8.5,  95, 0, 0, 0, 1.0, 190, "תל אביב",         "יפו הישנה",           "נסיעה כמעט מושלמת! המשך כך."),
]

# Points from Paz voucher Dan already redeemed
_DAN_REDEEMED_POINTS = 500
_DAN_TOTAL_POINTS = sum(t[9] for t in _DAN_TRIPS)   # 4 540
_DAN_TOTAL_DISTANCE = round(sum(t[3] for t in _DAN_TRIPS), 1)  # 218.4


async def run() -> None:
    async with SessionLocal() as db:

        # --- Levels ---
        for lv in LEVELS:
            existing = await db.scalar(select(Level).where(Level.number == lv["number"]))
            if existing is None:
                db.add(Level(**lv))
            else:
                for k, v in lv.items():
                    setattr(existing, k, v)

        # --- Businesses ---
        biz_by_name: dict[str, Business] = {}
        for biz in BUSINESSES:
            name = cast(str, biz["name"])
            existing_b = await db.scalar(select(Business).where(Business.name == name))
            if existing_b is None:
                row = Business(**biz)
                db.add(row)
                biz_by_name[name] = row
            else:
                for k, v in biz.items():
                    setattr(existing_b, k, v)
                biz_by_name[name] = existing_b
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
                description_he=r["desc"],
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

        # --- Legacy test driver (daniel@carma.app) ---
        daniel = await db.scalar(select(User).where(User.email == "daniel@carma.app"))
        if daniel is None:
            db.add(
                User(
                    email="daniel@carma.app",
                    password_hash=hash_password("password123"),
                    name="דניאל כהן",
                    role=UserRole.DRIVER,
                    city="תל אביב",
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
                        city=lu["city"],
                        age=lu["age"],
                        license_year=lu["license_year"],
                        points=lu["total_points"],
                        total_points=lu["total_points"],
                        total_distance=lu["total_distance"],
                        level=lu["level"],
                    )
                )
            else:
                existing_lu.name = lu["name"]
                existing_lu.points = lu["total_points"]
                existing_lu.total_points = lu["total_points"]
                existing_lu.total_distance = lu["total_distance"]
                existing_lu.level = lu["level"]
        await db.flush()

        # --- Dan Ofri (investor-demo primary account) ---
        dan = await db.scalar(select(User).where(User.email == "ofridan@gmail.com"))
        if dan is None:
            dan = User(
                email="ofridan@gmail.com",
                password_hash=hash_password("Dan1234"),
                name="דן עופרי",
                role=UserRole.DRIVER,
                city="רמת גן",
                age=32,
                license_year=2012,
                points=_DAN_TOTAL_POINTS - _DAN_REDEEMED_POINTS,
                total_points=_DAN_TOTAL_POINTS,
                total_distance=_DAN_TOTAL_DISTANCE,
                level=4,
            )
            db.add(dan)
        else:
            dan.name = "דן עופרי"
            dan.password_hash = hash_password("Dan1234")
            dan.city = "רמת גן"
            dan.points = _DAN_TOTAL_POINTS - _DAN_REDEEMED_POINTS
            dan.total_points = _DAN_TOTAL_POINTS
            dan.total_distance = _DAN_TOTAL_DISTANCE
            dan.level = 4
        await db.flush()

        # Reset Dan's demo data for idempotent re-runs
        await db.execute(sql_delete(Trip).where(Trip.user_id == dan.id))
        await db.execute(sql_delete(Redemption).where(Redemption.user_id == dan.id))
        await db.execute(sql_delete(UserFriend).where(UserFriend.follower_id == dan.id))
        await db.flush()

        # --- Dan's trips ---
        for idx, row in enumerate(_DAN_TRIPS):
            date_str, start_h, dur_sec, dist_km, score, n_hb, n_aa, n_st, risk, pts, sloc, eloc, insight = row
            y, mo, d = int(date_str[:4]), int(date_str[5:7]), int(date_str[8:10])
            start_time = datetime(y, mo, d, start_h, 0, tzinfo=timezone.utc)
            end_time = start_time + timedelta(seconds=dur_sec)
            db.add(
                Trip(
                    user_id=dan.id,
                    start_time=start_time,
                    end_time=end_time,
                    duration_seconds=dur_sec,
                    distance_km=dist_km,
                    avg_score=float(score),
                    points=pts,
                    risk_multiplier=risk,
                    status=TripStatus.COMPLETED,
                    hard_brakes=n_hb,
                    aggressive_accels=n_aa,
                    sharp_turns=n_st,
                    start_location=sloc,
                    end_location=eloc,
                    ai_insight=insight,
                    synced_at=end_time,
                    idempotency_key=f"seed-trip-dan-{idx:02d}",
                )
            )

        # --- Dan's redeemed voucher (Paz 50 ₪, used on May 21) ---
        paz_reward = reward_map.get(("Paz", '50 ש"ח הנחה בתדלוק'))
        if paz_reward:
            used_at = datetime(2026, 5, 21, 9, 45, tzinfo=timezone.utc)
            db.add(
                Redemption(
                    user_id=dan.id,
                    reward_id=paz_reward.id,
                    qr_code="seed-dan-voucher-paz-01",
                    qr_data="seed-dan-voucher-paz-01",
                    status=RedemptionStatus.USED,
                    expires_at=used_at + timedelta(minutes=5),
                    used_at=used_at,
                )
            )

        # --- Dan follows top 3 (Friends leaderboard) ---
        for friend_email in DAN_FRIEND_EMAILS:
            friend = await db.scalar(select(User).where(User.email == friend_email))
            if friend is not None:
                db.add(UserFriend(follower_id=dan.id, followee_id=friend.id, status=FriendStatus.ACCEPTED))

        await db.commit()

    print("Seed completed OK")
    print(f"  Demo login  : ofridan@gmail.com / Dan1234  (Level 4, {_DAN_TOTAL_POINTS} pts, {len(_DAN_TRIPS)} trips)")
    print(f"  Test login  : daniel@carma.app / password123")
    print(f"  Leaderboard : {len(LEADERBOARD_USERS)} demo users seeded in תל אביב")
    print(f"  Rewards     : {len(REWARDS)} active rewards (80-5500 pts)")


if __name__ == "__main__":
    asyncio.run(run())
