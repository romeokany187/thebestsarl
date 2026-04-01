import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { cashOperationCreateSchema } from "@/lib/validators";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";

const cashOperationClient = (prisma as unknown as { cashOperation: any }).cashOperation;

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (access.role === "ADMIN" || access.role === "DIRECTEUR_GENERAL") {
    return NextResponse.json({ error: "Admin et Direction Générale ont un accès lecture seule sur les écritures de caisse." }, { status: 403 });
  }

  if (access.session.user.jobTitle !== "CAISSIERE") {
    return NextResponse.json({ error: "Seule la caissière est autorisée à enregistrer les opérations de caisse." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = cashOperationCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  const operation = await cashOperationClient.create({
    data: {
      occurredAt: data.occurredAt ?? new Date(),
      direction: data.direction,
      category: data.category,
      amount: data.amount,
      currency: (data.currency ?? "USD").toUpperCase(),
      method: data.method,
      reference: data.reference,
      description: data.description,
      createdById: access.session.user.id,
    },
    select: {
      id: true,
      occurredAt: true,
      direction: true,
      category: true,
      amount: true,
      currency: true,
      method: true,
      reference: true,
      description: true,
      createdById: true,
    },
  });

  const accountants = await prisma.user.findMany({
    where: {
      id: { not: access.session.user.id },
      OR: [{ role: "ACCOUNTANT" }, { jobTitle: "COMPTABLE" }],
    },
    select: { id: true, name: true, email: true },
    take: 200,
  });

  if (accountants.length > 0) {
    await prisma.userNotification.createMany({
      data: accountants.map((user) => ({
        userId: user.id,
        title: `Nouvelle opération de caisse ${operation.direction === "INFLOW" ? "(entrée)" : "(sortie)"}`,
        message: `${operation.amount.toFixed(2)} ${operation.currency} • ${operation.category} • ${operation.description}`,
        type: "CASH_OPERATION_ENTRY",
        metadata: {
          cashOperationId: operation.id,
          direction: operation.direction,
          category: operation.category,
          amount: operation.amount,
          currency: operation.currency,
          method: operation.method,
          reference: operation.reference,
          description: operation.description,
          actorId: access.session.user.id,
          actorName: access.session.user.name ?? "Caissiere",
          source: "CASH_LEDGER",
        },
      })),
    });

    if (isMailConfigured()) {
      try {
        const appUrl = process.env.NEXTAUTH_URL?.trim() || "";
        const paymentsUrl = appUrl ? `${appUrl}/payments` : "/payments";

        await sendMailBatch({
          recipients: accountants.map((user) => ({ email: user.email, name: user.name })),
          subject: `Notification comptable - Opération de caisse ${operation.direction === "INFLOW" ? "Entrée" : "Sortie"}`,
          text: [
            "THEBEST SARL - Ecriture de caisse",
            "",
            `Date opération: ${new Date(operation.occurredAt).toLocaleString("fr-FR")}`,
            `Type: ${operation.direction}`,
            `Catégorie: ${operation.category}`,
            `Montant: ${operation.amount.toFixed(2)} ${operation.currency}`,
            `Méthode: ${operation.method}`,
            `Référence: ${operation.reference ?? "-"}`,
            `Libellé: ${operation.description}`,
            `Saisi par: ${access.session.user.name ?? "Caissiere"}`,
            "",
            `Consulter: ${paymentsUrl}`,
          ].join("\n"),
          html: `
            <p><strong>THEBEST SARL - Ecriture de caisse</strong></p>
            <p><strong>Date opération:</strong> ${new Date(operation.occurredAt).toLocaleString("fr-FR")}<br/>
            <strong>Type:</strong> ${operation.direction}<br/>
            <strong>Catégorie:</strong> ${operation.category}<br/>
            <strong>Montant:</strong> ${operation.amount.toFixed(2)} ${operation.currency}<br/>
            <strong>Méthode:</strong> ${operation.method}<br/>
            <strong>Référence:</strong> ${operation.reference ?? "-"}<br/>
            <strong>Libellé:</strong> ${operation.description}<br/>
            <strong>Saisi par:</strong> ${access.session.user.name ?? "Caissière"}</p>
            <p><a href="${paymentsUrl}">Ouvrir le module comptabilité caisse</a></p>
          `,
          replyTo: access.session.user.email ?? undefined,
        });
      } catch (mailError) {
        console.error("[cash-operations.create] Echec envoi email comptable", {
          cashOperationId: operation.id,
          error: mailError instanceof Error ? mailError.message : "Erreur inconnue",
        });
      }
    }
  }

  return NextResponse.json({ data: operation }, { status: 201 });
}
