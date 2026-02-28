import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function readFirstExistingFile(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      return await readFile(path.join(process.cwd(), candidate));
    } catch {
      continue;
    }
  }
  return null;
}

async function embedOptionalImage(pdf: PDFDocument, candidates: string[]) {
  const bytes = await readFirstExistingFile(candidates);
  if (!bytes) return null;

  const lower = candidates[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return pdf.embedJpg(bytes);
  return pdf.embedPng(bytes);
}

function formatDate(value: Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export async function GET(request: NextRequest, context: RouteContext) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const { id } = await context.params;
  const shouldDownload = request.nextUrl.searchParams.get("download") === "1";

  const need = await prisma.needRequest.findUnique({
    where: { id },
    include: {
      requester: { select: { id: true, name: true, jobTitle: true, email: true } },
      reviewedBy: { select: { id: true, name: true, role: true } },
    },
  });

  if (!need) {
    return NextResponse.json({ error: "État de besoin introuvable." }, { status: 404 });
  }

  if (access.role === "EMPLOYEE" && need.requesterId !== access.session.user.id) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([595, 842]);

  const montserratRegular = await readFirstExistingFile([
    "public/fonts/Montserrat-Regular.ttf",
    "public/branding/fonts/Montserrat-Regular.ttf",
  ]);
  const montserratBold = await readFirstExistingFile([
    "public/fonts/Montserrat-Bold.ttf",
    "public/branding/fonts/Montserrat-Bold.ttf",
  ]);

  if (!montserratRegular || !montserratBold) {
    return NextResponse.json({ error: "Polices Montserrat introuvables sur le serveur." }, { status: 500 });
  }

  const regularFont = await pdf.embedFont(montserratRegular);
  const boldFont = await pdf.embedFont(montserratBold);

  const logo = await embedOptionalImage(pdf, [
    "public/logo thebest.png",
    "public/branding/logo thebest.png",
    "public/logo.png",
    "public/branding/logo.png",
  ]);

  const signature = await embedOptionalImage(pdf, [
    "public/signature.png",
    "public/branding/signature.png",
  ]);

  const stamp = await embedOptionalImage(pdf, [
    "public/cachet.png",
    "public/branding/cachet.png",
  ]);

  const brandBlue = rgb(0.07, 0.2, 0.47);

  if (logo) {
    const logoScaled = logo.scale(0.26);
    page.drawImage(logo, {
      x: 38,
      y: 744,
      width: Math.min(170, logoScaled.width),
      height: Math.min(70, logoScaled.height),
    });
  }

  page.drawText("THE BEST SARL", {
    x: 220,
    y: 785,
    size: 16,
    font: boldFont,
    color: brandBlue,
  });

  page.drawText("ÉTAT DE BESOIN - APPROVISIONNEMENT", {
    x: 220,
    y: 765,
    size: 10,
    font: regularFont,
    color: brandBlue,
  });

  page.drawLine({
    start: { x: 38, y: 742 },
    end: { x: 557, y: 742 },
    thickness: 1,
    color: rgb(0.84, 0.87, 0.95),
  });

  page.drawText(`Réf: EDB-${need.id.slice(0, 8).toUpperCase()}`, {
    x: 38,
    y: 712,
    size: 10,
    font: regularFont,
    color: rgb(0.2, 0.2, 0.2),
  });

  page.drawText(`Statut: ${need.status}`, {
    x: 400,
    y: 712,
    size: 10,
    font: boldFont,
    color: need.status === "APPROVED" ? rgb(0.07, 0.5, 0.23) : rgb(0.48, 0.38, 0.05),
  });

  const details = [
    ["Objet", need.title],
    ["Catégorie", need.category],
    ["Quantité", `${need.quantity} ${need.unit}`],
    ["Demandeur", `${need.requester.name} (${need.requester.jobTitle})`],
    ["Soumis le", formatDate(need.submittedAt)],
    ["Validé par", need.reviewedBy?.name ?? "-"],
    ["Date validation", formatDate(need.approvedAt ?? need.reviewedAt)],
  ] as const;

  let y = 680;
  for (const [label, value] of details) {
    page.drawText(`${label}:`, {
      x: 38,
      y,
      size: 10,
      font: boldFont,
      color: rgb(0.18, 0.18, 0.18),
    });
    page.drawText(value, {
      x: 165,
      y,
      size: 10,
      font: regularFont,
      color: rgb(0.22, 0.22, 0.22),
    });
    y -= 22;
  }

  page.drawText("Détails du besoin:", {
    x: 38,
    y: 520,
    size: 10,
    font: boldFont,
    color: rgb(0.18, 0.18, 0.18),
  });

  const wrapText = (text: string, maxChars = 92) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > maxChars) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const lines = wrapText(need.details || "-");
  let detailY = 500;
  lines.slice(0, 12).forEach((line) => {
    page.drawText(line, {
      x: 38,
      y: detailY,
      size: 10,
      font: regularFont,
      color: rgb(0.25, 0.25, 0.25),
    });
    detailY -= 16;
  });

  page.drawLine({
    start: { x: 38, y: 230 },
    end: { x: 557, y: 230 },
    thickness: 0.8,
    color: rgb(0.86, 0.86, 0.86),
  });

  page.drawText("Validation Direction / Finance", {
    x: 38,
    y: 210,
    size: 10,
    font: boldFont,
    color: rgb(0.22, 0.22, 0.22),
  });

  page.drawText(
    need.reviewComment?.trim() ? `Commentaire: ${need.reviewComment}` : "Commentaire: -",
    {
      x: 38,
      y: 192,
      size: 9,
      font: regularFont,
      color: rgb(0.3, 0.3, 0.3),
    },
  );

  if (need.status === "APPROVED" && need.sealedAt) {
    if (signature) {
      const sigScale = signature.scale(0.27);
      page.drawImage(signature, {
        x: 360,
        y: 96,
        width: Math.min(160, sigScale.width),
        height: Math.min(80, sigScale.height),
      });
    }

    if (stamp) {
      const stampScale = stamp.scale(0.3);
      page.drawImage(stamp, {
        x: 300,
        y: 78,
        width: Math.min(120, stampScale.width),
        height: Math.min(120, stampScale.height),
        opacity: 0.95,
      });
    }

    page.drawText(`Document scellé le ${formatDate(need.sealedAt)}`, {
      x: 38,
      y: 136,
      size: 9,
      font: boldFont,
      color: rgb(0.07, 0.42, 0.2),
    });
  } else {
    page.drawText("Document non scellé (en attente d'approbation).", {
      x: 38,
      y: 136,
      size: 9,
      font: regularFont,
      color: rgb(0.58, 0.45, 0.08),
    });
  }

  page.drawText(`Imprimé par: ${access.session.user.name} • ${formatDate(new Date())}`, {
    x: 38,
    y: 26,
    size: 8,
    font: regularFont,
    color: rgb(0.44, 0.44, 0.44),
  });

  const bytes = await pdf.save();
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename="etat-besoin-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
