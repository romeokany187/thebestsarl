import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";

const sendMailSchema = z.object({
  mode: z.enum(["single", "broadcast"]),
  recipientUserId: z.string().min(1).optional(),
  subject: z.string().min(3).max(180),
  message: z.string().min(5).max(6000),
});

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("profile", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  if (!isMailConfigured()) {
    return NextResponse.json(
      { error: "SMTP non configuré. Ajoutez SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS et MAIL_FROM_EMAIL." },
      { status: 500 },
    );
  }

  const body = await request.json();
  const parsed = sendMailSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const isBroadcast = parsed.data.mode === "broadcast";
  const canBroadcast = access.role === "ADMIN" || access.role === "MANAGER";
  if (isBroadcast && !canBroadcast) {
    return NextResponse.json({ error: "Diffusion globale réservée à l'administration et aux managers." }, { status: 403 });
  }

  const sender = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, name: true, email: true },
  });

  if (!sender) {
    return NextResponse.json({ error: "Expéditeur introuvable." }, { status: 404 });
  }

  const recipients = isBroadcast
    ? await prisma.user.findMany({
        where: { id: { not: sender.id } },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      })
    : await prisma.user.findMany({
        where: { id: parsed.data.recipientUserId ?? "" },
        select: { id: true, name: true, email: true },
        take: 1,
      });

  if (recipients.length === 0) {
    return NextResponse.json({ error: "Destinataire introuvable." }, { status: 404 });
  }

  const subject = parsed.data.subject.trim();
  const message = parsed.data.message.trim();
  const mailText = [
    `Message interne THEBEST SARL`,
    `De: ${sender.name} <${sender.email}>`,
    "",
    message,
  ].join("\n");

  const delivery = await sendMailBatch({
    recipients: recipients.map((recipient) => ({ email: recipient.email, name: recipient.name })),
    subject,
    text: mailText,
    html: `<p><strong>Message interne THEBEST SARL</strong></p><p><strong>De:</strong> ${sender.name} (${sender.email})</p><p>${message.replace(/\n/g, "<br/>")}</p>`,
    replyTo: sender.email,
  });

  await prisma.userNotification.createMany({
    data: recipients.map((recipient) => ({
      userId: recipient.id,
      title: subject,
      message,
      type: "MAIL",
      metadata: {
        senderId: sender.id,
        senderName: sender.name,
        senderEmail: sender.email,
        sentVia: "APP_MAIL",
      },
    })),
  });

  return NextResponse.json({
    data: {
      recipients: recipients.length,
      delivered: delivery.sent.length,
      failed: delivery.failed.length,
      failedRecipients: delivery.failed,
    },
  });
}
