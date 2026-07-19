from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from sqlalchemy import select

from app.core.deps import DbSession
from app.models import Level
from app.schemas._base import CamelModel

router = APIRouter(prefix="/api", tags=["levels"])

# UI-only decorations — not stored in DB (colour/icon are presentation concerns)
_LEVEL_META: dict[int, dict[str, Any]] = {
    1: {"color": "#94a3b8", "icon": "🌱", "perks": []},
    2: {"color": "#22c55e", "icon": "🚗", "perks": ["גישה לטבלת המובילים"]},
    3: {"color": "#16a34a", "icon": "⭐", "perks": ["5% הנחה בחנות הפרסים"]},
    4: {"color": "#0d9488", "icon": "🛡️", "perks": ["5% הנחה בחנות הפרסים", "פרסים בלעדיים"]},
    5: {"color": "#3b82f6", "icon": "🏅", "perks": ["10% הנחה", "מכפיל נקודות x1.1"]},
    6: {"color": "#6366f1", "icon": "💎", "perks": ["10% הנחה", "גישה VIP לפרסים"]},
    7: {"color": "#8b5cf6", "icon": "🌟", "perks": ["15% הנחה", "בונוס חודשי"]},
    8: {"color": "#f59e0b", "icon": "🏆", "perks": ["15% הנחה", "תג מאסטר"]},
    9: {"color": "#ef4444", "icon": "⚡", "perks": ["20% הנחה", "VIP לכל הפרסים"]},
    10: {"color": "#f97316", "icon": "👑", "perks": ["25% הנחה", "מכפיל x1.2", "גישה לכל"]},
}


class LevelOut(CamelModel):
    level: int
    name: str
    name_en: str
    min_points: int
    max_points: int
    color: str
    icon: str
    perks: list[str]


class LevelsListOut(CamelModel):
    levels: list[LevelOut]


@router.get("/levels", response_model=LevelsListOut, response_model_by_alias=True)
async def list_levels(db: DbSession) -> LevelsListOut:
    rows = (await db.scalars(select(Level).order_by(Level.number.asc()))).all()
    out: list[LevelOut] = []
    for i, row in enumerate(rows):
        next_min = rows[i + 1].min_points if i + 1 < len(rows) else None
        max_pts = (next_min - 1) if next_min is not None else 2_147_483_647
        meta = _LEVEL_META.get(row.number, {"color": "#94a3b8", "icon": "🌱", "perks": []})
        out.append(
            LevelOut(
                level=row.number,
                name=row.name_he,
                name_en=row.name_en,
                min_points=row.min_points,
                max_points=max_pts,
                color=meta["color"],
                icon=meta["icon"],
                perks=meta["perks"],
            )
        )
    return LevelsListOut(levels=out)
