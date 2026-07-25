"""Friend requests, friendships and blocks.

Paths are spread across two nouns on purpose, matching how the client thinks:
`/api/users/{id}/…` for something you do TO a person, `/api/friend-requests/…`
for acting on a request that is already sitting in your inbox.
"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.core.deps import CurrentUser, DbSession
from app.schemas.friend import FriendRequestsOut, FriendStatusOut
from app.services import friends as svc

router = APIRouter(tags=["friends"])


# ── Sending ───────────────────────────────────────────────────────────────────


@router.post(
    "/api/users/{target_id}/friend-request",
    response_model=FriendStatusOut,
    response_model_by_alias=True,
    summary="Send a friend request. Answering an open request from that user accepts it.",
)
async def send_friend_request(target_id: str, user: CurrentUser, db: DbSession) -> FriendStatusOut:
    return await svc.send_request(db, user, target_id)


@router.delete(
    "/api/users/{target_id}/friend-request",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Withdraw the pending request between you and that user",
)
async def cancel_friend_request(target_id: str, user: CurrentUser, db: DbSession) -> Response:
    await svc.cancel_request(db, user, target_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Inbox ─────────────────────────────────────────────────────────────────────


@router.get(
    "/api/friend-requests",
    response_model=FriendRequestsOut,
    response_model_by_alias=True,
    summary="Friend requests awaiting the authenticated user's answer",
)
async def list_friend_requests(user: CurrentUser, db: DbSession) -> FriendRequestsOut:
    return await svc.incoming_requests(db, user)


@router.post(
    "/api/friend-requests/{request_id}/accept",
    response_model=FriendStatusOut,
    response_model_by_alias=True,
    summary="Accept an incoming friend request",
)
async def accept_friend_request(request_id: str, user: CurrentUser, db: DbSession) -> FriendStatusOut:
    return await svc.accept_request(db, user, request_id)


@router.delete(
    "/api/friend-requests/{request_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Reject an incoming friend request",
)
async def reject_friend_request(request_id: str, user: CurrentUser, db: DbSession) -> Response:
    await svc.reject_request(db, user, request_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Friendships ───────────────────────────────────────────────────────────────


@router.delete(
    "/api/friends/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Remove a friend. Either side can re-add the other afterwards.",
)
async def remove_friend(user_id: str, user: CurrentUser, db: DbSession) -> Response:
    await svc.remove_friend(db, user, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Blocks ────────────────────────────────────────────────────────────────────


@router.post(
    "/api/users/{target_id}/block",
    response_model=FriendStatusOut,
    response_model_by_alias=True,
    summary="Block a user. Drops any friendship or pending request between you.",
)
async def block_user(target_id: str, user: CurrentUser, db: DbSession) -> FriendStatusOut:
    return await svc.block_user(db, user, target_id)


@router.delete(
    "/api/users/{target_id}/block",
    response_model=FriendStatusOut,
    response_model_by_alias=True,
    summary="Unblock a previously blocked user",
)
async def unblock_user(target_id: str, user: CurrentUser, db: DbSession) -> FriendStatusOut:
    return await svc.unblock_user(db, user, target_id)
