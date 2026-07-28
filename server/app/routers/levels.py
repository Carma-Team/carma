from __future__ import annotations

from fastapi import APIRouter

from app.schemas._base import CamelModel
from app.services import levels as svc

router = APIRouter(prefix="/api", tags=["levels"])


class LevelOut(CamelModel):
    level: int
    name: str
    name_en: str
    min_points: int
    max_points: int
    bonus_multiplier: float
    color: str
    icon: str
    perks: list[str]


class LevelsListOut(CamelModel):
    levels: list[LevelOut]


@router.get("/levels", response_model=LevelsListOut, response_model_by_alias=True)
async def list_levels() -> LevelsListOut:
    """The ladder, straight from `services.levels` (#61).

    No database read: the ladder is product configuration, not per-user data.
    `bonusMultiplier` is exposed so the client can *show* what a level is worth
    — it must never apply it. Points arrive from the server already multiplied.
    """
    return LevelsListOut(
        levels=[
            LevelOut(
                level=lv.number,
                name=lv.name_he,
                name_en=lv.name_en,
                min_points=lv.min_points,
                max_points=svc.max_points_for(lv.number),
                bonus_multiplier=lv.bonus_multiplier,
                color=lv.color,
                icon=lv.icon,
                perks=list(lv.perks_he),
            )
            for lv in svc.LEVELS
        ]
    )
