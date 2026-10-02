import { useEffect, useRef } from 'react'
// A short confetti burst on a full-screen canvas: brand lime, gold, white. Pointer-events off,
// removes itself when the last piece falls out. Honours prefers-reduced-motion.
export default function Confetti({ duration = 2600 }) {
  const ref = useRef(null)
  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const c = ref.current, ctx = c.getContext('2d')
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = c.width = innerWidth * dpr, H = c.height = innerHeight * dpr
    const colors = ['#d0ff52', '#ffd866', '#ffffff', '#b4e63a', '#e6e9ec']
    const N = 140
    const ps = Array.from({ length: N }, (_, i) => ({
      x: W / 2 + (Math.random() - .5) * W * .3, y: H * .45,
      vx: (Math.random() - .5) * 18 * dpr, vy: (-14 - Math.random() * 10) * dpr,
      w: (6 + Math.random() * 6) * dpr, h: (8 + Math.random() * 8) * dpr,
      r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3, c: colors[i % colors.length], shape: i % 3
    }))
    const g = .55 * dpr, start = performance.now()
    let raf
    const tick = now => {
      const t = now - start
      ctx.clearRect(0, 0, W, H)
      for (const p of ps) {
        p.vy += g; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c
        ctx.globalAlpha = Math.max(0, Math.min(1, 1.6 - t / duration))
        if (p.shape === 0) ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        else if (p.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill() }
        else { ctx.beginPath(); ctx.moveTo(0, -p.h / 2); ctx.lineTo(p.w / 2, p.h / 2); ctx.lineTo(-p.w / 2, p.h / 2); ctx.closePath(); ctx.fill() }
        ctx.restore()
      }
      if (t < duration) raf = requestAnimationFrame(tick); else ctx.clearRect(0, 0, W, H)
    }
    raf = requestAnimationFrame(tick)
    try { navigator.vibrate && navigator.vibrate([30, 40, 60]) } catch { /* no haptics */ }
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="confetti" aria-hidden="true" />
}
