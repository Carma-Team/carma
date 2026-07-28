"""The level ladder — the single definition of it anywhere (#61).

Before this module the ladder existed in five places that disagreed:
`trips.py::_LEVEL_THRESHOLDS`, the `levels` table, `_LEVEL_META` in the router,
and two tables in the mobile client. At 20,000 lifetime points the server said
level 7 and the client said level 10.

It lives in code rather than in a table because it is product configuration,
not data: nothing here is per-user, nothing is written at runtime, and a table
that only ever mirrors a constant is a second copy waiting to drift — which is
exactly what happened. `/api/levels` serves this list, so the client cannot
hold a stale copy either; it renders whatever the server sends.

Changing the ladder means a deploy. That is the intent — thresholds and the
points economy are reviewed changes, not a live database edit.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LevelDef:
    number: int
    name_he: str
    name_en: str
    min_points: int
    #: Multiplies the points a trip earns. Applied against the level the driver
    #: *entered* the trip at — see `trips.save`.
    bonus_multiplier: float
    color: str
    icon: str
    perks_he: tuple[str, ...]


# Point thresholds are the ones that were already deciding `user.level`
# (the old `trips.py::_LEVEL_THRESHOLDS`), so no driver's level moves as a
# result of consolidating. The `levels` table disagreed at level 5 — 5,500
# against 7,000 — which only ever affected the roadmap screen, never the level
# a driver actually held.
#
# Multipliers ramp at every level. The old table gave 1.0 for levels 1-8 and
# only moved at 9 and 10, so eight of ten levels carried no economic reward at
# all — a ladder that pays nothing until the very top does not motivate anyone.
# The daily points cap in scoring_v2 (§8) already bounds what this can be worth,
# so the top multiplier is an engagement lever, not a grind risk.
#
# No level carries a discount. Levels 3-10 used to advertise 5%-25% off in the
# reward shop, and nothing in the code ever charged less — the perk text was the
# only place it existed. #83 replaces it with access: a business decides which
# rewards need a minimum level. Until that lands a level buys a faster points
# rate, and the perk text says only what is true.
LEVELS: tuple[LevelDef, ...] = (
    LevelDef(1, "מתחיל", "Beginner", 0, 1.00, "#94a3b8", "leaf-outline", ()),
    LevelDef(2, "זהיר", "Cautious", 500, 1.02, "#22c55e", "compass-outline", ("גישה לטבלת המובילים",)),
    LevelDef(3, "מרוכז", "Focused", 1_500, 1.04, "#16a34a", "aperture-outline", ()),
    LevelDef(4, "מיומן", "Skilled", 3_500, 1.06, "#0d9488", "flash-outline", ("פרסים בלעדיים",)),
    LevelDef(5, "חד", "Sharp", 7_000, 1.08, "#3b82f6", "shield-checkmark-outline", ("מכפיל נקודות x1.08",)),
    LevelDef(6, "מומחה", "Expert", 12_000, 1.10, "#6366f1", "flame-outline", ("גישה VIP לפרסים",)),
    LevelDef(7, "אשף", "Wizard", 20_000, 1.12, "#8b5cf6", "star-outline", ("מכפיל נקודות x1.12",)),
    LevelDef(8, "מאסטר", "Master", 32_000, 1.15, "#f59e0b", "diamond-outline", ("תג מאסטר",)),
    LevelDef(9, "גנרל הכביש", "Road General", 50_000, 1.18, "#ef4444", "trophy-outline", ("VIP לכל הפרסים",)),
    LevelDef(10, "אגדה", "Legend", 75_000, 1.25, "#f97316", "ribbon-outline", ("מכפיל נקודות x1.25",)),
)

MAX_LEVEL = LEVELS[-1].number

# Highest-first, so a CASE expression short-circuits on the first match.
_DESCENDING = tuple(sorted(LEVELS, key=lambda lv: lv.min_points, reverse=True))


def thresholds_desc() -> tuple[tuple[int, int], ...]:
    """(min_points, level) pairs, highest first — for the SQL CASE in `trips.save`."""
    return tuple((lv.min_points, lv.number) for lv in _DESCENDING if lv.min_points > 0)


def level_for_points(total_points: int) -> int:
    for lv in _DESCENDING:
        if total_points >= lv.min_points:
            return lv.number
    return 1


def by_number(number: int) -> LevelDef:
    """Clamped lookup — a level outside the ladder resolves to its nearest end."""
    idx = min(max(number, 1), MAX_LEVEL) - 1
    return LEVELS[idx]


def max_points_for(number: int) -> int:
    """Top of a level's band. The last level is open-ended (int32 max, for the wire)."""
    if number >= MAX_LEVEL:
        return 2_147_483_647
    return by_number(number + 1).min_points - 1
