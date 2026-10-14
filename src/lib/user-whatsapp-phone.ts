import { prisma } from "@/lib/prisma";

function isMySqlFamilyDatabase() {
  const databaseUrl = process.env.DATABASE_URL?.trim().toLowerCase() ?? "";
  return databaseUrl.startsWith("mysql://") || databaseUrl.startsWith("mariadb://");
}

/** Ajoute la colonne whatsappPhone en prod MySQL sans migration Prisma dédiée. */
export async function ensureUserWhatsappPhoneColumn() {
  if (!isMySqlFamilyDatabase()) {
    return;
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`User\`
      ADD COLUMN \`whatsappPhone\` VARCHAR(32) NULL
    `);
  } catch {
    // Colonne déjà présente.
  }
}

/** Numéro WhatsApp API Meta : chiffres uniquement, indicatif pays (ex. 243…). */
export function normalizeWhatsappPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("243") && digits.length >= 11) {
    return digits.slice(0, 12);
  }
  if (digits.startsWith("0") && digits.length >= 9) {
    return `243${digits.slice(1)}`;
  }
  if (digits.length === 9) {
    return `243${digits}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return digits;
  }

  return null;
}

export function formatWhatsappPhoneHint(value: string | null | undefined) {
  const normalized = normalizeWhatsappPhone(value);
  if (!normalized) return null;
  return `+${normalized}`;
}
