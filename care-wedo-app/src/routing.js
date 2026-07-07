export function isLineCallbackSearch(search = "") {
  const params = new URLSearchParams(search);
  return params.has("liff.state") || params.has("code");
}

export function resolveCareWedoRoute(pathname = "/") {
  const cleanPathname = pathname.split(/[?#]/, 1)[0] || "/";
  const normalized = cleanPathname.replace(/\/+$/, "") || "/";
  if (normalized === "/") return "landing";
  if (normalized === "/app") return "app";
  if (normalized === "/app/open" || normalized === "/open") return "external-open";
  if (normalized === "/auth/callback") return "auth-callback";
  if (normalized === "/login") return "login";
  if (normalized === "/about") return "features";
  if (normalized === "/features") return "features";
  if (normalized === "/guide") return "guide";
  if (normalized === "/pricing") return "pricing";
  if (normalized === "/privacy") return "privacy";
  if (normalized === "/terms") return "terms";
  return "landing";
}

export function resolveInitialCareWedoRoute(pathname = "/", search = "") {
  if (isLineCallbackSearch(search)) return "app";
  return resolveCareWedoRoute(pathname);
}
