// A progress photo by id. Fetches through the authenticated API and shows a quiet placeholder
// until the bytes arrive (or if they never do).
import { useEffect, useState } from 'react'
import { photoUrl } from '../lib/progress-photos.js'
import Icon from './Icon.jsx'

export default function Photo({ id, alt = '', className = '', style, onClick }) {
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { let on = true; setSrc(null); setFailed(false); photoUrl(id).then(u => on && setSrc(u)).catch(() => on && setFailed(true)); return () => { on = false } }, [id])
  if (!id || failed) return <div className={'photo ph-empty ' + className} style={style}><Icon name="camera" /></div>
  if (!src) return <div className={'photo ph-loading ' + className} style={style} />
  return <img className={'photo ' + className} style={style} src={src} alt={alt} onClick={onClick} />
}
