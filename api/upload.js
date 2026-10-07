// Upload hygiene for the photo / PDF routes. Files reach the API as base64 inside JSON, are
// forwarded to the model once and are never written to disk or logged — but the client's
// declared type is still just a claim. Everything here decides from the bytes themselves:
//   - base64 must be well formed (no data: prefix, no stray characters)
//   - the first bytes must be a real JPEG / PNG / WebP / GIF / PDF signature; the media type
//     sent onward is the one the signature says, not the one the client said
//   - PDFs: capped size and page count, and no active content (JavaScript, launch actions,
//     embedded files) — the model reads text and pixels, nothing else should ride along
//   - a 1-pixel-per-byte sanity cap on decoded size so a 4 MB string cannot become 30 MB
// Returns { ok: true, kind, mediaType, data } or { ok: false, error } — never throws.

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const IMAGE_MAX = 3 * 1024 * 1024;   // decoded bytes; the client resizes to ~1500 px first
const PDF_MAX = 12.5 * 1024 * 1024;   // a coach's PDF full of photos runs 5-10 MB; cost is per page, not per byte
const PDF_MAX_PAGES = 30;
// Reference clips for a custom exercise: a few seconds of "this is how I do it", nothing more.
// Short and small on purpose — it keeps storage honest and leaves no room for a payload that
// happens to start with a valid header.
const VIDEO_MAX = 6 * 1024 * 1024;
const VIDEO_MAX_SECONDS = 8;

const SIGS = [
  { mediaType: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mediaType: 'image/png', test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  { mediaType: 'image/gif', test: b => b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a' },
  { mediaType: 'image/webp', test: b => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];

function decode(b64, max) {
  const s = String(b64 || '');
  if (!s || s.length > Math.ceil(max / 3) * 4 + 4) return null;
  if (!B64.test(s) || s.length % 4 !== 0) return null;
  const buf = Buffer.from(s, 'base64');
  if (!buf.length || buf.length > max) return null;
  return buf;
}

export function inspectImage(b64) {
  const buf = decode(b64, IMAGE_MAX);
  if (!buf) return { ok: false, error: 'image missing, malformed or too large' };
  if (buf.length < 16) return { ok: false, error: 'not an image' };
  const sig = SIGS.find(s => s.test(buf));
  if (!sig) return { ok: false, error: 'unsupported image — send a JPEG, PNG, WebP or GIF' };
  return { ok: true, kind: 'image', mediaType: sig.mediaType, data: b64 };
}

// Active-content markers. Matched on the object dictionaries only: the bytes between
// `stream` and `endstream` are compressed images and fonts, where "/JS" shows up by chance
// every few megabytes. Object streams could hide a marker from this check, but a nutrition
// or training plan has no business containing any of these, so a hit simply rejects the file.
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFiles?|OpenAction|AA|RichMedia|XFA|SubmitForm|ImportData)(?=[\s/<\[(>]|$)/;
const PDF_STREAM = /stream\r?\n[\s\S]*?endstream/g;

// ---- short reference clips (MP4 / QuickTime) -------------------------------------------
// An ISO base-media file is a flat list of boxes: [4-byte size][4-byte type][payload]. We walk
// that list at the top level, refuse any box type we do not expect, and read the duration out of
// moov/mvhd. Nothing is transcoded and nothing is executed; the file is accepted only if its own
// structure says it is a short video, and it is later served with a fixed content type and nosniff.
const FTYP_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'mmp4', 'M4V ', 'M4VP', 'qt  ', 'dash']);
const TOP_BOXES = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'meta', 'moof', 'mfra', 'sidx', 'styp', 'uuid']);

// Yields top-level boxes as { type, start, end }, or null when the layout is not sane.
function boxes(buf, from = 0, to = buf.length, depth = 0) {
  const out = [];
  let off = from;
  while (off + 8 <= to) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let head = 8;
    if (size === 1) {
      if (off + 16 > to) return null;
      const hi = buf.readUInt32BE(off + 8);
      if (hi > 0) return null;                       // > 4 GiB: not a reference clip
      size = buf.readUInt32BE(off + 12); head = 16;
      if (size < head) return null;
    } else if (size === 0) size = to - off;          // last box runs to the end
    if (size < head || off + size > to) return null;
    if (!/^[\x20-\x7e]{4}$/.test(type)) return null;
    out.push({ type, start: off + head, end: off + size });
    off += size;
    if (out.length > 64 || depth > 4) return null;
  }
  return off === to ? out : null;
}
function findBox(buf, list, type) { return (list || []).find(b => b.type === type) || null; }

