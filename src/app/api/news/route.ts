import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

const newsCreateSchema = z.object({
  title: z.string().min(3).max(180),
  content: z.string().min(10).max(5000),
});

export async function GET() {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const posts = await prisma.newsPost.findMany({
    where: access.role === "ADMIN" ? {} : { isPublished: true },
    include: {
      author: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 80,
  });

  return NextResponse.json({ data: posts });
}

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN"]);
  if (access.error) return access.error;

  const body = await request.json();
  const parsed = newsCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const created = await prisma.newsPost.create({
    data: {
      title: parsed.data.title,
      content: parsed.data.content,
      isPublished: true,
      authorId: access.session.user.id,
    },
    include: {
      author: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
