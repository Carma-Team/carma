import { request } from './client';
import type { FriendRequest } from '@/types';

export const friendsApi = {
  /** Incoming pending friend requests for the current user */
  getIncoming: () =>
    request<{ requests: FriendRequest[] }>('/api/friend-requests'),

  /** Accept an incoming friend request by its ID */
  accept: (requestId: string) =>
    request<{ status: string }>(`/api/friend-requests/${requestId}/accept`, { method: 'POST' }),

  /** Reject an incoming friend request by its ID */
  reject: (requestId: string) =>
    request<void>(`/api/friend-requests/${requestId}`, { method: 'DELETE' }),

  /** Cancel a pending request that the current user sent to targetUserId */
  cancel: (targetUserId: string) =>
    request<{ status: string }>(`/api/users/${targetUserId}/friend-request`, { method: 'DELETE' }),

  /** Remove an accepted friendship. Either side can re-add the other afterward. */
  remove: (userId: string) =>
    request<void>(`/api/friends/${userId}`, { method: 'DELETE' }),
};
