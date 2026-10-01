// VantixGym mark and wordmark. The mark is the V-arrow from the brand board (lime #D0FF52 on
// #121212); drawn inline with currentColor so it takes the accent and sits on any background.
// The thin inner line is cut out with a mask, which is what gives it the outlined look.
export function Mark({ size = 48, color = 'var(--acc)', style }) {
  return <svg viewBox="0 0 100 100" width={size} height={size} style={{ color, display: 'block', ...style }} aria-hidden="true">
    <defs><mask id="vx-m"><rect width="100" height="100" fill="#fff" />
      <g fill="none" stroke="#000" strokeWidth="3.4" strokeLinejoin="miter" strokeMiterlimit="8"><polyline points="13.1,32.3 42,90 82.6,16.1" /><polyline points="63.9,19.5 86,10 89.8,33.7" /></g></mask></defs>
    <g fill="none" stroke="currentColor" strokeWidth="12.5" strokeLinejoin="miter" strokeMiterlimit="8" mask="url(#vx-m)"><polyline points="10,26 42,90 86,10" /><polyline points="58.4,21.8 86,10 90.8,39.6" /></g>
  </svg>
}
// "Vantix" in the accent, "Gym" in grey, heavy and tight like the board.
export function Wordmark({ size = 34, style }) {
  return <span style={{ fontSize: size, fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1, whiteSpace: 'nowrap', ...style }}>
    <span style={{ color: 'var(--acc)' }}>Vantix</span><span style={{ color: 'var(--label-3)' }}>Gym</span>
  </span>
}
export default function Logo({ mark = 64, word = 34, gap = 10, style }) {
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap, ...style }}><Mark size={mark} /><Wordmark size={word} /></div>
}
