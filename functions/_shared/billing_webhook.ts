import {
  CARE_WEDO_CARE_PROFILE_MONTHLY_PRICE,
  CARE_WEDO_PAID_COLLABORATOR_MONTHLY_PRICE,
  resolveGroupBillingEntitlement,
  type GroupBillingEntitlement,
} from "./billing";
import { supabaseFetch, type Env } from "./supabase";
import {
  isCareSubscriptionState,
  transitionSubscriptionState,
  type CareSubscriptionEventType,
  type CareSubscriptionState,
  type CareSubscriptionTransitionResult,
} from "./subscription_state";

export type BillingWebhookEnv = Env & {
  WEDO_BILLING_GATEWAY_SECRET?: string;
  WEDO_BILLING_WEBHOOK_ALLOWED_SKEW_SECONDS?: string;
};

export type CentralBillingWebhookPayload = {
  provider?: string;
  event_type?: string;
  provider_event_id?: string;
  project?: string;
  project_order_id?: string | null;
  merchant_trade_no?: string | null;
  trade_no?: string | null;
  rtn_code?: string | null;
  rtn_message?: string | null;
  amount?: number | null;
  payment_type?: string | null;
  payment_date?: string | null;
  raw?: Record<string, unknown>;
};

type BillingSubscriptionRow = {
  id: number;
  family_group_id: number;
  owner_user_id: number | null;
  status: string | null;
  plan_id: string | null;
};

type BillingSnapshot = {
  groupId: number;
  ownerUserId: number | null;
  planId: string;
  status: CareSubscriptionState;
  careProfileCount: number;
  paidCollaboratorCount: number;
  memberCount: number;
  estimatedMonthlyAmount: number;
};

export type BillingWebhookResult = {
  ok: true;
  duplicate: boolean;
  family_group_id: number;
  event_type: CareSubscriptionEventType;
  subscription_status?: CareSubscriptionState;
};

const DEFAULT_SIGNATURE_SKEW_SECONDS = 300;

