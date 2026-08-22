"""cities + users.city_code - stop storing a city as a display label (CAR-218)

`users.city` was free text, and every consumer used the stored string as the
label. There is no per-language name, so a Hebrew city appeared in the English
build and the reverse. The column held both: the seed alone wrote "Tel Aviv" for
some drivers and "תל אביב" for others.

The reference list is the CBS settlements register, keyed by the CBS settlement
code. It ships as JSON beside this migration rather than inline so the file stays
readable, and it is frozen: later corrections belong in a later migration, or
this one stops being reproducible.

The English names needed work the raw resource cannot give. CBS caps that column
at 20 characters, so 15 names arrive cut mid-word, 4 rows have no English at all,
and the transliteration is academic rather than the form anyone reads - BENE
BERAQ, PETAH TIQWA. Those are corrected in the shipped file, keyed by Hebrew
name; keying by code silently renamed four different cities when it was tried.

The backfill matches on either language, because the column being replaced holds
both. A value matching neither becomes NULL and the label is gone - accepted
deliberately, since the alternative is keeping a column whose whole problem is
that nothing can render it.

Revision ID: 0018_city_reference
Revises: 0017_redemption_points_cost
Create Date: 2026-08-22 00:00:00.000000
"""

from __future__ import annotations

import json
import pathlib

import sqlalchemy as sa

from alembic import op

revision: str = "0018_city_reference"
down_revision: str | None = "0017_redemption_points_cost"
branch_labels: str | None = None
depends_on: str | None = None

_DATA = pathlib.Path(__file__).resolve().parent.parent / "data" / "israeli_settlements.json"


def upgrade() -> None:
    cities = op.create_table(
        "cities",
        sa.Column("code", sa.String(10), primary_key=True),
        sa.Column("name_he", sa.String(120), nullable=False),
        sa.Column("name_en", sa.String(120), nullable=False),
    )
    rows = json.loads(_DATA.read_text(encoding="utf-8"))
    op.bulk_insert(
        cities,
        [{"code": r["code"], "name_he": r["nameHe"], "name_en": r["nameEn"]} for r in rows],
    )

    op.add_column("users", sa.Column("city_code", sa.String(10), nullable=True))
    op.create_index("ix_users_city_code", "users", ["city_code"])
    op.create_foreign_key("fk_users_city_code", "users", "cities", ["city_code"], ["code"])

    # Hebrew first, then English over whatever is still unmatched. Two passes
    # rather than one OR so a name that exists in both languages resolves to the
    # Hebrew row, which is what the overwhelming majority of stored values are.
    for column in ("name_he", "name_en"):
        op.execute(
            sa.text(
                f"""
                UPDATE users SET city_code = c.code
                FROM cities c
                WHERE users.city_code IS NULL
                  AND users.city IS NOT NULL
                  AND btrim(users.city) <> ''
                  AND lower(btrim(users.city)) = lower(btrim(c.{column}))
                """  # noqa: S608 - column name is from the literal tuple above
            )
        )

    lost = (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM users WHERE city_code IS NULL AND btrim(coalesce(city, '')) <> ''"))
        .scalar_one()
    )
    if lost:
        print(f"CAR-218: {lost} user(s) had a city matching no CBS settlement; their label is dropped.")

    op.drop_column("users", "city")


def downgrade() -> None:
    op.add_column("users", sa.Column("city", sa.String(80), nullable=True))
    # Best effort: the Hebrew name is what most of these held, but a row that
    # stored an English label comes back Hebrew. The original text is not
    # recoverable - `upgrade` dropped it.
    op.execute(sa.text("UPDATE users SET city = c.name_he FROM cities c WHERE users.city_code = c.code"))
    op.drop_constraint("fk_users_city_code", "users", type_="foreignkey")
    op.drop_index("ix_users_city_code", table_name="users")
    op.drop_column("users", "city_code")
    op.drop_table("cities")
