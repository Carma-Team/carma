"""Seed the database with reference data and a demo driver.

Usage: python -m app.seed
"""

from __future__ import annotations

import asyncio
from typing import Any, cast

from sqlalchemy import select

from app.core.security import hash_password
from app.database import SessionLocal
from app.models import Business, BusinessCategory, Level, Reward, User, UserRole

LEVELS = [
    {
        "number": 1,
        "name_he": "מתחיל",
        "name_en": "Beginner",
        "min_points": 0,
        "discount_pct": 0,
        "bonus_multiplier": 1.0,
    },
    {
        "number": 2,
        "name_he": "זהיר",
        "name_en": "Cautious",
        "min_points": 500,
        "discount_pct": 0,
        "bonus_multiplier": 1.0,
    },
    {
        "number": 3,
        "name_he": "מרוכז",
        "name_en": "Focused",
        "min_points": 1500,
        "discount_pct": 5,
        "bonus_multiplier": 1.0,
    },
    {
        "number": 4,
        "name_he": "מיומן",
        "name_en": "Skilled",
        "min_points": 3500,
        "discount_pct": 5,
        "bonus_multiplier": 1.0,
    },
    {"number": 5, "name_he": "חד", "name_en": "Sharp", "min_points": 7000, "discount_pct": 10, "bonus_multiplier": 1.0},
    {
        "number": 6,
        "name_he": "מומחה",
        "name_en": "Expert",
        "min_points": 12000,
        "discount_pct": 10,
        "bonus_multiplier": 1.0,
    },
    {
        "number": 7,
        "name_he": "אשף",
        "name_en": "Wizard",
        "min_points": 20000,
        "discount_pct": 15,
        "bonus_multiplier": 1.0,
    },
    {
        "number": 8,
        "name_he": "מאסטר",
        "name_en": "Master",
        "min_points": 32000,
        "discount_pct": 15,
        "bonus_multiplier": 1.0,
    },
    {
        "number": 9,
        "name_he": "גנרל הכביש",
        "name_en": "Road General",
        "min_points": 50000,
        "discount_pct": 20,
        "bonus_multiplier": 1.1,
    },
    {
        "number": 10,
        "name_he": "אגדה",
        "name_en": "Legend",
        "min_points": 75000,
        "discount_pct": 25,
        "bonus_multiplier": 1.2,
    },
]

BUSINESSES = [
    {
        "name": "Paz",
        "category": BusinessCategory.FUEL,
        "location_lat": 32.0853,
        "location_lng": 34.7818,
        "address": "תל אביב",
    },
    {
        "name": "Arcaffe",
        "category": BusinessCategory.FOOD,
        "location_lat": 32.0809,
        "location_lng": 34.7806,
        "address": "תל אביב",
    },
    {
        "name": "Lime",
        "category": BusinessCategory.ECO,
        "location_lat": 32.0668,
        "location_lng": 34.7647,
        "address": "תל אביב",
    },
    {
        "name": "Cinema City",
        "category": BusinessCategory.ENTERTAINMENT,
        "location_lat": 32.1093,
        "location_lng": 34.8555,
        "address": "גלילות",
    },
    {
        "name": "Super-Pharm",
        "category": BusinessCategory.SHOPPING,
        "location_lat": 32.0721,
        "location_lng": 34.7787,
        "address": "תל אביב",
    },
]

REWARDS = [
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
        "cost": 150,
        "emoji": "☕",
    },
    {
        "business": "Lime",
        "title_he": "15 דקות נסיעה",
        "desc": "15 דקות נסיעה בחינם בקורקינט חשמלי",
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
        "title_he": "20% הנחה",
        "desc": "קופון הנחה למחלקת הקוסמטיקה",
        "cat": BusinessCategory.SHOPPING,
        "cost": 400,
        "emoji": "🧴",
    },
]


async def run() -> None:
    async with SessionLocal() as db:
        # levels
        for lv in LEVELS:
            existing = await db.scalar(select(Level).where(Level.number == lv["number"]))
            if existing is None:
                db.add(Level(**lv))
            else:
                for k, v in lv.items():
                    setattr(existing, k, v)

        # businesses
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

        # rewards
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
                db.add(Reward(**data))
            else:
                for k, v in data.items():
                    setattr(existing_r, k, v)

        # demo driver — matches legacy test credentials
        demo_email = "daniel@carma.app"
        existing_user = await db.scalar(select(User).where(User.email == demo_email))
        if existing_user is None:
            db.add(
                User(
                    email=demo_email,
                    password_hash=hash_password("password123"),
                    name="דניאל כהן",
                    role=UserRole.DRIVER,
                    city="תל אביב",
                    age=22,
                    license_year=2021,
                    points=1250,
                    total_points=1250,
                    total_distance=301.7,
                    level=5,
                )
            )

        await db.commit()
    print("✓ Seed completed (login: daniel@carma.app / password123)")


if __name__ == "__main__":
    asyncio.run(run())
