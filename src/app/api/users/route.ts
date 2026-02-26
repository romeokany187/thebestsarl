import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

export async function GET() {
  const access = await requireApiRoles(["ADMIN", "MANAGER"]);
  if (access.error) {
    return access.error;
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      jobTitle: true,
      team: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: users });
}
