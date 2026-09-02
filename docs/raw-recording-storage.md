Current behaviour.

# Storage for labelled drive recordings

Staged calibration drives are recorded on the phone as NDJSON, uploaded to the
server, and kept as one gzipped object per drive with a row in `raw_recordings`
describing it. CAR-31 asks for the drives to be "somewhere the next person can
find it"; the objects are the data and the table is how they are found.

## The file

One JSON object per line. The first line is the session header, every later
line is a sample, and the upload route refuses anything else:

```
{"kind":"session_start","version":1,"sessionId":"session_1724608000000","startedAt":1724608000000,"scenario":"mounted","platform":"ios","deviceModel":"iPhone 14"}
{"t":1724608000100,"kind":"accel","accel":{"x":0.01,"y":-0.02,"z":0.98}}
{"t":1724608000100,"kind":"gyro","gyro":{"x":0,"y":0,"z":0.004}}
{"t":1724608000100,"kind":"mag","mag":{"x":21.4,"y":-8.1,"z":43.9}}
{"t":1724608002000,"kind":"location","location":{"lat":32.07,"lng":34.78,"speed":12.4,"accuracy":5}}
```

That is the format CAR-212 settled. Channels are raw only - accelerometer,
gyroscope and magnetometer at a requested 10 Hz, location every 2 s - with no
derived signals or fired events, so detection logic can be re-run offline
against drives already collected instead of re-driving when a threshold moves.
A scenario that changes mid-drive is a `marker` line rather than a new session.

A recording is roughly 1.6 MB for ten minutes, about 160 KB gzipped.

## Upload

`POST /api/dev/recordings`, multipart, one file. Admin accounts only: the
recorder is a debug-menu tool a regular build never exposes, but the route is
reachable in every environment and an authenticated stranger posting megabytes
is a storage bill with no owner.

The index is read out of the file's own header, never from separate form
fields - two sources for one fact drift, and the file outlives the table. A
file with no `session_start` header, or with a header and no samples, is
refused. Uploads are idempotent on `sessionId`, so a phone retrying one it
never saw succeed converges on a single row.

`GET /api/dev/recordings?scenario=&platform=` lists the set, newest first.

## Where the bytes go

`RECORDING_STORE` picks the store, the same way `SMS_PROVIDER` picks the sender.

- `local` writes under `RECORDING_LOCAL_DIR`. Development and the test suite.
- `azure` writes one blob per drive to `RECORDING_BLOB_CONTAINER` in the storage
  account named by `RECORDING_BLOB_CONNECTION_STRING`.

Objects are keyed `<scenario>/<sessionId>.ndjson.gz`. A production server on the
local store refuses the upload instead of accepting a file the next revision
would delete.

## Getting the drives back out

Pull them in bulk with Storage Explorer or `azcopy` and `gunzip` them. There is
deliberately no download endpoint: the consumer is an analysis run over the
whole set, not a client following a link, and a signed URL minted per row would
expire long before such a run finishes.
