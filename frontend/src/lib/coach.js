// The coach personas. A person picks one once (Home card / Settings); it's stored in the
// synced state as S.coach so every device shows the same face and name. Names are chosen to
// read naturally in both Spanish and English.
export const COACHES = [
  { id: 'sofia', name: 'Sofía', gender: 'f' },
  { id: 'leo', name: 'Leo', gender: 'm' }
]
export const coachOf = S => COACHES.find(c => c.id === (S && S.coach)) || null
