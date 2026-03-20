import { ArchiveFolder, ArchiveOrigin, PrismaClient } from "@prisma/client";

type ArchiveAppRole = "ADMIN" | "MANAGER" | "EMPLOYEE" | "ACCOUNTANT";
type ArchiveAccessScope = "ALL" | "DIRECTION" | "FINANCE";

const ARCHIVE_FOLDER_SCOPES: Record<ArchiveFolder, ArchiveAccessScope> = {
  DGI: "FINANCE",
  CNSS_ONEM: "FINANCE",
  ADMINISTRATIF: "DIRECTION",
  NOTES_LETTRES_INTERNES: "ALL",
  FACTURES_RECUS: "FINANCE",
  DGRK: "DIRECTION",
};

export const ARCHIVE_FOLDERS: Array<{
  key: ArchiveFolder;
  label: string;
  description: string;
}> = [
  { key: "DGI", label: "Dossiers DGI", description: "Documents fiscaux et correspondances DGI. Accès Finance." },
  { key: "CNSS_ONEM", label: "Dossiers CNSS & ONEM", description: "Pièces sociales et obligations ONEM/CNSS. Accès Finance." },
  { key: "ADMINISTRATIF", label: "Dossier administratifs", description: "Documents administratifs sensibles. Accès Direction." },
  {
    key: "NOTES_LETTRES_INTERNES",
    label: "Dossier notes et lettres internes",
    description: "Communiqués, rapports et notes internes produits par l'application. Visible par tous.",
  },
  { key: "FACTURES_RECUS", label: "Dossier factures et reçus", description: "Factures, reçus et pièces de caisse. Accès Finance." },
  { key: "DGRK", label: "Dossier DGRK", description: "Correspondances et pièces DGRK. Accès Direction." },
];

export function archiveFolderLabel(folder: ArchiveFolder) {
  return ARCHIVE_FOLDERS.find((item) => item.key === folder)?.label ?? folder;
}

export function parseArchiveFolder(value?: string | null): ArchiveFolder | null {
  if (
    value === "DGI"
    || value === "CNSS_ONEM"
    || value === "ADMINISTRATIF"
    || value === "NOTES_LETTRES_INTERNES"
    || value === "FACTURES_RECUS"
    || value === "DGRK"
  ) {
    return value;
  }

  return null;
}

export function archiveFolderScope(folder: ArchiveFolder) {
  return ARCHIVE_FOLDER_SCOPES[folder];
}

export function canReadArchiveFolder(role: ArchiveAppRole, jobTitle: string | null | undefined, folder: ArchiveFolder) {
  const scope = archiveFolderScope(folder);

  if (scope === "ALL") {
    return true;
  }

  if (scope === "DIRECTION") {
    return role === "ADMIN" || (jobTitle ?? "") === "DIRECTION_GENERALE";
  }

  return role === "ACCOUNTANT" || (jobTitle ?? "") === "CAISSIERE" || (jobTitle ?? "") === "COMPTABLE";
}

export function canWriteArchiveFolder(role: ArchiveAppRole, jobTitle: string | null | undefined, folder: ArchiveFolder) {
  return canReadArchiveFolder(role, jobTitle, folder);
}

export function getAccessibleArchiveFolders(role: ArchiveAppRole, jobTitle: string | null | undefined) {
  return ARCHIVE_FOLDERS.filter((folder) => canReadArchiveFolder(role, jobTitle, folder.key));
}

function createReferenceFromSequence(sequence: number) {
  const year = new Date().getFullYear();
  return `BST-${year}-${String(sequence).padStart(6, "0")}`;
}

export async function normalizeLegacyArchiveReferences(prisma: PrismaClient) {
  const legacyDocuments = await prisma.archiveDocument.findMany({
    where: { reference: { startsWith: "ARC-" } },
    select: { id: true, reference: true },
    take: 5000,
  });

  for (const item of legacyDocuments) {
    const nextReference = item.reference.replace(/^ARC-/, "BST-");
    await prisma.archiveDocument.update({
      where: { id: item.id },
      data: { reference: nextReference },
    });
  }
}

export async function createArchiveDocumentWithGlobalReference(
  prisma: PrismaClient,
  input: {
    folder: ArchiveFolder;
    title: string;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    fileData?: Buffer;
    externalUrl?: string;
    origin: ArchiveOrigin;
    sourceKey?: string;
    createdById?: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const maxSequence = await tx.archiveDocument.aggregate({ _max: { sequence: true } });
    const nextSequence = (maxSequence._max.sequence ?? 0) + 1;

    return tx.archiveDocument.create({
      data: {
        sequence: nextSequence,
        reference: createReferenceFromSequence(nextSequence),
        folder: input.folder,
        title: input.title,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        fileData: input.fileData,
        externalUrl: input.externalUrl,
        origin: input.origin,
        sourceKey: input.sourceKey,
        createdById: input.createdById,
      },
    });
  });
}

