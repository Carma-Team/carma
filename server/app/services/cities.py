from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import City
from app.schemas.city import CitiesOut, CityOut, CountryOut

# CARMA operates in Israel only, so this is a constant rather than a table. It
# used to be the bare string "ישראל" sent to the English build as well (CAR-218).
COUNTRY = CountryOut(name_he="ישראל", name_en="Israel")

# Labels people actually write that are not the CBS form. The register says
# "תל אביב - יפו" and "Tel Aviv-Yafo"; nobody types either. Keyed by the
# normalised label, checked after both exact passes fail. The migration embeds
# the same pairs for the backfill - keep the two lists identical.
LEGACY_ALIASES: dict[str, str] = {
    "תל אביב": "5000",
    "תל אביב יפו": "5000",
    "tel aviv": "5000",
    "פתח תקוה": "7900",  # canonical spells it פתח תקווה
    "קריית שמונה": "2800",  # CBS spells קרית without the second yod
    "קריית גת": "2630",
    "קריית ים": "9600",
    "קריית ביאליק": "9500",
    "קריית מוצקין": "8200",
    "קריית אונו": "2620",
}


async def all_cities(db: AsyncSession) -> CitiesOut:
    """The whole canonical list, for registration to pick from.

    Deliberately not filtered to cities that have drivers: a registering user
    lives where they live. `leaderboard.locations` is the filtered one.
    """
    rows = (await db.scalars(select(City).order_by(City.name_he))).all()
    return CitiesOut(country=COUNTRY, cities=[CityOut.from_orm_city(c) for c in rows])


def _normalise(value: str) -> str:
    return " ".join(value.split()).casefold()


async def resolve_code(db: AsyncSession, *, code: str | None, label: str | None) -> str | None:
    """Turn whatever the client sent into a CBS code, or None.

    `code` is what current clients send. `label` is the deprecated free-text
    field: builds shipped before the canonical list still send a bare city name,
    and 422ing them would break registration on an app already in the field. An
    unrecognised value resolves to None rather than raising, which is the same
    answer the column gave before this existed.
    """
    if code:
        hit = await db.scalar(select(City.code).where(City.code == code))
        if hit:
            return hit
        return None
    if not label or not label.strip():
        return None
    wanted = _normalise(label)
    # Matched in either language: the column this replaces held a mix of both.
    by_he: str | None = await db.scalar(select(City.code).where(func.lower(func.btrim(City.name_he)) == wanted))
    if by_he:
        return by_he
    by_en: str | None = await db.scalar(select(City.code).where(func.lower(func.btrim(City.name_en)) == wanted))
    if by_en:
        return by_en
    alias = LEGACY_ALIASES.get(wanted)
    if alias:
        exists: str | None = await db.scalar(select(City.code).where(City.code == alias))
        return exists
    return None
