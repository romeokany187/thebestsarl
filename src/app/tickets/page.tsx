import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function toQueryString(params: SearchParams) {
  const query = new URLSearchParams();
  query.set("view", "stats");

  for (const [key, value] of Object.entries(params)) {
    if (key === "view" || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        query.append(key, item);
      }
    } else {
      query.set(key, value);
    }
  }

  return query.toString();
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolved = (await searchParams) ?? {};
  redirect(`/sales?${toQueryString(resolved)}`);
}
