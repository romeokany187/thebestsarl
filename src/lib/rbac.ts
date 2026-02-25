import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";

export type AppRole = "ADMIN" | "MANAGER" | "EMPLOYEE" | "ACCOUNTANT";

function extractRole(role: unknown): AppRole | null {
  if (role === "ADMIN" || role === "MANAGER" || role === "EMPLOYEE" || role === "ACCOUNTANT") {
    return role;
  }
  return null;
}

export async function requireApiRoles(allowedRoles: AppRole[]) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      session: null,
      role: null,
    };
  }

  const role = extractRole(session.user.role);

  if (!role || !allowedRoles.includes(role)) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      session,
      role,
    };
  }

  return {
    error: null,
    session,
    role,
  };
}

export async function requirePageRoles(allowedRoles: AppRole[]) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const role = extractRole(session.user.role);

  if (!role || !allowedRoles.includes(role)) {
    redirect("/");
  }

  return {
    session,
    role,
  };
}
