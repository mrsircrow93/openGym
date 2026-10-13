// @vitest-environment jsdom
// The rest timer's alert has to survive the screen going off. It used to rely on a server Web
// Push that never reaches a Capacitor build, so on a phone in a pocket nothing ever buzzed and
// the set was missed. These tests pin the three moments that matter: starting a rest schedules
// the notification, changing its length moves it, and skipping cancels it.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const scheduleRestAlert = vi.fn()
const cancelRestAlert = vi.fn()
vi.mock('./mobile.js', () => ({
  MOBILE: true, API_BASE: '', getToken: () => null,
  scheduleRestAlert: (...a) => scheduleRestAlert(...a),
  cancelRestAlert: (...a) => cancelRestAlert(...a)
}))
vi.mock('./sound.js', () => ({ beep: () => {}, vibrate: () => {} }))
vi.mock('./api.js', () => ({ api: () => Promise.resolve({}) }))

const { useUI } = await import('../store/useUI.js')

describe('rest timer alert', () => {
  beforeEach(() => { useUI.getState().stopRest(); scheduleRestAlert.mockClear(); cancelRestAlert.mockClear() })

  it('schedules one alert for the moment the rest ends', () => {
    const before = Date.now()
    useUI.getState().startRest(90)
    expect(scheduleRestAlert).toHaveBeenCalledTimes(1)
    const at = scheduleRestAlert.mock.calls[0][0]
    expect(at).toBeGreaterThanOrEqual(before + 90_000)
    expect(at).toBeLessThan(before + 92_000)
    expect(at).toBe(useUI.getState().timer.endsAt)
  })

  it('moves the alert when time is added or taken off', () => {
    useUI.getState().startRest(90)
    const first = scheduleRestAlert.mock.calls[0][0]
    useUI.getState().addRest(15)
    expect(scheduleRestAlert).toHaveBeenCalledTimes(2)
    expect(scheduleRestAlert.mock.calls[1][0]).toBe(first + 15_000)
    useUI.getState().addRest(-15)
    expect(scheduleRestAlert.mock.calls[2][0]).toBe(first)
  })

  it('cancels the alert when the rest is skipped', () => {
    useUI.getState().startRest(90)
    useUI.getState().stopRest()
    expect(cancelRestAlert).toHaveBeenCalled()
    expect(useUI.getState().timer).toBe(null)
  })

  // Taking off more than is left means "ready now", which is a skip — it must not leave a
  // notification queued for a rest that is already over.
  it('treats removing more than is left as a skip, alert and all', () => {
    useUI.getState().startRest(20)
    cancelRestAlert.mockClear()
    useUI.getState().addRest(-30)
    expect(useUI.getState().timer).toBe(null)
    expect(cancelRestAlert).toHaveBeenCalled()
  })
})
