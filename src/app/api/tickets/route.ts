import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ticketSchema } from "@/lib/validators";
import { calculateTicketMetrics } from "@/lib/kpi";
import { requireApiRoles } from "@/lib/rbac";

export async function GET() {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const tickets = await prisma.ticketSale.findMany({
    include: {
      airline: true,
      seller: {
        select: { id: true, name: true, email: true },
      },
      payments: true,
    },
    orderBy: { soldAt: "desc" },
    take: 200,
  });

  const metrics = calculateTicketMetrics(tickets);

  return NextResponse.json({ data: tickets, metrics });
}

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE"]);
  if (access.error) {
    return access.error;
  }

  const body = await request.json();
  const parsed = ticketSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const ticket = await prisma.ticketSale.create({
    data: parsed.data,
  });

  return NextResponse.json({ data: ticket }, { status: 201 });
}
