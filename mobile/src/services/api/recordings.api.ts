/**
 * @fileoverview Staged calibration recording upload — debug builds only
 * @module services/api/recordings
 *
 * @description
 * The upload half of CAR-31's collection loop. A recording is an NDJSON file on the
 * phone; this posts it to the server, which reads the index out of the file's own
 * `session_start` header and stores one gzipped object per drive
 * (`docs/raw-recording-storage.md`).
 *
 * @server
 * - POST /api/dev/recordings — real server only. Admin accounts: a regular driver's
 *   token gets a 403, which is the intended answer, not a bug to work around here.
 */
import { request } from './client';

export interface RawRecordingOut {
  sessionId: string;
  scenario: string;
  platform: string;
  startedAt: string;
  sizeBytes: number;
}

/**
 * Uploads one recording. `fileUri` is a `file://` path from the SDK — React Native's
 * FormData takes it as-is and streams the file, so the bytes never pass through JS.
 *
 * Idempotent on the session id, so a retry after a response we never saw converges on
 * one row rather than a duplicate.
 */
export const recordingsApi = {
  upload: (fileUri: string) => {
    const body = new FormData();
    // The cast is React Native's file-shaped FormData value, which the DOM lib's
    // FormData type does not describe. The three fields are what RN's implementation
    // reads; anything else on the object is ignored.
    body.append('file', {
      uri: fileUri,
      name: fileUri.split('/').pop() || 'recording.ndjson',
      type: 'application/x-ndjson',
    } as unknown as Blob);
    return request<RawRecordingOut>('/api/dev/recordings', { method: 'POST', body });
  },
};
