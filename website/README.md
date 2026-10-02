# vantixgym.app

Marketing site for VantixGym: plain HTML/CSS, no build step. Served by the same nginx as the
app (`web/nginx.conf`) for the hosts `vantixgym.app` and `www.vantixgym.app`; the app lives at
`app.vantixgym.app`. Screenshots in `img/` come from the demo build at phone width.

## Languages

`index.html` is Spanish (default, `hreflang="es"`), `en/index.html` is English. Both carry the
`lang` switch in the nav and `hreflang` links. Legal pages: `privacidad.html`, `terminos.html`
and their `en/` twins, generated from the app's `views/Legal.jsx` texts. Keep the two index files
in step when a section changes.

## Testimonials

Both index files have a `#testimonios` / `#testimonials` section marked `hidden` with three
placeholder cards. Never publish invented quotes: when real members agree to be quoted (first
name, city or goal, two or three sentences, written permission kept), replace the placeholders
and remove the `hidden` attribute.
