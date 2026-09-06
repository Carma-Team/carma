"""backfill a branch for a legacy business insert (CAR-341 continuation)

0034_business_branches backfilled every `Business` row that existed when it
ran. It does nothing for a `Business` inserted afterwards by a still-running
*previous* server image: during a migrate-then-rollout deploy, or after a
rollback, that image's `business_join_requests.approve()` still creates a
`Business` row directly — it predates `business_branches` entirely, so it
never adds a matching branch. The new image's own `_default_branch` assumes
every business has at least one, and would fail on one created that way.

The fix mirrors 0035_branch_legacy_sync's shape: a DB trigger catches what
the old process cannot be made to do itself. This one has to run at
COMMIT, not immediately after the `INSERT` — the *new* image's own
`approve()` inserts `Business`, then explicitly adds its own `BusinessBranch`
row, both before its one commit; a trigger firing right after the `Business`
insert would run before that second insert lands and create a duplicate. A
deferred constraint trigger checks "does this business have a branch yet"
once at the end of the transaction instead, by which point the new image's
own explicit insert (if any) has already happened — so it only ever acts for
a transaction that truly adds none.

Revision ID: 0036_branch_on_legacy_insert
Revises: 0035_branch_legacy_sync
Create Date: 2026-09-06 00:00:00.000000
"""

from __future__ import annotations

from alembic import op

revision: str = "0036_branch_on_legacy_insert"
down_revision: str | None = "0035_branch_legacy_sync"
branch_labels: str | None = None
depends_on: str | None = None

CREATE_FUNCTION_SQL = """
    CREATE FUNCTION seed_branch_for_legacy_business_insert() RETURNS trigger AS $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM business_branches WHERE business_id = NEW.id) THEN
            INSERT INTO business_branches
                (id, business_id, name, address, location_lat, location_lng, is_active, created_at)
            VALUES
                (replace(gen_random_uuid()::text, '-', ''), NEW.id, NULL, NEW.address,
                 NEW.location_lat, NEW.location_lng, true, NEW.created_at);
        END IF;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
"""

CREATE_TRIGGER_SQL = """
    CREATE CONSTRAINT TRIGGER business_initial_branch_backfill
    AFTER INSERT ON businesses
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION seed_branch_for_legacy_business_insert();
"""


def upgrade() -> None:
    op.execute(CREATE_FUNCTION_SQL)
    op.execute(CREATE_TRIGGER_SQL)


def downgrade() -> None:
    op.execute("DROP TRIGGER business_initial_branch_backfill ON businesses")
    op.execute("DROP FUNCTION seed_branch_for_legacy_business_insert()")
