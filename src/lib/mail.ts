import nodemailer, { type Transporter } from "nodemailer";

type MailRecipient = {
  email: string;
  name?: string | null;
};

type MailBatchPayload = {
  recipients: MailRecipient[];
  ccRecipients?: MailRecipient[];
  sendMode?: "individual" | "single-cc";
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
};

declare global {
  var __mailTransporter: Transporter | undefined;
}

function readMailConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const fromEmail = process.env.MAIL_FROM_EMAIL?.trim() ?? user;
  const fromName = process.env.MAIL_FROM_NAME?.trim() ?? "THEBEST SARL";
  const port = Number.parseInt(process.env.SMTP_PORT?.trim() ?? "587", 10);
  const secure = (process.env.SMTP_SECURE?.trim().toLowerCase() ?? "false") === "true";

  return {
    host,
    user,
    pass,
    fromEmail,
    fromName,
    port: Number.isFinite(port) ? port : 587,
    secure,
  };
}

export function isMailConfigured() {
  const config = readMailConfig();
  return Boolean(config.host && config.user && config.pass && config.fromEmail);
}

function getTransporter() {
  if (global.__mailTransporter) {
    return global.__mailTransporter;
  }

  const config = readMailConfig();

  if (!config.host || !config.user || !config.pass) {
    throw new Error("SMTP non configuré. Définissez SMTP_HOST, SMTP_USER, SMTP_PASS et MAIL_FROM_EMAIL.");
  }

  global.__mailTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  return global.__mailTransporter;
}

export async function sendMailBatch(payload: MailBatchPayload) {
  const config = readMailConfig();
  const transporter = getTransporter();

  if (!config.fromEmail) {
    throw new Error("Adresse expéditeur absente. Définissez MAIL_FROM_EMAIL.");
  }

  const uniqueRecipients = payload.recipients
    .map((recipient) => ({ ...recipient, email: recipient.email.trim().toLowerCase() }))
    .filter((recipient) => recipient.email.length > 0)
    .filter((recipient, index, list) => list.findIndex((item) => item.email === recipient.email) === index);

  const uniqueCcRecipients = (payload.ccRecipients ?? [])
    .map((recipient) => ({ ...recipient, email: recipient.email.trim().toLowerCase() }))
    .filter((recipient) => recipient.email.length > 0)
    .filter((recipient, index, list) => list.findIndex((item) => item.email === recipient.email) === index);

  const sent: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];

  if (payload.sendMode === "single-cc") {
    const ccList = uniqueCcRecipients.length > 0 ? uniqueCcRecipients : uniqueRecipients;

    try {
      await transporter.sendMail({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: `${config.fromName} <${config.fromEmail}>`,
        ...(ccList.length > 0
          ? {
              cc: ccList.map((recipient) => (
                recipient.name?.trim() ? `${recipient.name} <${recipient.email}>` : recipient.email
              )),
            }
          : {}),
        replyTo: payload.replyTo,
        subject: payload.subject,
        text: payload.text,
        ...(payload.html ? { html: payload.html } : {}),
        ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
      });

      sent.push(...ccList.map((recipient) => recipient.email));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erreur inconnue";
      ccList.forEach((recipient) => {
        failed.push({
          email: recipient.email,
          error: errorMessage,
        });
      });
    }

    return {
      total: ccList.length,
      sent,
      failed,
    };
  }

  for (const recipient of uniqueRecipients) {
    try {
      const to = recipient.name?.trim()
        ? `${recipient.name} <${recipient.email}>`
        : recipient.email;

      await transporter.sendMail({
        from: `${config.fromName} <${config.fromEmail}>`,
        to,
        replyTo: payload.replyTo,
        subject: payload.subject,
        text: payload.text,
        ...(payload.html ? { html: payload.html } : {}),
        ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
      });

      sent.push(recipient.email);
    } catch (error) {
      failed.push({
        email: recipient.email,
        error: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  return {
    total: uniqueRecipients.length,
    sent,
    failed,
  };
}
