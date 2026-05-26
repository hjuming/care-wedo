const SEARCH_TYPE_LABELS = {
  clinic_visit: "門診",
  inspection: "檢查",
  refill_reminder: "領藥",
  medication: "用藥",
  measurement: "量測",
  document: "文件",
  rehab: "復健",
  exercise: "運動",
  other: "其他",
  reminder: "提醒",
};

const SUGGESTION_FIELDS = [
  "hospital",
  "department",
  "doctor",
];

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[醫]師/g, "")
    .replace(/[\s\u3000,，.。:：;；、/\\|()（）[\]【】"'「」『』-]+/g, "");
}

function isSubsequence(query, target) {
  if (!query) return true;
  let cursor = 0;
  for (const char of target) {
    if (char === query[cursor]) cursor += 1;
    if (cursor === query.length) return true;
  }
  return false;
}

export function getSearchText(item = {}) {
  const values = Object.entries(item)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .flatMap(([key, value]) => {
      if (key === "type" && SEARCH_TYPE_LABELS[value]) return [value, SEARCH_TYPE_LABELS[value]];
      return [value];
    });
  return values.join(" ");
}

export function matchSearch(item, query) {
  const rawQuery = String(query || "").trim();
  if (!rawQuery) return true;

  const target = normalizeSearchText(getSearchText(item));
  const normalizedQuery = normalizeSearchText(rawQuery);
  if (!normalizedQuery) return true;
  if (target.includes(normalizedQuery)) return true;

  const tokens = rawQuery
    .split(/[\s\u3000,，、]+/)
    .map(normalizeSearchText)
    .filter(Boolean);

  if (tokens.length > 1 && tokens.every((token) => target.includes(token) || isSubsequence(token, target))) {
    return true;
  }

  return isSubsequence(normalizedQuery, target);
}

function splitSuggestionText(value) {
  const text = String(value || "").trim();
  if (!text || /^\d+$/.test(text)) return [];
  return [text];
}

function toShortSuggestionLabel(value) {
  return Array.from(String(value || "").trim().replace(/\s+/g, "")).slice(0, 4).join("");
}

function todayDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isFutureSearchItem(item = {}, today = todayDateString()) {
  if (item.status === "deleted" || item.status === "completed") return false;
  if (item.active === true && !item.date) return true;
  return typeof item.date === "string" && item.date >= today;
}

export function buildSearchSuggestions(items = [], limit = 6, today = todayDateString()) {
  const scores = new Map();

  items.forEach((item) => {
    const isFuture = isFutureSearchItem(item, today);
    const addScore = (keyword, weight) => {
      if (!keyword) return;
      const current = scores.get(keyword) || { label: keyword, totalCount: 0, futureCount: 0, score: 0 };
      current.totalCount += 1;
      current.futureCount += isFuture ? 1 : 0;
      current.score += weight;
      scores.set(keyword, current);
    };

    if (SEARCH_TYPE_LABELS[item?.type]) {
      addScore(SEARCH_TYPE_LABELS[item.type], 3);
    }

    SUGGESTION_FIELDS.forEach((field) => {
      splitSuggestionText(item?.[field]).forEach((keyword) => {
        const score = field === "hospital" ? 5 : field === "department" ? 4 : 3;
        addScore(keyword, score);
      });
    });
  });

  const suggestions = Array.from(scores.values());
  const hasFutureItems = suggestions.some((item) => item.futureCount > 0);

  const rankedSuggestions = suggestions
    .sort((a, b) => {
      if (hasFutureItems) {
        return b.futureCount - a.futureCount
          || b.totalCount - a.totalCount
          || b.score - a.score
          || a.label.localeCompare(b.label, "zh-Hant");
      }
      return b.totalCount - a.totalCount
        || b.score - a.score
        || a.label.localeCompare(b.label, "zh-Hant");
    })
    .map(({ label, futureCount }) => ({ label: toShortSuggestionLabel(label), count: futureCount }))
    .filter((item) => item.label.length >= 2);

  const seenLabels = new Set();
  const result = [];
  for (const item of rankedSuggestions) {
    if (seenLabels.has(item.label)) continue;
    seenLabels.add(item.label);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}
