// Terms of service and privacy policy. Reachable before sign-in (#/terms, #/privacy) because the
// sign-up form and the store listings link here. Plain language on purpose; Spanish first, English
// for the rest of the UI languages. Dates are the last substantive change.
import { useLocation } from 'react-router-dom'
import { getLang, t } from '../lib/i18n.js'
import { nav } from '../lib/nav.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

export const LEGAL_UPDATED = '2026-10-03'
export const SUPPORT_EMAIL = 'soporte@vantixgym.app'

const es = {
  terms: {
    title: 'Términos del servicio',
    intro: 'Estos términos regulan el uso de VantixGym, la aplicación y el servicio disponibles en app.vantixgym.app ("el Servicio"). Al crear una cuenta los aceptas. Si no estás de acuerdo, no uses el Servicio.',
    sections: [
      ['Qué es VantixGym', 'Una herramienta para planear y registrar entrenamientos, alimentación, pasos y peso corporal, con un coach y un entrenador asistidos por inteligencia artificial que generan sugerencias a partir de tus datos. No es un servicio médico ni sustituye a un profesional de la salud, de la nutrición o del entrenamiento. Consulta a un profesional antes de cambiar tu dieta o tu entrenamiento, sobre todo si tienes una condición de salud.'],
      ['Tu cuenta', 'Necesitas ser mayor de 18 años, o de 16 con autorización de tu tutor. Eres responsable de mantener tu contraseña y tus dispositivos seguros y de lo que ocurra con tu cuenta. Una cuenta es personal; no la compartas. Avísanos si crees que alguien más entró a ella.'],
      ['Prueba gratis y suscripción', 'Las cuentas nuevas tienen 7 días de prueba gratis sin tarjeta. Al terminar, usar el Servicio requiere una suscripción de pago (mensual, semestral o anual) con los precios mostrados en la app, en pesos mexicanos e IVA incluido. La suscripción se renueva automáticamente al final de cada periodo hasta que la canceles.'],
      ['Cancelación y reembolsos', 'Puedes cancelar cuando quieras desde Ajustes → Suscripción. Conservas el acceso hasta el final del periodo ya pagado y no se cobra nada más. No reembolsamos periodos parciales ni renovaciones ya iniciadas, salvo que el Servicio haya estado inaccesible por causa nuestra durante un tiempo relevante; en ese caso escríbenos y lo resolvemos. Esto no limita los derechos que te reconoce la Ley Federal de Protección al Consumidor.'],
      ['Cambios de precio', 'Si cambiamos un precio, te avisaremos por correo al menos 30 días antes de que aplique a tu siguiente renovación. Si no estás de acuerdo, puedes cancelar antes de esa fecha.'],
      ['Uso aceptable', 'No uses el Servicio para algo ilegal, para intentar acceder a cuentas o datos de otros, para sobrecargarlo o copiarlo, ni para enviar contenido que no sea tuyo o que sea ofensivo. Podemos suspender una cuenta que incumpla esto, avisándote cuando sea razonable.'],
      ['Las sugerencias del coach', 'Las respuestas, planes y recetas los genera un modelo de inteligencia artificial a partir de tus datos. Pueden contener errores. Úsalas con criterio y revisa siempre las cantidades y las indicaciones de tu nutriólogo o médico, que prevalecen sobre cualquier sugerencia de la app.'],
      ['Tus datos y tu contenido', 'Tus datos son tuyos. Puedes exportarlos desde Ajustes en cualquier momento y eliminar tu cuenta cuando quieras. Nos das permiso para procesarlos únicamente para prestarte el Servicio, como describe la Política de privacidad.'],
      ['Disponibilidad', 'Trabajamos para que el Servicio esté siempre disponible, pero puede haber interrupciones por mantenimiento o causas ajenas. No garantizamos disponibilidad ininterrumpida. Haz copias de tus datos con la exportación si son importantes para ti.'],
      ['Responsabilidad', 'En la medida que la ley permite, nuestra responsabilidad frente a ti se limita a lo que pagaste por el Servicio en los últimos 12 meses. No respondemos por lesiones o daños derivados de seguir un plan de entrenamiento o alimentación: tú decides qué hacer con tu cuerpo y te recomendamos hacerlo con supervisión profesional.'],
      ['Código abierto', 'VantixGym está construido sobre openGym, un proyecto con licencia AGPL v3. El código fuente de la versión que usas está disponible públicamente; el enlace está en Ajustes. Esto no te da licencia sobre la marca VantixGym ni sobre el servicio hospedado.'],
      ['Cambios a estos términos', 'Podemos actualizarlos. Si el cambio es relevante te avisaremos por correo o dentro de la app antes de que aplique. Seguir usando el Servicio después significa que lo aceptas.'],
      ['Ley aplicable y contacto', 'Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Para cualquier duda o reclamación escríbenos a ' + SUPPORT_EMAIL + '.']
    ]
  },
  privacy: {
    title: 'Política de privacidad',
    intro: 'Esta política explica qué datos recoge VantixGym, para qué, con quién los comparte y qué derechos tienes. La redactamos para que se entienda; si algo no queda claro, escríbenos.',
    sections: [
      ['Responsable', 'VantixGym (nombre comercial operado por Daniel Oliva), con contacto en ' + SUPPORT_EMAIL + ', es el responsable del tratamiento de tus datos personales en los términos de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares.'],
      ['Qué datos recogemos', 'Los que tú registras: nombre, correo, contraseña (guardada solo como hash, nunca en claro) o los datos básicos de tu cuenta de Google si entras con ella, peso, entrenamientos, comidas y fotos de comidas, pasos, agua, objetivos, el plan de alimentación o la rutina que subas, tus fotos de progreso si haces el check-in mensual y tus conversaciones con el coach. Datos técnicos mínimos para que el servicio funcione: dirección IP y registros de acceso, que se conservan como máximo 30 días. No usamos cookies de seguimiento ni analítica de terceros.'],
      ['Para qué los usamos', 'Para prestarte el Servicio: sincronizar tus datos entre dispositivos, generar las sugerencias del coach, enviarte correos de cuenta (confirmación, contraseña, aviso de fin de prueba, recibos) y cobrar la suscripción. También para proteger el Servicio frente a abuso. No vendemos tus datos ni los usamos para publicidad.'],
      ['Inicio de sesión con Google', 'Si eliges "Continuar con Google", Google nos entrega únicamente tu nombre, tu correo electrónico y, si existe, tu foto de perfil, junto con un identificador de tu cuenta de Google. Los usamos solo para crear o identificar tu cuenta de VantixGym y para enviarte los correos de la cuenta. No accedemos a tus contactos, calendario, correos, archivos ni a ningún otro dato de Google, no los vendemos ni los compartimos con terceros, y no los usamos para publicidad ni para entrenar modelos. Puedes desvincular Google en cualquier momento desde tu cuenta de Google (Seguridad → Aplicaciones de terceros) o eliminando tu cuenta de VantixGym. El uso que VantixGym hace de la información recibida de las API de Google cumple la Política de datos de usuario de los servicios de API de Google, incluidos los requisitos de uso limitado.'],
      ['Inteligencia artificial', 'Cuando usas el coach, el entrenador, las recetas, la importación de planes o el análisis de fotos de comida, enviamos los datos necesarios para esa función (por ejemplo, la foto, el documento, tu registro reciente o tu plan) a Anthropic, el proveedor del modelo, que los procesa para generar la respuesta y, según sus términos de uso de API, no los usa para entrenar sus modelos. Las fotos de comida y los documentos importados no se guardan en nuestros servidores: se analizan y se descartan. Lo que sí guardamos es el resultado (los alimentos y sus valores, el plan transcrito) y la conversación, porque son parte de tu registro.'],
      ['Fotos de progreso', 'Si usas el check-in mensual, tus fotos de frente, perfil y espalda se guardan en nuestros servidores, cifradas en tránsito, en una carpeta privada de tu cuenta a la que solo tú accedes desde la app; nadie más puede verlas, ni siquiera por enlace. Para generar la nota de tu coach se envían a Anthropic una vez, con la misma regla de no entrenamiento, y no se conservan allí. Puedes borrar cualquier check-in cuando quieras y se eliminan al instante; al eliminar tu cuenta se borran con ella.'],
      ['Con quién los compartimos', 'Solo con proveedores que necesitamos para operar, cada uno limitado a su función: Amazon Web Services (servidores y copias de seguridad, en Estados Unidos), Cloudflare (red y protección), Resend (envío de correos de cuenta), Stripe (pagos; nosotros nunca vemos tu tarjeta completa) y Anthropic (inteligencia artificial, descrito arriba). No compartimos datos con nadie más salvo obligación legal.'],
      ['Transferencias internacionales', 'Nuestros servidores están en Estados Unidos. Al usar el Servicio consientes esa transferencia, que se realiza con proveedores que ofrecen medidas de seguridad y compromisos contractuales de protección de datos.'],
      ['Seguridad', 'Las conexiones van cifradas (HTTPS). Las contraseñas se guardan con scrypt. Las sesiones pueden cerrarse en todos los dispositivos desde Ajustes. Las copias de seguridad están cifradas. El acceso al servidor está restringido a su administrador. Ningún sistema es infalible; si ocurriera una brecha que te afecte, te avisaremos sin demora.'],
      ['Cuánto tiempo los guardamos', 'Mientras tengas cuenta. Si la eliminas desde Ajustes, queda oculta de inmediato y se borra definitivamente a los 30 días, periodo en el que puedes recuperarla iniciando sesión. Las copias de seguridad cifradas rotan en un máximo de 90 días. Los datos de facturación se conservan el tiempo que exige la ley fiscal.'],
      ['Tus derechos', 'Puedes acceder, corregir, exportar y eliminar tus datos tú mismo desde Ajustes. También puedes ejercer tus derechos ARCO (acceso, rectificación, cancelación y oposición), revocar tu consentimiento o limitar el uso escribiendo a ' + SUPPORT_EMAIL + '; respondemos en un máximo de 20 días hábiles. Si no quedas conforme, puedes acudir al INAI.'],
      ['Menores', 'El Servicio no está dirigido a menores de 16 años. Si detectamos una cuenta de un menor sin autorización, la eliminaremos.'],
      ['Cambios', 'Si cambiamos esta política de forma relevante te avisaremos por correo o en la app. La fecha de la última actualización aparece al final.']
    ]
  }
}
const en = {
  terms: {
    title: 'Terms of service',
    intro: 'These terms govern the use of VantixGym, the app and service at app.vantixgym.app (the "Service"). By creating an account you accept them. If you disagree, do not use the Service.',
    sections: [
      ['What VantixGym is', 'A tool to plan and log workouts, meals, steps and body weight, with an AI-assisted coach and trainer that generate suggestions from your data. It is not a medical service and does not replace a health, nutrition or training professional. Check with a professional before changing your diet or training, especially if you have a health condition.'],
      ['Your account', 'You must be 18 or older, or 16 with a guardian\'s consent. You are responsible for keeping your password and devices safe and for what happens on your account. Accounts are personal; do not share them. Tell us if you think someone else got in.'],
      ['Free trial and subscription', 'New accounts get a 7-day free trial, no card required. Afterwards, using the Service requires a paid subscription (monthly, 6-month or yearly) at the prices shown in the app, in Mexican pesos, tax included. Subscriptions renew automatically at the end of each period until you cancel.'],
      ['Cancellation and refunds', 'Cancel any time from Settings → Subscription. You keep access until the end of the period you already paid for, and nothing further is charged. We do not refund partial periods or renewals already started, unless the Service was unavailable through our fault for a meaningful time; in that case write to us and we will sort it out. This does not limit the rights consumer law grants you.'],
      ['Price changes', 'If we change a price we will email you at least 30 days before it applies to your next renewal. If you disagree, you can cancel before that date.'],
      ['Acceptable use', 'Do not use the Service for anything illegal, to try to access other people\'s accounts or data, to overload or copy it, or to submit content that is not yours or is abusive. We may suspend an account that breaks this, with notice when reasonable.'],
      ['The coach\'s suggestions', 'Answers, plans and recipes are generated by an AI model from your data. They can contain mistakes. Use judgement, and always check quantities and your nutritionist\'s or doctor\'s instructions, which prevail over anything the app suggests.'],
      ['Your data and content', 'Your data is yours. You can export it from Settings at any time and delete your account whenever you want. You allow us to process it only to provide the Service, as described in the Privacy policy.'],
      ['Availability', 'We work to keep the Service available, but there may be interruptions for maintenance or causes outside our control. We do not guarantee uninterrupted availability. Export your data if it matters to you.'],
      ['Liability', 'To the extent the law allows, our liability to you is limited to what you paid for the Service in the last 12 months. We are not liable for injury or damage from following a training or meal plan: you decide what to do with your body, and we recommend doing it with professional supervision.'],
      ['Open source', 'VantixGym is built on openGym, an AGPL v3 project. The source code of the version you use is publicly available; the link is in Settings. This grants no licence to the VantixGym brand or the hosted service.'],
      ['Changes to these terms', 'We may update them. For material changes we will notify you by email or in the app before they apply. Continuing to use the Service afterwards means you accept them.'],
      ['Governing law and contact', 'These terms are governed by the laws of Mexico. For any question or complaint write to ' + SUPPORT_EMAIL + '.']
    ]
  },
  privacy: {
    title: 'Privacy policy',
    intro: 'This policy explains what data VantixGym collects, why, who it is shared with and what rights you have. It is written to be understood; if anything is unclear, write to us.',
    sections: [
      ['Controller', 'VantixGym (a trade name operated by Daniel Oliva), reachable at ' + SUPPORT_EMAIL + ', is the controller of your personal data under Mexico\'s Federal Law on Protection of Personal Data Held by Private Parties.'],
      ['What we collect', 'What you log: name, email, password (stored only as a hash, never in clear text) or the basic details of your Google account if you sign in with it, weight, workouts, meals and meal photos, steps, water, goals, any diet plan or routine you upload, your progress photos if you use the monthly check-in, and your conversations with the coach. Minimal technical data needed to run the service: IP address and access logs, kept at most 30 days. No tracking cookies, no third-party analytics.'],
      ['Why we use it', 'To provide the Service: sync your data across devices, generate the coach\'s suggestions, send account emails (confirmation, password, trial ending, receipts) and charge the subscription. Also to protect the Service from abuse. We do not sell your data or use it for advertising.'],
      ['Sign in with Google', 'If you choose "Continue with Google", Google gives us only your name, your email address and, when there is one, your profile picture, together with an identifier for your Google account. We use them solely to create or identify your VantixGym account and to send you account emails. We do not access your contacts, calendar, emails, files or any other Google data; we do not sell or share them with third parties, and we do not use them for advertising or to train models. You can unlink Google at any time from your Google account (Security → Third-party apps) or by deleting your VantixGym account. VantixGym\'s use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.'],
      ['Artificial intelligence', 'When you use the coach, the trainer, recipes, plan import or meal-photo analysis, we send the data needed for that feature (for example the photo, the document, your recent log or your plan) to Anthropic, the model provider, which processes it to generate the answer and, under its API terms, does not use it to train its models. Meal photos and imported documents are not stored on our servers: they are analysed and discarded. We do keep the result (the foods and their values, the transcribed plan) and the conversation, because they are part of your log.'],
      ['Progress photos', 'If you use the monthly check-in, your front, side and back photos are stored on our servers, encrypted in transit, in a private folder of your account that only you can open from the app; nobody else can see them, not even by link. To write your coach\'s note they are sent to Anthropic once, under the same no-training rule, and are not kept there. You can delete any check-in whenever you want and the photos are erased immediately; deleting your account erases them too.'],
      ['Who we share it with', 'Only providers we need to operate, each limited to its role: Amazon Web Services (servers and backups, in the United States), Cloudflare (network and protection), Resend (account emails), Stripe (payments; we never see your full card) and Anthropic (AI, described above). We share data with no one else unless legally required.'],
      ['International transfers', 'Our servers are in the United States. By using the Service you consent to that transfer, which is made with providers that offer security measures and contractual data-protection commitments.'],
      ['Security', 'Connections are encrypted (HTTPS). Passwords are stored with scrypt. Sessions can be closed on every device from Settings. Backups are encrypted. Server access is restricted to its administrator. No system is infallible; if a breach affecting you occurred, we would notify you without delay.'],
      ['How long we keep it', 'While you have an account. If you delete it from Settings it is hidden immediately and erased for good after 30 days, during which you can recover it by signing in. Encrypted backups rotate within 90 days. Billing records are kept as long as tax law requires.'],
      ['Your rights', 'You can access, correct, export and delete your data yourself from Settings. You can also exercise your access, rectification, cancellation and objection rights, withdraw consent or limit use by writing to ' + SUPPORT_EMAIL + '; we answer within 20 business days. If unsatisfied, you may contact INAI, the Mexican data-protection authority.'],
      ['Children', 'The Service is not aimed at anyone under 16. If we find an account of a minor without consent we will delete it.'],
      ['Changes', 'For material changes to this policy we will notify you by email or in the app. The date of the last update is at the bottom.']
    ]
  }
}

