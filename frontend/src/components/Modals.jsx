import { useEffect, useRef } from 'react'
import { useUI } from '../store/useUI.js'

// Every scrollable box between the touch target and the sheet is at its top (or there is none).
function innerAtTop(target, root) {
  let n = target
  while (n && n !== root) {
    if (n.nodeType === 1) {
      const oy = getComputedStyle(n).overflowY
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) return false
    }
    n = n.parentNode
  }
  return true
}

// One bottom sheet (or centered dialog) with swipe-to-dismiss.
function Sheet({ sheet }) {
  const { closeSheet } = useUI()
  const ref = useRef(null)
  // startY/startX: where the finger landed; axis: decided from the first ~8 px of movement —
  // 'y' pulls the sheet, 'x' belongs to a horizontal scroller (chips, badges, heatmap) and is
  // then ignored until the finger lifts, however much it drifts vertically afterwards.
  const drag = useRef({ startY: null, startX: 0, delta: 0, axis: null })
  const inHorizontalScroller = (target, root) => {
    let n = target
    while (n && n !== root) {
      if (n.nodeType === 1) {
        const ox = getComputedStyle(n).overflowX
        if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true
      }
      n = n.parentNode
    }
    return false
  }

  const onTouchStart = e => {
    const el = ref.current
    // a gesture that begins on a slider (or opted-out control) belongs to that control,
    // not to the sheet's swipe-to-dismiss — so it keeps working while you drag
    if (e.target.closest && e.target.closest('input[type=range], [data-nodrag]')) {
      drag.current = { startY: null, startX: 0, delta: 0, axis: null }
      return
    }
    // Only a drag that starts with every scroll area at its top may pull the sheet down. A
    // gesture inside a scrolled chat or list belongs to that list (the coach's long answers).
    const ok = el.scrollTop <= 0 && innerAtTop(e.target, el)
    drag.current = { startY: ok ? e.touches[0].clientY : null, startX: e.touches[0].clientX, delta: 0, axis: inHorizontalScroller(e.target, el) ? 'pending' : 'y' }
  }
  const onTouchMove = e => {
    const el = ref.current, d = drag.current
    if (d.startY === null || d.axis === 'x') return
    const dy = e.touches[0].clientY - d.startY, dx = e.touches[0].clientX - d.startX
    if (d.axis === 'pending') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return          // not enough movement to tell yet
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'            // chips row: sideways wins
      if (d.axis === 'x') return
    }
    d.delta = dy
    if (d.delta > 0 && el.scrollTop <= 0 && innerAtTop(e.target, el)) {
      e.preventDefault()
      el.style.transition = 'none'
      el.style.transform = `translateY(${d.delta}px)`
    } else d.delta = 0
  }
  const onTouchEnd = () => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    el.style.transition = 'transform .2s'
    if (d.axis === 'y' && d.delta > 90 && !sheet.locked) { el.style.transform = 'translateY(110%)'; setTimeout(() => closeSheet(sheet.id), 180) }
    else el.style.transform = ''
    d.startY = null; d.axis = null
  }

  // non-passive touchmove so preventDefault works (bottom sheets only; centered dialogs have no ref)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  const close = () => closeSheet(sheet.id)
  if (sheet.kind === 'center') {
    return (
      <div>
        <div className="mback" onClick={() => { if (!sheet.locked) close() }} />
        <div className="center">{sheet.render(close)}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="mback" onClick={() => { if (!sheet.locked) close() }} />
      <div className="sheet" ref={ref} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="grab" />
        {sheet.render(close)}
      </div>
    </div>
  )
}

export default function Modals() {
  const sheets = useUI(s => s.sheets)

  // lock the page behind any open sheet (iOS-safe)
  useEffect(() => {
    if (!sheets.length) return
    const y = window.scrollY || 0
    const b = document.body.style
    b.position = 'fixed'; b.top = -y + 'px'; b.left = '0'; b.right = '0'; b.width = '100%'
    return () => {
      b.position = b.top = b.left = b.right = b.width = ''
      window.scrollTo(0, y)
    }
  }, [sheets.length > 0])

  if (!sheets.length) return null
  return (
    <div id="modal-root" className="open">
      {sheets.map(s => <Sheet key={s.id} sheet={s} />)}
    </div>
  )
}
