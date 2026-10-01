// Transactional email (docs/ACCOUNTS.md §4). Resend over plain fetch when RESEND_API_KEY is
// set; otherwise the message (and its link) goes to stdout so local development still works.
// Templates are plain text + minimal HTML, in the user's language (es default for this app).
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'openGym <onboarding@resend.dev>';
const APP_NAME = process.env.RP_NAME || 'openGym';

export async function sendEmail({ to, subject, text, html }) {
  if (!RESEND_API_KEY) {
    console.log(`[email → ${to}] ${subject}\n${text}\n`);
    return { ok: true, logged: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + RESEND_API_KEY },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text, html: html || `<pre style="font:15px/1.5 -apple-system,system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>` })
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.error('email send failed', r.status, body.slice(0, 300));
    return { ok: false };
  }
  return { ok: true };
}
export const emailConfigured = () => !!RESEND_API_KEY;

const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const button = (href, label) => `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#c8f04a;color:#0d1a08;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px;font:700 16px -apple-system,system-ui,sans-serif">${label}</a></p>`;
const wrap = (title, bodyHtml) => `<div style="max-width:520px;margin:0 auto;padding:28px 20px;font:15px/1.55 -apple-system,system-ui,sans-serif;color:#1c1c1e"><h2 style="margin:0 0 14px;font-size:22px">${title}</h2>${bodyHtml}<p style="color:#8e8e93;font-size:13px;margin-top:28px">${APP_NAME}</p></div>`;

