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

/**
 * Patterns issus du journal Excel caissière (oct. 2026) :
 * fautes fréquentes (paoement, paielment, guillets, facturee, gransfert, connesion, ethioipain…).
 */
const TICKET_PRODUCT_RULES: PatternRule[] = [
  { pattern: /\bpaiements?\s+billets?\b/, score: 100, reason: "paiement billet" },
  { pattern: /\bpaoements?\s+billets?\b|\bpaielments?\s+billets?\b|\bpaiemnts?\s+billets?\b/, score: 98, reason: "paiement billet (faute)" },
  { pattern: /\bpaiements?\s+bill+ets?\b/, score: 96, reason: "paiement billlet" },
  { pattern: /\bsolde\s+billets?\b|\bbillets?\s+solde\b/, score: 95, reason: "solde billet" },
  { pattern: /\bacompte\s+billets?\b|\bbillets?\s+acompte\b|\bocomptes?\b/, score: 94, reason: "acompte billet" },
  { pattern: /\bcomplement\s+billets?\b|\bcomplements?\b/, score: 90, reason: "complément billet" },
  { pattern: /\bchangement\s+date\b/, score: 88, reason: "changement date billet" },
  { pattern: /\bpenalit[eé]s?\b|\bp[eé]nalit[eé]s?\b/, score: 85, reason: "pénalité" },
  { pattern: /\bpaimeent\b/, score: 85, reason: "paiement (orthographe)" },
  { pattern: /\bremboursements?\s+billets?\b/, score: 40, reason: "remboursement billet (entrée)" },
  { pattern: /\bpnd\b|\bpni\b/, score: 75, reason: "PND/PNI (paiement non détaillé)" },
  { pattern: /\bpaiements?\s+non\s+d[eé]taill/, score: 80, reason: "paiement non détaillé" },
  { pattern: /\bbillets?\b/, score: 70, reason: "libellé billet" },
  { pattern: /\bmjm\b|\bmbujimayi\b/, score: 68, reason: "agence MJM / Mbujimayi" },
];

const MARKET_PRODUCT_RULES: PatternRule[] = [
  { pattern: /\badra\b/, score: 100, reason: "ADRA" },
  { pattern: /\bgilets?\b|\bguillets?\b/, score: 98, reason: "gilets / guillets" },
  { pattern: /\bmarches?\s+publics?\b|\bmaeches?\b/, score: 95, reason: "marché public" },
  { pattern: /\bmarches?\b|\bmaeches?\b/, score: 88, reason: "marché" },
  { pattern: /\bfortutex\b|\bfprtute[sx]\b/, score: 90, reason: "marché FORTUTEX" },
  { pattern: /\bdigitalisations?\b/, score: 70, reason: "digitalisation (marché)" },
  { pattern: /\betat\s+de\s+besoin\b|\bedb\b/, score: 72, reason: "EDB" },
];

const OTHER_PRODUCT_RULES: PatternRule[] = [
  { pattern: /\bpaiements?\s+du\s+prets?\b|\bremboursements?\s+(du\s+)?prets?\b/, score: 80, reason: "remboursement de prêt" },
];

