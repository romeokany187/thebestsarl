import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { attendanceSignSchema } from "@/lib/validators";

type TeamOfficeGeofence = {
  names: string[];
  latitude: number;
  longitude: number;
  radiusMeters: number;
  label: string;
  timeZone: string;
};

const TEAM_OFFICE_GEOFENCES: TeamOfficeGeofence[] = [
  {
    names: ["lubumbashi"],
    latitude: -11.66473,
    longitude: 27.48597,
    radiusMeters: 200,
    label: "Bureau Lubumbashi",
    timeZone: "Africa/Lubumbashi",
  },
  {
    names: ["mbujimayi", "mbuji-mayi", "mbuji mayi"],
    latitude: -6.13438,
    longitude: 23.60965,
    radiusMeters: 200,
    label: "Bureau Mbuji-Mayi",
    timeZone: "Africa/Lubumbashi",
  },
];

const DEFAULT_REFERENCE_SITE = {
  latitude: -4.30706,
  longitude: 15.30875,
  radiusMeters: 200,
  name: "Point de référence Marché Central",
  timeZone: "Africa/Kinshasa",
};

function normalizeTeamName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function resolveTeamGeofence(teamName: string | null | undefined) {
  if (!teamName) {
    return null;
  }

  const normalized = normalizeTeamName(teamName);
  return TEAM_OFFICE_GEOFENCES.find((item) => item.names.includes(normalized)) ?? null;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const earthRadius = 6371000;
  const dLat = toRadians(latitudeB - latitudeA);
  const dLon = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function resolveAttendanceTimeZone(teamName: string | null | undefined) {
  return resolveTeamGeofence(teamName)?.timeZone ?? DEFAULT_REFERENCE_SITE.timeZone;
}

function getZonedDateParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const readPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";

  return {
    year: Number.parseInt(readPart("year"), 10),
    month: Number.parseInt(readPart("month"), 10),
    day: Number.parseInt(readPart("day"), 10),
    hour: Number.parseInt(readPart("hour"), 10),
    minute: Number.parseInt(readPart("minute"), 10),
    second: Number.parseInt(readPart("second"), 10),
    weekday: readPart("weekday").toLowerCase(),
  };
}

function buildAttendanceDay(signTime: Date, timeZone: string) {
  const zoned = getZonedDateParts(signTime, timeZone);
  return new Date(Date.UTC(zoned.year, zoned.month - 1, zoned.day, 0, 0, 0, 0));
}

function computeLatenessMinutes(signTime: Date, timeZone: string) {
  const zoned = getZonedDateParts(signTime, timeZone);
  const signMinutes = (zoned.hour * 60) + zoned.minute;
  const officeStartMinutes = (8 * 60) + 30;
  return Math.max(0, signMinutes - officeStartMinutes);
}

function expectedEndTime(signTime: Date, timeZone: string) {
  const zoned = getZonedDateParts(signTime, timeZone);
  const isSaturday = zoned.weekday.startsWith("sat");
  const currentMinutes = (zoned.hour * 60) + zoned.minute;
  const endMinutes = isSaturday ? 13 * 60 : 16 * 60;

  return {
    currentMinutes,
    endMinutes,
    label: isSaturday ? "13h00 (samedi)" : "16h00",
  };
}

