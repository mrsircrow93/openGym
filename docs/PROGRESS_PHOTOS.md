# Progress photos — monthly check-in (shipped 2026-10-02)

A check-in is a front / side / back set taken the same day, once a month, plus that day's
weight. The next month's set is shown next to it and the coach writes a short note on what
changed. Everything below is what is actually in the code.

## Where things live

- **Images**: on the API host, `/data/photos/<uid>/<id>.jpg`, mode 600, JPEG ≤ 3 MB
  (the client resizes to 1200 px, ~150 KB). Same volume as the state files, so the nightly
  encrypted backup (`scripts/backup.sh`) already covers them. Removed with the account on purge.
- **Metadata**: `S.checkins` in the synced profile —
  `{ id, d, t, w, photos: { front, side, back }, review: { headline, summary, observations, tips, comparable, mood, at } | null }`.
- **Client**: `frontend/src/lib/progress-photos.js` (upload, authenticated object URLs,
  due-date logic, review facts), `sheets-checkin.jsx` (capture, compare, timeline, cards),
  `components/Photo.jsx`.

## Routes

- `POST /api/progress-photos` `{ image: base64 }` → `{ id }`. Signature-checked (api/upload.js),
  JPEG only, 30/day per user, 400 photos per account.
- `GET /api/progress-photos?id=` → the JPEG, owner only, `Cache-Control: private`.
- `DELETE /api/progress-photos?id=`.
- `POST /api/ai/progress-review` `{ current, previous, weightNow, weightBefore, unit, daysBetween,
  workoutsBetween, goal, sex, checkinNumber, lang }` → the note. Vision model; 6 reviews per
  30 days per user; counts against the AI budget like any other feature.

## Prompt guardrails

Same pose compared with same pose; only visible, plausible change; numbers only from the facts
(never body-fat or measurements from pixels); kind, adult tone; no shaming, no medical or
eating-disorder-adjacent advice; says plainly when sets are not comparable and how to shoot
next time. Verified: exercise illustrations sent as "photos" come back as *not comparable*
with shooting tips rather than invented progress.

## Moving to object storage later

Disk is fine for thousands of users (3 photos × 12 months × 150 KB ≈ 5 MB per user per year).
If the host ever needs to be stateless, swap the three file calls in `server.js`
(`photoFile` read/write/unlink) for an S3 client; the client contract does not change.
