import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { buildNewsPdf } from "@/lib/news-pdf";

type RouteContext = {
  params: Promise<{ id: string }>;
};


export async function GET(request: NextRequest, context: RouteContext) {
  const access = await requireApiModuleAccess("news", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    if (access.error.status === 401) {
      const signInUrl = new URL("/auth/signin", request.url);
      signInUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(signInUrl);
    }
    return access.error;
  }

  const { id } = await context.params;

  const post = await prisma.newsPost.findUnique({
    where: { id },
    include: {
      author: {
        select: { name: true, email: true },
      },
    },
  });

  if (!post) {
    return NextResponse.json({ error: "Nouvelle introuvable." }, { status: 404 });
  }

  if (!post.isPublished && access.role !== "ADMIN") {
    return NextResponse.json({ error: "Nouvelle non disponible." }, { status: 403 });
  }

  const printedBy = access.session.user.name ?? access.session.user.email ?? "Utilisateur";
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildNewsPdf(post, printedBy);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur lors de la génération du PDF." },
      { status: 500 },
    );
  }

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="nouvelle-${post.id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
