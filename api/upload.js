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
const PDF_MAX = 3.3 * 1024 * 1024;
const PDF_MAX_PAGES = 30;

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

// Active-content markers. Matched on the raw bytes (PDF syntax is ASCII); object streams
// could hide them, but a nutrition or training plan has no business containing any of
// these, so a hit simply rejects the file.
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFiles?|OpenAction|AA|RichMedia|XFA|SubmitForm|ImportData)\b/;

export function inspectPdf(b64) {
  const buf = decode(b64, PDF_MAX);
  if (!buf) return { ok: false, error: 'PDF missing, malformed or too large (max 3 MB)' };
  if (buf.toString('latin1', 0, 5) !== '%PDF-') return { ok: false, error: 'not a PDF' };
  const text = buf.toString('latin1');
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
