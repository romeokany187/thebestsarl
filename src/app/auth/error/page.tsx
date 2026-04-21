import Link from "next/link";

const MESSAGES: Record<string, string> = {
  DatabaseUnavailable: "La connexion est temporairement indisponible car la base de données n'est pas accessible.",
  AccessDenied: "L'accès a été refusé pour ce compte.",
  Configuration: "La configuration d'authentification est momentanément indisponible.",
  Verification: "La vérification de connexion n'a pas pu aboutir.",
  OAuthSignin: "La connexion Google n'a pas pu démarrer correctement. Réessayez depuis un seul onglet et vérifiez que vous utilisez le domaine officiel de l'application.",
  OAuthCallback: "Le retour Google a échoué car la session de sécurité n'a pas été conservée. Fermez les autres onglets de connexion puis réessayez.",
  Callback: "Le retour du fournisseur d'authentification a échoué. Réessayez dans un seul onglet de connexion.",
  PasswordLoginRequired: "La connexion Google est réservée à la toute première activation d'un compte sans mot de passe. Pour ce compte, utilisez désormais votre adresse email et votre mot de passe.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const errorCode = params.error ?? "Configuration";
  const message = MESSAGES[errorCode] ?? "Une erreur de connexion est survenue. Réessayez dans quelques instants.";

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
        <section className="w-full rounded-2xl border border-red-500/20 bg-white p-6 shadow-sm dark:bg-zinc-900 sm:p-8">
          <p className="mb-3 inline-flex rounded-full bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-600 dark:text-red-300">
            Connexion indisponible
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Impossible de terminer la connexion</h1>
          <p className="mt-3 text-sm text-black/70 dark:text-white/70">{message}</p>
          <p className="mt-2 text-xs text-black/50 dark:text-white/50">Code: {errorCode}</p>

          <div className="mt-6 flex gap-3">
            <Link
              href="/auth/signin"
              className="rounded-xl border border-black/15 px-4 py-2 text-sm font-semibold transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Réessayer
            </Link>
            <Link
              href="/"
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 dark:bg-white dark:text-black"
            >
              Retour à l'accueil
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
