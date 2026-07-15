import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as billingCancel } from "../api/billing/cancel";
import { onRequestGet as billingHistory } from "../api/billing/history";

const GROUP_ID = 123;
const USER_ID = 88;
const SECRET = "test-checkout-secret";
const CANCEL_URL = "https://www.wedopr.com/api/billing/subscription/cancel";

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

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

function makeRequest(path: string, method: string, body?: unknown): Request {
  return new Request(`https://care.example${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeContext(request: Request) {
  return {
    request,
    env: {
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      WEDO_BILLING_CHECKOUT_SECRET: SECRET,
      WEDO_BILLING_SUBSCRIPTION_CANCEL_URL: CANCEL_URL,
    },
    data: {
      requestUser: {
        userId: USER_ID,
        identity: { provider: "line", lineUserId: "U-test", name: "Test User" },
      },
    },
  } as any;
}

test("billing cancel terminates the provider recurring order before marking the local subscription canceled", async () => {
  const writes: Array<{ url: string; method?: string; body: any }> = [];
  let centralPayload: any = null;

  await withMockedFetch(async (url, init) => {
    if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${USER_ID}&group_id=eq.${GROUP_ID}`)) {
      return json([{ role: "admin", can_pay: true }]);
    }
    if (url.includes(`/rest/v1/billing_subscriptions?family_group_id=eq.${GROUP_ID}`)) {
      return json([{
        id: 77,
        status: "active",
        estimated_monthly_amount: 10,
        current_period_end: "2026-08-15",
        provider_merchant_trade_no: "CWTEST123",
      }]);
    }
    if (url === CANCEL_URL) {
      centralPayload = JSON.parse(String(init?.body || "{}"));
      return json({ success: true, provider: "ecpay", merchant_trade_no: "CWTEST123" });
    }
    if (url.includes(`/rest/v1/billing_subscriptions?id=eq.77`) && init?.method === "PATCH") {
      writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return json([]);
    }
    if (url.endsWith("/rest/v1/billing_events") && init?.method === "POST") {
      writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return json([]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const response = await billingCancel(makeContext(makeRequest("/api/billing/cancel", "POST", { group_id: GROUP_ID })));
    const body = await response.json() as { canceled: boolean; status: string };

    assert.equal(response.status, 200);
    assert.equal(body.canceled, true);
    assert.equal(body.status, "cancel_at_period_end");
    assert.equal(centralPayload.project, "care_wedo");
    assert.equal(centralPayload.project_order_id, `family_group_${GROUP_ID}`);
    assert.equal(centralPayload.merchant_trade_no, "CWTEST123");
    assert.equal(centralPayload.action, "Cancel");
    assert.ok(writes.some((write) => write.body.status === "cancel_at_period_end"));
    assert.ok(writes.some((write) => write.body.event_type === "subscription_canceled"));
  });
});

test("billing history returns invoices and provider events scoped to a member group", async () => {
  await withMockedFetch((url) => {
    if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${USER_ID}&group_id=eq.${GROUP_ID}`)) {
      return json([{ role: "member", can_pay: false }]);
    }
    if (url.includes(`/rest/v1/invoices?family_group_id=eq.${GROUP_ID}`)) {
      return json([{ id: 1, period: "2026-07", status: "paid", currency: "TWD", amount_due: 10, paid_at: "2026-07-15T00:00:00Z" }]);
    }
    if (url.includes(`/rest/v1/billing_events?family_group_id=eq.${GROUP_ID}`)) {
      return json([{ id: 2, event_type: "payment_succeeded", provider: "ecpay", amount_delta: 10, merchant_trade_no: "CWTEST123", provider_trade_no: "EC123", created_at: "2026-07-15T00:00:00Z" }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const response = await billingHistory(makeContext(makeRequest(`/api/billing/history?group_id=${GROUP_ID}`, "GET")));
    const body = await response.json() as { history: Array<{ kind: string }> };

    assert.equal(response.status, 200);
    assert.equal(body.history.length, 2);
    assert.deepEqual(body.history.map((item) => item.kind), ["invoice", "event"]);
  });
});
