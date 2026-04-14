import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

// Plan comptable structuré — données inlinées pour garantir la disponibilité en production
const PLAN_COMPTABLE_STRUCTURED: Array<{ code: string; label: string; children: any[] }> = [
  {"code":"10","label":"Capital","children":[{"code":"101","label":"Capital social","children":[]},{"code":"104","label":"Primes liées au capital","children":[]}]},
  {"code":"11","label":"Réserves","children":[{"code":"111","label":"Réserve légale","children":[]},{"code":"112","label":"Réserves statutaires","children":[]},{"code":"118","label":"Autres réserves","children":[]}]},
  {"code":"12","label":"Report à nouveau","children":[{"code":"121","label":"Report à nouveau créditeur","children":[]},{"code":"129","label":"Report à nouveau débiteur","children":[]}]},
  {"code":"13","label":"Résultat net de l'exercice","children":[{"code":"131","label":"Résultat net : Bénéfice","children":[]},{"code":"139","label":"Résultat net : Perte","children":[]}]},
  {"code":"14","label":"Subventions d'investissement","children":[]},
  {"code":"16","label":"Emprunts et dettes assimilées","children":[{"code":"162","label":"Emprunts auprès des établissements de crédit","children":[]},{"code":"166","label":"Comptes courants d'associés bloqués","children":[]}]},
  {"code":"18","label":"Comptes de liaisons internes","children":[{"code":"181","label":"Comptes de liaison Siège / Mbujimayi","children":[]},{"code":"182","label":"Comptes de liaison Siège / Lubumbashi","children":[]},{"code":"183","label":"Comptes de liaison Siège / Agence","children":[]}]},
  {"code":"19","label":"Provisions financières pour risques et charges","children":[{"code":"191","label":"Provisions pour litiges","children":[]},{"code":"192","label":"Provisions pour garanties données aux clients","children":[]},{"code":"193","label":"Provisions pour pertes sur marchés à terme","children":[]},{"code":"194","label":"Provisions pour amendes et pénalités","children":[]},{"code":"198","label":"Autres provisions pour charges à répartir sur plusieurs exercices.","children":[]}]},
  {"code":"21","label":"Immobilisations Incorporelles","children":[{"code":"211","label":"Frais de développement","children":[]},{"code":"212","label":"Brevets, licences, marques","children":[]},{"code":"213","label":"Logiciels et Application","children":[]},{"code":"215","label":"Fonds de commerce","children":[]},{"code":"218","label":"Autres droits et valeurs incorporelles","children":[]},{"code":"219","label":"Immobilisations Incorporelles en cours","children":[]}]},
  {"code":"22","label":"Terrains","children":[{"code":"221","label":"Terrains nus","children":[]},{"code":"228","label":"Aménagements de terrains","children":[]}]},
  {"code":"23","label":"Bâtiments / Constructions","children":[{"code":"231","label":"Bâtiments administratifs et commerciaux","children":[]},{"code":"232","label":"Bureaux","children":[]},{"code":"233","label":"Constructions sur terrains d'autrui","children":[]},{"code":"238","label":"Autres constructions","children":[]}]},
  {"code":"24","label":"Matériel, Mobilier et Actifs Biologiques","children":[{"code":"241","label":"Matériel et outillage industriels et commerciaux","children":[]},{"code":"244","label":"Matériel de transport","children":[]},{"code":"245","label":"Matériel de bureau et informatique","children":[]},{"code":"248","label":"Mobilier de bureau","children":[]}]},
  {"code":"25","label":"Avances et Acomptes versés sur Immobilisations","children":[]},
  {"code":"27","label":"Immobilisations Financières","children":[{"code":"271","label":"Titres de participation","children":[]},{"code":"272","label":"Autres immobilisations financières","children":[]},{"code":"278","label":"Dépôts et cautionnements versés","children":[]}]},
  {"code":"28","label":"Amortissements","children":[{"code":"281","label":"Amortissements des immobilisations incorporelles","children":[]},{"code":"284","label":"Amortissements du matériel et mobilier","children":[]},{"code":"288","label":"Amortissements autres immobilisations","children":[]}]},
  {"code":"31","label":"Crédits Compagnies","children":[{"code":"311","label":"Crédits Ethiopian Airlines","children":[]},{"code":"312","label":"Crédits Kenya Airways","children":[]},{"code":"313","label":"Crédits Air France / KLM","children":[]},{"code":"314","label":"Crédits Brussels Airlines","children":[]},{"code":"315","label":"Crédits Turkish Airlines","children":[]},{"code":"316","label":"Crédits Emirates","children":[]},{"code":"317","label":"Crédits Qatar Airways","children":[]},{"code":"318","label":"Autres crédits compagnies","children":[]}]},
  {"code":"32","label":"Matières Premières et Fournitures Consommables","children":[{"code":"321","label":"Matières premières","children":[]},{"code":"322","label":"Matières et fournitures consommables","children":[]},{"code":"325","label":"Fournitures de bureau","children":[]},{"code":"328","label":"Autres fournitures","children":[]}]},
  {"code":"33","label":"Autres Approvisionnements","children":[{"code":"331","label":"Emballages perdus","children":[]},{"code":"332","label":"Emballages récupérables non identifiables","children":[]},{"code":"335","label":"Emballages à usage mixte","children":[]},{"code":"338","label":"Autres emballages","children":[]}]},
  {"code":"34","label":"Services en cours","children":[{"code":"341","label":"Services en cours","children":[]},{"code":"348","label":"Autres services en cours","children":[]}]},
  {"code":"35","label":"Produits finis","children":[{"code":"351","label":"Produits finis","children":[]}]},
  {"code":"36","label":"Produits Intermédiaires et Résiduels","children":[{"code":"361","label":"Produits intermédiaires","children":[]},{"code":"365","label":"Produits résiduels","children":[]}]},
  {"code":"37","label":"Stocks provenant d'immobilisations","children":[{"code":"371","label":"Stocks issus d'immobilisations","children":[]}]},
  {"code":"38","label":"Stocks achetés","children":[{"code":"381","label":"Marchandises","children":[]},{"code":"382","label":"Produits achetés pour revente","children":[]},{"code":"388","label":"Autres stocks achetés","children":[]}]},
  {"code":"39","label":"Dépréciations des stocks","children":[{"code":"391","label":"Dépréciations stocks matières premières","children":[]},{"code":"395","label":"Dépréciations stocks produits finis","children":[]},{"code":"398","label":"Dépréciations autres stocks","children":[]}]},
  {"code":"40","label":"Fournisseurs et Comptes Rattachés","children":[{"code":"401","label":"Fournisseurs","children":[]},{"code":"402","label":"Fournisseurs — Effets à payer","children":[]},{"code":"408","label":"Fournisseurs — Factures non parvenues","children":[]},{"code":"409","label":"Fournisseurs débiteurs","children":[]},{"code":"4091","label":"Avances et acomptes versés","children":[]}]},
  {"code":"41","label":"Clients et Comptes Rattachés","children":[{"code":"411","label":"Clients","children":[]},{"code":"412","label":"Clients — Effets à recevoir","children":[]},{"code":"413","label":"Clients — Chèques et valeurs à encaisser","children":[]},{"code":"414","label":"Clients douteux ou litigieux","children":[]},{"code":"418","label":"Clients — Produits non encore facturés","children":[]},{"code":"419","label":"Clients créditeurs","children":[]}]},
  {"code":"42","label":"Personnel","children":[{"code":"421","label":"Personnel — Rémunérations dues","children":[]},{"code":"428","label":"Personnel — Charges à payer et produits à recevoir","children":[]}]},
  {"code":"43","label":"Organismes sociaux","children":[{"code":"431","label":"Sécurité sociale","children":[]},{"code":"438","label":"Organismes sociaux — Charges à payer","children":[]}]},
  {"code":"44","label":"État et Collectivités publiques","children":[{"code":"441","label":"État — Impôts et taxes","children":[]},{"code":"442","label":"État — Taxes sur le chiffre d'affaires","children":[]},{"code":"443","label":"État — Retenues à la source","children":[]},{"code":"445","label":"État — Impôts sur les résultats","children":[]},{"code":"447","label":"État — Impôts et taxes recouvrables","children":[]},{"code":"448","label":"État — Charges à payer et produits à recevoir","children":[]},{"code":"4491","label":"Acomptes d'impôts","children":[]},{"code":"4492","label":"Crédit de TVA","children":[]}]},
  {"code":"45","label":"Organismes internationaux","children":[]},
  {"code":"46","label":"Associés et Groupe","children":[{"code":"461","label":"Associés — Opérations sur le capital","children":[]},{"code":"462","label":"Associés — Dividendes à payer","children":[]},{"code":"467","label":"Autres comptes débiteurs ou créditeurs","children":[]}]},
  {"code":"47","label":"Débiteurs divers et Créditeurs divers","children":[{"code":"471","label":"Débiteurs divers","children":[]},{"code":"472","label":"Versements restant à effectuer sur titres","children":[]},{"code":"473","label":"Débiteurs et créditeurs divers — Opérations en cours","children":[]},{"code":"474","label":"Créances et dettes sur cessions d'immobilisations","children":[]},{"code":"475","label":"Créances et dettes sur acquisitions de titres","children":[]},{"code":"476","label":"Charges constatées d'avance","children":[]},{"code":"477","label":"Produits constatés d'avance","children":[]}]},
  {"code":"48","label":"Créances et dettes hors activités ordinaires (H.A.O.)","children":[{"code":"481","label":"Fournisseurs d'immobilisations","children":[]},{"code":"482","label":"Dettes d'acquisition de titres","children":[]},{"code":"483","label":"Versements restant à effectuer","children":[]},{"code":"484","label":"Créances sur cessions d'immobilisations","children":[]},{"code":"485","label":"Créances sur cessions de titres","children":[]},{"code":"486","label":"Charges imputables à plusieurs exercices","children":[]},{"code":"488","label":"Comptes de régularisation","children":[]}]},
  {"code":"49","label":"Dépréciation et risques provisionnés","children":[{"code":"491","label":"Dépréciations des comptes clients","children":[]},{"code":"492","label":"Dépréciations compte fournisseurs débiteurs","children":[]},{"code":"493","label":"Dépréciations des comptes du personnel","children":[]},{"code":"494","label":"Dépréciations des comptes d'organismes sociaux","children":[]},{"code":"495","label":"Dépréciations des comptes de l'État","children":[]},{"code":"496","label":"Dépréciations des comptes débiteurs divers","children":[]},{"code":"497","label":"Dépréciations des comptes HAO","children":[]},{"code":"498","label":"Autres dépréciations","children":[]},{"code":"499","label":"Provisions pour risques à court terme","children":[]},{"code":"4991","label":"Provisions pour risques divers","children":[]}]},
  {"code":"50","label":"Valeurs Mobilières de Placement (VMP)","children":[{"code":"501","label":"Titres de placement","children":[]},{"code":"508","label":"Autres valeurs mobilières","children":[]}]},
  {"code":"51","label":"Valeurs à Encaisser","children":[{"code":"511","label":"Effets à l'encaissement","children":[]},{"code":"512","label":"Chèques à encaisser","children":[]},{"code":"514","label":"Chèques postaux","children":[]},{"code":"516","label":"Virements de fonds","children":[]},{"code":"518","label":"Autres valeurs à encaisser","children":[]}]},
  {"code":"52","label":"Banques","children":[{"code":"521","label":"Banques locales","children":[]},{"code":"522","label":"Banques étrangères","children":[]}]},
  {"code":"57","label":"Caisse","children":[{"code":"571","label":"Caisse siège","children":[]},{"code":"572","label":"Caisse agence Mbujimayi","children":[]},{"code":"573","label":"Caisse agence Lubumbashi","children":[]},{"code":"578","label":"Autres caisses","children":[]}]},
  {"code":"58","label":"Virements Internes","children":[{"code":"581","label":"Virements de fonds internes","children":[]},{"code":"585","label":"Virements entre caisses","children":[]},{"code":"588","label":"Autres virements internes","children":[]}]},
  {"code":"60","label":"ACHATS ET VARIATIONS DE STOCKS","children":[{"code":"601","label":"Achats de marchandises","children":[]},{"code":"602","label":"Achats de matières premières","children":[]},{"code":"604","label":"Achats stockés — Matières et fournitures consommables","children":[]},{"code":"605","label":"Achats de matériel et équipements","children":[]},{"code":"608","label":"Autres achats","children":[]},{"code":"609","label":"Rabais, remises, ristournes obtenus","children":[]}]},
  {"code":"61","label":"TRANSPORT","children":[{"code":"611","label":"Transports sur achats","children":[]},{"code":"612","label":"Transports sur ventes","children":[]},{"code":"613","label":"Transports pour le compte de tiers","children":[]},{"code":"614","label":"Transports du personnel","children":[]},{"code":"618","label":"Autres transports","children":[]}]},
  {"code":"62","label":"SERVICES EXTERIEURS A","children":[{"code":"621","label":"Sous-traitance générale","children":[]},{"code":"622","label":"Locations et charges locatives","children":[]},{"code":"623","label":"Redevances de crédit-bail","children":[]},{"code":"624","label":"Entretien, réparations et maintenance","children":[]},{"code":"625","label":"Primes d'assurances","children":[]},{"code":"626","label":"Études, recherches et documentation","children":[]},{"code":"628","label":"Autres services extérieurs A","children":[]}]},
  {"code":"63","label":"SERVICES EXTERIEURS B","children":[{"code":"631","label":"Rémunérations d'intermédiaires et honoraires","children":[]},{"code":"632","label":"Commissions aux compagnies aériennes","children":[]},{"code":"633","label":"Publicité, publications et relations publiques","children":[]},{"code":"634","label":"Déplacements, missions et réceptions","children":[]},{"code":"635","label":"Frais postaux et de télécommunications","children":[]},{"code":"638","label":"Autres charges externes","children":[]}]},
  {"code":"64","label":"IMPÔTS, TAXES ET VERSEMENTS ASSIMILÉS","children":[{"code":"641","label":"Impôts et taxes directs","children":[]},{"code":"642","label":"Taxes et droits indirects","children":[]},{"code":"643","label":"Contribution foncière","children":[]},{"code":"645","label":"Taxes sur salaires","children":[]},{"code":"648","label":"Autres impôts et taxes","children":[]}]},
  {"code":"65","label":"EXPLOITATION","children":[{"code":"651","label":"Pertes sur créances irrécouvrables","children":[]},{"code":"658","label":"Autres charges d'exploitation","children":[]}]},
  {"code":"66","label":"CHARGES DE PERSONNEL","children":[{"code":"661","label":"Appointements et salaires","children":[]},{"code":"662","label":"Primes et gratifications","children":[]},{"code":"663","label":"Indemnités forfaitaires","children":[]},{"code":"664","label":"Charges sociales","children":[]},{"code":"668","label":"Autres charges de personnel","children":[]}]},
  {"code":"67","label":"CHARGES HORS ACTIVITES ORDINAIRES","children":[{"code":"671","label":"Valeurs comptables des cessions d'immobilisations","children":[]},{"code":"678","label":"Autres charges HAO","children":[]}]},
  {"code":"68","label":"DOTATIONS AUX AMORTISSEMENTS","children":[{"code":"681","label":"Dotations aux amortissements","children":[]},{"code":"691","label":"Dotations aux provisions d'exploitation","children":[]}]},
  {"code":"69","label":"DOTATIONS AUX PROVISIONS","children":[]},
  {"code":"70","label":"VENTES ET PRESTATIONS DE SERVICES","children":[{"code":"701","label":"Ventes de billets d'avion","children":[]},{"code":"702","label":"Prestations de services","children":[]},{"code":"708","label":"Autres produits d'activités ordinaires","children":[]}]},
  {"code":"71","label":"SUBVENTIONS D'EXPLOITATION","children":[]},
  {"code":"72","label":"PRODUCTION IMMOBILISÉE ET INCORPORELLE","children":[{"code":"721","label":"Immobilisations produites par l'entreprise pour elle-même","children":[]},{"code":"728","label":"Autres productions immobilisées","children":[]}]},
  {"code":"75","label":"AUTRES PRODUITS D'EXPLOITATION","children":[{"code":"751","label":"Revenus des immeubles non affectés aux activités professionnelles","children":[]},{"code":"752","label":"Gains sur créances irrécouvrables","children":[]},{"code":"758","label":"Autres produits divers","children":[]}]},
  {"code":"76","label":"PRODUITS FINANCIERS","children":[{"code":"761","label":"Intérêts de prêts","children":[]},{"code":"762","label":"Revenus de titres et valeurs de placement","children":[]},{"code":"768","label":"Autres produits financiers","children":[]}]},
  {"code":"77","label":"PRODUITS HORS ACTIVITÉS ORDINAIRES (HAO)","children":[{"code":"771","label":"Produits de cessions d'immobilisations","children":[]},{"code":"778","label":"Autres produits HAO","children":[]}]},
  {"code":"78","label":"TRANFERT DE CHARGES","children":[{"code":"781","label":"Transferts de charges d'exploitation","children":[]},{"code":"788","label":"Transferts de charges HAO","children":[]}]},
  {"code":"79","label":"Reprises d'exploitation","children":[{"code":"791","label":"Reprises de provisions d'exploitation","children":[]},{"code":"798","label":"Autres reprises","children":[]}]},
  {"code":"9782","label":"Sinistres non assurés","children":[]},
];

