from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base schema that maps snake_case Python attrs to camelCase JSON keys.

    Accepts both forms on input (populate_by_name=True) and reads from ORM
    attributes (from_attributes=True). Routes use response_model_by_alias=True
    so the wire format is camelCase.
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )
