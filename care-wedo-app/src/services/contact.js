function normalizeText(value = "") {
  return String(value || "").trim();
}

export function normalizeLineContactId(lineUserId = "") {
  const normalized = normalizeText(lineUserId);
  if (!normalized) return null;

  // LINE Login / Messaging API 拿到的 U 開頭 user id 不是可直接對外聯絡的公開 ID。
  if (/^U[0-9a-f]{20,}$/i.test(normalized)) return null;

  return normalized;
}

export function buildCollaboratorContact({ lineUserId, email } = {}) {
  const normalizedLineId = normalizeLineContactId(lineUserId);
  if (normalizedLineId) {
    if (normalizedLineId.startsWith("@")) {
      return {
        type: "line",
        href: `https://line.me/R/ti/p/${encodeURIComponent(normalizedLineId)}`,
        label: "LINE",
      };
    }

    return {
      type: "line",
      href: `https://line.me/R/ti/p/~${encodeURIComponent(normalizedLineId)}`,
      label: "LINE",
    };
  }

  const normalizedEmail = normalizeText(email);
  if (normalizedEmail) {
    return {
      type: "email",
      href: `mailto:${normalizedEmail}`,
      label: "Email",
    };
  }

  return {
    type: "none",
    href: null,
    label: "補聯絡方式",
  };
}
