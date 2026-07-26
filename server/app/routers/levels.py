from __future__ import annotations

from fastapi import APIRouter

from app.schemas._base import CamelModel
from app.services import levels as svc

router = APIRouter(prefix="/api", tags=["levels"])


class UnlockOut(CamelModel):
    #: "discount" is the only kind today. The client renders a localised line
    #: per kind and ignores kinds it does not know, so adding one is additive.
    kind: str
    value: float


class LevelOut(CamelModel):
    level: int
    name: str
    name_en: str
    min_points: int
    max_points: int
    discount_pct: int
    bonus_multiplier: float
    color: str
    icon: str
    unlocks: list[UnlockOut]


class LevelsListOut(CamelModel):
    levels: list[LevelOut]


@router.get("/levels", response_model=LevelsListOut, response_model_by_alias=True)
async def list_levels() -> LevelsListOut:
    """The ladder, straight from `services.levels` (#61).

    No database read: the ladder is product configuration, not per-user data.
    `bonusMultiplier` is exposed so the client can *show* what a level is worth
    — it must never apply it. Points arrive from the server already multiplied.

    `unlocks` is derived from the ladder rather than written by hand, so the
    roadmap can only advertise something the server actually enforces.
    """
    return LevelsListOut(
        levels=[
            LevelOut(
                level=lv.number,
                name=lv.name_he,
                name_en=lv.name_en,
                min_points=lv.min_points,
                max_points=svc.max_points_for(lv.number),
                discount_pct=lv.discount_pct,
                bonus_multiplier=lv.bonus_multiplier,
                color=lv.color,
                icon=lv.icon,
                unlocks=[UnlockOut(kind=u.kind, value=u.value) for u in svc.unlocks_for(lv.number)],
            )
            for lv in svc.LEVELS
        ]
    )