const T = {
  es: {
    verify: (name, url) => ({
      subject: `Confirma tu correo · ${APP_NAME}`,
      text: `Hola ${name},\n\nConfirma tu correo para activar tu cuenta de ${APP_NAME}:\n${url}\n\nEl enlace vale 24 horas. Si no creaste esta cuenta, ignora este mensaje.`,
      html: wrap('Confirma tu correo', `<p>Hola ${escapeHtml(name)},</p><p>Toca el botón para confirmar tu correo y activar tu cuenta.</p>${button(url, 'Confirmar correo')}<p style="color:#8e8e93;font-size:13px">El enlace vale 24 horas. Si no creaste esta cuenta, ignora este mensaje.</p>`)
    }),
    reset: (name, url) => ({
      subject: `Restablece tu contraseña · ${APP_NAME}`,
      text: `Hola ${name},\n\nPara elegir una contraseña nueva entra aquí:\n${url}\n\nEl enlace vale 1 hora. Si no fuiste tú, ignora este correo: tu contraseña no cambia.`,
      html: wrap('Restablece tu contraseña', `<p>Hola ${escapeHtml(name)},</p><p>Toca el botón para elegir una contraseña nueva.</p>${button(url, 'Nueva contraseña')}<p style="color:#8e8e93;font-size:13px">El enlace vale 1 hora. Si no fuiste tú, ignora este correo: tu contraseña no cambia.</p>`)
    }),
    passwordChanged: (name) => ({
      subject: `Tu contraseña cambió · ${APP_NAME}`,
      text: `Hola ${name},\n\nLa contraseña de tu cuenta acaba de cambiar y se cerraron las sesiones en los demás dispositivos.\n\nSi no fuiste tú, restablece tu contraseña ahora mismo desde la pantalla de inicio de sesión.`,
    }),
    emailChanged: (name, newEmail) => ({
      subject: `Tu correo cambió · ${APP_NAME}`,
      text: `Hola ${name},\n\nEl correo de tu cuenta se cambió a ${newEmail}.\n\nSi no fuiste tú, restablece tu contraseña ahora mismo desde la pantalla de inicio de sesión.`,
    }),
    deleted: (name) => ({
      subject: `Tu cuenta se eliminará en 30 días · ${APP_NAME}`,
      text: `Hola ${name},\n\nTu cuenta quedó marcada para eliminarse. Tus datos se borran definitivamente en 30 días.\n\n¿Cambiaste de opinión? Vuelve a iniciar sesión antes de esa fecha y todo sigue donde estaba.`,
    }),
    referralReward: (name, friend, days, url) => ({
      subject: `${friend} se suscribió: tienes ${days} días de regalo · ${APP_NAME}`,
      text: `Hola ${name},\n\n${friend} entró a ${APP_NAME} con tu código y acaba de suscribirse. Como agradecimiento, añadimos ${days} días a tu acceso.\n\nSigue compartiendo tu código desde Ajustes → Invita y gana:\n${url}`,
      html: wrap('¡Tienes días de regalo!', `<p>Hola ${escapeHtml(name)},</p><p><b>${escapeHtml(friend)}</b> entró con tu código y acaba de suscribirse. Añadimos <b>${days} días</b> a tu acceso.</p>${button(url, 'Ver mi código')}`)
    }),
    trialEnding: (name, days, url) => ({
      subject: days <= 1 ? `Tu prueba termina mañana · ${APP_NAME}` : `Tu prueba termina en ${days} días · ${APP_NAME}`,
      text: `Hola ${name},\n\nTu prueba gratis de ${APP_NAME} termina en ${days} día${days === 1 ? '' : 's'}. Para seguir con tu coach, tus planes y tu progreso, elige un plan aquí:\n${url}\n\nSi no continúas, tus datos se conservan y puedes volver cuando quieras.`,
      html: wrap('Tu prueba está por terminar', `<p>Hola ${escapeHtml(name)},</p><p>Tu prueba gratis termina en <b>${days} día${days === 1 ? '' : 's'}</b>. Para seguir con tu coach, tus planes y tu progreso, elige un plan.</p>${button(url, 'Ver planes')}<p style="color:#8e8e93;font-size:13px">Si no continúas, tus datos se conservan y puedes volver cuando quieras.</p>`)
    })
  },
  en: {
    verify: (name, url) => ({
      subject: `Confirm your email · ${APP_NAME}`,
      text: `Hi ${name},\n\nConfirm your email to activate your ${APP_NAME} account:\n${url}\n\nThe link is valid for 24 hours. If you didn't create this account, ignore this message.`,
      html: wrap('Confirm your email', `<p>Hi ${escapeHtml(name)},</p><p>Tap the button to confirm your email and activate your account.</p>${button(url, 'Confirm email')}<p style="color:#8e8e93;font-size:13px">The link is valid for 24 hours. If you didn't create this account, ignore this message.</p>`)
    }),
    reset: (name, url) => ({
      subject: `Reset your password · ${APP_NAME}`,
      text: `Hi ${name},\n\nChoose a new password here:\n${url}\n\nThe link is valid for 1 hour. If this wasn't you, ignore this email: your password stays the same.`,
      html: wrap('Reset your password', `<p>Hi ${escapeHtml(name)},</p><p>Tap the button to choose a new password.</p>${button(url, 'New password')}<p style="color:#8e8e93;font-size:13px">The link is valid for 1 hour. If this wasn't you, ignore this email: your password stays the same.</p>`)
    }),
    passwordChanged: (name) => ({ subject: `Your password changed · ${APP_NAME}`, text: `Hi ${name},\n\nYour account password just changed and sessions on other devices were signed out.\n\nIf this wasn't you, reset your password right away from the sign-in screen.` }),
    emailChanged: (name, newEmail) => ({ subject: `Your email changed · ${APP_NAME}`, text: `Hi ${name},\n\nThe email on your account was changed to ${newEmail}.\n\nIf this wasn't you, reset your password right away from the sign-in screen.` }),
    deleted: (name) => ({ subject: `Your account will be deleted in 30 days · ${APP_NAME}`, text: `Hi ${name},\n\nYour account is marked for deletion. Your data is permanently erased in 30 days.\n\nChanged your mind? Sign in again before then and everything is where you left it.` }),
    referralReward: (name, friend, days, url) => ({
      subject: `${friend} subscribed: ${days} days on us · ${APP_NAME}`,
      text: `Hi ${name},\n\n${friend} joined ${APP_NAME} with your code and just subscribed. As a thank-you we added ${days} days to your access.\n\nKeep sharing your code from Settings → Invite & earn:\n${url}`,
      html: wrap('Days on us!', `<p>Hi ${escapeHtml(name)},</p><p><b>${escapeHtml(friend)}</b> joined with your code and just subscribed. We added <b>${days} days</b> to your access.</p>${button(url, 'See my code')}`)
    }),
    trialEnding: (name, days, url) => ({
      subject: days <= 1 ? `Your trial ends tomorrow · ${APP_NAME}` : `Your trial ends in ${days} days · ${APP_NAME}`,
      text: `Hi ${name},\n\nYour free ${APP_NAME} trial ends in ${days} day${days === 1 ? '' : 's'}. To keep your coach, plans and progress, pick a plan here:\n${url}\n\nIf you don't continue, your data is kept and you can come back any time.`,
      html: wrap('Your trial is about to end', `<p>Hi ${escapeHtml(name)},</p><p>Your free trial ends in <b>${days} day${days === 1 ? '' : 's'}</b>. To keep your coach, plans and progress, pick a plan.</p>${button(url, 'See plans')}<p style="color:#8e8e93;font-size:13px">If you don't continue, your data is kept and you can come back any time.</p>`)
    })
  }
};
export const mail = (lang, kind, ...args) => (T[lang] || T.es)[kind](...args);
