import type { ImportedJournalLineRecord } from "@/lib/cash-journal-ledger";

export type ProductBucket = "ticket" | "market" | "other_product";
export type ChargeBucket =
  | "dream"
  | "bank"
  | "transport"
  | "salary"
  | "internet"
  | "commission"
  | "other_charge";

export type ClassificationDisposition =
  | { side: "product"; bucket: ProductBucket; label: string; reason: string }
  | { side: "charge"; bucket: ChargeBucket; label: string; reason: string }
  | { side: "excluded"; reason: string };

type PatternRule = {
  pattern: RegExp;
  score: number;
  reason: string;
};

function normalizeMatchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, " ")
    .replace(/[^a-z0-9%./+\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function combinedText(line: Pick<ImportedJournalLineRecord, "typeOperation" | "libelle" | "referenceDoc">) {
  return normalizeMatchText(`${line.typeOperation} ${line.libelle} ${line.referenceDoc ?? ""}`);
}

function bestRule(text: string, rules: PatternRule[]): PatternRule | null {
  let best: PatternRule | null = null;
  for (const rule of rules) {
    if (!rule.pattern.test(text)) continue;
    if (!best || rule.score > best.score) best = rule;
  }
  return best;
}

const TICKET_PRODUCT_RULES: PatternRule[] = [
  { pattern: /\bpaiements?\s+billets?\b/, score: 100, reason: "paiement billet" },
  { pattern: /\bpaimeent\b/, score: 95, reason: "paiement billet (orthographe)" },
  { pattern: /\bsolde\s+billets?\b/, score: 95, reason: "solde billet" },
  { pattern: /\bacompte\b/, score: 90, reason: "acompte billet" },
  { pattern: /\bpenalit[eé]s?\b|\bp[eé]nalit[eé]s?\b/, score: 85, reason: "pénalité billet" },
  { pattern: /\bremboursements?\s+billets?\b/, score: 85, reason: "remboursement billet" },
  { pattern: /\bbillets?\b/, score: 70, reason: "libellé billet" },
  { pattern: /\bpnr\b|\bepass\b/, score: 65, reason: "réf. billet/PNR" },
];

const MARKET_PRODUCT_RULES: PatternRule[] = [
  { pattern: /\badra\b/, score: 100, reason: "marché ADRA" },
  { pattern: /\bgilets?\b/, score: 95, reason: "marché gilets" },
  { pattern: /\bmarches?\s+publics?\b/, score: 95, reason: "marché public" },
  { pattern: /\bmarche\b/, score: 80, reason: "marché" },
  { pattern: /\betat\s+de\s+besoin\b|\bedb\b/, score: 75, reason: "EDB / état de besoin" },
  { pattern: /\bcommande\s+publique\b|\bappel\s+d offre\b/, score: 75, reason: "commande publique" },
];

const CHARGE_RULES: Array<{ bucket: ChargeBucket; label: string; rules: PatternRule[] }> = [
  {
    bucket: "dream",
    label: "Factures Dream",
    rules: [
      { pattern: /\bdream\b/, score: 100, reason: "Dream" },
      { pattern: /\bfactures?\s+dream\b/, score: 110, reason: "facture Dream" },
    ],
  },
  {
    bucket: "bank",
    label: "Frais bancaires",
    rules: [
      { pattern: /\bfrais\s+bancaires?\b/, score: 110, reason: "frais bancaires" },
      { pattern: /\bfrais\s+banque\b/, score: 105, reason: "frais banque" },
      { pattern: /\btenue\s+de\s+compte\b/, score: 100, reason: "tenue de compte" },
      { pattern: /\bcommissions?\s+(de\s+)?(retrait|depot|dépôt|virement|transfert)\b/, score: 100, reason: "commission bancaire" },
      { pattern: /\bfrais\s+(airtel|orange|m-?pesa|equity|rawbank|illico|mpesa)\b/, score: 100, reason: "frais mobile money / banque" },
      { pattern: /\bfrais\s+(banc|momo|mobile\s+money)\b/, score: 90, reason: "frais bancaires/momo" },
      { pattern: /\bcharges?\s+bancaires?\b/, score: 95, reason: "charge bancaire" },
    ],
  },
  {
    bucket: "salary",
    label: "Charges du personnel",
    rules: [
      { pattern: /\bsalaires?\b/, score: 110, reason: "salaire" },
      { pattern: /\bremunerations?\b/, score: 100, reason: "rémunération" },
      { pattern: /\bpaie\s+(du\s+)?personnel\b|\bpaie\s+agents?\b|\bpaie\s+salaires?\b/, score: 105, reason: "paie personnel" },
      { pattern: /\bcharges?\s+du\s+personnel\b|\bcharges?\s+personnel\b/, score: 105, reason: "charges personnel" },
      { pattern: /\bprimes?\s+(de\s+)?(salaires?|agents?|personnel|fin\s+de\s+mois)\b/, score: 95, reason: "prime personnel" },
      { pattern: /\bavances?\s+sur\s+salaires?\b/, score: 90, reason: "avance salaire" },
    ],
  },
  {
    bucket: "internet",
    label: "Internet",
    rules: [
      { pattern: /\binternet\b/, score: 110, reason: "internet" },
      { pattern: /\bforfait\s+internet\b/, score: 115, reason: "forfait internet" },
      { pattern: /\bfibre\b|\bwifi\b/, score: 90, reason: "fibre/wifi" },
      { pattern: /\bcredits?\s+telephones?\b|\bforfait\s+telephonique\b|\bforfait\s+data\b/, score: 95, reason: "forfait télécom" },
      { pattern: /\bvodacom\b|\bairtel\s+data\b|\borange\s+data\b/, score: 85, reason: "data opérateur" },
    ],
  },
  {
    bucket: "transport",
    label: "Mobilité et transport",
    rules: [
      { pattern: /\bmobilite\b|\btransport\b/, score: 100, reason: "mobilité/transport" },
      { pattern: /\bdeplacements?\b/, score: 95, reason: "déplacement" },
      { pattern: /\btaxi\b|\bcarburant\b|\bessence\b|\bgazoil\b|\bgasoil\b/, score: 95, reason: "taxi/carburant" },
      { pattern: /\bmission\s+(de\s+)?(service|terrain|kin|interieur)\b|\bfrais\s+de\s+mission\b/, score: 90, reason: "frais de mission" },
      { pattern: /\btransport\s+agents?\b|\bnavette\b/, score: 90, reason: "transport agents" },
    ],
  },
  {
    bucket: "commission",
    label: "Commissions versées",
    rules: [
      { pattern: /\bcommissions?\s+versees?\b/, score: 110, reason: "commission versée" },
      { pattern: /\bcommission\s+(agent|partenaire|agence|hk|intermediaire)\b/, score: 100, reason: "commission partenaire" },
      { pattern: /\bhk\s*services?\b|\bhkservice\b/, score: 100, reason: "HK Service" },
      { pattern: /\bhonoraires?\b/, score: 90, reason: "honoraires" },
      { pattern: /\bcommissions?\b/, score: 60, reason: "commission (générique)" },
    ],
  },
];

const CHARGE_LABELS: Record<ChargeBucket, string> = {
  dream: "Factures Dream",
  bank: "Frais bancaires",
  transport: "Mobilité et transport",
  salary: "Charges du personnel",
  internet: "Internet",
  commission: "Commissions versées",
  other_charge: "Autres charges",
};

function isConversionText(text: string) {
  return /\bconversions?\b|\bchange\s+de\s+devise\b|\bfx\b/.test(text);
}

function isOpeningText(text: string) {
  return /\breport\s+a\s+nouveau\b|\breport\s+à\s+nouveau\b|\bsolde\s+d\s*ouverture\b/.test(text);
}

function isEntryType(text: string) {
  return /\bentree\b|\bentrée\b|\bbon\s+d\s*entree\b|\bbon\s+d\s*entrée\b/.test(text);
}

function isExitType(text: string) {
  return /\bsortie\b|\bbon\s+de\s+sortie\b|\bbon\s+de\s+sorrtie\b/.test(text);
}

function marketTitle(line: Pick<ImportedJournalLineRecord, "libelle" | "typeOperation">) {
  const raw = (line.libelle || line.typeOperation || "Marché public").trim().replace(/\s+/g, " ");
  return raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
}

/**
 * Reclasse chaque ligne journal pour le compte de résultat (indépendamment du lineCategory importé,
 * afin de rattraper les libellés mal catégorisés à l’import).
 */
export function classifyIncomeStatementLine(
  line: ImportedJournalLineRecord,
): ClassificationDisposition {
  const text = combinedText(line);
  const category = line.lineCategory;

  if (category === "OPENING" || category === "SKIP" || isOpeningText(text)) {
    return { side: "excluded", reason: "report à nouveau / hors résultat" };
  }
  if (isConversionText(text)) {
    return { side: "excluded", reason: "conversion de change (hors P&L)" };
  }

  const hasIn = line.usdIn > 0 || line.cdfIn > 0;
  const hasOut = line.usdOut > 0 || line.cdfOut > 0;
  const treatAsOutflow =
    category === "OUTFLOW" || (hasOut && !hasIn) || (isExitType(text) && !isEntryType(text));
  const treatAsInflow =
    !treatAsOutflow && (category === "TICKET_INFLOW" || category === "OTHER_INFLOW" || hasIn || isEntryType(text));

  if (treatAsOutflow) {
    let best: { bucket: ChargeBucket; label: string; score: number; reason: string } | null = null;
    for (const group of CHARGE_RULES) {
      const hit = bestRule(text, group.rules);
      if (!hit) continue;
      if (!best || hit.score > best.score) {
        best = { bucket: group.bucket, label: group.label, score: hit.score, reason: hit.reason };
      }
    }
    if (best) {
      return { side: "charge", bucket: best.bucket, label: best.label, reason: best.reason };
    }
    return {
      side: "charge",
      bucket: "other_charge",
      label: CHARGE_LABELS.other_charge,
      reason: "sortie non rattachée à une rubrique connue",
    };
  }

  if (treatAsInflow) {
    const ticketHit = bestRule(text, TICKET_PRODUCT_RULES);
    const marketHit = bestRule(text, MARKET_PRODUCT_RULES);

    if (category === "TICKET_INFLOW" || (ticketHit && (!marketHit || ticketHit.score >= marketHit.score))) {
      if (category === "TICKET_INFLOW" || ticketHit) {
        return {
          side: "product",
          bucket: "ticket",
          label: "Recettes billetteries",
          reason: ticketHit?.reason ?? "catégorie import TICKET_INFLOW",
        };
      }
    }

    if (marketHit && (!ticketHit || marketHit.score > ticketHit.score)) {
      return {
        side: "product",
        bucket: "market",
        label: marketTitle(line),
        reason: marketHit.reason,
      };
    }

    if (ticketHit) {
      return {
        side: "product",
        bucket: "ticket",
        label: "Recettes billetteries",
        reason: ticketHit.reason,
      };
    }

    return {
      side: "product",
      bucket: "other_product",
      label: "Autres recettes",
      reason: "entrée hors billetterie / marché public",
    };
  }

  return { side: "excluded", reason: "ligne sans mouvement exploitable" };
}

export function chargeBucketLabel(bucket: ChargeBucket) {
  return CHARGE_LABELS[bucket];
}
