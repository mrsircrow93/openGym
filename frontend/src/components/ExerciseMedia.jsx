// Shows the reference photo or clip of a custom exercise. Video plays muted, inline and on a
// loop, so a three-second clip reads like an animated GIF next to the catalogue's animations.
import { useEffect, useState } from 'react'
import { mediaUrl, mediaKind } from '../lib/exercise-media.js'

export default function ExerciseMedia({ id, className = '', style }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setUrl(null); setFailed(false)
    if (id) mediaUrl(id).then(u => { if (alive) setUrl(u) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [id])
  if (!id || failed) return null
  const common = { className: 'exmedia ' + className, style }
  if (!url) return <div {...common} aria-hidden="true" />
  return mediaKind(id) === 'video'
    ? <video {...common} src={url} muted loop autoPlay playsInline disablePictureInPicture controlsList="nodownload" />
    : <img {...common} src={url} alt="" />
}
