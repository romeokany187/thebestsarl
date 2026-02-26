import { NextRequest, NextResponse } from "next/server";
import { SiteType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { attendanceSignSchema } from "@/lib/validators";

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
  const deltaMins = Math.round((signTime.getTime() - officeStart.getTime()) / 60000);
  return Math.max(0, deltaMins);
}

function computeOvertimeMinutes(signTime: Date) {
  const officeEnd = new Date(signTime);
  officeEnd.setHours(17, 0, 0, 0);
  const deltaMins = Math.round((signTime.getTime() - officeEnd.getTime()) / 60000);
  return Math.max(0, deltaMins);
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

    const road = address?.road ?? address?.pedestrian ?? address?.path ?? null;
    const houseNumber = address?.house_number ?? null;
    const quarter = address?.suburb ?? address?.neighbourhood ?? address?.quarter ?? null;
    const city = address?.city ?? address?.town ?? address?.village ?? null;

    const concise = [
      [road, houseNumber].filter(Boolean).join(" "),
      quarter,
      city,
    ]
      .filter(Boolean)
      .join(", ");

    return concise || payload?.display_name || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
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
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
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
  const resolvedAddress = await resolveAddressFromCoords(latitude, longitude);

  const activeSites = await prisma.workSite.findMany({
    where: { isActive: true },
  });

  let matchedSite: {
    id: string;
    name: string;
    type: SiteType;
    distanceM: number;
  } | null = null;

  for (const site of activeSites) {
    const distanceM = distanceMeters(latitude, longitude, site.latitude, site.longitude);
    if (distanceM <= site.radiusMeters) {
      if (!matchedSite || distanceM < matchedSite.distanceM) {
        matchedSite = {
          id: site.id,
          name: site.name,
          type: site.type,
          distanceM,
        };
      }
    }
  }

  const locationStatus = matchedSite
    ? matchedSite.type === "OFFICE"
      ? "OFFICE"
      : "ASSIGNMENT"
    : "OFFSITE";
  const isAtOffice = locationStatus === "OFFICE";

  const isClockOut = action === "CLOCK_OUT";
  const latenessMins = isClockOut ? 0 : computeLatenessMinutes(signTime);
  const overtimeMins = isClockOut ? computeOvertimeMinutes(signTime) : 0;

  if (isClockOut) {
    const todayRecord = await prisma.attendance.findUnique({
      where: {
        userId_date: {
          userId: access.session.user.id,
          date: day,
        },
      },
      select: { clockIn: true, clockOut: true },
    });

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
      matchedSiteId: matchedSite?.id,
      matchDistanceM: matchedSite?.distanceM,
      notes: matchedSite
        ? `${isClockOut ? "Sortie" : "Entrée"} validée sur ${matchedSite.name}`
        : `${isClockOut ? "Sortie" : "Entrée"} hors bureau${resolvedAddress ? ` • ${resolvedAddress}` : ""}`,
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
      matchedSiteId: matchedSite?.id,
      matchDistanceM: matchedSite?.distanceM,
      notes: matchedSite
        ? `${isClockOut ? "Sortie" : "Entrée"} validée sur ${matchedSite.name}`
        : `${isClockOut ? "Sortie" : "Entrée"} hors bureau${resolvedAddress ? ` • ${resolvedAddress}` : ""}`,
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
      matchDistanceM: matchedSite?.distanceM ?? null,
      resolvedAddress,
    },
  });
}
