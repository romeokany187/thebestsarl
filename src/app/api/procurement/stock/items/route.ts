import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

export async function GET() {
  const access = await requireApiModuleAccess("procurement", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const items = await prisma.stockItem.findMany({
    include: {
      movements: {
        include: {
          performedBy: { select: { id: true, name: true } },
          needRequest: { select: { id: true, title: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 25,
      },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    take: 300,
  });

  return NextResponse.json({ data: items });
}
