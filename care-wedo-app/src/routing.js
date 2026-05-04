export function resolveCareWedoRoute(pathname = "/") {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/app") return "app";
  if (normalized === "/login") return "login";
  if (normalized === "/privacy") return "privacy";
  if (normalized === "/terms") return "terms";
  return "landing";
}
