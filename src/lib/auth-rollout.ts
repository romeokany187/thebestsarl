const DEFAULT_PASSWORD_AUTH_LAUNCH_AT = "2026-04-21T04:00:00.000Z";

export function passwordAuthLaunchAt() {
  return new Date(process.env.PASSWORD_AUTH_LAUNCH_AT?.trim() || DEFAULT_PASSWORD_AUTH_LAUNCH_AT);
}

export function passwordAuthLaunchAtIso() {
  return passwordAuthLaunchAt().toISOString();
}

export function isPasswordAuthActive(now = new Date()) {
  return now.getTime() >= passwordAuthLaunchAt().getTime();
}