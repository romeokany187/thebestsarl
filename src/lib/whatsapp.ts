import { normalizeWhatsappPhone } from "@/lib/user-whatsapp-phone";

type WhatsAppSendResult =
  | { ok: true; messageId?: string }
  | { ok: false; error: string; skipped?: boolean };

function readWhatsAppConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || "v22.0";
  return { accessToken, phoneNumberId, apiVersion };
}

export function isWhatsAppConfigured() {
  const { accessToken, phoneNumberId } = readWhatsAppConfig();
  return Boolean(accessToken && phoneNumberId);
}

/** Envoi texte via WhatsApp Cloud API (Meta). */
export async function sendWhatsAppText(toRaw: string, body: string): Promise<WhatsAppSendResult> {
  const { accessToken, phoneNumberId, apiVersion } = readWhatsAppConfig();
  if (!accessToken || !phoneNumberId) {
    return { ok: false, error: "WhatsApp non configuré (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID).", skipped: true };
  }

  const to = normalizeWhatsappPhone(toRaw);
  if (!to) {
    return { ok: false, error: "Numéro WhatsApp invalide." };
  }

  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return { ok: false, error: "Message vide." };
  }

  const textBody = trimmedBody.length > 4096 ? `${trimmedBody.slice(0, 4090)}…` : trimmedBody;

  try {
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: textBody },
      }),
    });

    const payload = (await response.json()) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      return {
        ok: false,
        error: payload.error?.message ?? `Erreur WhatsApp HTTP ${response.status}`,
      };
    }

    return { ok: true, messageId: payload.messages?.[0]?.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erreur réseau WhatsApp",
    };
  }
}
