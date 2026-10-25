// Email for team assignments (lib/team.js). Server-only. Off unless SMTP is configured:
//   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, SMTP_SECURE=1 (port 465), MAIL_FROM
// APP_URL (the address people open TenderOS at) puts a link to the bid in each mail.
import nodemailer from "nodemailer";

const globalRef = globalThis;

export function mailEnabled() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

/**
 * How team emails go out: "smtp" (sent), "demo" (a demo deployment without SMTP: composed and
 * kept in the outbox, shown in the Team panel, not sent), or "off".
 */
export function mailMode() {
  if (mailEnabled()) return "smtp";
  return process.env.DEMO_MODE === "1" ? "demo" : "off";
}

function transport() {
  if (!globalRef.__tenderosMail) {
    globalRef.__tenderosMail = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "1",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || "" } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return globalRef.__tenderosMail;
}

/** Send one plain-text mail; never throws. Returns { sent, error }. */
export async function sendMail({ to, subject, text }) {
  if (!mailEnabled()) return { sent: false, error: "SMTP is not configured" };
  try {
    await transport().sendMail({ from: process.env.MAIL_FROM, to, subject: String(subject).slice(0, 200), text: String(text).slice(0, 20000) });
    return { sent: true, error: null };
  } catch (err) {
    return { sent: false, error: String(err?.message || err).slice(0, 300) };
  }
}
