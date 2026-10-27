/** Marqueur d'exécution caisse dans le commentaire de revue EDB (sans dépendance serveur). */
export function hasNeedExecutionMarker(value?: string | null) {
  return (value ?? "").includes("EXECUTION_CAISSE:");
}
