import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as billingWebhook } from "../api/billing/webhook";
import { signBillingWebhookRequest } from "../_shared/billing_webhook";

const SECRET = "test-central-billing-secret";
const GROUP_ID = 123;
const OWNER_USER_ID = 88;
const NOW = "2026-07-07T08:00:00.000Z";

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  WEDO_BILLING_GATEWAY_SECRET: SECRET,
  WEDO_BILLING_WEBHOOK_ALLOWED_SKEW_SECONDS: "900",
} as any;

type FetchHandler = (url: string, init: RequestInit | undefined) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
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

function successPayload(overrides: Record<string, unknown> = {}) {
  return {
    provider: "ecpay",
    event_type: "payment_return",
    provider_event_id: "CW123:EC123:1:2026/07/07 16:00:00:1:payment_return",
    project: "care_wedo",
    project_order_id: `family_group_${GROUP_ID}`,
    merchant_trade_no: "CWTEST123",
    trade_no: "EC123",
    rtn_code: "1",
    rtn_message: "交易成功",
    amount: 50,
    payment_type: "Credit_CreditCard",
    payment_date: "2026/07/07 16:00:00",
    raw: {
      CustomField1: "care_wedo",
      CustomField2: `family_group_${GROUP_ID}`,
    },
    ...overrides,
  };
}

async function signedRequest(payload: Record<string, unknown>, secret = SECRET): Promise<Request> {
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await signBillingWebhookRequest(secret, timestamp, rawBody);
  return new Request("https://care.example/api/billing/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wedo-billing-timestamp": timestamp,
      "x-wedo-billing-signature": signature,
    },
    body: rawBody,
  });
}

function entitlementRoutes(url: string, planId: "free" | "pro") {
  if (url.includes(`/rest/v1/family_groups?id=eq.${GROUP_ID}`) && url.includes("select=owner_user_id,plan_id")) {
    return json([{ owner_user_id: OWNER_USER_ID, plan_id: planId }]);
  }
  if (url.includes(`/rest/v1/family_groups?id=eq.${GROUP_ID}`) && url.includes("select=plan_id")) {
    return json([{ plan_id: planId }]);
  }
  if (url.includes(`/rest/v1/plans?id=eq.${planId}`)) {
    return json([planRow(planId)]);
  }
  if (url.includes(`/rest/v1/care_profiles?group_id=eq.${GROUP_ID}`)) {
    return json([{ id: 501 }, { id: 502 }]);
  }
  if (url.includes(`/rest/v1/user_family_groups?group_id=eq.${GROUP_ID}`)) {
    return json([{ user_id: OWNER_USER_ID }, { user_id: 89 }]);
  }
  return null;
}

test("billing webhook rejects unsigned or incorrectly signed requests before DB writes", async () => {
  let fetchCalled = false;
  await withMockedFetch(() => {
    fetchCalled = true;
    return json([]);
  }, async () => {
    const request = await signedRequest(successPayload(), "wrong-secret");
    const response = await billingWebhook({ request, env: ENV } as any);
    const body = await response.json() as { error: string };

    assert.equal(response.status, 401);
    assert.equal(body.error, "billing_webhook_unauthorized");
    assert.equal(fetchCalled, false, "bad signatures must not touch Supabase");
  });
});