const CHARGE_RULES: Array<{ bucket: ChargeBucket; label: string; rules: PatternRule[] }> = [
  {
    bucket: "dream",
    label: "Factures Dream",
    rules: [
      { pattern: /\bdream\b/, score: 120, reason: "Dream" },
      { pattern: /\bfacturee?\s+dream\b|\bfactures?\s+dream\b/, score: 130, reason: "facture Dream" },
    ],
  },
  {
    bucket: "bank",
    label: "Frais bancaires",
    rules: [
      { pattern: /\bfrais\s+de\s+retraits?\b|\bfrais\s+retraits?\b/, score: 120, reason: "frais de retrait" },
      { pattern: /\bfrais\s+de\s+(gransfert|transfert|transfer)\b/, score: 120, reason: "frais de transfert" },
      { pattern: /\bfrais\s+bancaires?\b|\bfrais\s+banque\b/, score: 115, reason: "frais bancaires" },
      { pattern: /\btenue\s+de\s+compte\b/, score: 100, reason: "tenue de compte" },
      { pattern: /\bcommissions?\s+(de\s+)?(retrait|depot|virement|transfert)\b/, score: 110, reason: "commission bancaire" },
      { pattern: /\bfrais\s+(airtel|orange|m-?pesa|equity|rawbank|illico|mpesa)\b/, score: 100, reason: "frais momo/banque" },
    ],
  },
  {
    bucket: "salary",
    label: "Charges du personnel",
    rules: [
      { pattern: /\bsalaires?\b/, score: 120, reason: "salaire" },
      { pattern: /\bavances?\s+sur\s+salaires?\b/, score: 125, reason: "avance sur salaire" },
      { pattern: /\bremunerations?\b/, score: 100, reason: "rémunération" },
      { pattern: /\bpaie\s+(du\s+)?personnel\b|\bpaie\s+agents?\b/, score: 105, reason: "paie personnel" },
      { pattern: /\bcharges?\s+(du\s+)?personnel\b/, score: 105, reason: "charges personnel" },
      { pattern: /\bcnss\b|\bipr\b/, score: 95, reason: "charges sociales / IPR" },
    ],
  },
  {
    bucket: "internet",
    label: "Internet",
    rules: [
      { pattern: /\binternet\b/, score: 120, reason: "internet" },
      { pattern: /\bconnesions?\b|\bconnexions?\b/, score: 115, reason: "connexion internet" },
      { pattern: /\bforfait\s+internet\b|\bforfait\s+fibre\b|\bfibre\s+optique\b/, score: 125, reason: "forfait/fibre" },
      { pattern: /\bfibre\b|\bwifi\b/, score: 90, reason: "fibre/wifi" },
      { pattern: /\bcredits?\s+telephones?\b|\bforfait\s+telephonique\b|\bforfait\s+data\b/, score: 95, reason: "forfait télécom" },
    ],
  },
  {
    bucket: "transport",
    label: "Mobilité et transport",
    rules: [
      { pattern: /\btransports?\b/, score: 110, reason: "transport" },
      { pattern: /\bmobilite\b|\bdeplacements?\b/, score: 100, reason: "mobilité/déplacement" },
      { pattern: /\btaxi\b|\bcarburant\b|\bessence\b|\bgazoil\b|\bgasoil\b/, score: 95, reason: "taxi/carburant" },
      { pattern: /\bdescente\s+sur\s+terrain\b|\bfrais\s+de\s+mission\b/, score: 95, reason: "mission / terrain" },
      { pattern: /\bentretiens?\s+du\s+vehicule\b|\bvehicule\b/, score: 85, reason: "véhicule" },
    ],
  },
  {
    bucket: "commission",
    label: "Commissions versées",
    rules: [
      { pattern: /\bcommissions?\s+versees?\b/, score: 120, reason: "commission versée" },
      { pattern: /\bcommission\s+(agent|partenaire|agence|hk|intermediaire)\b/, score: 110, reason: "commission partenaire" },
      { pattern: /\bhk\s*services?\b|\bhkservice\b/, score: 110, reason: "HK Service" },
      { pattern: /\bhonoraires?\b/, score: 90, reason: "honoraires" },
      // score bas : « commission » seul, après frais bancaires
      { pattern: /\bcommissions?\b/, score: 55, reason: "commission (générique)" },
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
  return /\bconversions?\b|\bchange\s+de\s+devise\b|\bcdf\s+en\s+usd\b|\busd\s+en\s+cdf\b/.test(text);
}

function isOpeningText(text: string) {
  return /\breport\s+a\s+nouveau\b|\bsolde\s+d\s*ouverture\b/.test(text);
}

function marketTitle(line: Pick<ImportedJournalLineRecord, "libelle" | "typeOperation">) {
  const raw = (line.libelle || line.typeOperation || "Marché public").trim().replace(/\s+/g, " ");
  // Normalise GUILLETS → intitulé lisible pour le comptable
  const pretty = raw.replace(/guillets?/gi, "Gilets").replace(/\s+/g, " ");
  return pretty.length > 80 ? `${pretty.slice(0, 77)}…` : pretty;
}

function resolveMovementSide(line: ImportedJournalLineRecord, text: string): "inflow" | "outflow" | "none" {
  const inAmt = (line.usdIn || 0) + (line.cdfIn || 0);
  const outAmt = (line.usdOut || 0) + (line.cdfOut || 0);

  // Priorité aux montants réels (souvent « Bon d'entrée » avec SORTIES pour salaires/Dream/frais).
  if (outAmt > 0 && inAmt <= 0) return "outflow";
  if (inAmt > 0 && outAmt <= 0) return "inflow";
  if (outAmt > inAmt) return "outflow";
  if (inAmt > outAmt) return "inflow";

  if (line.lineCategory === "OUTFLOW") return "outflow";
  if (line.lineCategory === "TICKET_INFLOW" || line.lineCategory === "OTHER_INFLOW") return "inflow";

  if (/\bsortie\b|\bbon\s+de\s+sortie\b/.test(text)) return "outflow";
  if (/\bentree\b|\bbon\s+d\s*entree\b/.test(text)) return "inflow";
  return "none";
}

/**
 * Reclasse chaque ligne journal pour le compte de résultat à partir du libellé + montants
 * (pas seulement la catégorie d’import).
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

  const side = resolveMovementSide(line, text);

  if (side === "outflow") {
    // Remboursement billet (sortie) → autres charges (pas une recette)
    if (/\bremboursements?\s+billets?\b/.test(text)) {
      return {
        side: "charge",
        bucket: "other_charge",
        label: CHARGE_LABELS.other_charge,
        reason: "remboursement billet (sortie)",
      };
    }

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
      reason: "sortie non rattachée (appro compagnies, loyer, prêts, achats…)",
    };
  }

  if (side === "inflow") {
    const ticketHit = bestRule(text, TICKET_PRODUCT_RULES);
    const marketHit = bestRule(text, MARKET_PRODUCT_RULES);
    const otherHit = bestRule(text, OTHER_PRODUCT_RULES);

    // Dream ne doit jamais être une recette même si le type dit « entrée »
    if (/\bdream\b/.test(text) && (line.usdOut > 0 || line.cdfOut > 0)) {
      return { side: "charge", bucket: "dream", label: CHARGE_LABELS.dream, reason: "Dream (montant sortie)" };
    }

    if (marketHit && (!ticketHit || marketHit.score > ticketHit.score)) {
      return {
        side: "product",
        bucket: "market",
        label: marketTitle(line),
        reason: marketHit.reason,
      };
    }

    if (category === "TICKET_INFLOW" || ticketHit) {
      // Évite de classer « paiement non détaillé » marché comme billet si ADRA/gilets présents
      if (marketHit && marketHit.score >= 90) {
        return {
          side: "product",
          bucket: "market",
          label: marketTitle(line),
          reason: marketHit.reason,
        };
      }
      return {
        side: "product",
        bucket: "ticket",
        label: "Recettes billetteries",
        reason: ticketHit?.reason ?? "catégorie import TICKET_INFLOW",
      };
    }

    if (otherHit) {
      return {
        side: "product",
        bucket: "other_product",
        label: "Autres recettes",
        reason: otherHit.reason,
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
