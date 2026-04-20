import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { isPasswordAuthActive } from "@/lib/auth-rollout";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PostLoginPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/auth/signin");
  }

  const email = session.user.email.trim().toLowerCase();
  const dbUser = await prisma.user.findUnique({
    where: { email },
    select: {
      role: true,
      passwordHash: true,
    },
  });

  if (!dbUser) {
    redirect("/auth/signin");
  }

  if (isPasswordAuthActive() && !dbUser.passwordHash?.trim()) {
    redirect(`/auth/signin?setup=required&email=${encodeURIComponent(email)}`);
  }

  if (dbUser.role === "ADMIN") {
    redirect("/admin");
  }

  redirect("/reports");
}
