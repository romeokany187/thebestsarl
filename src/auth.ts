import { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";

const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

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
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !user.email) {
        return false;
      }

      const normalizedEmail = user.email.trim().toLowerCase();
      const isAdminEmail = Boolean(adminEmail && normalizedEmail === adminEmail);

      const existing = await prisma.user.findUnique({ where: { email: user.email } });

      if (!existing) {
        await prisma.user.create({
          data: {
            name: user.name ?? user.email.split("@")[0],
            email: user.email,
            passwordHash: "",
            role: isAdminEmail ? "ADMIN" : "EMPLOYEE",
            jobTitle: isAdminEmail ? "DIRECTION_GENERALE" : "AGENT_TERRAIN",
          },
        });
      } else if (isAdminEmail && existing.role !== "ADMIN") {
        await prisma.user.update({
          where: { id: existing.id },
          data: { role: "ADMIN", jobTitle: "DIRECTION_GENERALE" },
        });
      } else if (isAdminEmail && existing.jobTitle !== "DIRECTION_GENERALE") {
        await prisma.user.update({
          where: { id: existing.id },
          data: { jobTitle: "DIRECTION_GENERALE" },
        });
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email;
      }

      if (token.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email },
          select: { id: true, name: true, role: true, jobTitle: true, team: { select: { name: true } } },
        });

        if (dbUser) {
          token.sub = dbUser.id;
          token.name = dbUser.name;
          token.role = dbUser.role;
          token.jobTitle = dbUser.jobTitle;
          token.teamName = dbUser.team?.name ?? null;
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
        session.user.name = token.name ?? session.user.name;
        session.user.email = token.email ?? session.user.email;
      }
      return session;
    },
  },
};
