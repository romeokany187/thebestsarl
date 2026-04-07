import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";
import { writeActivityLog } from "@/lib/activity-log";

const newsCreateSchema = z.object({
  title: z.string().min(3).max(180),
  content: z.string().min(10).max(5000),
});

export async function GET() {
  const access = await requireApiModuleAccess("news", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const canPublishNews = access.role === "ADMIN" || access.role === "DIRECTEUR_GENERAL";

  const posts = await prisma.newsPost.findMany({
    where: canPublishNews ? {} : { isPublished: true },
    include: {
      author: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 80,
  });

  return NextResponse.json({ data: posts });
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("news", ["ADMIN", "DIRECTEUR_GENERAL"]);
  if (access.error) return access.error;

  const body = await request.json();
  const parsed = newsCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const created = await prisma.newsPost.create({
    data: {
      title: parsed.data.title,
      content: parsed.data.content,
      isPublished: true,
      authorId: access.session.user.id,
    },
    include: {
      author: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  const recipients = await prisma.user.findMany({
    where: {
      id: { not: access.session.user.id },
      role: { in: ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] },
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  const mailResult: {
    configured: boolean;
    attempted: boolean;
    recipients: number;
    delivered: number;
    failed: number;
    error?: string;
  } = {
    configured: isMailConfigured(),
    attempted: false,
    recipients: recipients.length,
    delivered: 0,
    failed: 0,
  };

  if (recipients.length > 0) {
    await prisma.userNotification.createMany({
      data: recipients.map((recipient) => ({
        userId: recipient.id,
        title: `Nouveau communiqué: ${created.title}`,
        message: "Un nouveau communiqué a été publié. Consultez le module Nouvelles.",
        type: "NEWS",
        metadata: {
          newsId: created.id,
          newsTitle: created.title,
          authorId: created.author.id,
          authorName: created.author.name,
        },
      })),
    });

    if (mailResult.configured) {
      try {
        mailResult.attempted = true;
        const appUrl = process.env.NEXTAUTH_URL?.trim() || "";
        const newsUrl = appUrl ? `${appUrl}/news` : "/news";

        const delivery = await sendMailBatch({
          recipients: [{ email: created.author.email, name: created.author.name }],
          ccRecipients: recipients.map((recipient) => ({ email: recipient.email, name: recipient.name })),
          sendMode: "single-cc",
          subject: `Communiqué - ${created.title}`,
          text: [
            "THEBEST SARL - Nouveau communiqué",
            "",
            `Titre: ${created.title}`,
            "",
            "Contenu:",
            created.content,
            "",
            `Consulter: ${newsUrl}`,
          ].join("\n"),
          replyTo: created.author.email,
        });

        mailResult.delivered = delivery.sent.length;
        mailResult.failed = delivery.failed.length;

        if (delivery.failed.length > 0) {
          console.error("[news.publish] Echecs partiels email communiqué", {
            newsId: created.id,
            failed: delivery.failed,
          });
        }
      } catch (error) {
        mailResult.error = error instanceof Error ? error.message : "Erreur email inconnue";
        console.error("[news.publish] Echec envoi email communiqué", {
          newsId: created.id,
          error: mailResult.error,
        });
        // Ne pas bloquer la publication si l'email échoue.
      }
    } else {
      console.warn("[news.publish] SMTP non configuré: envoi email communiqué ignoré", {
        newsId: created.id,
      });
    }
  }

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "NEWS_PUBLISHED",
    entityType: "NEWS_POST",
    entityId: created.id,
    summary: `Nouvelle publiée: ${created.title}.`,
    payload: {
      title: created.title,
      authorName: created.author.name,
      recipients: recipients.length,
      delivered: mailResult.delivered,
    },
  });

  return NextResponse.json({ data: created, mail: mailResult }, { status: 201 });
}
