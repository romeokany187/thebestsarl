import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { JobTitle, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

export async function POST() {
  const access = await requireApiRoles(["ADMIN"]);
  if (access.error) return access.error;

  const passwordHash = await bcrypt.hash("password123", 10);

  const operationsTeam = await prisma.team.upsert({
    where: { name: "Operations" },
    update: {},
    create: { name: "Operations" },
  });

  const adminUser = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, name: true },
  });

  if (!adminUser) {
    return NextResponse.json({ error: "Admin introuvable." }, { status: 404 });
  }

  const procurementOfficer = await prisma.user.upsert({
    where: { email: "appro@thebestsarl.com" },
    update: {
      role: Role.EMPLOYEE,
      jobTitle: JobTitle.APPROVISIONNEMENT_MARKETING,
      teamId: operationsTeam.id,
    },
    create: {
      name: "Chargé Approvisionnement",
      email: "appro@thebestsarl.com",
      passwordHash,
      role: Role.EMPLOYEE,
      jobTitle: JobTitle.APPROVISIONNEMENT_MARKETING,
      teamId: operationsTeam.id,
    },
  });

  const romeooAccount = await prisma.user.findUnique({
    where: { email: "romeoo.thebest@gmail.com" },
    select: { id: true },
  });

  if (romeooAccount) {
    await prisma.user.update({
      where: { id: romeooAccount.id },
      data: {
        jobTitle: JobTitle.APPROVISIONNEMENT_MARKETING,
        teamId: operationsTeam.id,
      },
    });
  }

  const now = new Date();

  const needApproved = await prisma.needRequest.upsert({
    where: { id: "demo-need-approved" },
    update: {
      title: "Achat consommables bureau T1",
      category: "Fournitures de bureau",
      details: "Ramettes A4, stylos, chemises cartonnées, classeurs.",
      quantity: 40,
      unit: "lot",
      status: "APPROVED",
      requesterId: procurementOfficer.id,
      reviewedById: adminUser.id,
      reviewComment: "Besoin validé pour continuité des opérations.",
      submittedAt: now,
      reviewedAt: now,
      approvedAt: now,
      sealedAt: now,
    },
    create: {
      id: "demo-need-approved",
      title: "Achat consommables bureau T1",
      category: "Fournitures de bureau",
      details: "Ramettes A4, stylos, chemises cartonnées, classeurs.",
      quantity: 40,
      unit: "lot",
      status: "APPROVED",
      requesterId: procurementOfficer.id,
      reviewedById: adminUser.id,
      reviewComment: "Besoin validé pour continuité des opérations.",
      submittedAt: now,
      reviewedAt: now,
      approvedAt: now,
      sealedAt: now,
    },
  });

  await prisma.needRequest.upsert({
    where: { id: "demo-need-submitted" },
    update: {
      title: "Renouvellement kits imprimante",
      category: "Consommables IT",
      details: "Toners et tambours pour imprimantes administration et caisse.",
      quantity: 12,
      unit: "pièce",
      status: "SUBMITTED",
      requesterId: procurementOfficer.id,
      submittedAt: now,
      reviewedById: null,
      reviewedAt: null,
      approvedAt: null,
      sealedAt: null,
    },
    create: {
      id: "demo-need-submitted",
      title: "Renouvellement kits imprimante",
      category: "Consommables IT",
      details: "Toners et tambours pour imprimantes administration et caisse.",
      quantity: 12,
      unit: "pièce",
      status: "SUBMITTED",
      requesterId: procurementOfficer.id,
      submittedAt: now,
    },
  });

  const paperStock = await prisma.stockItem.upsert({
    where: {
      name_category_unit: {
        name: "Ramette A4",
        category: "Fournitures de bureau",
        unit: "paquet",
      },
    },
    update: {},
    create: {
      name: "Ramette A4",
      category: "Fournitures de bureau",
      unit: "paquet",
      currentQuantity: 0,
    },
  });

  const markerStock = await prisma.stockItem.upsert({
    where: {
      name_category_unit: {
        name: "Marqueur tableau",
        category: "Fournitures de bureau",
        unit: "pièce",
      },
    },
    update: {},
    create: {
      name: "Marqueur tableau",
      category: "Fournitures de bureau",
      unit: "pièce",
      currentQuantity: 0,
    },
  });

  await prisma.stockMovement.upsert({
    where: { id: "demo-mov-in-paper" },
    update: {
      stockItemId: paperStock.id,
      movementType: "IN",
      quantity: 80,
      justification: "Réception achat validé consommables bureau T1",
      referenceDoc: "BL-APPRO-001",
      performedById: procurementOfficer.id,
      needRequestId: needApproved.id,
    },
    create: {
      id: "demo-mov-in-paper",
      stockItemId: paperStock.id,
      movementType: "IN",
      quantity: 80,
      justification: "Réception achat validé consommables bureau T1",
      referenceDoc: "BL-APPRO-001",
      performedById: procurementOfficer.id,
      needRequestId: needApproved.id,
    },
  });

  await prisma.stockMovement.upsert({
    where: { id: "demo-mov-out-paper" },
    update: {
      stockItemId: paperStock.id,
      movementType: "OUT",
      quantity: 15,
      justification: "Sortie pour impression dossiers administratifs",
      referenceDoc: "BS-ADMIN-002",
      performedById: procurementOfficer.id,
    },
    create: {
      id: "demo-mov-out-paper",
      stockItemId: paperStock.id,
      movementType: "OUT",
      quantity: 15,
      justification: "Sortie pour impression dossiers administratifs",
      referenceDoc: "BS-ADMIN-002",
      performedById: procurementOfficer.id,
    },
  });

  await prisma.stockMovement.upsert({
    where: { id: "demo-mov-in-marker" },
    update: {
      stockItemId: markerStock.id,
      movementType: "IN",
      quantity: 30,
      justification: "Entrée stock marqueurs pour salles de briefing",
      referenceDoc: "BL-APPRO-003",
      performedById: procurementOfficer.id,
      needRequestId: needApproved.id,
    },
    create: {
      id: "demo-mov-in-marker",
      stockItemId: markerStock.id,
      movementType: "IN",
      quantity: 30,
      justification: "Entrée stock marqueurs pour salles de briefing",
      referenceDoc: "BL-APPRO-003",
      performedById: procurementOfficer.id,
      needRequestId: needApproved.id,
    },
  });

  await prisma.stockMovement.upsert({
    where: { id: "demo-mov-out-marker" },
    update: {
      stockItemId: markerStock.id,
      movementType: "OUT",
      quantity: 6,
      justification: "Dotation kits formation commerciale",
      referenceDoc: "BS-FORM-001",
      performedById: procurementOfficer.id,
    },
    create: {
      id: "demo-mov-out-marker",
      stockItemId: markerStock.id,
      movementType: "OUT",
      quantity: 6,
      justification: "Dotation kits formation commerciale",
      referenceDoc: "BS-FORM-001",
      performedById: procurementOfficer.id,
    },
  });

  const groupedStock = await prisma.stockMovement.groupBy({
    by: ["stockItemId", "movementType"],
    _sum: { quantity: true },
  });

  const totals = new Map<string, { inQty: number; outQty: number }>();
  groupedStock.forEach((row) => {
    const entry = totals.get(row.stockItemId) ?? { inQty: 0, outQty: 0 };
    if (row.movementType === "IN") {
      entry.inQty = row._sum.quantity ?? 0;
    } else {
      entry.outQty = row._sum.quantity ?? 0;
    }
    totals.set(row.stockItemId, entry);
  });

  await Promise.all(
    Array.from(totals.entries()).map(([stockItemId, value]) =>
      prisma.stockItem.update({
        where: { id: stockItemId },
        data: { currentQuantity: Math.max(value.inQty - value.outQty, 0) },
      }),
    ),
  );

  return NextResponse.json({
    message: "Données de test Approvisionnement injectées.",
    data: {
      procurementOfficer: procurementOfficer.email,
      primaryProcurementAccount: romeooAccount ? "romeoo.thebest@gmail.com" : null,
      approvedNeedId: needApproved.id,
      stockItems: [paperStock.name, markerStock.name],
    },
  });
}
