import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportSchema } from "@/lib/validators";
import { requireApiRoles } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period");
  const authorId = searchParams.get("authorId");

  const reports = await prisma.workerReport.findMany({
    where: {
      ...(access.role === "EMPLOYEE" ? { authorId: access.session.user.id } : {}),
      ...(period ? { period: period as never } : {}),
      ...(authorId ? { authorId } : {}),
    },
    include: {
      author: {
        select: { id: true, name: true, email: true },
      },
      reviewer: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ data: reports });
}

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE"]);
  if (access.error) {
    return access.error;
  }

  const body = await request.json();
  const parsed = reportSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (access.role === "EMPLOYEE" && parsed.data.authorId !== access.session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const author = await prisma.user.findUnique({
    where: { id: parsed.data.authorId },
    include: { team: true },
  });

  if (!author) {
    return NextResponse.json({ error: "Auteur introuvable." }, { status: 400 });
  }

  const serviceLabel = author.team?.name ?? "Service non défini";
  const enrichedContent = [
    `Fonction: ${author.role}`,
    `Service: ${serviceLabel}`,
    "",
    parsed.data.content,
  ].join("\n");

  const report = await prisma.workerReport.create({
    data: {
      ...parsed.data,
      content: enrichedContent,
      status: parsed.data.status ?? "DRAFT",
      submittedAt: parsed.data.status === "SUBMITTED" ? new Date() : null,
    },
  });

  return NextResponse.json({ data: report }, { status: 201 });
}
