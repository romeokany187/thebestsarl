import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { isPasswordAuthActive } from "@/lib/auth-rollout";
import { prisma } from "@/lib/prisma";
import { normalizeAuthEmail, verifyUserPassword } from "@/lib/password-setup";
import { shouldForceReauthenticateSession } from "@/lib/session-security";

process.env.AUTH_TRUST_HOST = process.env.AUTH_TRUST_HOST?.trim() || "true";

const DEFAULT_ADMIN_EMAIL = "romeokany187@gmail.com";
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const SESSION_UPDATE_AGE_SECONDS = 30 * 60;

const adminEmails = new Set(
  `${process.env.ADMIN_EMAILS ?? ""},${process.env.ADMIN_EMAIL ?? ""},${DEFAULT_ADMIN_EMAIL}`
    .split(",")
    .map((email) => normalizeAuthEmail(email))
    .filter(Boolean),
);

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim(),
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  jwt: {
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  providers: [
    CredentialsProvider({
      name: "EmailPassword",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        if (!isPasswordAuthActive()) {
          return null;
        }

        const email = normalizeAuthEmail(credentials?.email);
        const password = credentials?.password?.trim() ?? "";

        if (!email || !password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            name: true,
            email: true,
            passwordHash: true,
            role: true,
            jobTitle: true,
            canImportTicketWorkbook: true,
            team: { select: { name: true } },
          },
        });

        if (!user) {
          return null;
        }

        const isValid = await verifyUserPassword(password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          jobTitle: user.jobTitle,
          teamName: user.team?.name ?? null,
          canImportTicketWorkbook: user.canImportTicketWorkbook,
        };
      },
    }),
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
      if (account?.provider === "credentials") {
        return isPasswordAuthActive();
      }

      if (account?.provider !== "google" || !user.email) {
        return false;
      }

      const normalizedEmail = normalizeAuthEmail(user.email);
      const isAdminEmail = adminEmails.has(normalizedEmail);

      try {
        const existing = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          select: {
            id: true,
            role: true,
            canImportTicketWorkbook: true,
            passwordHash: true,
          },
        });

        if (isPasswordAuthActive() && existing?.passwordHash?.trim()) {
          return "/auth/error?error=PasswordLoginRequired";
        }

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
      const tokenIssuedAt = typeof token.iat === "number" ? token.iat : undefined;

      if (shouldForceReauthenticateSession(tokenIssuedAt)) {
        token.sessionRevoked = true;
      }

      const authUser = user as (typeof user & {
        id?: string;
        role?: string;
        jobTitle?: string;
        teamName?: string | null;
        canImportTicketWorkbook?: boolean;
      }) | undefined;

      if (authUser?.id) {
        token.sub = authUser.id;
      }
      if (typeof authUser?.role === "string") {
        token.role = authUser.role;
      }
      if (typeof authUser?.jobTitle === "string") {
        token.jobTitle = authUser.jobTitle;
      }
      if (typeof authUser?.teamName !== "undefined") {
        token.teamName = authUser.teamName ?? null;
      }
      if (typeof authUser?.canImportTicketWorkbook !== "undefined") {
        token.canImportTicketWorkbook = Boolean(authUser.canImportTicketWorkbook);
      }
      if (authUser?.id) {
        token.sessionRevoked = false;
      }
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
              email: true,
              role: true,
              jobTitle: true,
              canImportTicketWorkbook: true,
              passwordHash: true,
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
            if (isPasswordAuthActive() && !dbUser.passwordHash?.trim()) {
              token.sessionRevoked = true;
            }
          } else {
            token.sessionRevoked = true;
          }
        } catch (error) {
          console.error("[auth] jwt database error", error);
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (token.sessionRevoked) {
        if (session.user) {
          session.user.id = "";
          session.user.role = "";
          session.user.jobTitle = undefined;
          session.user.teamName = null;
          session.user.canImportTicketWorkbook = false;
          session.user.name = undefined;
          session.user.email = undefined;
          session.user.sessionRevoked = true;
        }
        return session;
      }

      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = token.role as string;
        session.user.jobTitle = token.jobTitle as string;
        session.user.teamName = (token.teamName as string | null) ?? null;
        session.user.canImportTicketWorkbook = Boolean(token.canImportTicketWorkbook);
        session.user.name = token.name ?? session.user.name;
        session.user.email = token.email ?? session.user.email;
        session.user.sessionRevoked = false;
      }
      return session;
    },
  },
};
