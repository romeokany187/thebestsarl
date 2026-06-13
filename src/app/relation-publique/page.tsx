import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { BidWorkspace } from "@/components/bid-workspace";

export const dynamic = "force-dynamic";

export default async function RelationPubliquePage() {
  const { role, session } = await requirePageModuleAccess("dao", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  const [folders, allUsers] = await Promise.all([
    prisma.bidFolder.findMany({
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
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  type BidStatus = "IN_PROGRESS" | "SUBMITTED" | "WON" | "LOST" | "CANCELLED";

  const serializedFolders = folders.map((folder) => ({
    ...folder,
    deadline: folder.deadline?.toISOString() ?? null,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
    status: folder.status as BidStatus,
    documents: folder.documents.map((doc) => ({
      ...doc,
      createdAt: doc.createdAt.toISOString(),
    })),
  }));

  const canManageAll = role === "ADMIN" || role === "DIRECTEUR_GENERAL";

  return (
    <AppShell
      role={role}
      accessNote={
        canManageAll
          ? "Accès complet à tous les dossiers d'appels d'offres. Vous pouvez créer, modifier et suivre tous les dossiers."
          : "Espace de travail dédié aux appels d'offres (DAO). Créez vos dossiers, définissez les exigences et suivez le taux de complétude."
      }
    >
      <BidWorkspace
        initialFolders={serializedFolders}
        allUsers={allUsers}
        canManageAll={canManageAll}
        currentUserId={session.user.id}
      />
    </AppShell>
  );
}
