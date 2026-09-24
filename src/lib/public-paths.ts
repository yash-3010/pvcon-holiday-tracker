const PUBLIC_EXACT = new Set(["/login", "/forgot-password", "/api/health", "/favicon.ico"]);
const PUBLIC_PREFIXES = ["/reset-password/", "/verify/", "/api/auth/", "/api/cron/", "/brand/", "/_next/"];

/** Paths that do not require a session. Cron routes authenticate with CRON_SECRET instead. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
