import { AttendanceStatus, PresenceLocationStatus, PrismaClient, SiteType } from "@prisma/client";

const prisma = new PrismaClient();

const targetUserId = process.env.ATTENDANCE_USER_ID?.trim() || "cmnnqfi9e000j56dpzhewyj0k";
const defaultTimeZone = "Africa/Kinshasa";
const kinshasaOfficeSiteName = "Agence de Kinshasa";
const defaultOfficeAddress = "Agence de Kinshasa, Kinshasa";
const defaultKinshasaLatitude = -4.325;
const defaultKinshasaLongitude = 15.322;
const defaultClockInStart = "08:00";
const defaultClockInEnd = "08:30";

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

function parseTimeToMinutes(value: string, fallback: number) {
  const normalized = value.trim();
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return (hour * 60) + minute;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
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
  const kinshasaOffice = await resolveKinshasaOfficeSite();
  const clockInStartMinutes = parseTimeToMinutes(process.env.ATTENDANCE_CLOCKIN_START ?? defaultClockInStart, 8 * 60);
  const clockInEndMinutes = parseTimeToMinutes(process.env.ATTENDANCE_CLOCKIN_END ?? defaultClockInEnd, (8 * 60) + 30);
  const minClockInMinutes = Math.min(clockInStartMinutes, clockInEndMinutes);
  const maxClockInMinutes = Math.max(clockInStartMinutes, clockInEndMinutes);

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, email: true },
  });

  if (!targetUser) {
    throw new Error(`User not found: ${targetUserId}`);
  }

  const lastAttendance = await prisma.attendance.findFirst({
    where: {
      userId: targetUserId,
      OR: [
        { signedAt: { not: null } },
        { clockIn: { not: null } },
      ],
    },
    orderBy: [
      { signedAt: "desc" },
      { clockIn: "desc" },
      { date: "desc" },
    ],
    select: {
      signedAt: true,
      clockIn: true,
      date: true,
    },
  });

  const envStart = process.env.ATTENDANCE_START_DATE?.trim();
  const envEnd = process.env.ATTENDANCE_END_DATE?.trim();

  const referenceDate = lastAttendance?.signedAt ?? lastAttendance?.clockIn ?? lastAttendance?.date;

  let startDate = referenceDate
    ? addDays(buildAttendanceDay(referenceDate, timeZone), 1)
    : getMonthStart(today);

  if (envStart) {
    const parsed = new Date(envStart);
    if (!Number.isNaN(parsed.getTime())) {
      startDate = buildAttendanceDay(parsed, timeZone);
    }
  }

  let endDate = today;
  if (envEnd) {
    const parsedEnd = new Date(envEnd);
    if (!Number.isNaN(parsedEnd.getTime())) {
      endDate = buildAttendanceDay(parsedEnd, timeZone);
    }
  }

  let createdCount = 0;
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    if (isSundayInTimeZone(cursor, timeZone)) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

    const dayKey = buildAttendanceDay(cursor, timeZone);
    const randomMinuteOfDay = randomInt(minClockInMinutes, maxClockInMinutes);
    const clockInHour = Math.floor(randomMinuteOfDay / 60);
    const clockInMinute = randomMinuteOfDay % 60;
    const clockIn = makeLocalTimeUtc(cursor, clockInHour, clockInMinute, timeZone);

    const observation = `Signature automatique: Entrée enregistrée. Heure locale (${timeZone}): ${new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(clockIn)}.`;

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
        notes: observation,
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
        notes: observation,
      },
    });

    console.log(`Signed ${dayKey.toISOString().slice(0, 10)} for ${targetUser.name} at ${clockIn.toISOString()} - observation: ${observation}`);

    createdCount += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  console.log(`Created or updated ${createdCount} attendance records for ${targetUser.name} (${targetUser.email})`);
  console.log(`Processed range: ${startDate.toISOString().slice(0, 10)} -> ${endDate.toISOString().slice(0, 10)}`);
  console.log(`Clock-in interval: ${String(Math.floor(minClockInMinutes / 60)).padStart(2, "0")}:${String(minClockInMinutes % 60).padStart(2, "0")} -> ${String(Math.floor(maxClockInMinutes / 60)).padStart(2, "0")}:${String(maxClockInMinutes % 60).padStart(2, "0")}`);
  console.log("Sundays excluded.");
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