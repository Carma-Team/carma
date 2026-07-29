/**
 * @fileoverview Friend requests, friendships and blocks
 * @module services/api/friends
 *
 * @server
 * - POST   /api/users/:id/friend-request  — send (accepts an open request from them)
 * - DELETE /api/users/:id/friend-request  — withdraw the pending request
 * - GET    /api/friend-requests           — incoming inbox
 * - POST   /api/friend-requests/:id/accept
 * - DELETE /api/friend-requests/:id       — reject
 * - DELETE /api/friends/:id               — unfriend
 * - POST | DELETE /api/users/:id/block
 */
import { request } from './client';
import type { FollowStatus, FriendRequest } from '@/types';

export const friendsApi = {
  /** Send a friend request. Answering one they already sent accepts it. */
  send: (targetUserId: string) =>
    request<{ status: FollowStatus }>(`/api/users/${targetUserId}/friend-request`, { method: 'POST' }),

  /** Incoming pending friend requests for the current user */
  getIncoming: () =>
    request<{ requests: FriendRequest[] }>('/api/friend-requests'),

  /** Accept an incoming friend request by its ID */
  accept: (requestId: string) =>
    request<{ status: FollowStatus }>(`/api/friend-requests/${requestId}/accept`, { method: 'POST' }),

  /** Reject an incoming friend request by its ID */
  reject: (requestId: string) =>
    request<void>(`/api/friend-requests/${requestId}`, { method: 'DELETE' }),

  /** Withdraw the pending request between the current user and targetUserId */
  cancel: (targetUserId: string) =>
    request<void>(`/api/users/${targetUserId}/friend-request`, { method: 'DELETE' }),

  /** Remove an accepted friendship. Either side can re-add the other afterward. */
  remove: (userId: string) =>
    request<void>(`/api/friends/${userId}`, { method: 'DELETE' }),

  /** Block a user — drops any friendship or pending request between you */
  block: (userId: string) =>
    request<{ status: FollowStatus }>(`/api/users/${userId}/block`, { method: 'POST' }),

  /** Unblock a previously blocked user */
  unblock: (userId: string) =>
    request<{ status: FollowStatus }>(`/api/users/${userId}/block`, { method: 'DELETE' }),
};
