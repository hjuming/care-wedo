import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as billingCheckout } from "../api/billing/checkout";

const SECRET = "test-checkout-secret";
const GROUP_ID = 123;
const USER_ID = 88;
const CHECKOUT_URL = "https://billing.example.test/api/billing/checkout";

type FetchHandler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function planRow(id: "free" | "pro") {
  return {
    id,
    name: id === "pro" ? "Care Circle" : "Free",
    monthly_ocr_limit: id === "pro" ? 100 : 10,
    max_members: id === "pro" ? 6 : 1,
    max_recipients: id === "pro" ? 4 : 1,
    family_group_enabled: id === "pro",
    price_monthly_usd: 0,
    is_active: true,
    sort_order: id === "pro" ? 20 : 10,
  };
}

function withMockedFetch(handler: FetchHandler, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    return handler(url, init);
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeRequest(body: Record<string, unknown>) {
  return new Request("https://care.example/app/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeContext(body: Record<string, unknown>, envOverrides: Record<string, string | undefined> = {}) {
  return {
    request: makeRequest(body),
    env: {
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      WEDO_BILLING_CHECKOUT_SECRET: SECRET,
      WEDO_BILLING_CHECKOUT_URL: CHECKOUT_URL,
      CARE_WEDO_PUBLIC_BASE_URL: "https://care.wedopr.com",
      ...envOverrides,
    },
    data: {
      requestUser: {
        userId: USER_ID,
        identity: { provider: "line", lineUserId: "U-test", name: "Test User" },
      },
    },
  } as any;
}

function entitlementRoutes(url: string, subscriptionRows: unknown[] = []) {
  if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${USER_ID}&group_id=eq.${GROUP_ID}`)) {
    return json([{ role: "admin", can_pay: false }]);
  }
  if (url.includes(`/rest/v1/family_groups?id=eq.${GROUP_ID}`) && url.includes("select=owner_user_id,plan_id")) {
    return json([{ owner_user_id: USER_ID, plan_id: "pro" }]);
  }
  if (url.includes(`/rest/v1/family_groups?id=eq.${GROUP_ID}`) && url.includes("select=plan_id")) {
    return json([{ plan_id: "pro" }]);
  }
  if (url.includes("/rest/v1/plans?id=eq.pro")) {
    return json([planRow("pro")]);
  }
  if (url.includes(`/rest/v1/care_profiles?group_id=eq.${GROUP_ID}`)) {
    return json([{ id: 501 }]);
  }
  if (url.includes(`/rest/v1/user_family_groups?group_id=eq.${GROUP_ID}`)) {
    return json([{ user_id: USER_ID }]);
  }
  if (url.includes(`/rest/v1/billing_subscriptions?family_group_id=eq.${GROUP_ID}`) && !url.includes("on_conflict")) {
    return json(subscriptionRows);
  }
  return null;
}

test("billing checkout refuses to start when the outbound gateway secret is missing", async () => {
  await withMockedFetch(() => {
    throw new Error("fetch should not be called without checkout secret");
  }, async () => {
    const response = await billingCheckout(makeContext(
      { group_id: GROUP_ID, action_type: "create_profile" },
      { WEDO_BILLING_CHECKOUT_SECRET: "" },
    ));
    const body = await response.json() as { error: string };

    assert.equal(response.status, 503);
    assert.equal(body.error, "billing_checkout_not_configured");
  });
});

test("billing checkout signs a central ECPay subscription request and records checkout_pending", async () => {
  const writes: Array<{ url: string; body: any; method?: string }> = [];
  let centralCheckoutPayload: any = null;
  let centralSignature = "";
  let centralTimestamp = "";
  let centralRawBody = "";

  await withMockedFetch(async (url, init) => {
    const entitlement = entitlementRoutes(url);
    if (entitlement) return entitlement;

    if (url === CHECKOUT_URL) {
      centralRawBody = String(init?.body || "");
      centralCheckoutPayload = JSON.parse(centralRawBody);
      centralTimestamp = new Headers(init?.headers).get("x-wedo-billing-timestamp") || "";
      centralSignature = new Headers(init?.headers).get("x-wedo-billing-signature") || "";
      return json({
        provider: "ecpay",
        checkout: {
          action: "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5",
          method: "POST",
          fields: {
            MerchantTradeNo: "CWTEST123",
            TotalAmount: 30,
            ItemName: "Care WEDO 照護圈 30 元/月",
          },
        },
      });
    }

    if (url.includes("/rest/v1/billing_subscriptions") && init?.method === "POST") {
      writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return json([{ id: 77 }]);
    }
    if (url.includes("/rest/v1/invoices?on_conflict=family_group_id,period") && init?.method === "POST") {
      writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return json([]);
    }
    if (url.includes("/rest/v1/billing_events") && init?.method === "POST") {
      writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return json([]);
    }

    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const response = await billingCheckout(makeContext({ group_id: GROUP_ID, action_type: "create_profile" }));
    const body = await response.json() as { checkout_required: boolean; amount: number; provider: string };

    assert.equal(response.status, 200);
    assert.equal(body.checkout_required, true);
    assert.equal(body.provider, "ecpay");
    assert.equal(body.amount, 30);

    assert.equal(centralCheckoutPayload.project, "care_wedo");
    assert.equal(centralCheckoutPayload.project_order_id, `family_group_${GROUP_ID}`);
    assert.equal(centralCheckoutPayload.amount, 30);
    assert.equal(centralCheckoutPayload.mode, "subscription");
    assert.equal(centralCheckoutPayload.subscription.period_type, "M");
    assert.equal(centralCheckoutPayload.client_back_url, "https://care.wedopr.com/app/settings?billing=return");
    assert.equal(centralSignature, await hmacSha256Hex(SECRET, `${centralTimestamp}.${centralRawBody}`));

    assert.ok(writes.some((write) => write.url.includes("/billing_subscriptions") && write.body.status === "checkout_pending"));
    assert.ok(writes.some((write) => write.url.includes("/invoices") && write.body.status === "open"));
    const eventWrite = writes.find((write) => write.url.endsWith("/rest/v1/billing_events"));
    assert.equal(eventWrite?.body.event_type, "checkout_created");
    assert.equal(eventWrite?.body.after_snapshot.estimatedMonthlyAmount, 30);
  });
});

test("billing checkout does not charge again when an active subscription already covers the action", async () => {
  let centralCheckoutCalled = false;
  await withMockedFetch((url) => {
    const entitlement = entitlementRoutes(url, [{
      status: "active",
      care_profile_count: 2,
      paid_collaborator_count: 0,
      estimated_monthly_amount: 30,
    }]);
    if (entitlement) return entitlement;
    if (url === CHECKOUT_URL) {
      centralCheckoutCalled = true;
      return json({});
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const response = await billingCheckout(makeContext({ group_id: GROUP_ID, action_type: "create_profile" }));
    const body = await response.json() as { checkout_required: boolean; amount: number; message: string };

    assert.equal(response.status, 200);
    assert.equal(body.checkout_required, false);
    assert.equal(body.amount, 30);
    assert.match(body.message, /已付款/);
    assert.equal(centralCheckoutCalled, false);
  });
});
