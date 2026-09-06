"""users.city - drop the free-text column city_code replaced (CAR-314)

0027_city_reference built `cities` and `users.city_code`, backfilled from this
column, and deliberately left it standing. Dropping it there would have taken
it out from under the image still serving through deploy.yml's
migrate-then-rollout window, and that image mapped `city` as a column - so
every `select(User)`, which is every authenticated request, would have 500'd
until the new revision took traffic.

That image is no longer running. This is the contract half of the pair, and it
is safe precisely because it ships a release later than the cutover.

The downgrade rebuilds a label from cities.name_he rather than restoring what
was there - this migration is what destroys the original text, so a row that
stored an English label comes back Hebrew. It is the same best-effort restore
0027's downgrade used to carry.

Revision ID: 0033_drop_users_city
Revises: 0032_raw_recordings
Create Date: 2026-09-04 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0033_drop_users_city"
down_revision: str | None = "0032_raw_recordings"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.drop_column("users", "city")


def downgrade() -> None:
    op.add_column("users", sa.Column("city", sa.String(80), nullable=True))
    op.execute(sa.text("UPDATE users SET city = c.name_he FROM cities c WHERE users.city_code = c.code"))
