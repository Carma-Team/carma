"""put client-origin events.severity on the 1.0-3.0 axis (CAR-239)

The column held two populations on incompatible scales. A phone-detected brake
stored the SDK's own 0-1 number; a server-detected one stored the 1.0-3.0 value
`telemetry._severity` produces. The old `[0, 100]` clamp made both legal, so
nothing ever caught the mix.

CAR-144 fixed the ingestion path. This fixes the rows already written. Client
rows are the ones without the `source: server-gps` tag `_server_events` stamps,
and the raw client number is still in `sensor_data`, so severity is RECOMPUTED
from that raw value rather than transformed from what is stored. That is what
makes this idempotent: running it twice, or running it against rows the new code
already wrote correctly, produces the same answer both times.

The 1.0 floor is the point of the mapping, not a rounding artefact. Severity is
a multiplicative weight, so an event sitting exactly on the detection threshold
has to be worth one event, never zero.

Revision ID: 0018_severity_axis_backfill
Revises: 0017_redemption_points_cost
Create Date: 2026-08-22 00:00:00.000000
"""

from __future__ import annotations

from alembic import op

revision: str = "0018_severity_axis_backfill"
down_revision: str | None = "0017_redemption_points_cost"
branch_labels: str | None = None
depends_on: str | None = None


# Only a JSON number is trusted. JSON has no NaN or Infinity, so `jsonb_typeof`
# is the whole guard: a string, a null, or a missing key all land on the floor,
# which is what `_parse_event` does with junk it cannot parse.
_RAW_SEVERITY = """
    CASE WHEN jsonb_typeof(sensor_data->'severity') = 'number'
         THEN (sensor_data->>'severity')::float8
         ELSE 0.0
    END
"""

_CLIENT_ROWS = "sensor_data->>'source' IS DISTINCT FROM 'server-gps'"


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE events
        SET severity = 1.0 + 2.0 * least(greatest({_RAW_SEVERITY}, 0.0), 1.0)
        WHERE {_CLIENT_ROWS}
        """
    )


def downgrade() -> None:
    # The old path stored the raw number under a [0, 100] clamp, and the raw
    # number is still in sensor_data, so this reverses exactly. Rows that never
    # carried a severity went in at 1.0 under the old default and come back to
    # 1.0, not 0.0 — `raw.get("severity", 1.0)` was the old default.
    op.execute(
        f"""
        UPDATE events
        SET severity = CASE
                WHEN jsonb_typeof(sensor_data->'severity') = 'number'
                THEN least(greatest((sensor_data->>'severity')::float8, 0.0), 100.0)
                ELSE 1.0
            END
        WHERE {_CLIENT_ROWS}
        """
    )
