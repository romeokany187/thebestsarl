import { AppShell } from "@/components/app-shell";
import { authOptions } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requirePageRoles } from "@/lib/rbac";
import { getServerSession } from "next-auth";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const session = await getServerSession(authOptions);

  const user = session?.user?.email
    ? await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { team: true },
      })
    : null;

  return (
    <AppShell role={role} accessNote="Profil connecté: informations du compte actif et rôle d'accès.">
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Mon profil</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Voici l&apos;identité actuellement connectée et ses permissions dans la plateforme.
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
    </AppShell>
  );
}
