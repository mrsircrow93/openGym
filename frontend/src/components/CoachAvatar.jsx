// Flat illustrated avatars for the two coach personas (see lib/coach.js). Drawn inline so
// there's nothing to license or fetch; the face is deliberately simple and the same for both,
// only hair and top change. `size` is the rendered diameter in px.
export default function CoachAvatar({ gender = 'f', size = 44, className = '', style }) {
  const f = gender === 'f'
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={'coach-av ' + className} style={style} aria-hidden="true">
      <defs><clipPath id={'cav-' + gender}><circle cx="50" cy="50" r="50" /></clipPath></defs>
      <g clipPath={`url(#cav-${gender})`}>
        <circle cx="50" cy="50" r="50" fill={f ? '#f6d5c5' : '#cfe3f5'} />
        {/* long hair behind the head */}
        {f && <path d="M24 52 C22 28 78 28 76 52 L80 92 L20 92 Z" fill="#3a2416" />}
        {/* shoulders / top */}
        <path d="M16 100 C16 78 30 70 50 70 C70 70 84 78 84 100 Z" fill={f ? '#e0564f' : '#2f6df6'} />
        {/* tank straps show a bit of skin on the shoulders */}
        <path d="M30 100 C30 84 38 78 50 78 C62 78 70 84 70 100 Z" fill={f ? '#e0564f' : '#2f6df6'} />
        <circle cx="30" cy="88" r="7" fill="#e6b28c" />
        <circle cx="70" cy="88" r="7" fill="#e6b28c" />
        {/* neck + head */}
        <rect x="43" y="58" width="14" height="16" rx="5" fill="#d9a077" />
        <ellipse cx="50" cy="46" rx="18" ry="20" fill="#e6b28c" />
        {/* hair on top */}
        {f
          ? <path d="M31 46 C30 24 70 24 69 46 C64 36 56 34 50 33 C44 34 36 36 31 46 Z" fill="#3a2416" />
          : <path d="M32 40 C33 24 67 22 68 40 C64 33 58 30 50 30 C42 30 36 33 32 40 Z" fill="#2b2118" />}
        {/* face */}
        <circle cx="43" cy="47" r="2" fill="#2b2118" />
        <circle cx="57" cy="47" r="2" fill="#2b2118" />
        <path d="M44 55 Q50 60 56 55" stroke="#8a4a3a" strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* earrings for her, a bit of jaw shadow for him */}
        {f && <><circle cx="32" cy="52" r="1.8" fill="#f2c14e" /><circle cx="68" cy="52" r="1.8" fill="#f2c14e" /></>}
        {!f && <path d="M36 52 C38 62 62 62 64 52" fill="#d6a17a" opacity=".55" />}
      </g>
    </svg>
  )
}
