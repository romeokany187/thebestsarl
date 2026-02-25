import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { attendanceSchema } from "@/lib/validators";
import { requireApiRoles } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const { searchParams } = new URL(request.url);
  const requestedUserId = searchParams.get("userId");
  const userId = access.role === "EMPLOYEE" ? access.session.user.id : requestedUserId;

  const records = await prisma.attendance.findMany({
    where: {
      ...(userId ? { userId } : {}),
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
    orderBy: { date: "desc" },
    take: 200,
  });

  return NextResponse.json({ data: records });
}

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE"]);
  if (access.error) {
    return access.error;
  }

  const body = await request.json();
  const parsed = attendanceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (access.role === "EMPLOYEE" && parsed.data.userId !== access.session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const day = new Date(parsed.data.date.toDateString());

  const record = await prisma.attendance.upsert({
    where: {
      userId_date: {
        userId: parsed.data.userId,
        date: day,
      },
    },
    update: {
      clockIn: parsed.data.clockIn,
      clockOut: parsed.data.clockOut,
      latenessMins: parsed.data.latenessMins ?? 0,
      overtimeMins: parsed.data.overtimeMins ?? 0,
      notes: parsed.data.notes,
    },
    create: {
      userId: parsed.data.userId,
      date: day,
      clockIn: parsed.data.clockIn,
      clockOut: parsed.data.clockOut,
      latenessMins: parsed.data.latenessMins ?? 0,
      overtimeMins: parsed.data.overtimeMins ?? 0,
      notes: parsed.data.notes,
    },
  });

  return NextResponse.json({ data: record }, { status: 201 });
}
