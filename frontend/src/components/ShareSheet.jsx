import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { renderShareCard, shareImage } from '../lib/share-card.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// Share a workout as a story image. Three looks: your photo, VantixGym background, or a
// transparent sticker to lay over your own video in Instagram / WhatsApp stories.
export default function ShareSheet({ workout, prs = [], close }) {
  const unit = useStore(s => s.S.unit)
  const toast = useUI(s => s.toast)
  const [style, setStyle] = useState('brand')
  const [size, setSize] = useState('lg')
  const [pos, setPos] = useState('center')
  const [align, setAlign] = useState('center')
  const [photo, setPhoto] = useState(null)
  const [url, setUrl] = useState('')
  const [blob, setBlob] = useState(null)
  const [busy, setBusy] = useState(false)
  const input = useRef(null)
  useEffect(() => {
    let alive = true
    setBusy(true)
    renderShareCard({ workout, unit, style, photo, prs, size, pos, align }).then(b => { if (!alive) return; setBlob(b); setUrl(u => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(b) }); setBusy(false) }).catch(() => setBusy(false))
    return () => { alive = false }
  }, [style, photo, size, pos, align])
  const pick = e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setPhoto(f); setStyle('photo') } }
  const share = async () => {
    if (!blob) return
    try { const r = await shareImage(blob, 'vantixgym-' + workout.d + '.png'); if (r === 'downloaded') toast(t('Image saved')) ; close() }
    catch (e) { if (e.name !== 'AbortError') toast(e.message || t('Something went wrong — try again')) }
  }
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="upload" style={{ color: 'var(--acc)' }} />{t('Share your workout')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('A story-sized image with your numbers. Post it, send it, or save it.')}</div>
    <input ref={input} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
    <div className="share-styles">
      <button className={'chip nocap' + (style === 'brand' ? ' on' : '')} onClick={() => setStyle('brand')}>{t('VantixGym look')}</button>
      <button className={'chip nocap' + (style === 'photo' ? ' on' : '')} onClick={() => (photo ? setStyle('photo') : input.current?.click())}><Icon name="camera" /> {photo ? t('My photo') : t('Add my photo')}</button>
      <button className={'chip nocap' + (style === 'transparent' ? ' on' : '')} onClick={() => setStyle('transparent')}>{t('Transparent sticker')}</button>
    </div>
    <div className={'share-preview' + (style === 'transparent' ? ' checker' : '')}>
      {url && <img src={url} alt="" width="1080" height="1920" />}
      {busy && <div className="share-busy"><span className="spin" /></div>}
    </div>
    {style === 'photo' && photo && <button className="linkbtn small" style={{ display: 'block', margin: '6px auto 0' }} onClick={() => input.current?.click()}>{t('Change photo')}</button>}
    <div className="share-ctl">
      <span className="small dim">{t('Size')}</span>
      <div className="row" style={{ gap: 6 }}>{[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']].map(([v, l]) => <button key={v} className={'chip nocap' + (size === v ? ' on' : '')} onClick={() => setSize(v)}>{t(l)}</button>)}</div>
      <span className="small dim">{t('Position')}</span>
      <div className="row" style={{ gap: 6 }}>{[['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom']].map(([v, l]) => <button key={v} className={'chip nocap' + (pos === v ? ' on' : '')} onClick={() => setPos(v)}>{t(l)}</button>)}</div>
      <span className="small dim">{t('Side')}</span>
      <div className="row" style={{ gap: 6 }}>{[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([v, l]) => <button key={v} className={'chip nocap' + (align === v ? ' on' : '')} onClick={() => setAlign(v)}>{t(l)}</button>)}</div>
    </div>
    <div className="row" style={{ gap: 8, marginTop: 12 }}>
      <Button variant="primary" icon="upload" style={{ flex: 1 }} disabled={busy || !blob} onClick={share}>{t('Share')}</Button>
      <Button style={{ flex: 1 }} onClick={close}>{t('Close')}</Button>
    </div>
  </>
}
