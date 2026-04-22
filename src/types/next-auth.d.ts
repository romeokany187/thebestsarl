import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      jobTitle?: string;
      teamName?: string | null;
      canImportTicketWorkbook?: boolean;
      sessionRevoked?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    jobTitle?: string;
    teamName?: string | null;
    canImportTicketWorkbook?: boolean;
    sessionRevoked?: boolean;
    sessionKey?: string;
  }
}
