import { AttendanceStatus, PresenceLocationStatus, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const targetUserId = "cmnnqfi9e000j56dpzhewyj0k";
const defaultTimeZone = "Africa/Kinshasa";

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getZonedDateParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const readPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";

  return {
    year: Number.parseInt(readPart("year"), 10),
    month: Number.parseInt(readPart("month"), 10),
    day: Number.parseInt(readPart("day"), 10),
  };
}

function buildAttendanceDay(date: Date, timeZone: string) {
  const zoned = getZonedDateParts(date, timeZone);
  return new Date(Date.UTC(zoned.year, zoned.month - 1, zoned.day, 0, 0, 0, 0));
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function timeZoneOffsetMinutes(timeZone: string) {
  switch (timeZone) {
    case "Africa/Lubumbashi":
      return 120;
    case "Africa/Kinshasa":
    default:
      return 60;
  }
}

function makeLocalTimeUtc(date: Date, hour: number, minute: number, timeZone: string) {
  const zoned = getZonedDateParts(date, timeZone);
  const utcBase = Date.UTC(zoned.year, zoned.month - 1, zoned.day, hour, minute, 0, 0);
  return new Date(utcBase - (timeZoneOffsetMinutes(timeZone) * 60 * 1000));
}

async function resolveAttendanceTimeZone(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { team: { select: { name: true } } },
  });

  const teamName = user?.team?.name?.trim().toLowerCase() ?? "";

  if (teamName.includes("lubumbashi")) {
    return "Africa/Lubumbashi";
  }

  return defaultTimeZone;
}

async function main() {
  const today = new Date();
  const timeZone = await resolveAttendanceTimeZone(targetUserId);
  const startDate = getMonthStart(today);

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, email: true },
  });

  if (!targetUser) {
    throw new Error(`User not found: ${targetUserId}`);
  }

  let createdCount = 0;
  const cursor = new Date(startDate);

  while (cursor <= today) {
    const dayKey = buildAttendanceDay(cursor, timeZone);
    const minute = randomInt(0, 30);
    const clockIn = makeLocalTimeUtc(cursor, 8, minute, timeZone);

    await prisma.attendance.upsert({
      where: {
        userId_date: {
          userId: targetUserId,
          date: dayKey,
        },
      },
      update: {
        clockIn,
        signedAt: clockIn,
        status: AttendanceStatus.PRESENT,
        latenessMins: 0,
        overtimeMins: 0,
        signLatitude: null,
        signLongitude: null,
        signAccuracyM: null,
        signAddress: null,
        locationStatus: PresenceLocationStatus.UNKNOWN,
        matchedSiteId: null,
        matchDistanceM: null,
        notes: "Generated attendance seed for demo/testing",
      },
      create: {
        userId: targetUserId,
        date: dayKey,
        clockIn,
        signedAt: clockIn,
        status: AttendanceStatus.PRESENT,
        latenessMins: 0,
        overtimeMins: 0,
        signLatitude: null,
        signLongitude: null,
        signAccuracyM: null,
        signAddress: null,
        locationStatus: PresenceLocationStatus.UNKNOWN,
        matchDistanceM: null,
        notes: "Generated attendance seed for demo/testing",
      },
    });

    createdCount += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  console.log(`Created or updated ${createdCount} attendance records for ${targetUser.name} (${targetUser.email})`);
  console.log(`Time zone: ${timeZone}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });