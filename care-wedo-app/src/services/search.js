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
  "location",
  "name",
  "purpose",
  "reminder_text",
  "notes",
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
  return String(value || "")
    .split(/[\s\u3000,，。;；、/\\|()（）[\]【】"'「」『』]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !/^\d+$/.test(item));
}

export function buildSearchSuggestions(items = [], limit = 12) {
  const scores = new Map();

  items.forEach((item) => {
    if (SEARCH_TYPE_LABELS[item?.type]) {
      const label = SEARCH_TYPE_LABELS[item.type];
      scores.set(label, (scores.get(label) || 0) + 3);
    }

    SUGGESTION_FIELDS.forEach((field) => {
      splitSuggestionText(item?.[field]).forEach((keyword) => {
        const score = ["hospital", "department", "doctor", "name"].includes(field) ? 4 : 1;
        scores.set(keyword, (scores.get(keyword) || 0) + score);
      });
    });
  });

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"))
    .map(([keyword]) => keyword)
    .slice(0, limit);
}
