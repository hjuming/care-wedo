const PRODUCTION_HOSTS = new Set(["care.wedopr.com", "www.care.wedopr.com"]);

export function isSafeReviewLoginEnabled({ flag, configuredHost, hostname } = {}) {
  const expected = String(configuredHost || "").trim().toLowerCase();
  const actual = String(hostname || "").trim().toLowerCase();
  return flag === "1"
    && Boolean(expected)
    && expected === actual
    && !PRODUCTION_HOSTS.has(expected);
}
export function safeReviewLoginEnabled() {
  return isSafeReviewLoginEnabled({
    flag: import.meta.env?.VITE_CARE_WEDO_REVIEW_LOGIN,
    configuredHost: import.meta.env?.VITE_CARE_WEDO_REVIEW_HOST,
    hostname: window.location.hostname,
  });
}
