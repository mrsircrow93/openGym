// The coach personas. A person picks one once (Home card / Settings); it's stored in the
// synced state as S.coach so every device shows the same face and name. Names are chosen to
// read naturally in both Spanish and English.
// `desc` is shown where the choice is made; the voice itself lives in api/personas.js, because
// it is part of the prompt. Keep the two in step when either changes.
export const COACHES = [
  { id: 'sofia', name: 'Sofía', gender: 'f', desc: 'Close and methodical' },
  { id: 'leo', name: 'Leo', gender: 'm', desc: 'Direct and to the point' }
]
export const coachOf = S => COACHES.find(c => c.id === (S && S.coach)) || null
