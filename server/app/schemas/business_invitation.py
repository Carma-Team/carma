from __future__ import annotations

from datetime import datetime
from typing import Literal

from app.schemas._base import CamelModel

# Only these two — an OWNER never needs an invitation, and CAR-76 explicitly
# forbids one carrying a role higher than its issuer holds. Creation is
# OWNER-only, so the ceiling that matters is "never OWNER", enforced here
# rather than trusted to the caller.
InvitationRole = Literal["manager", "cashier"]


class BusinessInvitationIn(CamelModel):
    role: InvitationRole


class BusinessInvitationOut(CamelModel):
    """Returned once, at creation — the only time the plaintext token exists
    outside the caller's own memory. Nothing later re-derives or re-displays it."""

    id: str
    role: InvitationRole
    token: str
    url: str
    expires_at: datetime


class BusinessInvitationPreviewOut(CamelModel):
    """What a recipient sees before deciding to accept — enough to identify the
    business and the role on offer, nothing that assumes they already belong to it."""

    business_id: str
    business_name: str
    role: InvitationRole
    expires_at: datetime


class BusinessInvitationAcceptOut(CamelModel):
    business_id: str
    role: InvitationRole


class BusinessInvitationListItem(CamelModel):
    """A pending invitation as the OWNER's list sees it (CAR-118) — never the
    token or the URL. Both were returned once, at creation, and are not
    re-derivable from `token_hash`; a list endpoint that could show them again
    would be a second way to read a credential that is supposed to exist only
    in whatever channel the OWNER already sent it through."""

    id: str
    role: InvitationRole
    created_at: datetime
    expires_at: datetime


class BusinessInvitationCreateResponse(CamelModel):
    invitation: BusinessInvitationOut


class BusinessInvitationListResponse(CamelModel):
    invitations: list[BusinessInvitationListItem]


class BusinessInvitationPreviewResponse(CamelModel):
    invitation: BusinessInvitationPreviewOut


class BusinessInvitationAcceptResponse(CamelModel):
    membership: BusinessInvitationAcceptOut