function timingSafeEqualHex(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
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

export async function signBillingWebhookRequest(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  return hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
}

export async function verifyBillingWebhookSignature(
  input: {
    secret?: string;
    timestamp: string;
    signature: string;
    rawBody: string;
    toleranceSeconds?: number;
    now?: Date;
  },
): Promise<boolean> {
  if (!input.secret || !input.timestamp || !input.signature) return false;
  const timestampMs = Number(input.timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) return false;
  const nowMs = (input.now || new Date()).getTime();
  const toleranceMs = (input.toleranceSeconds ?? DEFAULT_SIGNATURE_SKEW_SECONDS) * 1000;
  if (Math.abs(nowMs - timestampMs) > toleranceMs) return false;
  const expected = await signBillingWebhookRequest(input.secret, input.timestamp, input.rawBody);
  return timingSafeEqualHex(expected, input.signature);
}

function parseAllowedSkewSeconds(env: BillingWebhookEnv): number {
  const parsed = Number(env.WEDO_BILLING_WEBHOOK_ALLOWED_SKEW_SECONDS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SIGNATURE_SKEW_SECONDS;
  return Math.min(parsed, 900);
}

function parseFamilyGroupId(projectOrderId: string | null | undefined): number | null {
  const value = String(projectOrderId || "").trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/(?:family_group|group|fg)[_-]?(\d+)/i);
  return match ? Number(match[1]) : null;
}

function normalizeProvider(value: unknown): string {
  const provider = String(value || "").trim().toLowerCase();
  return provider || "unknown";
}

function mapProviderEventType(payload: CentralBillingWebhookPayload): CareSubscriptionEventType {
  return String(payload.rtn_code || "") === "1" ? "payment_succeeded" : "payment_failed";
}

function coerceWebhookPayload(value: unknown): CentralBillingWebhookPayload {
  if (!value || typeof value !== "object") throw new Error("request_body_invalid");
  const input = value as CentralBillingWebhookPayload;
  if (input.project !== "care_wedo") throw new Error("project_not_allowed");
  if (!String(input.provider_event_id || "").trim()) throw new Error("provider_event_id_required");
  if (!parseFamilyGroupId(input.project_order_id)) throw new Error("family_group_id_required");
  return input;
}

function toSnapshot(
  entitlement: GroupBillingEntitlement,
  status: CareSubscriptionState,
): BillingSnapshot {
  return {
    groupId: entitlement.groupId,
    ownerUserId: entitlement.ownerUserId,
    planId: entitlement.planId,
    status,
    careProfileCount: entitlement.careProfileCount,
    paidCollaboratorCount: entitlement.paidCollaboratorCount,
    memberCount: entitlement.memberCount,
    estimatedMonthlyAmount: entitlement.estimatedMonthlyAmount,
  };
}

function buildLineItems(snapshot: BillingSnapshot) {
  return [
    {
      label: "主要照護對象",
      quantity: snapshot.careProfileCount,
      unit_amount: CARE_WEDO_CARE_PROFILE_MONTHLY_PRICE,
      amount: snapshot.careProfileCount * CARE_WEDO_CARE_PROFILE_MONTHLY_PRICE,
    },
    {
      label: "共同協作者",
      quantity: snapshot.paidCollaboratorCount,
      unit_amount: CARE_WEDO_PAID_COLLABORATOR_MONTHLY_PRICE,
      amount: snapshot.paidCollaboratorCount * CARE_WEDO_PAID_COLLABORATOR_MONTHLY_PRICE,
    },
  ];
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addOneMonth(date: Date): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function parseProviderDate(value: string | null | undefined): Date {
  if (!value) return new Date();
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

async function findDuplicateProviderEvent(
  env: Env,
  provider: string,
  providerEventId: string,
): Promise<boolean> {
  const rows = await supabaseFetch<Array<{ id: number }>>(
    env,
    `billing_events?provider=eq.${encodeURIComponent(provider)}&provider_event_id=eq.${encodeURIComponent(providerEventId)}&select=id&limit=1`,
  );
  return rows.length > 0;
}

async function getBillingSubscription(
  env: Env,
  groupId: number,
): Promise<BillingSubscriptionRow | null> {
  const rows = await supabaseFetch<BillingSubscriptionRow[]>(
    env,
    `billing_subscriptions?family_group_id=eq.${groupId}&select=id,family_group_id,owner_user_id,status,plan_id&limit=1`,
  );
  return rows[0] ?? null;
}

async function upsertSubscription(
  env: Env,
  snapshot: BillingSnapshot,
  subscriptionId: number | null,
  metadata: Record<string, unknown>,
): Promise<number> {
  const path = subscriptionId
    ? `billing_subscriptions?id=eq.${subscriptionId}&select=id`
    : "billing_subscriptions?on_conflict=family_group_id&select=id";
  const method = subscriptionId ? "PATCH" : "POST";
  const prefer = subscriptionId
    ? "return=representation"
    : "resolution=merge-duplicates,return=representation";
  const rows = await supabaseFetch<Array<{ id: number }>>(
    env,
    path,
    {
      method,
      headers: { Prefer: prefer },
      body: JSON.stringify({
        family_group_id: snapshot.groupId,
        owner_user_id: snapshot.ownerUserId,
        plan_id: snapshot.planId,
        status: snapshot.status,
        currency: "TWD",
        care_profile_count: snapshot.careProfileCount,
        paid_collaborator_count: snapshot.paidCollaboratorCount,
        estimated_monthly_amount: snapshot.estimatedMonthlyAmount,
        metadata,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  const id = rows[0]?.id ?? subscriptionId;
  if (!id) throw new Error("billing_subscription_upsert_failed");
  return id;
}

async function updateSubscriptionPeriod(
  env: Env,
  subscriptionId: number,
  status: CareSubscriptionState,
  paidAt: Date,
): Promise<void> {
  await supabaseFetch(env, `billing_subscriptions?id=eq.${subscriptionId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status,
      current_period_start: isoDate(paidAt),
      current_period_end: isoDate(addOneMonth(paidAt)),
      billing_anchor_day: paidAt.getUTCDate(),
      updated_at: new Date().toISOString(),
    }),
  });
}

async function upsertInvoice(
  env: Env,
  snapshot: BillingSnapshot,
  subscriptionId: number,
  transition: CareSubscriptionTransitionResult,
  paidAt: Date,
  providerAmount: number | null | undefined,
): Promise<void> {
  if (!transition.invoiceStatus) return;
  const amount = typeof providerAmount === "number" && providerAmount >= 0
    ? providerAmount
    : snapshot.estimatedMonthlyAmount;
  await supabaseFetch(env, "invoices?on_conflict=family_group_id,period", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      family_group_id: snapshot.groupId,
      subscription_id: subscriptionId,
      owner_user_id: snapshot.ownerUserId,
      period: paidAt.toISOString().slice(0, 7),
      status: transition.invoiceStatus,
      currency: "TWD",
      care_profile_count: snapshot.careProfileCount,
      paid_collaborator_count: snapshot.paidCollaboratorCount,
      amount_due: amount,
      line_items: buildLineItems(snapshot),
      issued_at: paidAt.toISOString(),
      paid_at: transition.invoiceStatus === "paid" ? paidAt.toISOString() : null,
    }),
  });
}

async function recordProviderEvent(
  env: Env,
  input: {
    provider: string;
    payload: CentralBillingWebhookPayload;
    groupId: number;
    subscriptionId: number;
    beforeSnapshot: BillingSnapshot;
    afterSnapshot: BillingSnapshot;
    transition: CareSubscriptionTransitionResult;
  },
): Promise<void> {
  await supabaseFetch(env, "billing_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      family_group_id: input.groupId,
      subscription_id: input.subscriptionId,
      actor_user_id: input.afterSnapshot.ownerUserId,
      event_type: input.transition.eventType,
      provider: input.provider,
      provider_event_id: input.payload.provider_event_id,
      merchant_trade_no: input.payload.merchant_trade_no || null,
      provider_trade_no: input.payload.trade_no || null,
      amount_delta: input.afterSnapshot.estimatedMonthlyAmount - input.beforeSnapshot.estimatedMonthlyAmount,
      before_snapshot: input.beforeSnapshot,
      after_snapshot: input.afterSnapshot,
      raw_event: input.payload,
      transition: input.transition,
      note: input.payload.rtn_message || null,
    }),
  });
}

async function ensureCheckoutPending(
  env: Env,
  groupId: number,
  subscription: BillingSubscriptionRow | null,
  currentState: CareSubscriptionState,
  providerEventId: string,
): Promise<{ subscriptionId: number; state: CareSubscriptionState; snapshot: BillingSnapshot }> {
  const entitlement = await resolveGroupBillingEntitlement(env, groupId);
  const snapshot = toSnapshot(entitlement, currentState);
  let subscriptionId = subscription?.id ?? await upsertSubscription(env, snapshot, null, {
    source: "billing_webhook",
    hydrated_from: "provider_callback",
  });
  if (currentState !== "beta" && currentState !== "canceled") {
    return { subscriptionId, state: currentState, snapshot };
  }

  const checkoutTransition = transitionSubscriptionState(currentState, {
    type: "checkout_created",
    requestId: `gateway:${providerEventId}`,
  });
  if (!checkoutTransition.accepted) {
    return { subscriptionId, state: currentState, snapshot };
  }
  const checkoutSnapshot = { ...snapshot, status: checkoutTransition.to };
  subscriptionId = await upsertSubscription(env, checkoutSnapshot, subscriptionId, {
    source: "billing_webhook",
    hydrated_from: "provider_callback",
    transition: checkoutTransition,
  });
  return { subscriptionId, state: checkoutTransition.to, snapshot: checkoutSnapshot };
}

export async function handleCentralBillingWebhook(
  request: Request,
  env: BillingWebhookEnv,
): Promise<BillingWebhookResult> {
  const rawBody = await request.text();
  const verified = await verifyBillingWebhookSignature({
    secret: env.WEDO_BILLING_GATEWAY_SECRET,
    timestamp: request.headers.get("x-wedo-billing-timestamp") || "",
    signature: request.headers.get("x-wedo-billing-signature") || "",
    rawBody,
    toleranceSeconds: parseAllowedSkewSeconds(env),
  });
  if (!verified) throw new Error("billing_webhook_unauthorized");

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawBody);
  } catch {
    throw new Error("request_body_invalid");
  }
  const payload = coerceWebhookPayload(parsedPayload);
  const provider = normalizeProvider(payload.provider);
  const providerEventId = String(payload.provider_event_id || "").trim();
  const groupId = parseFamilyGroupId(payload.project_order_id);
  if (!groupId) throw new Error("family_group_id_required");

  const eventType = mapProviderEventType(payload);
  if (await findDuplicateProviderEvent(env, provider, providerEventId)) {
    return { ok: true, duplicate: true, family_group_id: groupId, event_type: eventType };
  }

  const subscription = await getBillingSubscription(env, groupId);
  const persistedState = subscription?.status || "beta";
  const currentState = isCareSubscriptionState(persistedState) ? persistedState : "beta";
  const prepared = await ensureCheckoutPending(env, groupId, subscription, currentState, providerEventId);

  const transition = transitionSubscriptionState(prepared.state, {
    type: eventType,
    provider,
    providerEventId,
  });
  if (!transition.accepted) throw new Error(transition.reason || "subscription_transition_rejected");

  const paidAt = parseProviderDate(payload.payment_date);
  if (transition.to === "active") {
    await supabaseFetch(env, `family_groups?id=eq.${groupId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        plan_id: "pro",
        plan_started_at: paidAt.toISOString(),
        plan_expires_at: addOneMonth(paidAt).toISOString(),
      }),
    });
  }

  const afterEntitlement = await resolveGroupBillingEntitlement(env, groupId);
  const afterSnapshot = toSnapshot(afterEntitlement, transition.to);
  const subscriptionId = await upsertSubscription(env, afterSnapshot, prepared.subscriptionId, {
    source: "billing_webhook",
    provider,
    provider_event_id: providerEventId,
    merchant_trade_no: payload.merchant_trade_no || null,
    trade_no: payload.trade_no || null,
    transition,
  });
  if (transition.to === "active") {
    await updateSubscriptionPeriod(env, subscriptionId, transition.to, paidAt);
  }
  await upsertInvoice(env, afterSnapshot, subscriptionId, transition, paidAt, payload.amount);
  await recordProviderEvent(env, {
    provider,
    payload,
    groupId,
    subscriptionId,
    beforeSnapshot: prepared.snapshot,
    afterSnapshot,
    transition,
  });

  return {
    ok: true,
    duplicate: false,
    family_group_id: groupId,
    event_type: eventType,
    subscription_status: transition.to,
  };
}
