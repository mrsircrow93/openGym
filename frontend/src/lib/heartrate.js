// Live heart rate from a smartwatch / chest strap over Web Bluetooth.
//
// Uses the standard BLE Heart Rate Service (0x180D) — the profile that Garmin, Polar,
// Wahoo, Coros, Amazfit and cheap chest straps broadcast, and that an Apple Watch exposes
// while a companion app is broadcasting a workout. There is no web (or Capacitor WebView)
// API to *pair with* an Apple Watch the way its own apps do — that needs a native WatchOS
// target — so this reads the same open HR stream any BLE monitor puts out.
//
// Web Bluetooth is Chromium-only: it works in Android Chrome and desktop Chrome/Edge, and
// is absent in iOS Safari and inside the Capacitor WKWebView. Every entry point in the UI
// is therefore gated on hrSupported(), so it simply doesn't appear where it can't work.

export const hrSupported = () => typeof navigator !== 'undefined' && !!navigator.bluetooth

const HR_SERVICE = 'heart_rate'                 // 0x180D
const HR_MEASUREMENT = 'heart_rate_measurement' // 0x2A37

// Parse the Heart Rate Measurement characteristic per the BLE spec: a flags byte, then the
// BPM as an 8- or 16-bit value depending on bit 0 of the flags.
function parseHeartRate(dv) {
  const flags = dv.getUint8(0)
  return (flags & 0x1) ? dv.getUint16(1, /* littleEndian */ true) : dv.getUint8(1)
}

let device = null
let characteristic = null
let onValue = null

// Opens the browser device chooser (must be called from a user gesture), subscribes to the
// HR stream and calls onBpm(number) on every notification. onDisconnect() fires if the strap
// goes out of range or is turned off. Resolves with { name } once notifications are live.
export async function hrConnect(onBpm, onDisconnect) {
  const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [HR_SERVICE] }] })
  dev.addEventListener('gattserverdisconnected', () => {
    characteristic = null
    onDisconnect && onDisconnect()
  })
  const server = await dev.gatt.connect()
  const service = await server.getPrimaryService(HR_SERVICE)
  const ch = await service.getCharacteristic(HR_MEASUREMENT)
  onValue = e => { try { onBpm(parseHeartRate(e.target.value)) } catch { /* skip malformed frame */ } }
  ch.addEventListener('characteristicvaluechanged', onValue)
  await ch.startNotifications()
  device = dev
  characteristic = ch
  return { name: dev.name || 'Heart-rate monitor' }
}

export function hrDisconnect() {
  try { if (characteristic) { characteristic.removeEventListener('characteristicvaluechanged', onValue); characteristic.stopNotifications() } } catch { /* already gone */ }
  try { if (device && device.gatt && device.gatt.connected) device.gatt.disconnect() } catch { /* already gone */ }
  device = null
  characteristic = null
  onValue = null
}

export const hrConnected = () => !!(device && device.gatt && device.gatt.connected && characteristic)
