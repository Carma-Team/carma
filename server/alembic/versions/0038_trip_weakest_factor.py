"""trips.weakest_factor - persist the trip's worst behaviour (CAR-186)

CAR-185 computes the weakest factor at save time and returns it in the POST
/api/trips response, but never writes it down. Every later read - the history
list, the trip detail screen - answered NULL, so the "one thing to fix" line
appeared once and was gone the moment the driver reopened the same trip.

A native enum rather than a varchar: the set is the five subscores the v2 engine
computes, so it closes only when the formula gains a sixth factor, and that is a
change that should have to say so in a migration.

Nullable and staying that way. A trip scored before this landed was never asked,
and a trip whose worst subscore is above 90 has nothing worth naming - both show
no line, so neither needs its own value. No backfill: the value is a function of
per-subscore inputs that were never stored, so it cannot be recovered for old
trips, only recomputed by rescoring them.

Numbered 0038 with 0037 free: the unmerged `email-verification` branch already
carries a 0037 off this same head. Alembic sequences on `revision`, not on the
filename, so the gap costs nothing and the collision would have cost a rename.

Revision ID: 0038_trip_weakest_factor
Revises: 24b7ca343591
Create Date: 2026-09-07 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0038_trip_weakest_factor"
down_revision: str | None = "24b7ca343591"
branch_labels: str | None = None
depends_on: str | None = None

# Spelled out rather than imported from the model: a migration records what the
# schema was at this point in history, and importing would let a later edit to
# the model silently rewrite what this one did.
_weakest_factor = sa.Enum("braking", "acceleration", "cornering", "speeding", "distraction", name="weakest_factor")


def upgrade() -> None:
    _weakest_factor.create(op.get_bind(), checkfirst=True)
    op.add_column("trips", sa.Column("weakest_factor", _weakest_factor, nullable=True))


def downgrade() -> None:
    op.drop_column("trips", "weakest_factor")
    _weakest_factor.drop(op.get_bind(), checkfirst=True)
