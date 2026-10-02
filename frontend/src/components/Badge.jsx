import Icon from './Icon.jsx'
// A shield-shaped badge. Tier colours: 1 bronze, 2 silver, 3 gold, 4 lime (the brand).
// Locked badges render in grey with the icon dimmed.
export default function Badge({ badge, size = 96, locked = false }) {
  const tier = locked ? 0 : badge.tier
  return <span className={'badge t' + tier} style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
    <span className="badge-in"><Icon name={badge.icon} /></span>
  </span>
}
