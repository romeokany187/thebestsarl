import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportSchema } from "@/lib/validators";
import { requireApiModuleAccess } from "@/lib/rbac";
import { writeActivityLog } from "@/lib/activity-log";

function jobTitleLabel(jobTitle: string) {
  const labels: Record<string, string> = {
    COMMERCIAL: "Commercial",
    COMPTABLE: "Comptable",
    AUDITEUR: "Auditeur",
    CAISSIER: "Caisse 1 Siège",
    CAISSE_2_SIEGE: "Caisse 2 Siège",
    CAISSE_AGENCE: "Caisse agence",
    RELATION_PUBLIQUE: "Relation publique",
    APPROVISIONNEMENT: "Chargé des approvisionnements",
    AGENT_TERRAIN: "Non affecté",
    DIRECTION_GENERALE: "Directeur Général",
  };

  return labels[jobTitle] ?? jobTitle;
}

const titleKeywordsByJobTitle: Record<string, string[]> = {
  COMMERCIAL: ["VENTE", "COMMERCIAL"],
  COMPTABLE: ["FINAN", "COMPTABLE"],
  AUDITEUR: ["AUDIT", "CONFORM"],
  CAISSIER: ["CAISSE", "CAISS"],
  CAISSE_2_SIEGE: ["CAISSE", "CAISS"],
  CAISSE_AGENCE: ["CAISSE", "CAISS", "AGENCE"],
  RELATION_PUBLIQUE: ["RH", "RESSOURCE", "RELATION PUBLIQUE"],
  APPROVISIONNEMENT: ["APPROVISION", "STOCK", "ACHAT"],
  AGENT_TERRAIN: ["TERRAIN", "ACTIVITE"],
  DIRECTION_GENERALE: ["DIRECTION", "PILOTAGE"],
};

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("reports", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
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
  const access = await requireApiModuleAccess("reports", ["MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const body = await request.json();
  const parsed = reportSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!/Billets vendus:\s*\d+/i.test(parsed.data.content)) {
    return NextResponse.json(
      { error: "Le rapport doit indiquer le nombre de billets vendus." },
      { status: 400 },
    );
  }

  if ((access.role === "EMPLOYEE" || access.role === "ACCOUNTANT") && parsed.data.authorId !== access.session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const author = await prisma.user.findUnique({
    where: { id: parsed.data.authorId },
    include: { team: true },
  });

  if (!author) {
    return NextResponse.json({ error: "Auteur introuvable." }, { status: 400 });
  }

  const normalizedTitle = parsed.data.title.trim().toUpperCase();
  const expectedKeywords = titleKeywordsByJobTitle[author.jobTitle] ?? [];
  if (expectedKeywords.length > 0 && !expectedKeywords.some((keyword) => normalizedTitle.includes(keyword))) {
    return NextResponse.json(
      {
        error: `Le titre doit correspondre a la fonction: ${jobTitleLabel(author.jobTitle)}.`,
      },
      { status: 400 },
    );
  }

  const serviceLabel = author.team?.name ?? "Service non défini";
  const functionLabel = jobTitleLabel(author.jobTitle);
  const enrichedContent = [
    `Fonction: ${functionLabel}`,
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

  await writeActivityLog({
    actorId: access.session.user.id,
    action: report.status === "SUBMITTED" ? "REPORT_SUBMITTED" : "REPORT_SAVED",
    entityType: "WORKER_REPORT",
    entityId: report.id,
    summary: `Rapport ${report.status === "SUBMITTED" ? "soumis" : "enregistré"}: ${report.title}.`,
    payload: {
      title: report.title,
      period: report.period,
      status: report.status,
      authorId: report.authorId,
    },
  });

  return NextResponse.json({ data: report }, { status: 201 });
}
