// Swipe-to-reveal actions on a list row (iOS Mail style). Drag left to expose the action
// buttons; tap anywhere else to close. Pointer events so it works with mouse and touch alike.
// Only one row stays open at a time — opening one closes the others through a tiny bus.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

const openRows = new Set()
const closeOthers = me => { openRows.forEach(fn => { if (fn !== me) fn() }) }

export default function SwipeRow({ actions = [], children, className = '' }) {
  const [dx, setDxState] = useState(0)     // current translate (≤ 0)
  const dxRef = useRef(0)                  // same value, readable inside handlers without a stale closure
  const setDx = v => { dxRef.current = v; setDxState(v) }
  const [drag, setDrag] = useState(false)
  const start = useRef(null)               // { x, y, dx0, axis: null | 'x' | 'y' }
  const width = actions.length * 72
  const closeMe = useRef(() => setDx(0))

  useEffect(() => {
    const fn = closeMe.current
    openRows.add(fn)
    return () => openRows.delete(fn)
  }, [])

  const onDown = e => {
    if (e.target.closest('.swipe-actions')) return
    start.current = { x: e.clientX, y: e.clientY, dx0: dx, axis: null }
    setDrag(true)
  }
  const onMove = e => {
    const s = start.current
    if (!s) return
    const mx = e.clientX - s.x, my = e.clientY - s.y
    if (!s.axis) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return
      s.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
      if (s.axis === 'x') { closeOthers(closeMe.current); try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic / already released */ } }
    }
    if (s.axis !== 'x') return
    setDx(Math.max(-width - 20, Math.min(0, s.dx0 + mx)))
  }
  const onUp = e => {
    const s = start.current
    start.current = null
    setDrag(false)
    const cur = dxRef.current
    if (!s || s.axis !== 'x') { if (cur !== 0 && s && !s.axis) setDx(0); return }
    setDx(cur < -width / 2 ? -width : 0)
    e.preventDefault?.()
  }
  // A tap on the content while open just closes it — it shouldn't also open the row.
  const onClickCapture = e => {
    if (dxRef.current !== 0 && !e.target.closest('.swipe-actions')) { e.stopPropagation(); e.preventDefault(); setDx(0) }
  }

  return <div className={'swipe ' + (dx !== 0 ? 'open ' : '') + className} onClickCapture={onClickCapture}>
    <div className="swipe-actions" style={{ width }}>
      {actions.map(a => <button key={a.label} className={'swipe-act ' + (a.danger ? 'danger' : '')} onClick={() => { setDx(0); a.onClick() }} aria-label={a.label}>
        <Icon name={a.icon} /><span>{a.label}</span>
      </button>)}
    </div>
    <div className={'swipe-body' + (drag ? ' dragging' : '')} style={{ transform: `translateX(${dx}px)` }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {children}
    </div>
  </div>
}
