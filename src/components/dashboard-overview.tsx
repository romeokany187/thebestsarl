"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";

type Role = "ADMIN" | "MANAGER" | "EMPLOYEE" | "ACCOUNTANT";
type Period = "DAILY" | "WEEKLY" | "MONTHLY" | "ANNUAL";

type DashboardResponse = {
  users: Array<{ id: string; name: string; role: Role; email: string }>;
  usersSummary: {
    total: number;
    admin: number;
    manager: number;
    employee: number;
    accountant: number;
  };
  reports: {
    total: number;
    draft: number;
    submitted: number;
    approved: number;
    rejected: number;
  };
  reportsByRole: Array<{ role: Role; count: number }>;
  attendance: {
    totalRecords: number;
    present: number;
    absent: number;
    off: number;
    lateCount: number;
    overtimeMins: number;
  };
  payments: {
    paid: number;
    unpaid: number;
    partial: number;
  };
  sales: {
    totalSales: number;
    grossCommission: number;
    netCommission: number;
    paidRatio: number;
  };
  perEmployee: Array<{
    userId: string;
    name: string;
    role: Role;
    reports: number;
    approvedReports: number;
    attendance: number;
    absences: number;
    late: number;
    overtimeMins: number;
    tickets: number;
    salesAmount: number;
  }>;
  byFrequency: Array<{
    period: Period;
    reports: number;
    sales: number;
  }>;
};

const roleOptions: Array<{ value: "ALL" | Role; label: string }> = [
  { value: "ALL", label: "Toutes fonctions" },
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "EMPLOYEE", label: "Employé" },
  { value: "ACCOUNTANT", label: "Comptable" },
];

const periodOptions: Array<{ value: Period; label: string }> = [
  { value: "DAILY", label: "Journalier" },
  { value: "WEEKLY", label: "Hebdomadaire" },
  { value: "MONTHLY", label: "Mensuel" },
  { value: "ANNUAL", label: "Annuel" },
];

export function DashboardOverview() {
  const [period, setPeriod] = useState<Period>("MONTHLY");
  const [role, setRole] = useState<"ALL" | Role>("ALL");
  const [userId, setUserId] = useState<string>("ALL");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isActive = true;

    async function loadData() {
      setLoading(true);
      setError("");

      const params = new URLSearchParams();
      params.set("period", period);
      if (role !== "ALL") {
        params.set("role", role);
      }
      if (userId !== "ALL") {
        params.set("userId", userId);
      }

      const response = await fetch(`/api/dashboard?${params.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        if (isActive) {
          setError("Impossible de charger le dashboard.");
          setLoading(false);
        }
        return;
      }

      const payload = (await response.json()) as DashboardResponse;
      if (isActive) {
        setData(payload);
        setLoading(false);
      }
    }

    loadData();

    return () => {
      isActive = false;
    };
  }, [period, role, userId]);

  const employees = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.users;
  }, [data]);

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <div className="grid gap-3 sm:grid-cols-3">
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as Period)}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {periodOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value as "ALL" | Role);
              setUserId("ALL");
            }}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {roleOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <select value={userId} onChange={(event) => setUserId(event.target.value)} className="rounded-md border px-3 py-2 text-sm">
            <option value="ALL">Tous les employés</option>
            {employees.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.role})
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? <p className="text-sm text-black/60 dark:text-white/60">Chargement du dashboard...</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!loading && data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Utilisateurs" value={String(data.usersSummary.total)} hint={`A:${data.usersSummary.admin} • M:${data.usersSummary.manager} • E:${data.usersSummary.employee} • C:${data.usersSummary.accountant}`} />
            <KpiCard label="Présences" value={String(data.attendance.totalRecords)} hint={`Absences: ${data.attendance.absent} • Retards: ${data.attendance.lateCount}`} />
            <KpiCard label="Rapports" value={String(data.reports.total)} hint={`Soumis: ${data.reports.submitted} • Approuvés: ${data.reports.approved}`} />
            <KpiCard label="Ventes" value={`${data.sales.totalSales.toFixed(2)} USD`} hint={`Commission nette: ${data.sales.netCommission.toFixed(2)} USD`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
              <h2 className="text-base font-semibold">Présence et absences</h2>
              <div className="mt-3 grid gap-2 text-sm">
                <p>Présent: {data.attendance.present}</p>
                <p>Absent: {data.attendance.absent}</p>
                <p>Repos: {data.attendance.off}</p>
                <p>Retard: {data.attendance.lateCount}</p>
                <p>Heures supp: {data.attendance.overtimeMins} min</p>
              </div>
            </div>

            <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
              <h2 className="text-base font-semibold">Rapports par fonction</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {data.reportsByRole.map((item) => (
                  <li key={item.role} className="flex items-center justify-between rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                    <span>{item.role}</span>
                    <span className="font-semibold">{item.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-base font-semibold">Fréquences disponibles (journalier à annuel)</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.byFrequency.map((freq) => (
                <div key={freq.period} className="rounded-lg border border-black/10 px-3 py-3 dark:border-white/10">
                  <p className="text-xs font-semibold text-black/55 dark:text-white/55">{freq.period}</p>
                  <p className="mt-1 text-sm">Rapports: {freq.reports}</p>
                  <p className="text-sm">Ventes: {freq.sales.toFixed(2)} USD</p>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
            <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
              <h2 className="text-base font-semibold">Détail par employé</h2>
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-black/5 dark:bg-white/10">
                <tr>
                  <th className="px-3 py-2 text-left">Employé</th>
                  <th className="px-3 py-2 text-left">Fonction</th>
                  <th className="px-3 py-2 text-left">Présences</th>
                  <th className="px-3 py-2 text-left">Absences</th>
                  <th className="px-3 py-2 text-left">Retards</th>
                  <th className="px-3 py-2 text-left">Rapports</th>
                  <th className="px-3 py-2 text-left">Rapports approuvés</th>
                  <th className="px-3 py-2 text-left">Ventes</th>
                  <th className="px-3 py-2 text-left">Montant ventes</th>
                </tr>
              </thead>
              <tbody>
                {data.perEmployee.map((row) => (
                  <tr key={row.userId} className="border-t border-black/5 dark:border-white/10">
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2">{row.role}</td>
                    <td className="px-3 py-2">{row.attendance}</td>
                    <td className="px-3 py-2">{row.absences}</td>
                    <td className="px-3 py-2">{row.late}</td>
                    <td className="px-3 py-2">{row.reports}</td>
                    <td className="px-3 py-2">{row.approvedReports}</td>
                    <td className="px-3 py-2">{row.tickets}</td>
                    <td className="px-3 py-2">{row.salesAmount.toFixed(2)} USD</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
