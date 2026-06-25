import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { ClientBidDetailPage } from "@/components/bid-detail-page";

export const dynamic = "force-dynamic";

export default async function BidDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { role, session } = await requirePageModuleAccess("dao", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const { id } = await params;

  const folder = await prisma.bidFolder.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      requirements: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          label: true,
          description: true,
          category: true,
          isRequired: true,
          orderIndex: true,
        },
      },
      documents: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          label: true,
          originalFileName: true,
          mimeType: true,
          fileSize: true,
          requirementId: true,
          uploadedBy: { select: { id: true, name: true } },
          createdAt: true,
        },
      },
    },
  });

  if (!folder) {
    notFound();
  }

  const allFolders = await prisma.bidFolder.findMany({
    select: { id: true, title: true, reference: true, status: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const canManageAll = role === "ADMIN" || role === "DIRECTEUR_GENERAL";

  const serializedFolder = {
    ...folder,
    deadline: folder.deadline?.toISOString() ?? null,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
    status: folder.status as "IN_PROGRESS" | "SUBMITTED" | "WON" | "LOST" | "CANCELLED",
    documents: folder.documents.map((doc) => ({
      ...doc,
      createdAt: doc.createdAt.toISOString(),
    })),
  };

  const serializedAllFolders = allFolders.map((f) => ({
    ...f,
    status: f.status as "IN_PROGRESS" | "SUBMITTED" | "WON" | "LOST" | "CANCELLED",
  }));

  return (
    <AppShell
      role={role}
      accessNote={canManageAll ? "Accès complet à tous les dossiers." : "Espace de travail dédié aux appels d'offres."}
    >
      <ClientBidDetailPage
        folder={serializedFolder}
        allFolders={serializedAllFolders}
        canManageAll={canManageAll}
        currentUserId={session.user.id}
      />
    </AppShell>
  );
}
