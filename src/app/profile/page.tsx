import { AppShell } from "@/components/app-shell";
import { ProcurementInboxActions } from "@/components/procurement-inbox-actions";
import { authOptions } from "@/auth";
import { assignmentCapabilities, jobTitleLabel } from "@/lib/assignment";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { getServerSession } from "next-auth";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { role, session: roleSession } = await requirePageModuleAccess("profile", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const session = await getServerSession(authOptions);
  const userId = roleSession.user.id;
  const currentJobTitle = roleSession.user.jobTitle ?? "AGENT_TERRAIN";
  const capabilities = assignmentCapabilities(currentJobTitle);
  const canValidateNeedsFromInbox = role === "ADMIN"
    || ["DIRECTION_GENERALE", "CAISSIERE", "COMPTABLE", "AUDITEUR"].includes(currentJobTitle);

  const user = session?.user?.email
    ? await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { team: true },
      })
    : null;

  const [notifications, latestLogs] = await Promise.all([
    prisma.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.auditLog.findMany({
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  return (
    <AppShell role={role} accessNote="Profil connecté et inbox: informations du compte, notifications et activité récente.">
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Profil & Inbox</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Voici l&apos;identité connectée, ses permissions, notifications et événements récents.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Compte connecté</h2>
          <ul className="mt-3 space-y-2 text-sm text-black/75 dark:text-white/75">
            <li><span className="font-semibold">Nom :</span> {session?.user?.name ?? "-"}</li>
            <li><span className="font-semibold">Email :</span> {session?.user?.email ?? "-"}</li>
            <li><span className="font-semibold">Rôle :</span> {role}</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Enregistrement BDD</h2>
          <ul className="mt-3 space-y-2 text-sm text-black/75 dark:text-white/75">
            <li><span className="font-semibold">ID utilisateur :</span> {user?.id ?? "Non trouvé"}</li>
            <li><span className="font-semibold">Équipe :</span> {user?.team?.name ?? "Sans équipe"}</li>
            <li><span className="font-semibold">Créé le :</span> {user?.createdAt ? new Date(user.createdAt).toLocaleString() : "-"}</li>
          </ul>
        </section>
      </div>

      <section className="mb-4 mt-6 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Fonction actuelle: {jobTitleLabel(currentJobTitle)}</h2>
        <ul className="mt-3 flex flex-wrap gap-2 text-xs">
          {capabilities.map((capability) => (
            <li key={capability} className="rounded-full border border-black/15 bg-black/5 px-2.5 py-1 font-medium dark:border-white/20 dark:bg-white/10">
              {capability}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold">Mes notifications</h2>
          <ul className="space-y-3 text-sm">
            {notifications.length > 0 ? (
              notifications.map((notification) => (
                <li key={notification.id} className="rounded-xl border border-black/10 px-3 py-3 dark:border-white/10">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{notification.title}</p>
                    <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">
                      {notification.type}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-black/70 dark:text-white/70">{notification.message}</p>
                  {(() => {
                    const metadata = (notification.metadata ?? null) as { needRequestId?: string } | null;
                    const needRequestId = typeof metadata?.needRequestId === "string"
                      ? metadata.needRequestId
                      : null;

                    if (!needRequestId) return null;

                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <a
                          href={`/api/procurement/needs/${needRequestId}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                        >
                          Lire PDF EDB
                        </a>
                      </div>
                    );
                  })()}
                  {(() => {
                    const metadata = (notification.metadata ?? null) as { needRequestId?: string; needStatus?: string } | null;
                    const needRequestId = typeof metadata?.needRequestId === "string"
                      ? metadata.needRequestId
                      : null;
                    const needStatus = typeof metadata?.needStatus === "string"
                      ? metadata.needStatus
                      : null;

                    if (!canValidateNeedsFromInbox || !needRequestId || notification.type !== "PROCUREMENT_APPROVAL") {
                      return null;
                    }

                    if (needStatus && needStatus !== "SUBMITTED") {
                      return <p className="mt-2 text-[11px] text-black/55 dark:text-white/55">Statut actuel: {needStatus}</p>;
                    }

                    return <ProcurementInboxActions needRequestId={needRequestId} />;
                  })()}
                  <p className="mt-1 text-[11px] text-black/50 dark:text-white/50">{new Date(notification.createdAt).toLocaleString()}</p>
                </li>
              ))
            ) : (
              <li className="rounded-xl border border-black/10 px-3 py-3 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
                Aucune notification pour le moment.
              </li>
            )}
          </ul>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold">Journal d&apos;activité</h2>
          <ul className="space-y-3 text-sm">
            {latestLogs.map((log) => (
              <li key={log.id} className="rounded-xl border border-black/10 px-3 py-3 dark:border-white/10">
                <p className="font-medium">{log.action}</p>
                <p className="text-xs text-black/60 dark:text-white/60">{log.actor.name} • {new Date(log.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
