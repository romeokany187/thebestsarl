import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { requirePageRoles } from "@/lib/rbac";

type PageContext = {
  params: Promise<{ id: string }>;
};

function statusLabel(status: string) {
  if (status === "SUBMITTED") return "Soumis";
  if (status === "APPROVED") return "Approuvé";
  if (status === "REJECTED") return "Rejeté";
  return "Brouillon";
}

function formatDate(value: Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export const dynamic = "force-dynamic";

export default async function NeedReadPage(context: PageContext) {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const { id } = await context.params;

  const need = await prisma.needRequest.findUnique({
    where: { id },
    include: {
      requester: { select: { id: true, name: true, email: true, jobTitle: true } },
      reviewedBy: { select: { id: true, name: true, role: true } },
    },
  });

  if (!need) notFound();

  return (
    <AppShell role={role} accessNote="Lecture d'état de besoin avec impression PDF disponible pour tous les profils." >
      <section className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lecture de l&apos;état de besoin</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Référence: EDB-{need.id.slice(0, 8).toUpperCase()} • Statut: {statusLabel(need.status)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/procurement/needs/${need.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-black/20 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Lire en PDF
          </a>
          <a
            href={`/api/procurement/needs/${need.id}/pdf?download=1`}
            className="rounded-md border border-black/20 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Télécharger PDF
          </a>
          <Link
            href="/approvisionnement"
            className="rounded-md border border-black/20 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Retour
          </Link>
        </div>
      </section>

      <article className="rounded-xl border border-black/10 bg-white p-5 text-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">{need.title}</h2>
        <p className="mt-1 text-black/70 dark:text-white/70">{need.category} • {need.quantity} {need.unit}</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <p><span className="font-semibold">Demandeur:</span> {need.requester.name} ({need.requester.jobTitle})</p>
          <p><span className="font-semibold">Email:</span> {need.requester.email}</p>
          <p><span className="font-semibold">Soumis le:</span> {formatDate(need.submittedAt)}</p>
          <p><span className="font-semibold">Validé par:</span> {need.reviewedBy?.name ?? "-"}</p>
          <p><span className="font-semibold">Date validation:</span> {formatDate(need.approvedAt ?? need.reviewedAt)}</p>
          <p><span className="font-semibold">Sceau:</span> {need.sealedAt ? `Scellé le ${formatDate(need.sealedAt)}` : "Non scellé"}</p>
        </div>

        <section className="mt-4">
          <h3 className="font-semibold">Articles demandés</h3>
          <p className="mt-1 whitespace-pre-wrap text-black/75 dark:text-white/75">{need.details}</p>
        </section>

        {typeof need.estimatedAmount === "number" ? (
          <section className="mt-4">
            <h3 className="font-semibold">Montant estimatif</h3>
            <p className="mt-1 text-black/80 dark:text-white/80">
              {new Intl.NumberFormat("fr-FR").format(need.estimatedAmount)} {need.currency ?? "XAF"}
            </p>
          </section>
        ) : null}

        <section className="mt-4">
          <h3 className="font-semibold">Commentaire Direction / Finance</h3>
          <p className="mt-1 whitespace-pre-wrap text-black/75 dark:text-white/75">{need.reviewComment?.trim() || "-"}</p>
        </section>
      </article>
    </AppShell>
  );
}
