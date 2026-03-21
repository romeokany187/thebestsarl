"use client";

import { useState } from "react";

export function SalesReportButton({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleGenerateReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
      });
      const response = await fetch(`/api/sales/report/pdf?${params}`, {
        method: "GET",
      });

      if (!response.ok) {
        alert("Erreur lors de la génération du rapport.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rapport-vente-${startDate}-${endDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      alert("Erreur lors du téléchargement du rapport.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleGenerateReport}
      disabled={loading}
      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
    >
      {loading ? "Génération..." : "Générer rapport PDF"}
    </button>
  );
}
