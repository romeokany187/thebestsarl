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
};

const TEAM_OFFICE_GEOFENCES: TeamOfficeGeofence[] = [
  {
    names: ["lubumbashi"],
    latitude: -11.66473,
    longitude: 27.48597,
    radiusMeters: 200,
    label: "Bureau Lubumbashi",
  },
  {
    names: ["mbujimayi", "mbuji-mayi", "mbuji mayi"],
    latitude: -6.13438,
    longitude: 23.60965,
    radiusMeters: 200,
    label: "Bureau Mbuji-Mayi",
  },
];

const DEFAULT_REFERENCE_SITE = {
  latitude: -4.30706,
  longitude: 15.30875,
  radiusMeters: 200,
  name: "Point de référence Marché Central",
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

function computeLatenessMinutes(signTime: Date) {
  const officeStart = new Date(signTime);
  officeStart.setHours(8, 30, 0, 0);
  // Retard starts only after 08:30; partial minutes are not rounded up.
  const deltaMins = Math.floor((signTime.getTime() - officeStart.getTime()) / 60000);
  return Math.max(0, deltaMins);
}

function expectedEndTime(signTime: Date) {
  const isSaturday = signTime.getDay() === 6;
  const end = new Date(signTime);
  end.setHours(isSaturday ? 13 : 16, 0, 0, 0);
  return {
    end,
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

export async function GET() {
  const access = await requireApiModuleAccess("attendance", ["MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const now = new Date();
  const day = new Date(now.toDateString());

  const todayRecord = await prisma.attendance.findUnique({
    where: {
      userId_date: {
        userId: access.session.user.id,
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
  const access = await requireApiModuleAccess("attendance", ["MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const body = await request.json();
  const parsed = attendanceSignSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const signTime = new Date();
  const day = new Date(signTime.toDateString());
  const { latitude, longitude, accuracyM, action } = parsed.data;
  const userTeam = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { team: { select: { name: true } } },
  });
  const teamGeofence = resolveTeamGeofence(userTeam?.team?.name);
  const referenceSite = teamGeofence
    ? {
      latitude: teamGeofence.latitude,
      longitude: teamGeofence.longitude,
      radiusMeters: teamGeofence.radiusMeters,
      name: teamGeofence.label,
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
  const latenessMins = isClockOut ? 0 : computeLatenessMinutes(signTime);
  const { end: endTime, label: endTimeLabel } = expectedEndTime(signTime);
  const overtimeMins = isClockOut
    ? Math.max(0, Math.round((signTime.getTime() - endTime.getTime()) / 60000))
    : 0;
  const earlyDepartureMins = isClockOut
    ? Math.max(0, Math.round((endTime.getTime() - signTime.getTime()) / 60000))
    : 0;

  const todayRecord = await prisma.attendance.findUnique({
    where: {
      userId_date: {
        userId: access.session.user.id,
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

  const signNote = isClockOut
    ? `${isAtOffice ? "Sortie signée au bureau." : "Sortie signée hors bureau."} ${timingNote}${resolvedAddress ? ` Adresse: ${resolvedAddress}.` : ""}`
    : `${isAtOffice ? "Entrée signée au bureau." : "Entrée signée hors bureau."}${resolvedAddress ? ` Adresse: ${resolvedAddress}.` : ""}`;

  const record = await prisma.attendance.upsert({
    where: {
      userId_date: {
        userId: access.session.user.id,
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
      userId: access.session.user.id,
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
    },
  });
}
