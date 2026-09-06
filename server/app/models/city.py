from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class City(Base):
    """An Israeli settlement, keyed by its CBS code, with a name per language.

    Reference data, not user data: the rows come from the Central Bureau of
    Statistics settlements list and change a few times a year. `users.city_code`
    points here instead of holding a label, because a label can only ever be
    right in one language (CAR-218).

    `code` is the CBS settlement code rather than a surrogate id. It is already
    the national identifier for a settlement, it is stable across renames, and
    it means the seed is reproducible from the published dataset.
    """

    __tablename__ = "cities"

    code: Mapped[str] = mapped_column(String(10), primary_key=True)
    name_he: Mapped[str] = mapped_column(String(120), nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
