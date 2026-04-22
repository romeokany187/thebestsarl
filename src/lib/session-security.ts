const DEFAULT_FORCE_REAUTH_AFTER = "2026-04-20T21:20:00.000Z";
export const SESSION_INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;

export function forceReauthAfter() {
  return new Date(process.env.FORCE_REAUTH_AFTER?.trim() || DEFAULT_FORCE_REAUTH_AFTER);
}

export function shouldForceReauthenticateSession(tokenIssuedAt?: number | null) {
  if (!tokenIssuedAt) {
    return false;
  }

  return tokenIssuedAt * 1000 < forceReauthAfter().getTime();
}