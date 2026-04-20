const DEFAULT_FORCE_REAUTH_AFTER = "2026-04-20T21:20:00.000Z";

export function forceReauthAfter() {
  return new Date(process.env.FORCE_REAUTH_AFTER?.trim() || DEFAULT_FORCE_REAUTH_AFTER);
}

export function shouldForceReauthenticateSession(tokenIssuedAt?: number | null) {
  if (!tokenIssuedAt) {
    return false;
  }

  return tokenIssuedAt * 1000 < forceReauthAfter().getTime();
}