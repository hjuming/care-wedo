import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as handleLineWebhook } from "../callback";

const USER_ID = 41;
const GROUP_ID = 100;
const PROFILE_ID = 501;
const LINE_USER_ID = "Uline-security-test";
const CHANNEL_SECRET = "line-channel-secret";

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  LINE_CHANNEL_ACCESS_TOKEN: "line-access-token",
  LINE_CHANNEL_SECRET: CHANNEL_SECRET,
  GOOGLE_API_KEY: "gemini-key",
} as any;

type Scenario = {
  membership?: { role: string; can_manage: boolean } | null;
  memberships?: Array<{ group_id: number; role: string; can_manage: boolean }>;
  profiles?: Array<ReturnType<typeof careProfile>>;
  pendingDocumentGroupId?: number;
  quotaUsed?: number;
  nextUploadTarget?: boolean;
};

type FetchCall = { url: string; method: string; body: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function careProfile(id = PROFILE_ID, groupId = GROUP_ID) {
  return {
    id,
    group_id: groupId,
    primary_user_id: USER_ID,
    display_name: "王媽媽",
    relationship: "family",
    avatar_url: null,
    birth_year: null,
    birth_date: null,
    main_hospital: null,
    main_department: null,
    notes: null,
    is_default: true,
    sort_order: 10,
    created_at: "2026-07-01T00:00:00.000Z",
  };
}

function planRow() {
  return {
    id: "free",
    name: "Free",
    monthly_ocr_limit: 1,
    max_members: 1,
    max_recipients: 1,
    family_group_enabled: false,
    price_monthly_usd: 0,
    is_active: true,
    sort_order: 10,
  };
}

function installFetchMock(scenario: Scenario) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  const membership = scenario.membership === undefined
    ? { role: "admin", can_manage: true }
    : scenario.membership;
  const memberships = scenario.memberships
    ?? (membership ? [{ group_id: GROUP_ID, ...membership }] : []);
  const profiles = scenario.profiles ?? (memberships.length > 0 ? [careProfile()] : []);

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    const method = String(init?.method || "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body });

    if (url.includes("api.line.me/v2/bot/message/reply") || url.includes("api.line.me/v2/bot/message/push")) {
      return json({});
    }
    if (url.includes("api-data.line.me/v2/bot/message/")) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return json({
        candidates: [{
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify({ type: "other", appointments: [], medications: [] }) }] },
        }],
      });
    }
    if (url.includes("/rest/v1/users?line_user_id=")) {
      return json([{ id: USER_ID, name: "LINE User", picture_url: null }]);
    }
    if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${USER_ID}`)) {
      return json(memberships.map((row, index) => ({ id: 9 + index, user_id: USER_ID, ...row })));
    }
    if (url.includes("/rest/v1/care_profiles?group_id=in.")) {
      return json(profiles);
    }
    if (url.includes("/rest/v1/user_feature_flags?") && method === "GET") {
      if (url.includes("line_next_upload_profile:") && scenario.nextUploadTarget !== false && membership) {
        return json([{ feature_key: `line_next_upload_profile:${PROFILE_ID}` }]);
      }
      return json([]);
    }
    if (url.includes(`/rest/v1/family_groups?id=eq.${GROUP_ID}&select=plan_id`)) {
      return json([{ plan_id: "free" }]);
    }
    if (url.includes("/rest/v1/plans?id=eq.free")) {
      return json([planRow()]);
    }
    if (url.includes(`/rest/v1/care_profiles?group_id=eq.${GROUP_ID}&select=id`)) {
      return json([{ id: PROFILE_ID }]);
    }
    if (url.includes("/rest/v1/usage_quotas?") && url.includes("select=used_count")) {
      return json([{ used_count: scenario.quotaUsed ?? 0 }]);
    }
    if (url.includes("/rest/v1/usage_quotas?") && url.includes("select=id,used_count")) {
      return json([]);
    }
    if (url.endsWith("/rest/v1/care_documents?select=id") && method === "POST") {
      return json([{ id: 700 }]);
    }
    if (url.includes("/rest/v1/care_documents?id=eq.700") && method === "PATCH") {
      return json([]);
    }
    if (url.includes("/rest/v1/care_documents?id=eq.700") && method === "GET") {
      const sourceGroupId = scenario.pendingDocumentGroupId ?? GROUP_ID;
      const exactGroupId = Number(url.match(/group_id=eq\.(\d+)/)?.[1]);
      const allowedGroups = url.match(/group_id=in\.\(([^)]+)\)/)?.[1]
        .split(",")
        .map(Number);
      if (Number.isFinite(exactGroupId) && exactGroupId !== sourceGroupId) return json([]);
      if (allowedGroups && !allowedGroups.includes(sourceGroupId)) return json([]);
      if (url.includes("select=id,group_id&")) return json([{ id: 700, group_id: sourceGroupId }]);
      return json([{ id: 700, group_id: sourceGroupId, ai_summary: { appointments: [], medications: [] } }]);
    }
    if (url.includes("/rest/v1/appointments?") && method === "PATCH") {
      return json([{ id: 901 }]);
    }
    if (url.includes("/rest/v1/medications?") && method === "PATCH") {
      return json([{ id: 902 }]);
    }
    if (/\/rest\/v1\/user_family_groups\?group_id=eq\.\d+/.test(url)) {
      return json([]);
    }
    if (url.includes("/rest/v1/") && ["POST", "PATCH", "DELETE"].includes(method)) {
      return json([]);
    }

    throw new Error(`Unexpected fetch: ${method} ${url}`);
  }) as typeof fetch;

  return {
    calls,
    restore: () => { globalThis.fetch = original; },
  };
}

async function lineSignature(body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Buffer.from(signed).toString("base64");
}

async function invokeWebhook(event: Record<string, unknown>, scenario: Scenario = {}) {
  const mock = installFetchMock(scenario);
  const body = JSON.stringify({ events: [event] });
  const pending: Promise<unknown>[] = [];
  try {
    const response = await handleLineWebhook({
      request: new Request("https://care.example/callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-line-signature": await lineSignature(body),
        },
        body,
      }),
      env: ENV,
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    } as any);
    await Promise.allSettled(pending);
    return { response, calls: mock.calls };
  } finally {
    mock.restore();
  }
}

function textEvent() {
  return {
    type: "message",
    replyToken: "reply-text",
    source: { userId: LINE_USER_ID },
    message: { type: "text", text: "2026/08/12 上午 09:30 請到台大醫院家醫科回診並攜帶藥袋" },
  };
}

test("LINE 文字 OCR：唯讀成員在 Gemini 前被拒絕，不寫入醫療資料", async () => {
  const { calls } = await invokeWebhook(textEvent(), {
    membership: { role: "viewer", can_manage: false },
  });

  assert.equal(calls.some((call) => call.url.includes("generativelanguage.googleapis.com")), false);
  assert.equal(calls.some((call) => /\/rest\/v1\/(care_documents|appointments|medications)/.test(call.url) && ["POST", "PATCH"].includes(call.method)), false);
});

test("LINE 圖片 OCR：唯讀成員在下載圖片與 Gemini 前被拒絕", async () => {
  const { calls } = await invokeWebhook({
    type: "message",
    replyToken: "reply-image",
    source: { userId: LINE_USER_ID },
    message: { type: "image", id: "image-001" },
  }, { membership: { role: "viewer", can_manage: false } });

  assert.equal(calls.some((call) => call.url.includes("api-data.line.me")), false);
  assert.equal(calls.some((call) => call.url.includes("generativelanguage.googleapis.com")), false);
});

test("LINE OCR：無群組時不呼叫 Gemini", async () => {
  const { calls } = await invokeWebhook(textEvent(), { membership: null });

  assert.equal(calls.some((call) => call.url.includes("generativelanguage.googleapis.com")), false);
});

test("LINE OCR：額度用完時不呼叫 Gemini", async () => {
  const { calls } = await invokeWebhook(textEvent(), { quotaUsed: 1 });

  assert.equal(calls.some((call) => call.url.includes("generativelanguage.googleapis.com")), false);
});

test("LINE 重新指派：唯讀成員不能 PATCH 看診與用藥紀錄", async () => {
  const { calls } = await invokeWebhook({
    type: "postback",
    replyToken: "reply-reassign",
    source: { userId: LINE_USER_ID },
    postback: { data: `action=reassign&p=${PROFILE_ID}&a=901&m=902` },
  }, { membership: { role: "viewer", can_manage: false } });

  assert.equal(calls.some((call) => /\/rest\/v1\/(appointments|medications)/.test(call.url) && call.method === "PATCH"), false);
});

test("LINE 待歸檔文件：唯讀成員不能確認或寫入資料", async () => {
  const { calls } = await invokeWebhook({
    type: "postback",
    source: { userId: LINE_USER_ID },
    postback: { data: `action=assign_pending_ocr&d=700&p=${PROFILE_ID}` },
  }, { membership: { role: "viewer", can_manage: false } });

  assert.equal(calls.some((call) => /\/rest\/v1\/(care_documents|appointments|medications)/.test(call.url) && ["POST", "PATCH"].includes(call.method)), false);
});

test("LINE 待歸檔文件：來源群唯讀時不能移到可管理的目標群", async () => {
  const targetGroupId = 200;
  const { calls } = await invokeWebhook({
    type: "postback",
    source: { userId: LINE_USER_ID },
    postback: { data: `action=assign_pending_ocr&d=700&p=${PROFILE_ID}` },
  }, {
    memberships: [
      { group_id: GROUP_ID, role: "viewer", can_manage: false },
      { group_id: targetGroupId, role: "admin", can_manage: true },
    ],
    profiles: [careProfile(PROFILE_ID, targetGroupId)],
    pendingDocumentGroupId: GROUP_ID,
  });

  assert.equal(calls.some((call) => call.url.includes("select=id,group_id,ai_summary") && call.method === "GET"), false);
  assert.equal(calls.some((call) => call.url.includes("/rest/v1/care_documents?id=eq.700") && call.method === "PATCH"), false);
});

test("LINE 待歸檔文件：來源與目標群皆可管理時以原群範圍完成移動", async () => {
  const targetGroupId = 200;
  const { calls } = await invokeWebhook({
    type: "postback",
    source: { userId: LINE_USER_ID },
    postback: { data: `action=assign_pending_ocr&d=700&p=${PROFILE_ID}` },
  }, {
    memberships: [
      { group_id: GROUP_ID, role: "admin", can_manage: true },
      { group_id: targetGroupId, role: "admin", can_manage: true },
    ],
    profiles: [careProfile(PROFILE_ID, targetGroupId)],
    pendingDocumentGroupId: GROUP_ID,
  });

  const patch = calls.find((call) => call.url.includes("/rest/v1/care_documents?id=eq.700") && call.method === "PATCH");
  assert.ok(patch);
  assert.match(patch.url, new RegExp(`group_id=eq\\.${GROUP_ID}`));
  assert.equal(JSON.parse(patch.body).group_id, targetGroupId);
});

test("LINE OCR：管理者在額度內會呼叫 Gemini、寫入文件並計次", async () => {
  const { response, calls } = await invokeWebhook(textEvent(), { quotaUsed: 0 });

  assert.equal(response.status, 200);
  assert.equal(calls.filter((call) => call.url.includes("generativelanguage.googleapis.com")).length, 1);
  assert.equal(calls.some((call) => call.url.endsWith("/rest/v1/care_documents?select=id") && call.method === "POST"), true);
  assert.equal(calls.some((call) => call.url.endsWith("/rest/v1/usage_quotas") && call.method === "POST"), true);
});
