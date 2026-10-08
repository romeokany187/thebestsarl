import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { requirePageRoles } from "@/lib/rbac";
import { parseNeedQuote } from "@/lib/need-lines";
import { workflowAssignmentLabel } from "@/lib/workflow-assignment";

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
      stockMovements: {
        where: { movementType: "OUT" },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!need) notFound();
  const quote = parseNeedQuote(need.details);
  const hasExecutionMarker = (need.reviewComment ?? "").includes("EXECUTION_CAISSE:");
  const executedMovement = need.stockMovements[0] ?? null;
  const displayStatus = need.status === "APPROVED" && (executedMovement || hasExecutionMarker)
    ? "Approuvé et exécuté"
    : statusLabel(need.status);
  const urgencyLabel = quote?.urgencyLevel === "CRITIQUE"
    ? "Critique"
    : quote?.urgencyLevel === "ELEVEE"
      ? "Élevée"
      : quote?.urgencyLevel === "NORMALE"
        ? "Normale"
        : quote?.urgencyLevel === "FAIBLE"
          ? "Faible"
          : "-";
  const beneficiaryLabel = quote?.beneficiaryTeam === "KINSHASA"
    ? "Kinshasa"
    : quote?.beneficiaryTeam === "LUBUMBASHI"
      ? "Lubumbashi"
      : quote?.beneficiaryTeam === "MBUJIMAYI"
        ? "Mbujimayi"
        : "-";

  return (
    <AppShell role={role} >
      <section className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{need.title}</h1>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/procurement/needs/${need.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-black/20 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            PDF
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
        <p className="text-xs font-mono text-blue-700 dark:text-blue-400">{need.code ?? need.id.slice(0, 8)}</p>
        <p className="mt-2 rounded-full border border-black/15 inline-block px-2 py-0.5 text-xs font-semibold dark:border-white/20">{displayStatus}</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <p><span className="font-semibold">Demandeur:</span> {need.requester.name} ({need.requester.jobTitle})</p>
          <p><span className="font-semibold">Email:</span> {need.requester.email}</p>
          <p><span className="font-semibold">Soumis le:</span> {formatDate(need.submittedAt)}</p>
          <p><span className="font-semibold">Validé par:</span> {need.reviewedBy?.name ?? "-"}</p>
          <p><span className="font-semibold">Date validation:</span> {formatDate(need.approvedAt ?? need.reviewedAt)}</p>
          <p><span className="font-semibold">Sceau:</span> {need.sealedAt ? `Scellé le ${formatDate(need.sealedAt)}` : "Non scellé"}</p>
          <p><span className="font-semibold">Exécution:</span> {executedMovement
            ? `Exécuté le ${formatDate(executedMovement.createdAt)}`
            : hasExecutionMarker
              ? "Exécuté (validation caisse enregistrée)"
              : "En attente d'exécution"}</p>
          <p><span className="font-semibold">Niveau d&apos;urgence:</span> {urgencyLabel}</p>
          <p><span className="font-semibold">Affectation:</span> {workflowAssignmentLabel(quote?.assignment)}</p>
          <p><span className="font-semibold">Équipe bénéficiaire:</span> {beneficiaryLabel}</p>
          {quote?.beneficiaryPersonName && (
            <p><span className="font-semibold">Personne bénéficiaire:</span> {quote.beneficiaryPersonName}</p>
          )}
        </div>

        <section className="mt-4">
          <h3 className="font-semibold">Lignes</h3>
          {quote?.items?.length ? (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-black/5 dark:bg-white/10">
                  <tr>
                    <th className="px-2 py-2 text-left">N°</th>
                    <th className="px-2 py-2 text-left">Désignation</th>
                    <th className="px-2 py-2 text-left">Description</th>
                    <th className="px-2 py-2 text-left">Quantité</th>
                    <th className="px-2 py-2 text-left">Prix unitaire</th>
                    <th className="px-2 py-2 text-left">Prix total</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.items.map((line, index) => (
                    <tr key={`${need.id}-quote-line-${index}`} className="border-t border-black/10 dark:border-white/10">
                      <td className="px-2 py-2">{index + 1}</td>
                      <td className="px-2 py-2">{line.designation}</td>
                      <td className="px-2 py-2">{line.description || "-"}</td>
                      <td className="px-2 py-2">{line.quantity}</td>
                      <td className="px-2 py-2">{line.unitPrice.toFixed(2)} {need.currency ?? "XAF"}</td>
                      <td className="px-2 py-2">{line.lineTotal.toFixed(2)} {need.currency ?? "XAF"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-sm font-semibold">
                Total général: {quote.totalGeneral.toFixed(2)} {need.currency ?? "XAF"}
              </p>
            </div>
          ) : (
            <p className="mt-1 whitespace-pre-wrap text-black/75 dark:text-white/75">{need.details}</p>
          )}
        </section>

        {typeof need.estimatedAmount === "number" ? (
          <p className="mt-4 font-semibold">
            Total : {new Intl.NumberFormat("fr-FR").format(need.estimatedAmount)} {need.currency ?? "XAF"}
          </p>
        ) : null}

        {need.reviewComment?.trim() ? (
          <section className="mt-4">
            <h3 className="font-semibold">Commentaire</h3>
            <p className="mt-1 whitespace-pre-wrap text-black/75 dark:text-white/75">{need.reviewComment.trim()}</p>
          </section>
        ) : null}
      </article>
    </AppShell>
  );
}
