import { prisma } from "@/lib/prisma";

export type ModuleAccessLevel = "READ" | "WRITE" | "FULL";

export type AuthorizationModule =
  | "home"
  | "dashboard"
  | "admin"
  | "teams"
  | "profile"
  | "reports"
  | "attendance"
  | "sales"
  | "tickets"
  | "invoices"
  | "payments"
  | "procurement"
  | "archives"
  | "news"
  | "settings"
  | "audit";

export const AUTHORIZATION_MODULE_OPTIONS: Array<{ value: AuthorizationModule; label: string }> = [
  { value: "dashboard", label: "Dashboard" },
  { value: "sales", label: "Ventes" },
  { value: "tickets", label: "Billets" },
  { value: "invoices", label: "Factures" },
  { value: "payments", label: "Paiements / Comptabilite" },
  { value: "procurement", label: "Approvisionnement" },
  { value: "reports", label: "Rapports" },
  { value: "attendance", label: "Presences" },
  { value: "teams", label: "Equipes" },
  { value: "archives", label: "Archives" },
  { value: "news", label: "Nouvelles" },
  { value: "settings", label: "Parametres" },
  { value: "audit", label: "Audit" },
  { value: "admin", label: "Administration" },
  { value: "home", label: "Accueil" },
  { value: "profile", label: "Profil" },
];

const userModuleAccessClient = (prisma as unknown as { userModuleAccess: any }).userModuleAccess;

function levelRank(level: ModuleAccessLevel) {
  if (level === "FULL") return 3;
  if (level === "WRITE") return 2;
  return 1;
}

function normalizeModule(raw: string): AuthorizationModule | null {
  const value = raw.trim().toLowerCase();
  const found = AUTHORIZATION_MODULE_OPTIONS.find((item) => item.value === value);
  return found?.value ?? null;
}

function normalizeLevel(raw: string): ModuleAccessLevel | null {
  const value = raw.trim().toUpperCase();
  if (value === "READ" || value === "WRITE" || value === "FULL") return value;
  return null;
}

export function hasRequiredModuleAccessLevel(
  level: ModuleAccessLevel | null | undefined,
  required: ModuleAccessLevel,
) {
  if (!level) return false;
  return levelRank(level) >= levelRank(required);
}

export async function ensureUserModuleAccessTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`UserModuleAccess\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NOT NULL,
      \`module\` VARCHAR(191) NOT NULL,
      \`accessLevel\` VARCHAR(191) NOT NULL DEFAULT 'READ',
      \`createdById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`UserModuleAccess_userId_module_key\` (\`userId\`, \`module\`),
      KEY \`UserModuleAccess_userId_idx\` (\`userId\`),
      KEY \`UserModuleAccess_module_idx\` (\`module\`),
      KEY \`UserModuleAccess_createdById_idx\` (\`createdById\`)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

export async function getUserModuleAccessMap(userId?: string | null) {
  if (!userId) {
    return {} as Partial<Record<AuthorizationModule, ModuleAccessLevel>>;
  }

  try {
    const rows = await userModuleAccessClient.findMany({
      where: { userId },
      select: { module: true, accessLevel: true },
      take: 500,
    });

    const map: Partial<Record<AuthorizationModule, ModuleAccessLevel>> = {};
    for (const row of rows as Array<{ module: string; accessLevel: string }>) {
      const module = normalizeModule(row.module);
      const level = normalizeLevel(row.accessLevel);
      if (module && level) {
        map[module] = level;
      }
    }
    return map;
  } catch {
    return {} as Partial<Record<AuthorizationModule, ModuleAccessLevel>>;
  }
}
