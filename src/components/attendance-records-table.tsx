"use client";

import { useEffect, useMemo, useState } from "react";

type AttendanceRecord = {
  id: string;
  date: string | Date;
  clockIn: string | Date | null;
  clockOut: string | Date | null;
  signedAt: string | Date | null;
  locationStatus: string;
  signLatitude: number | null;
  signLongitude: number | null;
  signAddress: string | null;
  latenessMins: number;
  overtimeMins: number;
  user: {
    name: string;
  };
  matchedSite: {
    name: string;
  } | null;
};

type Props = {
  initialRecords: AttendanceRecord[];
  startDate: string;
  endDate: string;
  userId?: string;
  showEmployeeColumn?: boolean;
};

export function AttendanceRecordsTable({ initialRecords, startDate, endDate, userId, showEmployeeColumn = true }: Props) {
  const [records, setRecords] = useState<AttendanceRecord[]>(initialRecords);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ startDate, endDate });
    if (userId) {
      params.set("userId", userId);
    }
    return params.toString();
  }, [startDate, endDate, userId]);

  useEffect(() => {
    setRecords(initialRecords);
  }, [initialRecords]);

  useEffect(() => {
    let isMounted = true;

    async function refreshRecords() {
      const response = await fetch(`/api/attendance?${queryString}`, {
        cache: "no-store",
      });

      if (!response.ok || !isMounted) {
        return;
      }

      const payload = await response.json();
      if (!isMounted) {
        return;
      }

      setRecords(Array.isArray(payload?.data) ? payload.data : []);
    }

    const onAttendanceUpdated = () => {
      void refreshRecords();
    };

    void refreshRecords();
    const interval = window.setInterval(() => {
      void refreshRecords();
    }, 10000);
    window.addEventListener("attendance:updated", onAttendanceUpdated);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
      window.removeEventListener("attendance:updated", onAttendanceUpdated);
    };
  }, [queryString]);

  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-black/5 dark:bg-white/10">
            <tr>
              {showEmployeeColumn ? <th className="px-3 py-2 text-left">Employé</th> : null}
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Entrée</th>
              <th className="px-3 py-2 text-left">Sortie</th>
              <th className="px-3 py-2 text-left">Signé à</th>
              <th className="px-3 py-2 text-left">Localisation détectée</th>
              <th className="px-3 py-2 text-left">Adresse détectée</th>
              <th className="px-3 py-2 text-left">Retard</th>
              <th className="px-3 py-2 text-left">Heures supp.</th>
            </tr>
          </thead>
          <tbody>
            {records.map((row) => (
              <tr key={row.id} className="border-t border-black/5 dark:border-white/10">
                {showEmployeeColumn ? <td className="px-3 py-2">{row.user.name}</td> : null}
                <td className="px-3 py-2">{new Date(row.date).toLocaleDateString()}</td>
                <td className="px-3 py-2">{row.clockIn ? new Date(row.clockIn).toLocaleTimeString() : "-"}</td>
                <td className="px-3 py-2">{row.clockOut ? new Date(row.clockOut).toLocaleTimeString() : "-"}</td>
                <td className="px-3 py-2">{row.signedAt ? new Date(row.signedAt).toLocaleString() : "-"}</td>
                <td className="px-3 py-2">
                  {row.locationStatus}
                  {row.matchedSite ? ` (${row.matchedSite.name})` : ""}
                  {row.signLatitude != null && row.signLongitude != null
                    ? ` • ${row.signLatitude.toFixed(5)}, ${row.signLongitude.toFixed(5)}`
                    : ""}
                </td>
                <td className="px-3 py-2">{row.signAddress ?? "-"}</td>
                <td className="px-3 py-2">{row.latenessMins} min</td>
                <td className="px-3 py-2">{row.overtimeMins} min</td>
              </tr>
            ))}
            {records.length === 0 ? (
              <tr>
                <td colSpan={showEmployeeColumn ? 9 : 8} className="px-3 py-6 text-center text-sm text-black/55 dark:text-white/55">
                  Aucune présence trouvée pour cette période.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
