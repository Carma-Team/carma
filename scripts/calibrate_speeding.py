"""What `k_speed` should actually be, measured on real trips (CAR-222 / CAR-102).

    python scripts/calibrate_speeding.py

Replays every stored trip's waypoints through the real limit lookup and the real
analyzer, then prints the fleet's distribution of speeding ratio and the subscore
each candidate `k_speed` would produce for it.

`k_speed` shipped as an anchor, not a fit: 1% of distance over the buffer scores
95, 10% scores 61. Those came from the UBI literature's average driver, not from
our drivers. This script is what replaces them. Two failure modes to watch for,
and they pull in opposite directions:

  * **Almost every trip near 100.** The component is decoration again, which is
    the whole complaint CAR-233 raised. Raise k, or narrow the buffer.
  * **Almost every trip on the floor.** Then the score stops distinguishing a
    driver who speeds occasionally from one who always does, which is the same
    failure wearing the other hat.

Also prints limit coverage. If a large share of trips fall below
`telemetry._LIMIT_COVERAGE_MIN`, the map is the problem, not the constant -
reload it or widen `speed_limits._MATCH_RADIUS_M` before touching k.
"""

from __future__ import annotations

import asyncio
import os
import math
import sys
from pathlib import Path

# Settings reads `.env` relative to the working directory, so these scripts run
# from server/ whatever directory they were invoked from.
_SERVER = Path(__file__).resolve().parents[1] / "server"
sys.path.insert(0, str(_SERVER))
os.chdir(_SERVER)

from app.database import SessionLocal  # noqa: E402
from app.services import speed_limits, telemetry  # noqa: E402
from sqlalchemy import text  # noqa: E402

_CANDIDATE_K = (0.02, 0.035, 0.05, 0.08, 0.12)


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(int(p / 100.0 * len(ordered)), len(ordered) - 1)]


async def main() -> None:
    async with SessionLocal() as db:
        rows = await db.execute(
            text(
                "SELECT id, route_waypoints, duration_seconds FROM trips "
                "WHERE route_waypoints IS NOT NULL "
                "AND jsonb_array_length(route_waypoints) >= 20"
            )
        )
        trips = rows.all()
        print(f"{len(trips)} trips with a usable trace\n")

        ratios: list[float] = []
        coverages: list[float] = []
        scored = 0
        for _id, waypoints, duration_seconds in trips:
            limits = await speed_limits.resolve(db, waypoints)
            gps = telemetry.analyze(waypoints, int(duration_seconds or 0), speed_limits=limits)
            coverages.append(gps.limit_coverage)
            if gps.has_speed_data:
                ratios.append(gps.speeding_ratio)
                scored += 1

    print(f"limit coverage   median {_percentile(coverages, 50):.0%}   p10 {_percentile(coverages, 10):.0%}")
    print(f"speeding scored on {scored}/{len(trips)} trips\n")
    if not ratios:
        print(
            "no trips with a usable trace yet - nothing to calibrate against"
            if not trips
            else "no trip cleared the coverage bar - check the map is loaded (scripts/load_speed_limits.py)"
        )
        return

    print("share of distance over the limit + buffer")
    for p in (50, 75, 90, 95, 99):
        print(f"  p{p:<3} {_percentile(ratios, p):.2%}")

    print("\nsubscore each candidate k would give at those percentiles")
    header = "  k      " + "".join(f"p{p:<7}" for p in (50, 75, 90, 95, 99))
    print(header)
    for k in _CANDIDATE_K:
        cells = "".join(f"{100 * math.exp(-k * 100 * _percentile(ratios, p)):<8.1f}" for p in (50, 75, 90, 95, 99))
        print(f"  {k:<7}{cells}")


if __name__ == "__main__":
    asyncio.run(main())
