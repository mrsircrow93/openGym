# Progress photos — design, ready for a backend with storage

Goal: take a front / side / back photo every week or two, and see them side by side over time,
next to the body-weight curve. Images are big and private; the profile state (one JSON blob
synced whole) is the wrong place for them, so this feature needs object storage before it can
be built. Everything that does not need storage is laid out below so the remaining work is
mostly plumbing.

## What is in place

- **Metadata slot in the profile**: `S.progressPhotos: []` with rows
  `{ id, d, pose, w, note, remoteId, width, height, thumb }` — `thumb` is a ≤ 4 KB base64 so the
  timeline renders offline; `w` is the body weight that day (copied at capture time so the
  comparison view doesn't have to look it up).
- **Client contract**: `frontend/src/lib/progress-photos.js` — `uploadPhoto(file)`,
  `photoUrl(remoteId)`, `deletePhoto(remoteId)`, `makeThumb(file)`, `isConfigured()`. All reject
  with `NotConfigured` while the server answers `501`, so a UI can be built and shown as
  "coming soon" today.
- **Server stubs**: `POST /api/progress-photos/upload-url`, `GET /api/progress-photos?id=`,
  `DELETE /api/progress-photos?id=` return `501`.
- **Resize on device** (existing `fileToResizedBase64`): 1600 px long edge, JPEG 0.85 ≈ 250–400 KB
  per photo. Never upload originals.

## Storage

Any S3-compatible bucket (Cloudflare R2 is the cheap default: no egress fees, ~$0.015/GB-month).
At 350 KB × 3 poses × 4 per month ≈ 4 MB per user per month → a year of a Pro user is ~50 MB,
under $0.01/month. Storage is not a cost concern; **privacy is**.

- Bucket is private. The API signs short-lived URLs (15 min) for both PUT and GET.
- Object key: `photos/<uid>/<id>.jpg`. The uid is in the path so a bulk delete on account
  removal is one prefix listing.
- Never return a permanent URL; the client asks `GET /api/progress-photos?id=` each time it
  needs to display one (cache in memory for the session).

## Server work (small)

1. Env: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (R2 uses the S3 API).
2. `upload-url`: check session + `can('progressPhotos')`, generate id, presign PUT with the
   given `mediaType` and a size limit, return `{ id, url }`.
3. `GET`: check the id belongs to the caller (metadata is in their state file), presign GET.
4. `DELETE`: same ownership check, delete object.
5. Account deletion (`admin/user/disable` today) should also delete the prefix.
6. Feature flag: `PROGRESS_PHOTOS=1`; without it the routes keep returning `501`.

## Client UI (can be built now behind `isConfigured()`)

- **Stats → "Progress photos" card**: strip of thumbnails by date, pose filter chips
  (front / side / back), "Compare" button.
- **Capture sheet**: pose picker, camera input (`capture="user"` for a front selfie, otherwise
  `environment`), optional note; saves `thumb` + metadata immediately, uploads in the
  background, marks the row `pending` until `remoteId` arrives (retry on next boot if missing).
- **Compare view**: two photos side by side (earliest vs latest by default, or pick any two),
  body weight under each, a slider to swipe between them. Same pose only.
- **Privacy copy**: one line at first use — photos are private, stored encrypted at rest,
  deletable any time, never used for AI unless the user asks.

## AI on top (later, optional)

Same pattern as meal photos: send two photos of the same pose to the model and ask for a
short, kind, factual comparison ("visible change in shoulder width; midsection similar").
It must be opt-in per comparison, never automatic, and is a Pro feature (vision tokens).
