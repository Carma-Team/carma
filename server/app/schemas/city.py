from __future__ import annotations

from typing import Any

from app.schemas._base import CamelModel


class CityOut(CamelModel):
    """A settlement, carrying every label rather than one chosen for the caller.

    Both names ship on every response on purpose. There is no language
    negotiation anywhere in this server, and the convention the rest of the API
    already follows is to send both and let the client pick (`title`/`title_he`
    on rewards, `name`/`name_he` on businesses). It also keeps the city list a
    single cacheable document: choosing server-side would need `Vary:
    Accept-Language` and one cache entry per language for data that is identical
    apart from which field the client reads.
    """

    code: str
    name_he: str
    name_en: str

    @classmethod
    def from_orm_city(cls, city: Any) -> CityOut:
        return cls.model_validate({"code": city.code, "name_he": city.name_he, "name_en": city.name_en})


class CountryOut(CamelModel):
    """CARMA operates in one country, so this is a constant, not a table.

    It is shaped like CityOut and not a bare string for the same reason the
    cities are: `COUNTRY = "ישראל"` used to be sent to the English build too.
    """

    name_he: str
    name_en: str


class CitiesOut(CamelModel):
    country: CountryOut
    cities: list[CityOut]