test("billing webhook activates Care WEDO subscription from a verified ECPay success event", async () => {
  const writes: Array<{ url: string; body: any; method?: string }> = [];
  let groupPlan: "free" | "pro" = "free";

  await withMockedFetch((url, init) => {
    if (url.includes("/rest/v1/billing_events?provider=eq.ecpay")) return json([]);
    if (url.includes(`/rest/v1/billing_subscriptions?family_group_id=eq.${GROUP_ID}`)) return json([]);

    const entitlement = entitlementRoutes(url, groupPlan);
    if (entitlement) return entitlement;

    if (url.includes("/rest/v1/billing_subscriptions") && init?.method === "POST") {
      writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return json([{ id: 77 }]);
    }
    if (url.includes("/rest/v1/billing_subscriptions?id=eq.77") && init?.method === "PATCH") {
      writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return json([{ id: 77 }]);
    }
    if (url.includes(`/rest/v1/family_groups?id=eq.${GROUP_ID}`) && init?.method === "PATCH") {
      groupPlan = "pro";
      writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return json([]);
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
    const response = await billingWebhook({
      request: await signedRequest(successPayload()),
      env: ENV,
    } as any);
    const body = await response.json() as { duplicate: boolean; event_type: string; subscription_status: string };

    assert.equal(response.status, 200);
    assert.equal(body.duplicate, false);
    assert.equal(body.event_type, "payment_succeeded");
    assert.equal(body.subscription_status, "active");

    assert.ok(writes.some((write) => write.url.includes("/family_groups") && write.body.plan_id === "pro"));
    assert.ok(writes.some((write) => write.url.includes("/billing_subscriptions?id=eq.77") && write.body.status === "active"));
    assert.ok(writes.some((write) => write.url.includes("/invoices") && write.body.status === "paid"));
    const providerEventWrite = writes.find((write) => write.url.endsWith("/rest/v1/billing_events"));
    assert.equal(providerEventWrite?.body.provider, "ecpay");
    assert.equal(providerEventWrite?.body.event_type, "payment_succeeded");
    assert.equal(providerEventWrite?.body.transition.to, "active");
  });
});

test("billing webhook treats replayed provider events as idempotent no-ops", async () => {
  let writeAttempted = false;
  await withMockedFetch((url, init) => {
    if (url.includes("/rest/v1/billing_events?provider=eq.ecpay")) return json([{ id: 9001 }]);
    if (init?.method && init.method !== "GET") writeAttempted = true;
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const response = await billingWebhook({
      request: await signedRequest(successPayload()),
      env: ENV,
    } as any);
    const body = await response.json() as { duplicate: boolean; event_type: string };

    assert.equal(response.status, 200);
    assert.equal(body.duplicate, true);
    assert.equal(body.event_type, "payment_succeeded");
    assert.equal(writeAttempted, false, "duplicate provider events must not mutate subscription state");
  });
});

test("billing webhook records failed checkout callbacks without activating paid entitlements", async () => {
  const writes: Array<{ url: string; body: any; method?: string }> = [];

  await withMockedFetch((url, init) => {
    if (url.includes("/rest/v1/billing_events?provider=eq.ecpay")) return json([]);
    if (url.includes(`/rest/v1/billing_subscriptions?family_group_id=eq.${GROUP_ID}`)) {
      return json([{ id: 77, family_group_id: GROUP_ID, owner_user_id: OWNER_USER_ID, status: "checkout_pending", plan_id: "free" }]);
    }

    const entitlement = entitlementRoutes(url, "free");
    if (entitlement) return entitlement;

    if (url.includes("/rest/v1/billing_subscriptions?id=eq.77") && init?.method === "PATCH") {
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
    if (url.includes(`/rest/v1/family_groups?id=eq.${GROUP_ID}`) && init?.method === "PATCH") {
      throw new Error("failed payments must not upgrade family_groups");
    }

    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const response = await billingWebhook({
      request: await signedRequest(successPayload({
        provider_event_id: "CW123:EC123:0:2026/07/07 16:00:00:10100073:payment_return",
        rtn_code: "10100073",
        rtn_message: "交易失敗",
      })),
      env: ENV,
    } as any);
    const body = await response.json() as { event_type: string; subscription_status: string };

    assert.equal(response.status, 200);
    assert.equal(body.event_type, "payment_failed");
    assert.equal(body.subscription_status, "beta");
    assert.ok(writes.some((write) => write.url.includes("/billing_subscriptions?id=eq.77") && write.body.status === "beta"));
    assert.ok(writes.some((write) => write.url.includes("/invoices") && write.body.status === "failed"));
    assert.ok(writes.some((write) => write.url.endsWith("/rest/v1/billing_events") && write.body.event_type === "payment_failed"));
  });
});
