"""merge reward description and trip weakest factor heads

`0038_trip_weakest_factor` (CAR-186) was cut off `24b7ca343591` while that was
still develop's head. `0037_reward_desc_he_optional` (#333) landed off the same
parent between that branch's CI run and its merge, which is a state neither
PR's own checks can see. Nothing to migrate — this only rejoins the graph, the
same way `24b7ca343591` and `c443b498bcc7` did.

Revision ID: 9b091ac0fd71
Revises: 0037_reward_desc_he_optional, 0038_trip_weakest_factor
Create Date: 2026-09-07

"""

from __future__ import annotations

revision: str = "9b091ac0fd71"
down_revision: tuple[str, str] = ("0037_reward_desc_he_optional", "0038_trip_weakest_factor")
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