async function resolveAddressFromCoords(latitude: number, longitude: number) {
  const formatNominatimAddress = (address: Record<string, string | undefined> | undefined) => {
    if (!address) {
      return null;
    }

    const houseNumber = address.house_number ?? null;
    const avenue =
      address.road
      ?? address.residential
      ?? address.street
      ?? address.pedestrian
      ?? address.path
      ?? null;
    const quarter =
      address.suburb
      ?? address.neighbourhood
      ?? address.quarter
      ?? null;
    const commune =
      address.city_district
      ?? address.municipality
      ?? address.borough
      ?? address.township
      ?? null;

    const detailed = [
      houseNumber ? `N° ${houseNumber}` : null,
      avenue ? `Avenue ${avenue}` : null,
      quarter ? `Quartier ${quarter}` : null,
      commune ? `Commune ${commune}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    return detailed || null;
  };

  const formatBigDataCloudAddress = (payload: Record<string, unknown>) => {
    const locality = typeof payload.locality === "string" ? payload.locality : null;
    const city = typeof payload.city === "string" ? payload.city : null;
    const subdivision = typeof payload.principalSubdivision === "string" ? payload.principalSubdivision : null;
    const country = typeof payload.countryName === "string" ? payload.countryName : null;

    const label = [locality ?? city, subdivision, country]
      .filter(Boolean)
      .join(", ");

    return label || null;
  };

  try {
    const nominatimUrl = new URL("https://nominatim.openstreetmap.org/reverse");
    nominatimUrl.searchParams.set("format", "jsonv2");
    nominatimUrl.searchParams.set("lat", String(latitude));
    nominatimUrl.searchParams.set("lon", String(longitude));
    nominatimUrl.searchParams.set("addressdetails", "1");

    const nominatimResponse = await fetch(nominatimUrl.toString(), {
      headers: {
        "Accept-Language": "fr",
        "User-Agent": "THEBEST-SARL/1.0 (attendance)",
      },
      cache: "no-store",
    });

    if (nominatimResponse.ok) {
      const payload = await nominatimResponse.json();
      const nominatimAddress = formatNominatimAddress(payload?.address);
      if (nominatimAddress) {
        return nominatimAddress;
      }
    }
  } catch {
    // fallback below
  }

  try {
    const bigDataCloudUrl = new URL("https://api-bdc.net/data/reverse-geocode-client");
    bigDataCloudUrl.searchParams.set("latitude", String(latitude));
    bigDataCloudUrl.searchParams.set("longitude", String(longitude));
    bigDataCloudUrl.searchParams.set("localityLanguage", "fr");

    const bigDataCloudResponse = await fetch(bigDataCloudUrl.toString(), {
      cache: "no-store",
    });

    if (!bigDataCloudResponse.ok) {
      return null;
    }

    const payload = await bigDataCloudResponse.json();
    return formatBigDataCloudAddress(payload as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("attendance", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const requestedUserId = request.nextUrl.searchParams.get("userId")?.trim();
  const canManageTeamAttendance = access.role === "ADMIN" || access.role === "DIRECTEUR_GENERAL";

  if (requestedUserId && requestedUserId !== access.session.user.id && !canManageTeamAttendance) {
    return NextResponse.json(
      { error: "Seuls l'administrateur et la direction peuvent consulter la signature d'un autre employé." },
      { status: 403 },
    );
  }

  const targetUserId = requestedUserId && canManageTeamAttendance
    ? requestedUserId
    : access.session.user.id;

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { team: { select: { name: true } } },
  });

  if (!targetUser) {
    return NextResponse.json({ error: "Employé introuvable." }, { status: 404 });
  }

  const now = new Date();
  const attendanceTimeZone = resolveAttendanceTimeZone(targetUser.team?.name);
  const day = buildAttendanceDay(now, attendanceTimeZone);

  const todayRecord = await prisma.attendance.findUnique({
    where: {
      userId_date: {
        userId: targetUserId,
        date: day,
      },
    },
    select: {
      id: true,
      clockIn: true,
      clockOut: true,
      latenessMins: true,
      overtimeMins: true,
    },
  });

  return NextResponse.json({
    data: {
      hasClockIn: Boolean(todayRecord?.clockIn),
      hasClockOut: Boolean(todayRecord?.clockOut),
      clockIn: todayRecord?.clockIn ?? null,
      clockOut: todayRecord?.clockOut ?? null,
      latenessMins: todayRecord?.latenessMins ?? 0,
      overtimeMins: todayRecord?.overtimeMins ?? 0,
    },
  });
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("attendance", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const body = await request.json();
  const parsed = attendanceSignSchema.safeParse(body);

  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    const firstFieldError = Object.values(flattened.fieldErrors)
      .flat()
      .find((item) => typeof item === "string" && item.trim());

    return NextResponse.json(
      { error: flattened.formErrors[0] ?? firstFieldError ?? "Coordonnées de signature invalides." },
      { status: 400 },
    );
  }

  const signTime = new Date();
  const { latitude, longitude, accuracyM, action } = parsed.data;
  const requestedUserId = parsed.data.userId?.trim();
  const canManageTeamAttendance = access.role === "ADMIN" || access.role === "DIRECTEUR_GENERAL";

  if (requestedUserId && requestedUserId !== access.session.user.id && !canManageTeamAttendance) {
    return NextResponse.json(
      { error: "Seuls l'administrateur et la direction peuvent signer pour un autre employé." },
      { status: 403 },
    );
  }

  const targetUserId = requestedUserId && canManageTeamAttendance
    ? requestedUserId
    : access.session.user.id;

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      name: true,
      team: { select: { name: true } },
    },
  });

  if (!targetUser) {
    return NextResponse.json({ error: "Employé introuvable." }, { status: 404 });
  }

  const attendanceTimeZone = resolveAttendanceTimeZone(targetUser.team?.name);
  const day = buildAttendanceDay(signTime, attendanceTimeZone);
  const teamGeofence = resolveTeamGeofence(targetUser.team?.name);
  const referenceSite = teamGeofence
    ? {
      latitude: teamGeofence.latitude,
      longitude: teamGeofence.longitude,
      radiusMeters: teamGeofence.radiusMeters,
      name: teamGeofence.label,
      timeZone: teamGeofence.timeZone,
    }
    : DEFAULT_REFERENCE_SITE;
  const gpsResolvedAddress = await resolveAddressFromCoords(latitude, longitude);

  const distanceToReference = distanceMeters(
    latitude,
    longitude,
    referenceSite.latitude,
    referenceSite.longitude,
  );
  const effectiveRadius = Math.max(referenceSite.radiusMeters, Math.round(accuracyM ?? 0));
  const isInReferencePerimeter = distanceToReference <= effectiveRadius;

  const resolvedAddress = gpsResolvedAddress
    ?? (isInReferencePerimeter ? referenceSite.name : null);

  let matchedSite: {
    name: string;
    distanceM: number;
  } | null = null;

  if (isInReferencePerimeter) {
    matchedSite = {
      name: referenceSite.name,
      distanceM: distanceToReference,
    };
  }

  const locationStatus = isInReferencePerimeter
    ? "OFFICE"
    : "OFFSITE";
  const isAtOffice = locationStatus === "OFFICE";

  const isClockOut = action === "CLOCK_OUT";
  const latenessMins = isClockOut ? 0 : computeLatenessMinutes(signTime, attendanceTimeZone);
  const { currentMinutes, endMinutes, label: endTimeLabel } = expectedEndTime(signTime, attendanceTimeZone);
  const overtimeMins = isClockOut
    ? Math.max(0, currentMinutes - endMinutes)
    : 0;
  const earlyDepartureMins = isClockOut
    ? Math.max(0, endMinutes - currentMinutes)
    : 0;

  const todayRecord = await prisma.attendance.findUnique({
    where: {
      userId_date: {
        userId: targetUserId,
        date: day,
      },
    },
    select: { clockIn: true, clockOut: true },
  });

  if (!isClockOut && todayRecord?.clockIn) {
    return NextResponse.json(
      { error: "La présence d'entrée du jour est déjà signée." },
      { status: 400 },
    );
  }

  if (isClockOut) {
    if (!todayRecord?.clockIn) {
      return NextResponse.json(
        { error: "Impossible de signer la sortie sans entrée signée." },
        { status: 400 },
      );
    }

    if (todayRecord.clockOut) {
      return NextResponse.json(
        { error: "La sortie du jour est déjà signée." },
        { status: 400 },
      );
    }
  }

  const timingNote = isClockOut
    ? overtimeMins > 0
      ? `Heures supp: +${overtimeMins} min (après ${endTimeLabel}).`
      : earlyDepartureMins > 0
        ? `Sortie anticipée: ${earlyDepartureMins} min avant ${endTimeLabel}.`
        : `Sortie à l'heure (${endTimeLabel}).`
    : null;
  const signedByAnotherUser = targetUserId !== access.session.user.id;
  const actorLabel = access.session.user.name?.trim() || access.session.user.email || "Administration";
  const signedByNote = signedByAnotherUser
    ? ` Signée par ${actorLabel} pour ${targetUser.name?.trim() || "cet employé"}.`
    : "";

  const signNote = isClockOut
    ? `${isAtOffice ? "Sortie signée au bureau." : "Sortie signée hors bureau."} ${timingNote}${resolvedAddress ? ` Adresse approximative: ${resolvedAddress}.` : ""}${signedByNote}`
    : `${isAtOffice ? "Entrée signée au bureau." : "Entrée signée hors bureau."}${resolvedAddress ? ` Adresse approximative: ${resolvedAddress}.` : ""}${signedByNote}`;

  const record = await prisma.attendance.upsert({
    where: {
      userId_date: {
        userId: targetUserId,
        date: day,
      },
    },
    update: {
      ...(isClockOut ? { clockOut: signTime } : { clockIn: signTime, signedAt: signTime }),
      status: "PRESENT",
      ...(isClockOut ? { overtimeMins } : { latenessMins }),
      signLatitude: latitude,
      signLongitude: longitude,
      signAccuracyM: accuracyM,
      signAddress: resolvedAddress,
      locationStatus,
      matchedSiteId: null,
      matchDistanceM: distanceToReference,
      notes: signNote,
    },
    create: {
      userId: targetUserId,
      date: day,
      ...(isClockOut ? { clockOut: signTime } : { clockIn: signTime, signedAt: signTime }),
      status: "PRESENT",
      ...(isClockOut ? { overtimeMins } : { latenessMins }),
      signLatitude: latitude,
      signLongitude: longitude,
      signAccuracyM: accuracyM,
      signAddress: resolvedAddress,
      locationStatus,
      matchedSiteId: null,
      matchDistanceM: distanceToReference,
      notes: signNote,
    },
    include: {
      matchedSite: {
        select: { id: true, name: true, type: true },
      },
    },
  });

  return NextResponse.json({
    data: record,
    metadata: {
      action,
      signedAt: signTime.toISOString(),
      locationStatus,
      isAtOffice,
      matchedSiteName: matchedSite?.name ?? null,
      matchDistanceM: distanceToReference,
      resolvedAddress,
      targetUserId,
      targetUserName: targetUser.name ?? null,
      signedForSelf: !signedByAnotherUser,
      timeZone: attendanceTimeZone,
    },
  });
}
