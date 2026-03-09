import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { attendanceSignSchema } from "@/lib/validators";

const REFERENCE_SITE = {
  latitude: -4.30706,
  longitude: 15.30875,
  radiusMeters: 200,
  name: "Point de référence Marché Central",
};

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
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url.toString(), {
      headers: {
        "Accept-Language": "fr",
        "User-Agent": "THEBEST-SARL/1.0 (attendance)",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const address = payload?.address;

    const houseNumber = address?.house_number ?? null;
    const avenue =
      address?.road
      ?? address?.residential
      ?? address?.street
      ?? address?.pedestrian
      ?? address?.path
      ?? null;
    const quarter =
      address?.suburb
      ?? address?.neighbourhood
      ?? address?.quarter
      ?? null;
    const commune =
      address?.city_district
      ?? address?.municipality
      ?? address?.borough
      ?? address?.township
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
  const gpsResolvedAddress = await resolveAddressFromCoords(latitude, longitude);

  const distanceToReference = distanceMeters(
    latitude,
    longitude,
    REFERENCE_SITE.latitude,
    REFERENCE_SITE.longitude,
  );
  const effectiveRadius = Math.max(REFERENCE_SITE.radiusMeters, Math.round(accuracyM ?? 0));
  const isInReferencePerimeter = distanceToReference <= effectiveRadius;

  const resolvedAddress = gpsResolvedAddress
    ?? (isInReferencePerimeter ? REFERENCE_SITE.name : null);

  let matchedSite: {
    name: string;
    distanceM: number;
  } | null = null;

  if (isInReferencePerimeter) {
    matchedSite = {
      name: REFERENCE_SITE.name,
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
