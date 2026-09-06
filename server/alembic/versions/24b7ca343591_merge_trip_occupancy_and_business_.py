"""merge trip occupancy and business branches heads

`0034_trip_occupancy` (CAR-220) was cut off `0033_drop_users_city` while that
was still develop's head. `0034_business_branches` landed off the same parent
in the meantime, followed by `0035_branch_legacy_sync` and
`0036_branch_on_legacy_insert`, leaving alembic with two heads. Nothing to
migrate — this only rejoins the graph, the same way `2d8529414df2` and
`c443b498bcc7` did.

Revision ID: 24b7ca343591
Revises: 0034_trip_occupancy, 0036_branch_on_legacy_insert
Create Date: 2026-09-06

"""

from __future__ import annotations

revision: str = "24b7ca343591"
down_revision: tuple[str, str] = ("0034_trip_occupancy", "0036_branch_on_legacy_insert")
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
