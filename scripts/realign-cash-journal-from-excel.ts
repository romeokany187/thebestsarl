/**
 * Réaligne en base les lignes journal déjà importées (depuis avril 2026…)
 * en re-lisant les fichiers Excel avec le parseur actuel — sans repasser par l’UI d’import.
 *
 * Usage:
 *   npx tsx scripts/realign-cash-journal-from-excel.ts "/chemin/vers/dossier/excel" --dry-run
 *   npx tsx scripts/realign-cash-journal-from-excel.ts "/chemin/vers/dossier/excel"
 */
import fs from "node:fs";
import path from "node:path";
import { realignJournalLinesFromWorkbookBuffer } from "../src/lib/cash-journal-realign-from-excel";

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--dry-run");
  const dryRun = process.argv.includes("--dry-run");
  const targetDir = args[0];

  if (!targetDir) {
    console.error("Usage: npx tsx scripts/realign-cash-journal-from-excel.ts <dossier-excel> [--dry-run]");
    process.exit(1);
  }

  const absoluteDir = path.resolve(targetDir);
  if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) {
    console.error(`Dossier introuvable: ${absoluteDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(absoluteDir)
    .filter((name) => /\.xlsx?$/i.test(name))
    .sort();

  if (files.length === 0) {
    console.error(`Aucun fichier .xlsx dans ${absoluteDir}`);
    process.exit(1);
  }

  console.log(`[realign] ${files.length} fichier(s) Excel — dryRun=${dryRun}`);

  for (const fileName of files) {
    const filePath = path.join(absoluteDir, fileName);
    const buffer = fs.readFileSync(filePath);
    const result = await realignJournalLinesFromWorkbookBuffer({
      buffer,
      fileName,
      dryRun,
    });
    console.log(
      `[realign] ${fileName} → mois ${result.reportMonth} | parsé ${result.parsedLines} | maj ${result.updatedLines} | absent ${result.missingLines}`,
    );
  }

  console.log("[realign] Terminé.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
