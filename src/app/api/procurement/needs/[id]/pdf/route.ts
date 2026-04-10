
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFImage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { parseNeedQuote } from "@/lib/need-lines";

  const drawHeader = (page: import("pdf-lib").PDFPage, continuation = false) => {
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
      color: black,
    });

    page.drawText(`ÉTAT DE BESOIN - APPROVISIONNEMENT${continuation ? " (suite)" : ""}`, {
      x: 220,
      y: 765,
      size: 10.8,
      font: regularFont,
      color: black,
    });

    page.drawLine({
      start: { x: 38, y: 742 },
      end: { x: CONTENT_RIGHT, y: 742 },
      thickness: 1,
      color: rgb(0.84, 0.87, 0.95),
    });
  };

  const drawFooter = (page: import("pdf-lib").PDFPage, pageNumber: number, totalPages: number) => {
    page.drawLine({
      start: { x: CONTENT_LEFT, y: 22 },
      end: { x: CONTENT_RIGHT, y: 22 },
      thickness: 0.6,
      color: rgb(0.83, 0.83, 0.83),
    });

    page.drawText(`Page ${pageNumber}/${totalPages} • Imprimé le ${formatDate(new Date())}`, {
      x: CONTENT_LEFT,
      y: FOOTER_Y,
      size: 8.2,
      font: boldFont,
      color: black,
    });

    const byText = `Par ${access.session.user.name}`;
    const byWidth = boldFont.widthOfTextAtSize(byText, 8.2);
    page.drawText(byText, {
      x: CONTENT_RIGHT - byWidth,
      y: FOOTER_Y,
      size: 8.2,
      font: boldFont,
      color: black,
    });
  };

  const createPage = (continuation = false) => {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(page, continuation);
    pages.push(page);
    return page;
  };

  let page = createPage(false);
  let y = 712;

  const ensureSpace = (requiredHeight: number) => {
    if (y - requiredHeight < 70) {
      page = createPage(true);
      y = 770;
    }
  };

  const drawMetaLine = (label: string, value: string, valueColor = black) => {
    const valueLines = wrapTextByWidth(value, CONTENT_RIGHT - 170, regularFont, 10.2);
    const blockHeight = Math.max(16, valueLines.length * 12 + 4);
    ensureSpace(blockHeight);

    page.drawText(`${label}:`, {
      x: CONTENT_LEFT,
      y,
      size: 10.2,
      font: boldFont,
      color: black,
    });

    valueLines.forEach((line, index) => {
      page.drawText(line, {
        x: 170,
        y: y - (index * 12),
        size: 10.2,
        font: regularFont,
        color: valueColor,
      });
    });

    y -= blockHeight;
  };

  page.drawText(`Réf: ${need.code ?? `EDB-${need.id.slice(0, 8).toUpperCase()}`}`, {
    x: CONTENT_LEFT,
    y,
    size: 10.5,
    font: boldFont,
    color: black,
  });

  page.drawText(`Statut: ${statusLabel}`, {
    x: 378,
    y,
    size: 10.5,
    font: boldFont,
    color: black,
  });
  y -= 18;

  page.drawLine({
    start: { x: CONTENT_LEFT, y: y + 6 },
    end: { x: CONTENT_RIGHT, y: y + 6 },
    thickness: 0.7,
    color: grid,
  });
  y -= 4;

  const details = [
    ["Objet", need.title],
    ["Quantité", `${need.quantity} ${need.unit}`],
    ["Montant estimatif", typeof need.estimatedAmount === "number" ? `${new Intl.NumberFormat("fr-FR").format(need.estimatedAmount)} ${need.currency ?? "XAF"}` : "-"] ,
    ["Demandeur", `${need.requester.name} (${need.requester.jobTitle})`],
    ["Soumis le", formatDate(need.submittedAt)],
    ["Validé par", need.reviewedBy?.name ?? "-"],
    ["Date validation", formatDate(need.approvedAt ?? need.reviewedAt)],
    ["Exécution", executionMovement
      ? formatDate(executionMovement.createdAt)
      : hasExecutionMarker
        ? "Exécuté (validation caisse enregistrée)"
        : "En attente d'exécution"],
    ["Niveau d'urgence", urgencyLabel],
    ["Équipe bénéficiaire", beneficiaryLabel],
    ...(quote?.beneficiaryPersonName ? [["Personne bénéficiaire", quote.beneficiaryPersonName] as const] : []),
  ] as const;

  for (const [label, value] of details) {
    drawMetaLine(label, value);
  }

  y -= 8;

  page.drawText("Articles demandés:", {
    x: CONTENT_LEFT,
    y,
    size: 11,
    font: boldFont,
    color: black,
  });
  y -= 16;

  const drawTableHeader = (targetPage: import("pdf-lib").PDFPage, headerY: number) => {
    const xCols = [CONTENT_LEFT, 68, 185, 365, 418, 484];
    const headers = ["N°", "Désignation", "Description", "Qté", "P.U", "P.T"];
    headers.forEach((header, index) => {
      targetPage.drawText(header, {
        x: xCols[index],
        y: headerY,
        size: 9,
        font: boldFont,
        color: black,
      });
    });
    targetPage.drawLine({
      start: { x: CONTENT_LEFT, y: headerY - 4 },
      end: { x: CONTENT_RIGHT, y: headerY - 4 },
      thickness: 0.7,
      color: grid,
    });
  };

  let detailY = y;
  drawTableHeader(page, detailY);
  detailY -= 20;

  if (quote?.items?.length) {
    const xCols = [CONTENT_LEFT, 68, 185, 365, 418, 484];
    const colWidths = {
      designation: 112,
      description: 168,
    };

    for (const [index, item] of quote.items.entries()) {
      const designationLines = wrapTextByWidth(item.designation, colWidths.designation, boldFont, 9.2);
      const descriptionLines = wrapTextByWidth(item.description || "-", colWidths.description, regularFont, 9.2);
      const rowLineCount = Math.max(designationLines.length, descriptionLines.length, 1);
      const rowHeight = Math.max(34, rowLineCount * 13 + 16);

      if (detailY - rowHeight < FOOTER_BLOCK_TOP + 8) {
        page = createPage(true);
        detailY = 760;
        drawTableHeader(page, detailY);
        detailY -= 20;
      }

      const rowTopY = detailY;
      const rowTextY = rowTopY - 15;

      page.drawText(String(index + 1), { x: xCols[0], y: rowTextY, size: 9.4, font: boldFont, color: black });
      page.drawText(String(item.quantity), { x: xCols[3], y: rowTextY, size: 9.4, font: boldFont, color: black });
      page.drawText(item.unitPrice.toFixed(2), { x: xCols[4], y: rowTextY, size: 9.4, font: boldFont, color: black });
      page.drawText(item.lineTotal.toFixed(2), { x: xCols[5], y: rowTextY, size: 9.4, font: boldFont, color: black });

      for (let lineIndex = 0; lineIndex < rowLineCount; lineIndex += 1) {
        const d1 = designationLines[lineIndex] ?? "";
        const d2 = descriptionLines[lineIndex] ?? "";
        const lineY = rowTextY - (lineIndex * 13);
        if (d1) {
          page.drawText(d1, { x: xCols[1], y: lineY, size: 9.2, font: boldFont, color: black });
        }
        if (d2) {
          page.drawText(d2, { x: xCols[2], y: lineY, size: 9.2, font: regularFont, color: black });
        }
      }

      const rowBottomY = rowTopY - rowHeight;
      page.drawLine({
        start: { x: CONTENT_LEFT, y: rowBottomY },
        end: { x: CONTENT_RIGHT, y: rowBottomY },
        thickness: 0.3,
        color: rgb(0.87, 0.87, 0.87),
      });

      detailY = rowBottomY;
    }

    if (detailY < FOOTER_BLOCK_TOP + 52) {
      page = createPage(true);
      detailY = 760;
    }

    page.drawLine({
      start: { x: CONTENT_LEFT, y: detailY - 10 },
      end: { x: CONTENT_RIGHT, y: detailY - 10 },
      thickness: 0.7,
      color: grid,
    });

    page.drawText(`Total général: ${quote.totalGeneral.toFixed(2)} ${need.currency ?? "XAF"}`, {
      x: 330,
      y: detailY - 22,
      size: 10.8,
      font: boldFont,
      color: black,
    });
    detailY -= 36;
  } else {
    const rawLines = (need.details || "-").split("\n").map((line) => line.trim()).filter(Boolean);
    const normalized = rawLines.length > 0 ? rawLines.map((line) => (line.startsWith("-") || line.startsWith("•") ? line : `• ${line}`)) : ["• -"];
    const lines = normalized.flatMap((line) => wrapTextByWidth(line, 500, boldFont, 9.8));

    for (const line of lines) {
      if (detailY < FOOTER_BLOCK_TOP + 8) {
        page = createPage(true);
        detailY = 760;
      }
      page.drawText(line, {
        x: CONTENT_LEFT,
        y: detailY,
        size: 9.8,
        font: boldFont,
        color: black,
      });
      detailY -= 12;
    }
  }

  if (detailY < FOOTER_BLOCK_TOP + 20) {
    page = createPage(true);
    detailY = 720;
  }

  const drawValidationFooterBlock = (targetPage: import("pdf-lib").PDFPage) => {
    targetPage.drawLine({
      start: { x: CONTENT_LEFT, y: FOOTER_BLOCK_TOP },
      end: { x: CONTENT_RIGHT, y: FOOTER_BLOCK_TOP },
      thickness: 0.8,
      color: rgb(0.8, 0.8, 0.8),
    });

    targetPage.drawText("Validation Direction / Finance", {
      x: CONTENT_LEFT,
      y: FOOTER_BLOCK_TOP - 14,
      size: 10,
      font: boldFont,
      color: black,
    });

    const commentText = need.reviewComment?.trim() ? `Commentaire: ${need.reviewComment}` : "Commentaire: -";
    const commentLines = wrapTextByWidth(commentText, 360, regularFont, 9.2);
    let commentY = FOOTER_BLOCK_TOP - 34;
    commentLines.forEach((line) => {
      targetPage.drawText(line, {
        x: CONTENT_LEFT,
        y: commentY,
        size: 9.2,
        font: boldFont,
        color: black,
      });
      commentY -= 11;
    });

    const sealTextY = 32;
    const sealAnchorY = 20;

    if (need.status === "APPROVED" && need.sealedAt) {
      if (stamp) {
        const stampSize = getContainedSize(stamp, 78, 78, true);
        targetPage.drawImage(stamp, {
          x: 462,
          y: sealAnchorY,
          width: stampSize.width,
          height: stampSize.height,
          opacity: 0.95,
        });
      }

      targetPage.drawText(`Document scellé le ${formatDate(need.sealedAt)}`, {
        x: CONTENT_LEFT,
        y: sealTextY,
        size: 9.2,
        font: boldFont,
        color: black,
      });

      if (executionMovement || hasExecutionMarker) {
        const executionDateLabel = executionMovement
          ? formatDate(executionMovement.createdAt)
          : formatDate(need.sealedAt ?? need.updatedAt);
        targetPage.drawText(`Mention finale: APPROUVÉ ET EXÉCUTÉ (${executionDateLabel})`, {
          x: CONTENT_LEFT,
          y: sealTextY - 12,
          size: 9.2,
          font: boldFont,
          color: black,
        });
      }
    } else {
      targetPage.drawText("Document non scellé (en attente d'approbation).", {
        x: CONTENT_LEFT,
        y: sealTextY,
        size: 9.2,
        font: boldFont,
        color: black,
      });
    }
  };

  drawValidationFooterBlock(page);

  const allPages = pdf.getPages();
  allPages.forEach((p, index) => {
    drawFooter(p, index + 1, allPages.length);
  });

  const bytes = await pdf.save();
  const body = Buffer.from(bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename=etat-besoin-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
