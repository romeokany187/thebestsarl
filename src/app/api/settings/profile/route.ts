import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { ensureUserWhatsappPhoneColumn, normalizeWhatsappPhone } from "@/lib/user-whatsapp-phone";

const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  whatsappPhone: z.string().trim().max(32).nullable().optional(),
}).refine((value) => value.name !== undefined || value.whatsappPhone !== undefined, {
  message: "Aucune donnée à mettre à jour.",
});

export async function PATCH(request: NextRequest) {
  const access = await requireApiModuleAccess("settings", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const body = await request.json();
  const parsed = profileSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await ensureUserWhatsappPhoneColumn();

  const data: { name?: string; whatsappPhone?: string | null } = {};
  if (parsed.data.name !== undefined) {
    data.name = parsed.data.name;
  }
  if (parsed.data.whatsappPhone !== undefined) {
    if (parsed.data.whatsappPhone === null || parsed.data.whatsappPhone === "") {
      data.whatsappPhone = null;
    } else {
      const normalized = normalizeWhatsappPhone(parsed.data.whatsappPhone);
      if (!normalized) {
        return NextResponse.json({ error: "Numéro WhatsApp invalide (ex. +243 81…)." }, { status: 400 });
      }
      data.whatsappPhone = normalized;
    }
  }

  const updated = await prisma.user.update({
    where: { id: access.session.user.id },
    data,
    select: { id: true, name: true, email: true, whatsappPhone: true },
  });

  return NextResponse.json({ data: updated });
}
