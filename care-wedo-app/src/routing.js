export function isLineCallbackSearch(search = "") {
  const params = new URLSearchParams(search);
  return params.has("liff.state") || params.has("code");
}

export function resolveCareWedoRoute(pathname = "/") {
  const cleanPathname = pathname.split(/[?#]/, 1)[0] || "/";
  const normalized = cleanPathname.replace(/\/+$/, "") || "/";
  if (normalized === "/app") return "app";
  if (normalized === "/login") return "login";
  if (normalized === "/privacy") return "privacy";
  if (normalized === "/terms") return "terms";
  return "landing";
}

export function resolveInitialCareWedoRoute(pathname = "/", search = "") {
  if (isLineCallbackSearch(search)) return "app";
  return resolveCareWedoRoute(pathname);
}
