/**
 * Script: dedup-airlines.ts
 * Nettoie les doublons de compagnies créés lors des imports Excel.
 * Le script fusionne les variantes connues vers une compagnie canonique,
 * réaffecte les billets, transfère/supprime les règles de commission puis supprime les doublons.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Group = {
  label: string;
  preferredCodes: string[];
  matches: (code: string, normalizedName: string) => boolean;
};

type AirlineWithCounts = {
  id: string;
  code: string;
  name: string;
  _count: { tickets: number; commissionRules: number };
};

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function candidateScore(airline: AirlineWithCounts, group: Group) {
  const hasPreferredCode = group.preferredCodes.includes(airline.code.toUpperCase()) ? 1 : 0;
  return hasPreferredCode * 1_000_000 + airline._count.commissionRules * 10_000 + airline._count.tickets;
}

const groups: Group[] = [
  {
    label: "Air Congo",
    preferredCodes: ["ACG"],
    matches: (code, name) =>
      name.includes("aircong") || name.includes("aircingo") || code === "AIR" || /^AI\d+$/.test(code),
  },
  {
    label: "Ethiopian Airlines",
    preferredCodes: ["ET", "ETH"],
    matches: (code, name) => name.includes("ethi") || /^ET\d*$/.test(code) || code === "ETH" || code === "ETI",
  },
  {
    label: "Kenya Airways",
    preferredCodes: ["KQ"],
    matches: (code, name) => name.includes("kenya") || /^KQ\d*$/.test(code) || /^KE\d+$/.test(code) || code === "KEN",
  },
  {
    label: "Mont Gabaon",
    preferredCodes: ["MGB"],
    matches: (code, name) => name.includes("montgabaon") || code === "MGB" || code === "MG",
  },
  {
    label: "CAA",
    preferredCodes: ["CAA"],
    matches: (code, name) => name === "caa" || /^CAA+$/.test(code) || /^CA\d+$/.test(code),
  },
  {
    label: "Dakota",
    preferredCodes: ["DKT"],
    matches: (code, name) => name.includes("dakota") || code === "DKT" || code === "DAK",
  },
  {
    label: "Rwanda Air",
    preferredCodes: ["WB"],
    matches: (code, name) => name.includes("rwanda") || /^WB\d*$/.test(code),
  },
  {
    label: "Uganda Air",
    preferredCodes: ["UR"],
    matches: (code, name) => name.includes("uganda") || /^UR\d*$/.test(code) || code === "UGA",
  },
  {
    label: "Air Tanzania",
    preferredCodes: ["TC"],
    matches: (code, name) => name.includes("tanzania") || /^TC\d*$/.test(code) || code === "TAN",
  },
];

async function main() {
  // 1. Lister toutes les compagnies
  const allAirlines = await prisma.airline.findMany({
    include: { _count: { select: { tickets: true, commissionRules: true } } },
    orderBy: { name: "asc" },
  });

  console.log("\n--- Toutes les compagnies ---");
  for (const a of allAirlines) {
    console.log(
      `  code=${a.code.padEnd(10)} name=${a.name.padEnd(25)} tickets=${a._count.tickets} rules=${a._count.commissionRules}`,
    );
  }

  let totalReassigned = 0;
  let totalRulesDeleted = 0;
  let totalRulesTransferred = 0;
  let totalDuplicatesDeleted = 0;

  // 2. Traiter chaque famille de doublons connue
  for (const group of groups) {
    const members = allAirlines.filter((a) => {
      const code = a.code.toUpperCase();
      const normalizedName = normalizeName(a.name);
      return group.matches(code, normalizedName);
    });

    if (members.length <= 1) {
      continue;
    }

    const sorted = [...members].sort((a, b) => candidateScore(b, group) - candidateScore(a, group));
    const canonical = sorted[0];
    const duplicates = sorted.slice(1);

    console.log(`\nFamille: ${group.label}`);
    console.log(`  Canonique: code=${canonical.code}, name=${canonical.name}, tickets=${canonical._count.tickets}, rules=${canonical._count.commissionRules}`);

    for (const dup of duplicates) {
      console.log(`  -> doublon code=${dup.code}, name=${dup.name}, tickets=${dup._count.tickets}, rules=${dup._count.commissionRules}`);

      const reassigned = await prisma.ticketSale.updateMany({
        where: { airlineId: dup.id },
        data: { airlineId: canonical.id },
      });
      totalReassigned += reassigned.count;

      if (canonical._count.commissionRules === 0 && dup._count.commissionRules > 0) {
        const movedRules = await prisma.commissionRule.updateMany({
          where: { airlineId: dup.id },
          data: { airlineId: canonical.id },
        });
        totalRulesTransferred += movedRules.count;
      } else {
        const rulesDeleted = await prisma.commissionRule.deleteMany({
          where: { airlineId: dup.id },
        });
        totalRulesDeleted += rulesDeleted.count;
      }

      await prisma.airline.delete({ where: { id: dup.id } });
      totalDuplicatesDeleted++;
      console.log(`    Réaffecté ${reassigned.count} billet(s), puis supprimé ${dup.code}`);
    }
  }

  if (totalDuplicatesDeleted === 0) {
    console.log("\nAucun doublon détecté dans les familles ciblées. Base déjà propre.");
    return;
  }

  // 3. Résumé final
  console.log("\n✓ Nettoyage terminé:");
  console.log(`  - ${totalDuplicatesDeleted} doublon(s) supprimé(s)`);
  console.log(`  - ${totalReassigned} billet(s) réaffecté(s) vers les compagnies canoniques`);
  console.log(`  - ${totalRulesTransferred} règle(s) de commission transférée(s)`);
  console.log(`  - ${totalRulesDeleted} règle(s) de commission supprimée(s)`);

  // 4. Vérification finale par code canonique
  const trackedCanonicals = ["ACG", "ET", "ETH", "KQ", "MGB", "CAA", "DKT", "WB", "UR", "TC"];
  const finalState = await prisma.airline.findMany({
    where: { code: { in: trackedCanonicals } },
    include: { _count: { select: { tickets: true, commissionRules: true } } },
    orderBy: { code: "asc" },
  });

  console.log("\nÉtat final des codes canoniques suivis:");
  for (const airline of finalState) {
    console.log(`  code=${airline.code} name=${airline.name} tickets=${airline._count.tickets} rules=${airline._count.commissionRules}`);
  }
}

main()
  .catch((error) => {
    console.error("Erreur:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
