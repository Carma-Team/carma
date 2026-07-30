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


# Point thresholds are the ones that were already deciding `user.level`
# (the old `trips.py::_LEVEL_THRESHOLDS`), so no driver's level moves as a
# result of consolidating. The `levels` table disagreed at level 5 — 5,500
# against 7,000 — which only ever affected the roadmap screen, never the level
# a driver actually held.
#
# The multiplier moves on five rungs, not ten, and it moves hard when it moves.
#
# It used to rise 2% per level, topping out at 1.25. Two percent is below what a
# driver can feel: climbing from level 5 to level 6 was worth nothing they would
# notice, so the ladder gave them no reason to climb. Tiered-loyalty practice is
# 3-5 tiers with a top multiplier of 2x-3x — the rule being that a step nobody
# notices does not motivate. Ten rungs stay, because the progress bar is worth
# having; the reward bands underneath are five.
#
# Levels 3, 5, 8 and 10 are therefore milestones and the rungs between them are
# not. That is the intent: if every level paid more, no level would be an
# achievement. A quiet rung still moves the driver toward the next milestone.
#
# The daily points cap (scoring.md "Points") bounds what 2x can be worth, so the
# top of the ladder is an engagement lever rather than a grind risk.
#
# One caveat worth revisiting: the standard also wants the top band held by
# 10-15% of active drivers. 75,000 points was set before a single real driver
# existed, so the thresholds — not the multipliers — are what to recalibrate
# once the pilot has a distribution to look at.
LEVELS: tuple[LevelDef, ...] = (
    LevelDef(1, "מתחיל", "Beginner", 0, 1.00, "#94a3b8", "leaf-outline"),
    LevelDef(2, "זהיר", "Cautious", 500, 1.00, "#22c55e", "compass-outline"),
    LevelDef(3, "מרוכז", "Focused", 1_500, 1.25, "#16a34a", "aperture-outline"),
    LevelDef(4, "מיומן", "Skilled", 3_500, 1.25, "#0d9488", "flash-outline"),
    LevelDef(5, "חד", "Sharp", 7_000, 1.50, "#3b82f6", "shield-checkmark-outline"),
    LevelDef(6, "מומחה", "Expert", 12_000, 1.50, "#6366f1", "flame-outline"),
    LevelDef(7, "אשף", "Wizard", 20_000, 1.50, "#8b5cf6", "star-outline"),
    LevelDef(8, "מאסטר", "Master", 32_000, 1.75, "#f59e0b", "diamond-outline"),
    LevelDef(9, "גנרל הכביש", "Road General", 50_000, 1.75, "#ef4444", "trophy-outline"),
    LevelDef(10, "אגדה", "Legend", 75_000, 2.00, "#f97316", "ribbon-outline"),
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


def perks_for(number: int) -> tuple[str, ...]:
    """What a level actually gives, for the roadmap screen.

    Built from the ladder instead of written by hand. Levels used to carry free
    text — "5% הנחה בחנות הפרסים", "גישה לטבלת המובילים", "תג מאסטר" — and no
    code enforced any of it: the store always charged full price and the
    leaderboard was never gated. A driver was being shown things that did not
    exist.

    The faster points rate is the one thing a level really changes today, so it
    is the one thing listed. #83 adds rewards that need a minimum level; those
    join here when they are real.

    A rung between two milestones returns nothing, because it gives nothing —
    the driver still sees the level and the progress toward the next milestone.
    """
    lv = by_number(number)
    if lv.bonus_multiplier <= 1.0:
        return ()
    return (f"מכפיל נקודות x{lv.bonus_multiplier:.2f}",)