function flatten(
  nodes: Array<{ code: string; label: string; children: any[] }>,
  parentCode: string | null = null,
): Array<{ code: string; label: string; parentCode: string | null; level: number }> {
  const result: Array<{ code: string; label: string; parentCode: string | null; level: number }> = [];
  for (const node of nodes) {
    result.push({ code: node.code, label: node.label, parentCode, level: node.code.length });
    result.push(...flatten(node.children ?? [], node.code));
  }
  return result;
}

export async function POST() {
  const access = await requireApiRoles(["ADMIN"]);
  if (access.error) return access.error;

  // Ensure Account table exists (MySQL — migration may not have been applied on Hostinger)
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`Account\` (
        \`id\`            VARCHAR(191) NOT NULL,
        \`code\`          VARCHAR(191) NOT NULL,
        \`label\`         VARCHAR(191) NOT NULL,
        \`parentCode\`    VARCHAR(191) NULL,
        \`level\`         INT NULL,
        \`normalBalance\` ENUM('DEBIT','CREDIT') NOT NULL DEFAULT 'DEBIT',
        \`createdAt\`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\`     DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`Account_code_key\` (\`code\`),
        INDEX \`Account_code_idx\` (\`code\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    `);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Impossible de créer la table: ${e.message}` }, { status: 500 });
  }

  const accounts = flatten(PLAN_COMPTABLE_STRUCTURED);
  let count = 0;
  const errors: string[] = [];

  for (const a of accounts) {
    try {
      await prisma.account.upsert({
        where: { code: a.code },
        update: { label: a.label, parentCode: a.parentCode, level: a.level },
        create: { code: a.code, label: a.label, parentCode: a.parentCode, level: a.level },
      });
      count++;
    } catch (e: any) {
      errors.push(`${a.code}: ${e.message}`);
      // Stop on first DB-level error (table missing, connection issue, etc.)
      if (errors.length >= 3) break;
    }
  }

  if (errors.length > 0 && count === 0) {
    return NextResponse.json(
      { success: false, count: 0, error: `Erreur DB : ${errors[0]}`, errors },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, count, errors: errors.slice(0, 20) });
}
