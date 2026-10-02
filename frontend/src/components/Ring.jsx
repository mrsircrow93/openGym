// A goal ring: the one shape the app uses for "how far along today" (steps, calories, water).
export default function Ring({ pct, size = 64, stroke = 7, color = 'var(--acc)', children, track = 'var(--surface-3)' }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, pct || 0))
  return <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} style={{ transition: 'stroke-dashoffset .4s var(--ease)' }} />
    </svg>
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{children}</div>
  </div>
}
