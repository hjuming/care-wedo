import { getRequestUser } from "../../_shared/auth_context";
import { readJsonBody } from "../../_shared/request_body";
import { isPaidSubscriptionStatus } from "../../_shared/billing";
import { supabaseFetch, type Env } from "../../_shared/supabase";

type BillingCancelEnv = Env & {
  WEDO_BILLING_CHECKOUT_SECRET?: string;
  WEDO_BILLING_SUBSCRIPTION_CANCEL_URL?: string;
};

const DEFAULT_CANCEL_URL = "https://www.wedopr.com/api/billing/subscription/cancel";

type SubscriptionRow = {
  id: number;
  status: string | null;
  current_period_end: string | null;
  provider: string | null;
  provider_merchant_trade_no: string | null;
};

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

async function signGatewayRequest(secret: string, timestamp: string, rawBody: string): Promise<string> {
  return hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
}

async function assertCanPay(env: Env, userId: number, groupId: number): Promise<void> {
  const rows = await supabaseFetch<Array<{ role: string | null; can_pay: boolean | null }>>(
    env,
    `user_family_groups?user_id=eq.${userId}&group_id=eq.${groupId}&select=role,can_pay&limit=1`,
  );
  const membership = rows[0];
  if (!membership) throw new Error("您還沒有這個群組的權限");
  if (membership.role === "admin" || membership.can_pay === true) return;
  throw new Error("只有群組管理者或付款負責人可以管理訂閱");
}

async function getSubscription(env: Env, groupId: number): Promise<SubscriptionRow | null> {
  try {
    const rows = await supabaseFetch<SubscriptionRow[]>(
      env,
      `billing_subscriptions?family_group_id=eq.${groupId}&select=id,status,current_period_end,provider,provider_merchant_trade_no&limit=1`,
    );
    return rows[0] || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (!/column .* does not exist|schema cache|PGRST2(0|04)/i.test(message)) throw error;
    const rows = await supabaseFetch<SubscriptionRow[]>(
      env,
      `billing_subscriptions?family_group_id=eq.${groupId}&select=id,status,current_period_end&limit=1`,
    );
    return rows[0] || null;
  }
}

async function getLatestMerchantTradeNo(env: Env, groupId: number): Promise<string | null> {
  const rows = await supabaseFetch<Array<{ merchant_trade_no: string | null }>>(
    env,
    `billing_events?family_group_id=eq.${groupId}&merchant_trade_no=not.is.null&select=merchant_trade_no&order=created_at.desc&limit=1`,
  );
  return rows[0]?.merchant_trade_no || null;
}

async function callCentralCancel(env: BillingCancelEnv, groupId: number, merchantTradeNo: string) {
  if (!env.WEDO_BILLING_CHECKOUT_SECRET) throw new Error("billing_cancel_not_configured");
  const payload = {
    project: "care_wedo",
    project_order_id: `family_group_${groupId}`,
    merchant_trade_no: merchantTradeNo,
    action: "Cancel",
  };
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await signGatewayRequest(env.WEDO_BILLING_CHECKOUT_SECRET, timestamp, rawBody);
  const response = await fetch(env.WEDO_BILLING_SUBSCRIPTION_CANCEL_URL || DEFAULT_CANCEL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wedo-billing-timestamp": timestamp,
      "x-wedo-billing-signature": signature,
    },
    body: rawBody,
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || body.success !== true) {
    throw new Error(String(body.error || "billing_subscription_cancel_failed"));
  }
  return body;
}

export const onRequestPost: PagesFunction<BillingCancelEnv> = async (context) => {
  try {
    const { env } = context;
    const { userId } = await getRequestUser(context);
    const body = await readJsonBody<{ group_id?: unknown; reason?: unknown }>(context.request);
    const groupId = Number(body.group_id);
    if (!Number.isInteger(groupId) || groupId <= 0) {
      return Response.json({ error: "group_id_required" }, { status: 400 });
    }

    await assertCanPay(env, userId, groupId);
    const subscription = await getSubscription(env, groupId);
    if (!subscription) return Response.json({ error: "billing_subscription_not_found" }, { status: 404 });
    if (subscription.status === "canceled") {
      return Response.json({ canceled: true, status: "canceled", already_canceled: true });
    }
    if (subscription.status === "cancel_at_period_end") {
      return Response.json({
        canceled: true,
        status: "cancel_at_period_end",
        current_period_end: subscription.current_period_end,
        already_canceled: true,
      });
    }
    if (!isPaidSubscriptionStatus(subscription.status)) {
      return Response.json({ error: "billing_subscription_not_active" }, { status: 409 });
    }

    const merchantTradeNo = subscription.provider_merchant_trade_no || await getLatestMerchantTradeNo(env, groupId);
    if (!merchantTradeNo) return Response.json({ error: "billing_provider_reference_missing" }, { status: 409 });
    const providerResult = await callCentralCancel(env, groupId, merchantTradeNo);
    const reason = String(body.reason || "user_requested").slice(0, 120);
    const now = new Date().toISOString();

    await supabaseFetch(env, `billing_subscriptions?id=eq.${subscription.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "cancel_at_period_end",
        cancel_at_period_end: true,
        cancel_reason: reason,
        provider: "ecpay",
        provider_merchant_trade_no: merchantTradeNo,
        canceled_at: now,
        updated_at: now,
      }),
    });
    await supabaseFetch(env, "billing_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        family_group_id: groupId,
        subscription_id: subscription.id,
        actor_user_id: userId,
        event_type: "subscription_canceled",
        provider: "ecpay",
        merchant_trade_no: merchantTradeNo,
        amount_delta: 0,
        transition: { from: subscription.status, to: "cancel_at_period_end", action: "Cancel" },
        raw_event: providerResult,
        note: reason,
      }),
    });

    return Response.json({
      canceled: true,
      status: "cancel_at_period_end",
      current_period_end: subscription.current_period_end,
      merchant_trade_no: merchantTradeNo,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "billing_subscription_cancel_failed";
    const status = message.includes("請先登入") ? 401 : message.includes("權限") ? 403 : 500;
    return Response.json({ error: message }, { status });
  }
};
