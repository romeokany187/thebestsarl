import { NextResponse } from "next/server";
import { requireApiModuleAccess } from "@/lib/rbac";

export async function POST() {
  const access = await requireApiModuleAccess("admin", ["ADMIN"]);
  if (access.error) return access.error;

  return NextResponse.json(
    { error: "Injection des données de test désactivée." },
    { status: 410 },
  );
}
