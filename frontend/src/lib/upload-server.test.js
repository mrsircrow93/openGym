// The server-side inspector lives in api/, but it is plain Node — test it alongside the client.
import { describe, it, expect } from 'vitest'
import { inspectImage, inspectPdf, inspectUpload } from '../../../api/upload.js'

const b64 = buf => Buffer.from(buf).toString('base64')
const jpeg = b64(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]))
const png = b64(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]))
const pdf = b64('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n%%EOF')

describe('inspectImage', () => {
  it('accepts real images and reports the type from the bytes, not the client', () => {
    expect(inspectImage(jpeg)).toMatchObject({ ok: true, mediaType: 'image/jpeg' })
    expect(inspectImage(png)).toMatchObject({ ok: true, mediaType: 'image/png' })
  })
  it('rejects anything that is not an image', () => {
    expect(inspectImage(b64('<html><script>x</script></html>' + 'x'.repeat(40))).ok).toBe(false)
    expect(inspectImage(b64(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]))).ok).toBe(false)
    expect(inspectImage(pdf).ok).toBe(false)
    expect(inspectImage('data:image/jpeg;base64,' + jpeg).ok).toBe(false)
    expect(inspectImage('not base64!!').ok).toBe(false)
    expect(inspectImage('').ok).toBe(false)
  })
  it('caps the size', () => {
    expect(inspectImage('A'.repeat(5_000_000)).ok).toBe(false)
  })
})

describe('inspectPdf', () => {
  it('accepts a plain PDF and counts pages', () => {
    expect(inspectPdf(pdf)).toMatchObject({ ok: true, mediaType: 'application/pdf', pages: 1 })
  })
  it('rejects PDFs with active content', () => {
    expect(inspectPdf(b64('%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj')).ok).toBe(false)
    expect(inspectPdf(b64('%PDF-1.4\n<< /Type /Filespec /EF << /F 5 0 R >> >> /EmbeddedFiles')).ok).toBe(false)
  })
  it('does not mistake binary image data inside streams for scripts', () => {
    const noise = Buffer.alloc(300_000)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919 + 13) % 256
    const body = Buffer.concat([Buffer.from('%PDF-1.5\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n3 0 obj << /Type /Page >> endobj\n4 0 obj << /Length 300000 >> stream\n'), noise, Buffer.from('/JS /AA /Launch\nendstream endobj\n%%EOF')])
    expect(inspectPdf(b64(body)).ok).toBe(true)
    // ...but a marker in a dictionary still trips it
    expect(inspectPdf(b64('%PDF-1.5\n1 0 obj << /Type /Catalog /AA << /O 5 0 R >> >> endobj')).ok).toBe(false)
  })
  it('rejects non-PDFs and renamed images', () => {
    expect(inspectPdf(jpeg).ok).toBe(false)
    expect(inspectPdf(b64('hello world this is text, not a pdf')).ok).toBe(false)
  })
  it('rejects very long documents', () => {
    const many = '%PDF-1.4\n' + '<< /Type /Page >>\n'.repeat(31)
    expect(inspectPdf(b64(many)).ok).toBe(false)
  })
})

describe('inspectUpload', () => {
  it('prefers the pdf when both are sent and ignores declared types', () => {
    expect(inspectUpload({ image: jpeg, pdf: pdf }).kind).toBe('pdf')
    expect(inspectUpload({ image: jpeg, pdf: '' }).kind).toBe('image')
    expect(inspectUpload({}).ok).toBe(false)
  })
})
