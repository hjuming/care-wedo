import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet as getDashboard } from "../api/dashboard";

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  LINE_LOGIN_CHANNEL_ID: "1234567890",
} as any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function request(): Request {
  return new Request("https://care.example/api/dashboard?group_id=100&profile_id=501", {
    headers: { Authorization: "Bearer line-token" },
  });
}

test("dashboard exposes active membership and role capabilities for the selected group", async () => {
  let membershipSelect = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;

    if (url.includes("api.line.me/oauth2/v2.1/verify")) {
      return json({ sub: "Uprimary", name: "主要照護者" });
    }
    if (url.includes("/rest/v1/users?line_user_id=")) {
      return json([{ id: 1, name: "主要照護者", picture_url: null }]);
    }
    if (url.includes("/rest/v1/user_family_groups?user_id=eq.1&select=group_id,role,can_manage,can_pay")) {
      membershipSelect = url;
      return json([{ user_id: 1, group_id: 100, role: "member", can_manage: true, can_pay: false }]);
    }
    if (url.includes("/rest/v1/user_family_groups?user_id=eq.1&select=group_id")) {
      return json([{ group_id: 100 }]);
    }
    if (url.includes("/rest/v1/user_family_groups?user_id=eq.1&select=*&")) {
      return json([{ user_id: 1, group_id: 100, role: "member", can_manage: true, can_pay: false }]);
    }
    if (url.includes("/rest/v1/user_family_groups?user_id=eq.1&select=*")) {
      return json([{ user_id: 1, group_id: 100, role: "member", can_manage: true, can_pay: false }]);
    }
    if (url.includes("/rest/v1/family_groups?id=in.(100)&select=*")) {
      return json([{ id: 100, name: "測試家庭", invite_code: "TEST100", plan_id: "pro", created_at: "2026-07-14T00:00:00Z" }]);
    }
    if (url.includes("/rest/v1/care_profiles?group_id=in.(100)")) {
      return json([{
        id: 501,
        group_id: 100,
        primary_user_id: 1,
        display_name: "林清河伯伯",
        relationship: "父親",
        is_default: true,
        sort_order: 10,
        created_at: "2026-07-14T00:00:00Z",
      }]);
    }
    if (url.includes("/rest/v1/user_feature_flags?user_id=eq.1&feature_key=like.profile_order:")) return json([]);
    if (url.includes("/rest/v1/users?id=eq.1&select=active_profile_id")) return json([{ active_profile_id: 501 }]);
    if (url.includes("/rest/v1/family_groups?id=eq.100&select=plan_id")) return json([{ plan_id: "pro" }]);
    if (url.includes("/rest/v1/plans?id=eq.pro&select=*&limit=1")) {
      return json([{
        id: "pro", name: "Care Circle", monthly_ocr_limit: 100, max_members: 6,
        max_recipients: 4, family_group_enabled: true, price_monthly_usd: 0,
        is_active: true, sort_order: 10,
      }]);
    }
    if (url.includes("/rest/v1/usage_quotas?group_id=eq.100")) return json([{ used_count: 0 }]);
    if (url.includes("/rest/v1/user_feature_flags?user_id=eq.1&feature_key=eq.multiple_family_groups")) return json([]);
    if (url.includes("/rest/v1/appointments?group_id=eq.100&profile_id=eq.501")) return json([]);
    if (url.includes("/rest/v1/appointments?group_id=eq.100&profile_id=is.null&type=eq.family_note")) return json([]);
    if (url.includes("/rest/v1/medications?group_id=eq.100&profile_id=eq.501")) return json([]);
    if (url.includes("/rest/v1/care_documents?group_id=eq.100&profile_id=eq.501")) return json([]);
    if (url.includes("/rest/v1/user_family_groups?group_id=eq.100&select=user_id,role")) return json([]);
    if (url.includes("/rest/v1/line_push_logs?group_id=eq.100")) return json([]);
    if (url.includes("/rest/v1/medication_logs?")) return json([]);
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await getDashboard({ request: request(), env: ENV } as any);
    assert.equal(response.status, 200);
    const body = await response.json() as any;

    assert.match(membershipSelect, /select=group_id,role,can_manage,can_pay/);
    assert.deepEqual(body.active_membership, {
      user_id: 1,
      group_id: 100,
      role: "member",
      can_manage: true,
      can_pay: false,
    });
    assert.deepEqual(body.capabilities, {
      can_manage_care: true,
      can_complete_medication: true,
    });
    assert.deepEqual(body.pricing, {
      currency_symbol: "$",
      recipient_monthly: 30,
      collaborator_monthly: 10,
      included_care_profiles_during_beta: 1,
      free_monthly_ocr_limit: 10,
      paid_monthly_ocr_limit: 100,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dashboard reports read-only capabilities for an elder membership", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("api.line.me/oauth2/v2.1/verify")) return json({ sub: "Uelder", name: "長輩" });
    if (url.includes("/rest/v1/users?line_user_id=")) return json([{ id: 2, name: "長輩", picture_url: null }]);
    if (url.includes("/rest/v1/user_family_groups?user_id=eq.2")) {
      return json([{ user_id: 2, group_id: 100, role: "member", can_manage: false, can_pay: false }]);
    }
    if (url.includes("/rest/v1/family_groups?id=in.(100)&select=*")) return json([{ id: 100, name: "測試家庭", plan_id: "pro", created_at: "2026-07-14T00:00:00Z" }]);
    if (url.includes("/rest/v1/care_profiles?group_id=in.(100)")) return json([{ id: 501, group_id: 100, display_name: "林清河伯伯", is_default: true, created_at: "2026-07-14T00:00:00Z" }]);
    if (url.includes("/rest/v1/user_feature_flags?user_id=eq.2&feature_key=like.profile_order:")) return json([]);
    if (url.includes("/rest/v1/users?id=eq.2&select=active_profile_id")) return json([{ active_profile_id: 501 }]);
    if (url.includes("/rest/v1/family_groups?id=eq.100&select=plan_id")) return json([{ plan_id: "pro" }]);
    if (url.includes("/rest/v1/plans?id=eq.pro&select=*&limit=1")) return json([{ id: "pro", name: "Care Circle", monthly_ocr_limit: 100, max_members: 6, max_recipients: 4, family_group_enabled: true, price_monthly_usd: 0, is_active: true, sort_order: 10 }]);
    if (url.includes("/rest/v1/usage_quotas?group_id=eq.100")) return json([{ used_count: 0 }]);
    if (url.includes("/rest/v1/user_feature_flags?user_id=eq.2&feature_key=eq.multiple_family_groups")) return json([]);
    if (url.includes("/rest/v1/appointments?group_id=eq.100&profile_id=eq.501")) return json([]);
    if (url.includes("/rest/v1/appointments?group_id=eq.100&profile_id=is.null&type=eq.family_note")) return json([]);
    if (url.includes("/rest/v1/medications?group_id=eq.100&profile_id=eq.501")) return json([]);
    if (url.includes("/rest/v1/care_documents?group_id=eq.100&profile_id=eq.501")) return json([]);
    if (url.includes("/rest/v1/user_family_groups?group_id=eq.100&select=user_id,role")) return json([]);
    if (url.includes("/rest/v1/line_push_logs?group_id=eq.100")) return json([]);
    if (url.includes("/rest/v1/medication_logs?")) return json([]);
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await getDashboard({ request: new Request("https://care.example/api/dashboard?group_id=100&profile_id=501", { headers: { Authorization: "Bearer elder-token" } }), env: ENV } as any);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.deepEqual(body.active_membership, { user_id: 2, group_id: 100, role: "member", can_manage: false, can_pay: false });
    assert.deepEqual(body.capabilities, { can_manage_care: false, can_complete_medication: false });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
