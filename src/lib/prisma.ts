import { PrismaClient } from "@prisma/client";

declare global {
  var prisma: PrismaClient | undefined;
}

const prismaClient = global.prisma ?? new PrismaClient({
  log: ["error"],
});

export const prisma = prismaClient;

global.prisma = prismaClient;
