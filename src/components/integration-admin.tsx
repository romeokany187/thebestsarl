"use client";

import { useCallback, useEffect, useState } from "react";

type WebhookRow = {
  id: string;
  url: string;
  enabled: boolean;
  eventTypes: string[];
};

type ClientRow = {
  id: string;
  name: string;
  keyPrefix: string;
  enabled: boolean;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  scopes: string[];
  inboundCount: number;
  webhooks: WebhookRow[];
};

type EventRow = {
  id: string;
  eventType: string;
  externalId: string | null;
  status: string;
  receivedAt: string;
  clientName: string;
};

type RevealedSecret = {
  title: string;
  value: string;
};

export function IntegrationAdmin() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookClientId, setWebhookClientId] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [secret, setSecret] = useState<RevealedSecret | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/integrations", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? "Impossible de charger les connexions.");
      setLoading(false);
      return;
    }
    setClients(payload.data.clients ?? []);
    setEvents(payload.data.events ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createClient(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Création…");
    const response = await fetch("/api/admin/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? "Création impossible.");
      return;
    }
    setName("");
    setSecret({
      title: `Clé API de ${payload.data.name}`,
      value: payload.data.apiKey,
    });
    setStatus("Clé créée. Copiez-la maintenant, elle ne sera plus affichée.");
    await load();
  }

  async function revokeClient(id: string) {
    if (!window.confirm("Révoquer cette clé ? L'autre application ne pourra plus appeler l'API.")) return;
    const response = await fetch(`/api/admin/integrations/${id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? "Révocation impossible.");
      return;
    }
    setStatus("Clé révoquée.");
    await load();
  }

  async function createWebhook(event: React.FormEvent) {
    event.preventDefault();
    if (!webhookClientId) {
      setStatus("Choisissez l'application qui recevra les événements.");
      return;
    }
    setStatus("Enregistrement du webhook…");
    const response = await fetch(`/api/admin/integrations/${webhookClientId}/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? "Webhook impossible.");
      return;
    }
    setWebhookUrl("");
    setSecret({
      title: "Secret de signature du webhook",
      value: payload.data.signingSecret,
    });
    setStatus("Webhook enregistré. Copiez le secret, il sert à vérifier la signature.");
    await load();
  }

  async function sendPing(id: string) {
    setStatus("Envoi d'un ping…");
    const response = await fetch(`/api/admin/integrations/${id}/test`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? "Ping impossible.");
      return;
    }
    const deliveries = Array.isArray(payload.data?.deliveries) ? payload.data.deliveries.length : 0;
    setStatus(deliveries > 0 ? `Ping envoyé vers ${deliveries} webhook(s).` : "Ping enregistré. Aucun webhook actif à appeler.");
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      setStatus("Copié.");
    } catch {
      setStatus("Copie impossible. Sélectionnez le secret à la main.");
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Nouvelle application</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Crée une clé pour qu&apos;une autre application appelle <code>/api/integration/v1</code>. Les données métier ne sont pas encore ouvertes : on échange des événements.
        </p>
        <form onSubmit={createClient} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Nom</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex. Application partenaire"
              className="rounded-md border border-black/15 bg-white px-3 py-2 dark:border-white/15 dark:bg-zinc-950"
              required
            />
          </label>
          <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
            Créer la clé
          </button>
        </form>
      </section>

      {secret ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="text-sm font-semibold">{secret.title}</p>
          <p className="mt-2 break-all rounded-md bg-white px-3 py-2 font-mono text-xs text-black dark:bg-black dark:text-white">{secret.value}</p>
          <button type="button" onClick={() => void copySecret()} className="mt-2 rounded-md border border-current px-3 py-1 text-xs font-semibold">
            Copier
          </button>
        </section>
      ) : null}

      {status ? <p className="text-sm text-black/70 dark:text-white/70">{status}</p> : null}

      <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Applications connectées</h2>
        {loading ? <p className="mt-3 text-sm">Chargement…</p> : null}
        {!loading && clients.length === 0 ? <p className="mt-3 text-sm text-black/60 dark:text-white/60">Aucune application pour le moment.</p> : null}
        <div className="mt-3 space-y-3">
          {clients.map((client) => (
            <article key={client.id} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{client.name}</p>
                  <p className="text-xs text-black/55 dark:text-white/55">
                    Préfixe {client.keyPrefix}… · {client.revokedAt ? "Révoquée" : "Active"} · {client.inboundCount} événement(s) reçu(s)
                    {client.lastUsedAt ? ` · dernier appel ${new Date(client.lastUsedAt).toLocaleString("fr-FR")}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void sendPing(client.id)} disabled={Boolean(client.revokedAt)} className="rounded-md border border-black/15 px-2 py-1 text-xs font-semibold disabled:opacity-40 dark:border-white/20">
                    Envoyer un ping
                  </button>
                  <button type="button" onClick={() => void revokeClient(client.id)} disabled={Boolean(client.revokedAt)} className="rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-40 dark:border-red-800 dark:text-red-300">
                    Révoquer
                  </button>
                </div>
              </div>
              {client.webhooks.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-black/70 dark:text-white/70">
                  {client.webhooks.map((webhook) => (
                    <li key={webhook.id}>{webhook.url}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Webhook sortant</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          URL https appelée quand cette application envoie un événement. La signature est dans l&apos;en-tête <code>X-Thebest-Signature</code>.
        </p>
        <form onSubmit={createWebhook} className="mt-3 grid gap-2 sm:grid-cols-[1fr,2fr,auto] sm:items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Application</span>
            <select
              value={webhookClientId}
              onChange={(event) => setWebhookClientId(event.target.value)}
              className="rounded-md border border-black/15 bg-white px-3 py-2 dark:border-white/15 dark:bg-zinc-950"
            >
              <option value="">Choisir</option>
              {clients.filter((client) => !client.revokedAt).map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">URL https</span>
            <input
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder="https://partenaire.example/hooks/thebest"
              className="rounded-md border border-black/15 bg-white px-3 py-2 dark:border-white/15 dark:bg-zinc-950"
              required
            />
          </label>
          <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
            Enregistrer
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
        <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h2 className="text-sm font-semibold">Derniers événements reçus</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left">Quand</th>
                <th className="px-3 py-2 text-left">Application</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Référence</th>
                <th className="px-3 py-2 text-left">Statut</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-3 py-2">{new Date(event.receivedAt).toLocaleString("fr-FR")}</td>
                  <td className="px-3 py-2">{event.clientName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{event.eventType}</td>
                  <td className="px-3 py-2">{event.externalId ?? "—"}</td>
                  <td className="px-3 py-2">{event.status}</td>
                </tr>
              ))}
              {events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-black/50 dark:text-white/50">Aucun événement reçu.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
