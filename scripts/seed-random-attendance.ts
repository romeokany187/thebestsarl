import { AttendanceStatus, PresenceLocationStatus, PrismaClient, SiteType } from "@prisma/client";

const prisma = new PrismaClient();

const targetUserId = "cmnnqfi9e000j56dpzhewyj0k";
const defaultTimeZone = "Africa/Kinshasa";
const kinshasaOfficeSiteName = "Agence de Kinshasa";
const defaultOfficeAddress = "Agence de Kinshasa, Kinshasa";
const defaultKinshasaLatitude = -4.325;
const defaultKinshasaLongitude = 15.322;

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

function isSundayInTimeZone(date: Date, timeZone: string) {
  const zonedDayStart = buildAttendanceDay(date, timeZone);
  return zonedDayStart.getUTCDay() === 0;
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

async function resolveKinshasaOfficeSite() {
  const existing = await prisma.workSite.findFirst({
    where: {
      type: SiteType.OFFICE,
      OR: [
        { name: kinshasaOfficeSiteName },
        { name: { contains: "kinshasa" } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.workSite.create({
    data: {
      name: kinshasaOfficeSiteName,
      type: SiteType.OFFICE,
      latitude: defaultKinshasaLatitude,
      longitude: defaultKinshasaLongitude,
      radiusMeters: 150,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
    },
  });
}

async function main() {
  const today = new Date();
  const timeZone = await resolveAttendanceTimeZone(targetUserId);
  const startDate = getMonthStart(today);
  const kinshasaOffice = await resolveKinshasaOfficeSite();

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, email: true },
  });

  if (!targetUser) {
    throw new Error(`User not found: ${targetUserId}`);
  }

  let createdCount = 0;
  let deletedSundayCount = 0;
  const cursor = new Date(startDate);

  const sundaysToDelete: Date[] = [];
  while (cursor <= today) {
    if (isSundayInTimeZone(cursor, timeZone)) {
      sundaysToDelete.push(buildAttendanceDay(cursor, timeZone));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  if (sundaysToDelete.length > 0) {
    const deleted = await prisma.attendance.deleteMany({
      where: {
        userId: targetUserId,
        date: {
          in: sundaysToDelete,
        },
      },
    });
    deletedSundayCount = deleted.count;
  }

  cursor.setTime(startDate.getTime());

  while (cursor <= today) {
    if (isSundayInTimeZone(cursor, timeZone)) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

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
        signLatitude: kinshasaOffice.latitude,
        signLongitude: kinshasaOffice.longitude,
        signAccuracyM: 20,
        signAddress: defaultOfficeAddress,
        locationStatus: PresenceLocationStatus.OFFICE,
        matchedSiteId: kinshasaOffice.id,
        matchDistanceM: 0,
        notes: null,
      },
      create: {
        userId: targetUserId,
        date: dayKey,
        clockIn,
        signedAt: clockIn,
        status: AttendanceStatus.PRESENT,
        latenessMins: 0,
        overtimeMins: 0,
        signLatitude: kinshasaOffice.latitude,
        signLongitude: kinshasaOffice.longitude,
        signAccuracyM: 20,
        signAddress: defaultOfficeAddress,
        locationStatus: PresenceLocationStatus.OFFICE,
        matchedSiteId: kinshasaOffice.id,
        matchDistanceM: 0,
        notes: null,
      },
    });

    createdCount += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  console.log(`Created or updated ${createdCount} attendance records for ${targetUser.name} (${targetUser.email})`);
  console.log(`Deleted ${deletedSundayCount} Sunday attendance records for ${targetUser.name} (${targetUser.email})`);
  console.log(`Attendance linked to site: ${kinshasaOffice.name} (${kinshasaOffice.latitude}, ${kinshasaOffice.longitude})`);
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