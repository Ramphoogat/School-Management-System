import nodemailer from 'nodemailer'

export class NotConfiguredError extends Error {}

export function emailConfigured() {
  return !!process.env.EMAIL_HOST
}

export function whatsappConfigured() {
  return !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN)
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null

export async function sendEmail(to: string, subject: string, text: string) {
  if (!emailConfigured()) throw new NotConfiguredError('Email is not configured (set EMAIL_HOST)')
  transport ??= nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT ?? 587),
    secure: Number(process.env.EMAIL_PORT) === 465,
    auth: process.env.EMAIL_USER ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD } : undefined,
  })
  await transport.sendMail({ from: process.env.EMAIL_FROM ?? process.env.EMAIL_USER, to, subject, text })
}

/**
 * WhatsApp Business Cloud API. Business-initiated messages must use a pre-approved template,
 * so we send the template named by WHATSAPP_TEMPLATE_NAME with one body variable ({{1}} = message).
 */
export async function sendWhatsApp(toPhone: string, message: string) {
  if (!whatsappConfigured()) throw new NotConfiguredError('WhatsApp is not configured (set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN)')
  const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toPhone.replace(/[^\d]/g, ''),
      type: 'template',
      template: {
        name: process.env.WHATSAPP_TEMPLATE_NAME ?? 'school_notification',
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: message.slice(0, 900) }] }],
      },
    }),
  })
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 300)}`)
}
