import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet as getGroups } from "../api/groups";
import { createGroup, joinGroupByCode } from "../_shared/supabase";

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
} as any;

const USER_ID = 77;
const GROUP_ID = 100;
const GROUP = {
  id: GROUP_ID,
  name: "測試家庭",
  invite_code: "LEGACY7",
  owner_user_id: USER_ID,
  plan_id: "pro",
  created_at: "2026-07-18T00:00:00Z",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

async function withFetch(handler: (url: string, init?: RequestInit) => Response, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

function groupReadRoutes(role: string, canManage: boolean) {
  const membership = { user_id: USER_ID, group_id: GROUP_ID, role, can_manage: canManage };
  return (url: string): Response => {
    if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${USER_ID}&select=group_id`)) return json([membership]);
    if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${USER_ID}&select=*`)) return json([membership]);
    if (url.includes(`/rest/v1/family_groups?id=in.(${GROUP_ID})&select=*`)) return json([GROUP]);
    if (url.includes(`/rest/v1/care_profiles?group_id=in.(${GROUP_ID})`)) return json([]);
    if (url.includes(`/rest/v1/user_feature_flags?user_id=eq.${USER_ID}&feature_key=like.profile_order:`)) return json([]);
    if (url.includes(`/rest/v1/user_family_groups?group_id=eq.${GROUP_ID}&select=user_id,role,can_manage`)) return json([membership]);
    if (url.includes(`/rest/v1/family_groups?id=eq.${GROUP_ID}&select=owner_user_id,plan_id`)) return json([{ owner_user_id: USER_ID, plan_id: "pro" }]);
    if (url.includes(`/rest/v1/care_profiles?group_id=eq.${GROUP_ID}&select=id`)) return json([]);
    if (url.includes(`/rest/v1/user_family_groups?group_id=eq.${GROUP_ID}&select=user_id`)) return json([membership]);
    if (url.includes(`/rest/v1/family_groups?id=eq.${GROUP_ID}&select=plan_id`)) return json([{ plan_id: "pro" }]);
    if (url.includes("/rest/v1/plans?id=eq.pro")) return json([{ id: "pro", name: "Care Circle", monthly_ocr_limit: 100, max_members: 6, max_recipients: 4, family_group_enabled: true, price_monthly_usd: 0, is_active: true, sort_order: 1 }]);
    if (url.includes(`/rest/v1/billing_subscriptions?family_group_id=eq.${GROUP_ID}`)) return json([]);
    throw new Error(`unexpected fetch: ${url}`);
  };
}

function groupContext() {
  return {
    request: new Request("https://care.example/api/groups"),
    env: ENV,
    data: { requestUser: { userId: USER_ID, identity: { provider: "line", lineUserId: "Ugroup", name: "群組使用者" } } },
  } as any;
}

test("groups GET only returns an invite code to an admin or manager", async () => {
  await withFetch(groupReadRoutes("member", true), async () => {
    const response = await getGroups(groupContext());
    const body = await response.json() as { groups: Array<Record<string, unknown>> };
    assert.equal(response.status, 200);
    assert.equal(body.groups[0].invite_code, GROUP.invite_code);
  });

  await withFetch(groupReadRoutes("member", false), async () => {
    const response = await getGroups(groupContext());
    const body = await response.json() as { groups: Array<Record<string, unknown>> };
    assert.equal(response.status, 200);
    assert.equal("invite_code" in body.groups[0], false);
  });
});

test("new groups receive a 128-bit unpredictable invite token", async () => {
  let createdInviteCode = "";
  await withFetch((url, init) => {
    if (url.endsWith("/rest/v1/family_groups?select=*") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      createdInviteCode = body.invite_code;
      return json([{ ...GROUP, id: 101, ...body }]);
    }
    if (url.endsWith("/rest/v1/user_family_groups") && init?.method === "POST") return json([]);
    if (url.includes("/rest/v1/care_profiles?group_id=eq.101")) return json([{ id: 501 }]);
    throw new Error(`unexpected fetch: ${init?.method || "GET"} ${url}`);
  }, async () => {
    await createGroup(ENV, USER_ID, "新家庭");
  });

  assert.match(createdInviteCode, /^[A-F0-9]{32}$/);
});

test("legacy invite codes remain join-compatible", async () => {
  let membershipCreated = false;
  await withFetch((url, init) => {
    if (url.includes("/rest/v1/family_groups?invite_code=eq.LEGACY7")) return json([GROUP]);
    if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${USER_ID}&group_id=eq.${GROUP_ID}`)) return json([]);
    if (url.endsWith("/rest/v1/user_family_groups") && init?.method === "POST") {
      membershipCreated = true;
      return json([]);
    }
    throw new Error(`unexpected fetch: ${init?.method || "GET"} ${url}`);
  }, async () => {
    const group = await joinGroupByCode(ENV, USER_ID, "legacy7");
    assert.equal(group.id, GROUP_ID);
  });

  assert.equal(membershipCreated, true);
});
