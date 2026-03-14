import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";
import { buildNewsPdf } from "@/lib/news-pdf";

const newsCreateSchema = z.object({
  title: z.string().min(3).max(180),
  content: z.string().min(10).max(5000),
});

export async function GET() {
  const access = await requireApiModuleAccess("news", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const posts = await prisma.newsPost.findMany({
    where: access.role === "ADMIN" ? {} : { isPublished: true },
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
  const access = await requireApiModuleAccess("news", ["ADMIN"]);
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
    where: { id: { not: access.session.user.id } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  if (recipients.length > 0) {
    await prisma.userNotification.createMany({
      data: recipients.map((recipient) => ({
        userId: recipient.id,
        title: `Nouveau communiqué: ${created.title}`,
        message: "Un nouveau communiqué a été publié. Consultez le module Nouvelles.",
        type: "NEWS",
        metadata: {
          newsId: created.id,
          authorId: created.author.id,
          authorName: created.author.name,
        },
      })),
    });

    if (isMailConfigured()) {
      try {
        const appUrl = process.env.NEXTAUTH_URL?.trim() || "";
        const newsUrl = appUrl ? `${appUrl}/news` : "/news";
        const pdfBytes = await buildNewsPdf(created, created.author.name ?? created.author.email);

        await sendMailBatch({
          recipients: recipients.map((recipient) => ({ email: recipient.email, name: recipient.name })),
          subject: `[Communiqué] ${created.title}`,
          text: [
            "THEBEST SARL - Nouveau communiqué",
            "",
            `Titre: ${created.title}`,
            "",
            created.content,
            "",
            `Consulter: ${newsUrl}`,
          ].join("\n"),
          html: `
            <p><strong>THEBEST SARL - Nouveau communiqué</strong></p>
            <p><strong>Titre:</strong> ${created.title}</p>
            <p>${created.content.replace(/\n/g, "<br/>")}</p>
            <p><a href="${newsUrl}">Ouvrir le module Nouvelles</a></p>
          `,
          attachments: [
            {
              filename: `communique-${created.id}.pdf`,
              content: Buffer.from(pdfBytes),
              contentType: "application/pdf",
            },
          ],
          replyTo: created.author.email,
        });
      } catch {
        // Ne pas bloquer la publication si l'email échoue.
      }
    }
  }

  return NextResponse.json({ data: created }, { status: 201 });
}