export default function Legal() {
  const which = useLocation().pathname === '/privacy' ? 'privacy' : 'terms'
  const doc = (getLang() === 'es' ? es : en)[which]
  const other = which === 'terms' ? '/privacy' : '/terms'
  return <div className="narrow legal">
    <div className="hdr">
      <button className="iconbtn" onClick={() => (window.history.length > 1 ? window.history.back() : nav('/home'))} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>{doc.title}</h1><div className="sub">VantixGym · {t('Updated {0}', LEGAL_UPDATED)}</div></div>
    </div>
    <p className="muted">{doc.intro}</p>
    {doc.sections.map(([h, body], i) => <section key={i}><h2>{i + 1}. {h}</h2><p>{body}</p></section>)}
    <div className="row" style={{ gap: 8, marginTop: 22 }}>
      <Button size="sm" onClick={() => nav(other)}>{which === 'terms' ? (getLang() === 'es' ? 'Política de privacidad' : 'Privacy policy') : (getLang() === 'es' ? 'Términos del servicio' : 'Terms of service')}</Button>
      <Button size="sm" variant="tinted" onClick={() => nav('/home')}>{t('Go to the app')}</Button>
    </div>
    <div className="dim small" style={{ marginTop: 16 }}>{t('Updated {0}', LEGAL_UPDATED)} · {SUPPORT_EMAIL}</div>
  </div>
}
