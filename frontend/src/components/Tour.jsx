import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { TOUR_STEPS } from '../lib/tour.js'
import { nav } from '../lib/nav.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// A card over the real screen rather than a modal in front of a mockup: each step navigates to
// the tab it describes, so what is being explained is visible behind the words. The card sits at
// the bottom, clear of the content, and the backdrop is light enough to read through.
export default function Tour({ onClose }) {
  const [i, setI] = useState(0)
  const step = TOUR_STEPS[i]
  const last = i === TOUR_STEPS.length - 1
  useEffect(() => { if (step) nav(step.route) }, [i])
  if (!step) return null
  return (
    <div className="tour">
      <div className="tour-scrim" onClick={onClose} />
      <div className="tour-card">
        <div className="tour-head">
          <span className="tour-icon"><Icon name={step.icon} /></span>
          <b>{t(step.title)}</b>
          {/* Leaving has to be as easy as continuing, at every step, or it is not a choice. */}
          <button className="linkbtn tour-skip" onClick={onClose}>{t('Skip')}</button>
        </div>
        <div className="tour-body">{t(step.body)}</div>
        <div className="tour-foot">
          <div className="tour-dots">{TOUR_STEPS.map((_, n) => <i key={n} className={n === i ? 'on' : ''} />)}</div>
          <div className="row" style={{ gap: 8 }}>
            {i > 0 && <Button size="sm" onClick={() => setI(i - 1)}>{t('Back')}</Button>}
            <Button size="sm" variant="primary" onClick={() => (last ? onClose() : setI(i + 1))}>
              {last ? t('Got it') : t('Next')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Owns the "has this person seen it" decision so App stays a wiring file. Marking it done on the
// way out covers both endings — skipping and finishing — because showing someone the door twice
// after they said no is worse than never showing it. Guests see it too: it explains how to use
// the app, which is not something an account unlocks.
export function useTour(ready, authed) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [open, setOpen] = useState(false)
  const pending = ready && !!authed && !S.tourDone
  useEffect(() => { if (pending) setOpen(true) }, [pending])
  const close = () => { setOpen(false); update(s => { s.tourDone = true }) }
  return { open, close, start: () => setOpen(true) }
}