// moov > mvhd carries the timescale and duration of the whole movie.
function movieSeconds(buf, moov) {
  const inner = boxes(buf, moov.start, moov.end, 1);
  const mvhd = findBox(buf, inner, 'mvhd');
  if (!mvhd || mvhd.end - mvhd.start < 20) return null;
  const version = buf[mvhd.start];
  let timescale, duration;
  if (version === 0) {
    timescale = buf.readUInt32BE(mvhd.start + 12);
    duration = buf.readUInt32BE(mvhd.start + 16);
  } else if (version === 1) {
    if (mvhd.end - mvhd.start < 32) return null;
    timescale = buf.readUInt32BE(mvhd.start + 20);
    const hi = buf.readUInt32BE(mvhd.start + 24), lo = buf.readUInt32BE(mvhd.start + 28);
    duration = hi * 4294967296 + lo;
  } else return null;
  if (!timescale || !Number.isFinite(duration)) return null;
  return duration / timescale;
}

export function inspectVideo(b64) {
  const buf = decode(b64, VIDEO_MAX);
  if (!buf) return { ok: false, error: 'clip missing, malformed or larger than 6 MB' };
  if (buf.length < 32) return { ok: false, error: 'not a video' };
  const list = boxes(buf);
  if (!list || !list.length) return { ok: false, error: 'this file is not a plain MP4 or MOV clip' };
  for (const b of list) if (!TOP_BOXES.has(b.type)) return { ok: false, error: 'this file is not a plain MP4 or MOV clip' };
  const ftyp = findBox(buf, list, 'ftyp');
  if (!ftyp || list[0].type !== 'ftyp') return { ok: false, error: 'this file is not a plain MP4 or MOV clip' };
  const brand = buf.toString('latin1', ftyp.start, ftyp.start + 4);
  if (!FTYP_BRANDS.has(brand)) return { ok: false, error: 'unsupported video — record it with your phone camera (MP4 or MOV)' };
  const moov = findBox(buf, list, 'moov');
  if (!moov || !findBox(buf, list, 'mdat')) return { ok: false, error: 'this video looks incomplete' };
  const seconds = movieSeconds(buf, moov);
  if (seconds === null) return { ok: false, error: 'could not read the length of this video' };
  if (seconds <= 0 || seconds > VIDEO_MAX_SECONDS) return { ok: false, error: `keep the clip under ${VIDEO_MAX_SECONDS} seconds — it is only a reference` };
  return { ok: true, kind: 'video', mediaType: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4', data: b64, seconds: Math.round(seconds * 10) / 10, bytes: buf.length };
}

export function inspectPdf(b64) {
  const buf = decode(b64, PDF_MAX);
  if (!buf) return { ok: false, error: 'PDF missing, malformed or too large (max 12 MB)' };
  if (buf.toString('latin1', 0, 5) !== '%PDF-') return { ok: false, error: 'not a PDF' };
  const text = buf.toString('latin1').replace(PDF_STREAM, ' stream endstream ');
  if (PDF_ACTIVE.test(text)) return { ok: false, error: 'this PDF contains scripts or attachments — export a plain copy and try again' };
  const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
  if (pages > PDF_MAX_PAGES) return { ok: false, error: 'PDF too long (max ' + PDF_MAX_PAGES + ' pages)' };
  return { ok: true, kind: 'pdf', mediaType: 'application/pdf', data: b64, pages };
}

// One call for routes that take either. The client's mediaType is ignored on purpose.
export function inspectUpload({ image, pdf }) {
  if (pdf) return inspectPdf(pdf);
  if (image) return inspectImage(image);
  return { ok: false, error: 'photo or PDF required' };
}
