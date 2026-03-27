import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type ParsedArgs = {
  apply: boolean;
  year?: number;
  from?: string;
  to?: string;
  limit?: number;
};

function readFlagValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const yearRaw = readFlagValue(args, "--year");
  const from = readFlagValue(args, "--from");
  const to = readFlagValue(args, "--to");
  const limitRaw = readFlagValue(args, "--limit");

  const year = yearRaw ? Number.parseInt(yearRaw, 10) : undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  if (year !== undefined && (!Number.isFinite(year) || year < 2000 || year > 2100)) {
    throw new Error("Paramètre --year invalide.");
  }

  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error("Paramètre --limit invalide.");
  }

  return {
    apply,
    year,
    from,
    to,
    limit,
  };
}

function normalizeLookupKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactLookupKey(value: string) {
  return normalizeLookupKey(value).replace(/\s+/g, "");
}

function addLookupCandidate(candidates: Set<string>, value: string) {
  const normalized = normalizeLookupKey(value);
  if (normalized) {
    candidates.add(normalized);
  }
}

function buildTeamLookupCandidates(teamName: string) {
  const candidates = new Set<string>();
  addLookupCandidate(candidates, teamName);
  addLookupCandidate(candidates, teamName.replace(/^agence\s+de\s+/i, ""));
  addLookupCandidate(candidates, teamName.replace(/^equipe\s*[-:]?\s*/i, ""));

  const compact = compactLookupKey(teamName);
  if (compact.includes("kinshasa")) addLookupCandidate(candidates, "Kinshasa");
  if (compact.includes("lubumbashi")) addLookupCandidate(candidates, "Lubumbashi");
  if (compact.includes("mbujimayi") || compact.includes("mbujimai")) addLookupCandidate(candidates, "Mbujimayi");
  if (compact.includes("hkservice")) addLookupCandidate(candidates, "HKSERVICE");

  return Array.from(candidates);
}

function resolveImportedPayerName(
  value: string | null,
  lookups: {
    usersByKey: Map<string, string>;
    teamsByKey: Map<string, string>;
    userKeys: string[];
    teamKeys: string[];
  },
) {
  const raw = value?.trim();
  if (!raw) return null;

  const normalized = normalizeLookupKey(raw);
  const compact = compactLookupKey(raw);
  const stripped = normalizeLookupKey(raw.replace(/^(agent|employe|employe e|employe\(e\)|equipe|team|agence|client)\s*[-:]?\s*/i, ""));
  const lookupKeys = Array.from(new Set([normalized, compact, stripped, compactLookupKey(stripped)]).values()).filter(Boolean);

  for (const key of lookupKeys) {
    const matchedTeam = lookups.teamsByKey.get(key);
    if (matchedTeam) {
      return `Équipe - ${matchedTeam}`;
    }
    const matchedUser = lookups.usersByKey.get(key);
    if (matchedUser) {
      return `Agent - ${matchedUser}`;
    }
  }

  const partialTeamMatches = lookups.teamKeys.filter((key) => key.includes(compact) || compact.includes(key));
  if (partialTeamMatches.length === 1) {
    const matchedTeam = lookups.teamsByKey.get(partialTeamMatches[0]);
    if (matchedTeam) return `Équipe - ${matchedTeam}`;
  }

  const partialUserMatches = lookups.userKeys.filter((key) => key.includes(compact) || compact.includes(key));
  if (partialUserMatches.length === 1) {
    const matchedUser = lookups.usersByKey.get(partialUserMatches[0]);
    if (matchedUser) return `Agent - ${matchedUser}`;
  }

  return raw;
}

function parseIsoDate(value: string) {
  const parsed = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parsed) {
    throw new Error(`Date invalide: ${value}. Format attendu: AAAA-MM-JJ`);
  }

  const year = Number.parseInt(parsed[1], 10);
  const month = Number.parseInt(parsed[2], 10);
  const day = Number.parseInt(parsed[3], 10);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

async function main() {
  const args = parseArgs();

  const [users, teams] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.team.findMany({ select: { id: true, name: true } }),
  ]);

  const usersByPayerKey = new Map<string, string>();
  users.forEach((user) => {
    const keys = new Set<string>([
      normalizeLookupKey(user.name),
      compactLookupKey(user.name),
      normalizeLookupKey(`Agent ${user.name}`),
      compactLookupKey(`Agent ${user.name}`),
    ]);

    keys.forEach((key) => {
      if (key) usersByPayerKey.set(key, user.name);
    });
  });

  const teamsByPayerKey = new Map<string, string>();
  teams.forEach((team) => {
    buildTeamLookupCandidates(team.name).forEach((candidate) => {
      const normalizedCandidate = normalizeLookupKey(candidate);
      const compactCandidate = compactLookupKey(candidate);
      if (normalizedCandidate) teamsByPayerKey.set(normalizedCandidate, team.name);
      if (compactCandidate) teamsByPayerKey.set(compactCandidate, team.name);
    });
  });

  const where: {
    payerName: { not: null };
    soldAt?: { gte?: Date; lt?: Date; lte?: Date };
  } = {
    payerName: { not: null },
  };

  if (args.year !== undefined) {
    where.soldAt = {
      gte: new Date(Date.UTC(args.year, 0, 1, 0, 0, 0, 0)),
      lt: new Date(Date.UTC(args.year + 1, 0, 1, 0, 0, 0, 0)),
    };
  }

  if (args.from || args.to) {
    const current = where.soldAt ?? {};
    if (args.from) {
      current.gte = parseIsoDate(args.from);
    }
    if (args.to) {
      const end = parseIsoDate(args.to);
      end.setUTCDate(end.getUTCDate() + 1);
      current.lt = end;
    }
    where.soldAt = current;
  }

  const tickets = await prisma.ticketSale.findMany({
    where,
    select: { id: true, ticketNumber: true, payerName: true, soldAt: true },
    orderBy: [{ soldAt: "asc" }, { id: "asc" }],
    ...(args.limit ? { take: args.limit } : {}),
  });

  let unchanged = 0;
  const toUpdate: Array<{ id: string; oldValue: string | null; newValue: string | null; ticketNumber: string }> = [];

  for (const ticket of tickets) {
    const normalizedPayer = resolveImportedPayerName(ticket.payerName, {
      usersByKey: usersByPayerKey,
      teamsByKey: teamsByPayerKey,
      userKeys: Array.from(usersByPayerKey.keys()),
      teamKeys: Array.from(teamsByPayerKey.keys()),
    });

    const oldValue = ticket.payerName?.trim() ?? null;
    const newValue = normalizedPayer?.trim() ?? null;

    if (oldValue === newValue) {
      unchanged += 1;
      continue;
    }

    toUpdate.push({
      id: ticket.id,
      oldValue,
      newValue,
      ticketNumber: ticket.ticketNumber,
    });
  }

  if (args.apply && toUpdate.length > 0) {
    for (const row of toUpdate) {
      await prisma.ticketSale.update({
        where: { id: row.id },
        data: { payerName: row.newValue },
      });
    }
  }

  console.log(JSON.stringify({
    mode: args.apply ? "APPLY" : "DRY_RUN",
    filters: {
      year: args.year ?? null,
      from: args.from ?? null,
      to: args.to ?? null,
      limit: args.limit ?? null,
    },
    scanned: tickets.length,
    unchanged,
    toUpdate: toUpdate.length,
    samples: toUpdate.slice(0, 20),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