export async function syncSystemArchiveDocuments(prisma: PrismaClient) {
  const [newsPosts, workerReports, ticketSales, attendances, payments, approvedNeeds] = await Promise.all([
    prisma.newsPost.findMany({
      where: { isPublished: true },
      select: { id: true, title: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.workerReport.findMany({
      select: { id: true, title: true, period: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.ticketSale.findMany({
      select: { soldAt: true },
      orderBy: { soldAt: "desc" },
      take: 2000,
    }),
    prisma.attendance.findMany({
      select: { date: true },
      orderBy: { date: "desc" },
      take: 2000,
    }),
    prisma.payment.findMany({
      select: { paidAt: true },
      orderBy: { paidAt: "desc" },
      take: 2000,
    }),
    prisma.needRequest.findMany({
      where: { status: "APPROVED" },
      select: { id: true, title: true, approvedAt: true, createdAt: true },
      orderBy: { approvedAt: "desc" },
      take: 400,
    }),
  ]);

  const systemCandidates: Array<{
    sourceKey: string;
    title: string;
    originalFileName: string;
    mimeType: string;
    externalUrl: string;
  }> = [];

  for (const post of newsPosts) {
    const date = post.createdAt.toISOString().slice(0, 10);
    systemCandidates.push({
      sourceKey: `SYSTEM_NEWS_${post.id}`,
      title: `Communiqué - ${post.title}`,
      originalFileName: `communique-${date}.pdf`,
      mimeType: "application/pdf",
      externalUrl: `/api/news/${post.id}/pdf`,
    });
  }

  for (const report of workerReports) {
    const date = report.createdAt.toISOString().slice(0, 10);
    systemCandidates.push({
      sourceKey: `SYSTEM_WORKER_REPORT_${report.id}`,
      title: `Rapport ${report.period} - ${report.title}`,
      originalFileName: `rapport-travail-${date}.pdf`,
      mimeType: "application/pdf",
      externalUrl: `/api/reports/${report.id}/pdf`,
    });
  }

  const salesMonths = new Set(ticketSales.map((item) => item.soldAt.toISOString().slice(0, 7)));
  const attendanceMonths = new Set(attendances.map((item) => item.date.toISOString().slice(0, 7)));
  const paymentMonths = new Set(payments.map((item) => item.paidAt.toISOString().slice(0, 7)));

  for (const month of salesMonths) {
    systemCandidates.push({
      sourceKey: `SYSTEM_TICKETS_MONTH_${month}`,
      title: `Rapport des ventes - ${month}`,
      originalFileName: `rapport-ventes-${month}.pdf`,
      mimeType: "application/pdf",
      externalUrl: `/api/tickets/report?mode=month&month=${month}`,
    });
  }

  for (const month of attendanceMonths) {
    systemCandidates.push({
      sourceKey: `SYSTEM_ATTENDANCE_MONTH_${month}`,
      title: `Rapport des présences - ${month}`,
      originalFileName: `rapport-presences-${month}.pdf`,
      mimeType: "application/pdf",
      externalUrl: `/api/attendance/report?mode=month&month=${month}`,
    });
  }

  for (const month of paymentMonths) {
    systemCandidates.push({
      sourceKey: `SYSTEM_PAYMENTS_MONTH_${month}`,
      title: `Rapport des paiements - ${month}`,
      originalFileName: `rapport-paiements-${month}.pdf`,
      mimeType: "application/pdf",
      externalUrl: `/api/payments/report?mode=month&month=${month}`,
    });
  }

  for (const need of approvedNeeds) {
    const date = (need.approvedAt ?? need.createdAt).toISOString().slice(0, 10);
    systemCandidates.push({
      sourceKey: `SYSTEM_NEED_APPROVED_${need.id}`,
      title: `État de besoin approuvé - ${need.title}`,
      originalFileName: `etat-besoin-approuve-${date}.pdf`,
      mimeType: "application/pdf",
      externalUrl: `/api/procurement/needs/${need.id}/pdf`,
    });
  }

  const sourceKeys = systemCandidates.map((candidate) => candidate.sourceKey);
  const existing = await prisma.archiveDocument.findMany({
    where: { sourceKey: { in: sourceKeys } },
    select: { id: true, sourceKey: true },
  });
  const existingBySourceKey = new Map(
    existing
      .filter((item): item is { id: string; sourceKey: string } => Boolean(item.sourceKey))
      .map((item) => [item.sourceKey, item.id]),
  );

  for (const candidate of systemCandidates) {
    const existingId = existingBySourceKey.get(candidate.sourceKey);
    if (existingId) {
      await prisma.archiveDocument.update({
        where: { id: existingId },
        data: {
          folder: "NOTES_LETTRES_INTERNES",
          title: candidate.title,
          originalFileName: candidate.originalFileName,
          mimeType: candidate.mimeType,
          externalUrl: candidate.externalUrl,
          origin: "SYSTEM",
        },
      });
      continue;
    }

    await createArchiveDocumentWithGlobalReference(prisma, {
      folder: "NOTES_LETTRES_INTERNES",
      title: candidate.title,
      originalFileName: candidate.originalFileName,
      mimeType: candidate.mimeType,
      fileSize: 0,
      externalUrl: candidate.externalUrl,
      origin: "SYSTEM",
      sourceKey: candidate.sourceKey,
    });
  }
}
