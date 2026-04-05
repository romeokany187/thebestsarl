import { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";

const DEFAULT_ADMIN_EMAIL = "romeokany187@gmail.com";

function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

const adminEmails = new Set(
  `${process.env.ADMIN_EMAILS ?? ""},${process.env.ADMIN_EMAIL ?? ""},${DEFAULT_ADMIN_EMAIL}`
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean),
);

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !user.email) {
        return false;
      }

      const normalizedEmail = normalizeEmail(user.email);
      const isAdminEmail = adminEmails.has(normalizedEmail);

      try {
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });

        if (!existing) {
          await prisma.user.create({
            data: {
              name: user.name ?? normalizedEmail.split("@")[0],
              email: normalizedEmail,
              passwordHash: "",
              role: isAdminEmail ? "ADMIN" : "EMPLOYEE",
              jobTitle: "AGENT_TERRAIN",
              canImportTicketWorkbook: isAdminEmail,
            },
          });
        } else if (isAdminEmail && existing.role !== "ADMIN") {
          await prisma.user.update({
            where: { id: existing.id },
            data: { role: "ADMIN", canImportTicketWorkbook: true },
          });
        } else if (isAdminEmail && !existing.canImportTicketWorkbook) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { canImportTicketWorkbook: true },
          });
        }

        return true;
      } catch (error) {
        console.error("[auth] signIn database error", error);
        return "/auth/error?error=DatabaseUnavailable";
      }
    },
    async jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email.trim().toLowerCase();
      }

      if (token.email) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email: String(token.email).trim().toLowerCase() },
            select: {
              id: true,
              name: true,
              role: true,
              jobTitle: true,
              canImportTicketWorkbook: true,
              team: { select: { name: true } },
            },
          });

          if (dbUser) {
            token.sub = dbUser.id;
            token.name = dbUser.name;
            token.role = dbUser.role;
            token.jobTitle = dbUser.jobTitle;
            token.teamName = dbUser.team?.name ?? null;
            token.canImportTicketWorkbook = dbUser.canImportTicketWorkbook;
          }
        } catch (error) {
          console.error("[auth] jwt database error", error);
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = token.role as string;
        session.user.jobTitle = token.jobTitle as string;
        session.user.teamName = (token.teamName as string | null) ?? null;
        session.user.canImportTicketWorkbook = Boolean(token.canImportTicketWorkbook);
        session.user.name = token.name ?? session.user.name;
        session.user.email = token.email ?? session.user.email;
      }
      return session;
    },
  },
};
