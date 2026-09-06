"""business location legacy-sync trigger (CAR-341 continuation)

0034_business_branches made `business_branches` the source of truth for
location and left `businesses.address/location_lat/location_lng` as a
compatibility mirror, kept in sync from the app side whenever
`services.business.update_branch` changes which branch is canonical.

That only covers writes made by the *new* code. During a migrate-then-
rollout deploy, or after a rollback, the *previous* server image can still
be handling live traffic — and that image's `update_profile` still writes
straight to `businesses.address/location_lat/location_lng`, never to
`business_branches`, because it predates this table entirely. Nothing in
that old process can be changed at this point; the only place left to catch
its write is the database itself.

This trigger is that catch: on any UPDATE of the three legacy columns, it
copies the new values onto the canonical branch (the same earliest-created-
active-branch resolution `services.business._default_branch` uses). It is a
one-way bridge for the old-image-writes direction only — the new-image-
writes direction stays app-level (`_sync_legacy_location_mirror`), so the
two mechanisms never chase each other: the trigger's own write lands on
`business_branches`, a table it has no trigger on, so it cannot re-fire
itself.

Revision ID: 0035_branch_legacy_sync
Revises: 0034_business_branches
Create Date: 2026-09-06 00:00:00.000000
"""

from __future__ import annotations

from alembic import op

revision: str = "0035_branch_legacy_sync"
down_revision: str | None = "0034_business_branches"
branch_labels: str | None = None
depends_on: str | None = None

CREATE_FUNCTION_SQL = """
    CREATE FUNCTION sync_legacy_business_location_to_branch() RETURNS trigger AS $$
    BEGIN
        UPDATE business_branches
        SET address = NEW.address,
            location_lat = NEW.location_lat,
            location_lng = NEW.location_lng
        WHERE id = (
            SELECT id FROM business_branches
            WHERE business_id = NEW.id AND is_active
            ORDER BY created_at ASC
            LIMIT 1
        );
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
"""

CREATE_TRIGGER_SQL = """
    CREATE TRIGGER business_location_legacy_sync
    AFTER UPDATE OF address, location_lat, location_lng ON businesses
    FOR EACH ROW
    WHEN (
        OLD.address IS DISTINCT FROM NEW.address
        OR OLD.location_lat IS DISTINCT FROM NEW.location_lat
        OR OLD.location_lng IS DISTINCT FROM NEW.location_lng
    )
    EXECUTE FUNCTION sync_legacy_business_location_to_branch();
"""


def upgrade() -> None:
    op.execute(CREATE_FUNCTION_SQL)
    op.execute(CREATE_TRIGGER_SQL)


def downgrade() -> None:
    op.execute("DROP TRIGGER business_location_legacy_sync ON businesses")
    op.execute("DROP FUNCTION sync_legacy_business_location_to_branch()")
