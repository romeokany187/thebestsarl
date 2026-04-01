/**
 * Script: dedup-airlines.ts
 * Supprime les doublons Air Congo (ACG) créés lors des imports Excel.
 * Garde uniquement la compagnie avec le code exact "ACG" (qui a les règles de commission).
 * Réaffecte tous les billets des doublons vers l'ACG canonique avant suppression.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 1. Trouver la compagnie ACG canonique (code exact "ACG")
  const canonical = await prisma.airline.findUnique({
    where: { code: "ACG" },
    include: {
      commissionRules: { select: { id: true, commissionMode: true, ratePercent: true, isActive: true } },
      _count: { select: { tickets: true } },
    },
  });

  if (!canonical) {
    console.error("ERROR: Compagnie ACG canonique introuvable. Vérifiez le catalogue.");
    process.exit(1);
  }

  console.log(`ACG canonique trouvée: id=${canonical.id}, tickets=${canonical._count.tickets}, rules=${canonical.commissionRules.length}`);

  // 2. Lister TOUTES les compagnies dont le nom ressemble à Air Congo mais dont le code n'est PAS "ACG"
  const allAirlines = await prisma.airline.findMany({
    include: { _count: { select: { tickets: true } } },
    orderBy: { name: "asc" },
  });

  console.log("\n--- Toutes les compagnies ---");
  for (const a of allAirlines) {
    console.log(`  code=${a.code.padEnd(10)} name=${a.name.padEnd(25)} tickets=${a._count.tickets}`);
  }

  const duplicates = allAirlines.filter((a) => {
    if (a.code === "ACG") return false;
    const nameLower = a.name.toLowerCase().replace(/[\s_\-]+/g, "");
    // Couvre toutes les variantes rencontrées dans l'import
    return (
      nameLower.includes("aircong") ||
      nameLower.includes("air-cong") ||
      nameLower.includes("aircingo") ||
      a.code.toUpperCase().startsWith("AI") && nameLower.startsWith("air")
    );
  });

  if (duplicates.length === 0) {
    console.log("\nAucun doublon Air Congo détecté. Base déjà propre.");
    return;
  }

  console.log(`\n${duplicates.length} doublon(s) Air Congo détecté(s):`);
  for (const dup of duplicates) {
    console.log(`  -> code=${dup.code}, name=${dup.name}, tickets=${dup._count.tickets}`);
  }

  // 3. Réaffecter les billets et supprimer les doublons
  let totalReassigned = 0;
  let totalRulesDeleted = 0;
  let totalDuplicatesDeleted = 0;

  for (const dup of duplicates) {
    // Réaffecter les billets du doublon vers l'ACG canonique
    const reassigned = await prisma.ticketSale.updateMany({
      where: { airlineId: dup.id },
      data: { airlineId: canonical.id },
    });
    totalReassigned += reassigned.count;
    console.log(`  Réaffecté ${reassigned.count} billet(s) de "${dup.name}" (${dup.code}) → ACG`);

    // Supprimer les règles de commission du doublon
    const rulesDeleted = await prisma.commissionRule.deleteMany({
      where: { airlineId: dup.id },
    });
    totalRulesDeleted += rulesDeleted.count;

    // Supprimer le doublon
    await prisma.airline.delete({ where: { id: dup.id } });
    totalDuplicatesDeleted++;
    console.log(`  Supprimé doublon "${dup.name}" (${dup.code})`);
  }

  console.log(`\n✓ Nettoyage terminé:`);
  console.log(`  - ${totalDuplicatesDeleted} doublon(s) supprimé(s)`);
  console.log(`  - ${totalReassigned} billet(s) réaffecté(s) vers ACG`);
  console.log(`  - ${totalRulesDeleted} règle(s) de commission orpheline(s) supprimée(s)`);

  // 4. Vérification finale
  const finalAcg = await prisma.airline.findUnique({
    where: { code: "ACG" },
    include: { _count: { select: { tickets: true } }, commissionRules: true },
  });
  console.log(`\nACG final: ${finalAcg?._count.tickets} billets, ${finalAcg?.commissionRules.length} règle(s)`);
}

main()
  .catch((error) => {
    console.error("Erreur:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
