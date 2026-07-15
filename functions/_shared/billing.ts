import type { Env } from "./auth_identity";
import { supabaseFetch } from "./supabase";

export type PlanRow = {
  id: string;
  name: string;
  monthly_ocr_limit: number;
  max_members: number;
  max_recipients: number;
  family_group_enabled: boolean;
  price_monthly_usd: number;
  is_active: boolean;
  sort_order: number;
};

// Phase 1 新增：usage_quotas（以 group_id 為單位的額度）
export type UsageQuotaRow = {
  id: number;
  group_id: number;
  period: string;   // 'YYYY-MM'
  feature: string;  // 'ocr_upload'
  used_count: number;
  limit_count: number;
  plan_snapshot: string;
  updated_at: string;
  created_at: string;
};

export const FREE_OCR_MONTHLY_LIMIT = 10;
export const MULTIPLE_FAMILY_GROUPS_FEATURE = "multiple_family_groups";
export const CARE_WEDO_MAX_CARE_PROFILES_PER_GROUP = 4;
export const CARE_WEDO_MAX_PAID_COLLABORATORS_PER_GROUP = 5;
export const CARE_WEDO_MAX_MEMBERS_PER_GROUP = CARE_WEDO_MAX_PAID_COLLABORATORS_PER_GROUP + 1;
export const CARE_WEDO_CARE_PROFILE_MONTHLY_PRICE = 30;
export const CARE_WEDO_PAID_COLLABORATOR_MONTHLY_PRICE = 10;
export const CARE_WEDO_GROUP_MONTHLY_PRICE_MAX = 250;
export const CARE_WEDO_INCLUDED_CARE_PROFILES_DURING_BETA = 1;

// Pricing copy must come from one backend-owned contract. Frontend clients may
// render this summary, but must not invent a second set of add-on amounts.
export const CARE_WEDO_PRICING = Object.freeze({
  currency_symbol: "$",
  recipient_monthly: CARE_WEDO_CARE_PROFILE_MONTHLY_PRICE,
  collaborator_monthly: CARE_WEDO_PAID_COLLABORATOR_MONTHLY_PRICE,
  included_care_profiles_during_beta: CARE_WEDO_INCLUDED_CARE_PROFILES_DURING_BETA,
  free_monthly_ocr_limit: FREE_OCR_MONTHLY_LIMIT,
  paid_monthly_ocr_limit: 100,
});

export type GroupBillingEntitlement = {
  groupId: number;
  ownerUserId: number | null;
  planId: string;
  subscriptionStatus: string | null;
  careProfileCount: number;
  paidCollaboratorCount: number;
  memberCount: number;
  estimatedMonthlyAmount: number;
  paidMonthlyAmount: number;
  coveredCareProfileCount: number;
  coveredPaidCollaboratorCount: number;
  maxCareProfiles: number;
  maxPaidCollaborators: number;
  maxMembersIncludingOwner: number;
  canAddCareProfile: boolean;
  canInviteCollaborator: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  provider: string | null;
  providerMerchantTradeNo: string | null;
};

type BillingEventType =
  | "checkout_created"
  | "care_profile_created"
  | "collaborator_joined"
  | "subscription_upgraded"
  | "subscription_downgraded"
  | "subscription_canceled"
  | "subscription_cancel_requested";

type BillingSnapshot = {
  groupId: number;
  ownerUserId: number | null;
  planId: string;
  careProfileCount: number;
  paidCollaboratorCount: number;
  memberCount: number;
  estimatedMonthlyAmount: number;
};

type BillingSubscriptionSnapshotRow = {
  status: string | null;
  care_profile_count: number | null;
  paid_collaborator_count: number | null;
  estimated_monthly_amount: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  canceled_at: string | null;
  provider: string | null;
  provider_merchant_trade_no: string | null;
};

type BillingGroupEventInput = {
  groupId: number;
  actorUserId: number;
  eventType: BillingEventType;
  beforeSnapshot?: GroupBillingEntitlement;
  subjectUserId?: number | null;
  careProfileId?: number | null;
  note?: string;
};

type BillingCheckoutCreatedInput = {
  groupId: number;
  actorUserId: number;
  actionType: "create_profile" | "invite_collaborator" | "settle_group";
  requestId: string;
  provider: string;
  providerCheckoutId?: string | null;
  merchantTradeNo?: string | null;
  amount: number;
  beforeSnapshot: GroupBillingEntitlement;
  afterSnapshot: BillingSnapshot;
};

// Fallback plan definition — used when DB lookup fails or group has no plan_id.
const FREE_PLAN_FALLBACK: PlanRow = {
  id: "free",
  name: "Free",
  monthly_ocr_limit: 10,
  max_members: 1,
  max_recipients: 1,
  family_group_enabled: false,
  price_monthly_usd: 0,
  is_active: true,
  sort_order: 10,
};

function normalizePlanLimits(plan: PlanRow): PlanRow {
  if (plan.id !== "pro") return plan;
  return {
    ...plan,
    max_members: CARE_WEDO_MAX_MEMBERS_PER_GROUP,
    max_recipients: CARE_WEDO_MAX_CARE_PROFILES_PER_GROUP,
  };
}

function resolveMonthlyOcrLimit(plan: PlanRow, recipientCount = 1): number {
  if (plan.id === "free") return plan.monthly_ocr_limit;
  return plan.monthly_ocr_limit * Math.max(recipientCount, 1);
}

async function getGroupRecipientCount(env: Env, groupId: number | null): Promise<number> {
  if (!groupId) return 1;
  const profiles = await supabaseFetch<Array<{ id: number }>>(
    env,
    `care_profiles?group_id=eq.${groupId}&select=id`,
  );
  return Math.max(profiles.length, 1);
}

export function getChargeableCareProfileCountDuringBeta(careProfileCount: number): number {
  return Math.max((Number(careProfileCount) || 0) - CARE_WEDO_INCLUDED_CARE_PROFILES_DURING_BETA, 0);
}

export function calculateCareCircleMonthlyAmount(careProfileCount: number, paidCollaboratorCount: number): number {
  const amount = (
    getChargeableCareProfileCountDuringBeta(careProfileCount) * CARE_WEDO_CARE_PROFILE_MONTHLY_PRICE
    + Math.max(paidCollaboratorCount, 0) * CARE_WEDO_PAID_COLLABORATOR_MONTHLY_PRICE
  );
  return Math.min(amount, CARE_WEDO_GROUP_MONTHLY_PRICE_MAX);
}

export function isPaidSubscriptionStatus(
  status: string | null | undefined,
): status is "active" | "cancel_at_period_end" {
  return status === "active" || status === "cancel_at_period_end";
}

async function getBillingSubscriptionSnapshot(
  env: Env,
  groupId: number,
): Promise<BillingSubscriptionSnapshotRow | null> {
  try {
    try {
      const rows = await supabaseFetch<BillingSubscriptionSnapshotRow[]>(
        env,
        `billing_subscriptions?family_group_id=eq.${groupId}&select=status,care_profile_count,paid_collaborator_count,estimated_monthly_amount,current_period_start,current_period_end,cancel_at_period_end,canceled_at,provider,provider_merchant_trade_no&limit=1`,
      );
      return rows[0] ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      if (!/column .* does not exist|schema cache|PGRST2(0|04)/i.test(message)) throw error;
      const rows = await supabaseFetch<BillingSubscriptionSnapshotRow[]>(
        env,
        `billing_subscriptions?family_group_id=eq.${groupId}&select=status,care_profile_count,paid_collaborator_count,estimated_monthly_amount&limit=1`,
      );
      return rows[0] ?? null;
    }
  } catch (error) {
    if (!isBillingFoundationMissingError(error)) {
      console.warn("Care WEDO billing subscription lookup failed", error);
    }
    return null;
  }
}

async function getLatestProviderMerchantTradeNo(env: Env, groupId: number): Promise<string | null> {
  try {
    const rows = await supabaseFetch<Array<{ merchant_trade_no: string | null }>>(
      env,
      `billing_events?family_group_id=eq.${groupId}&merchant_trade_no=not.is.null&select=merchant_trade_no&order=created_at.desc&limit=1`,
    );
    return rows[0]?.merchant_trade_no || null;
  } catch (error) {
    if (!isBillingFoundationMissingError(error)) {
      console.warn("Care WEDO billing provider reference lookup failed", error);
    }
    return null;
  }
}

export async function resolveGroupBillingEntitlement(
  env: Env,
  groupId: number,
): Promise<GroupBillingEntitlement> {
  const [groups, profiles, members, plan, subscription] = await Promise.all([
    supabaseFetch<Array<{ owner_user_id: number | null; plan_id: string | null }>>(
      env,
      `family_groups?id=eq.${groupId}&select=owner_user_id,plan_id&limit=1`,
    ),
    supabaseFetch<Array<{ id: number }>>(
      env,
      `care_profiles?group_id=eq.${groupId}&select=id`,
    ),
    supabaseFetch<Array<{ user_id: number }>>(
      env,
      `user_family_groups?group_id=eq.${groupId}&select=user_id`,
    ),
    getGroupPlan(env, groupId),
    getBillingSubscriptionSnapshot(env, groupId),
  ]);

  const ownerUserId = groups[0]?.owner_user_id ?? null;
  const careProfileCount = profiles.length;
  const paidCollaboratorCount = members
    .filter((member) => ownerUserId === null || member.user_id !== ownerUserId)
    .length;
  const isCareCircle = plan.id === "pro";
  const maxCareProfiles = isCareCircle ? CARE_WEDO_MAX_CARE_PROFILES_PER_GROUP : plan.max_recipients;
  const maxPaidCollaborators = isCareCircle
    ? CARE_WEDO_MAX_PAID_COLLABORATORS_PER_GROUP
    : Math.max(plan.max_members - 1, 0);
  const maxMembersIncludingOwner = isCareCircle ? CARE_WEDO_MAX_MEMBERS_PER_GROUP : plan.max_members;
  const estimatedMonthlyAmount = isCareCircle
    ? calculateCareCircleMonthlyAmount(careProfileCount, paidCollaboratorCount)
    : 0;
  // ECPay cancellation is effective at the end of the current period. Once
  // that boundary has passed, stop granting paid coverage even if a webhook
  // has not yet rewritten the local row to `canceled`.
  const periodEnded = subscription?.cancel_at_period_end === true
    && Boolean(subscription.current_period_end)
    && Number.isFinite(Date.parse(subscription.current_period_end as string))
    && Date.parse(subscription.current_period_end as string) <= Date.now();
  const subscriptionStatus = periodEnded ? "canceled" : (subscription?.status ?? null);
  const providerMerchantTradeNo = subscription?.provider_merchant_trade_no
    || (subscriptionStatus && isPaidSubscriptionStatus(subscriptionStatus)
      ? await getLatestProviderMerchantTradeNo(env, groupId)
      : null);
  const paidMonthlyAmount = isPaidSubscriptionStatus(subscriptionStatus)
    ? Math.max(subscription?.estimated_monthly_amount || 0, 0)
    : 0;
  const coveredCareProfileCount = isPaidSubscriptionStatus(subscriptionStatus)
    ? Math.max(subscription?.care_profile_count || 0, careProfileCount)
    : careProfileCount;
  const coveredPaidCollaboratorCount = isPaidSubscriptionStatus(subscriptionStatus)
    ? Math.max(subscription?.paid_collaborator_count || 0, paidCollaboratorCount)
    : paidCollaboratorCount;

  return {
    groupId,
    ownerUserId,
    planId: groups[0]?.plan_id || plan.id,
    subscriptionStatus,
    careProfileCount,
    paidCollaboratorCount,
    memberCount: members.length,
    estimatedMonthlyAmount,
    paidMonthlyAmount,
    coveredCareProfileCount,
    coveredPaidCollaboratorCount,
    maxCareProfiles,
    maxPaidCollaborators,
    maxMembersIncludingOwner,
    canAddCareProfile: careProfileCount < maxCareProfiles,
    canInviteCollaborator: paidCollaboratorCount < maxPaidCollaborators
      && members.length < maxMembersIncludingOwner,
    currentPeriodStart: subscription?.current_period_start ?? null,
    currentPeriodEnd: subscription?.current_period_end ?? null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end === true && !periodEnded,
    canceledAt: subscription?.canceled_at ?? null,
    provider: subscription?.provider ?? null,
    providerMerchantTradeNo,
  };
}

function serializeBillingSnapshot(entitlement: GroupBillingEntitlement): BillingSnapshot {
  return {
    groupId: entitlement.groupId,
    ownerUserId: entitlement.ownerUserId,
    planId: entitlement.planId,
    careProfileCount: entitlement.careProfileCount,
    paidCollaboratorCount: entitlement.paidCollaboratorCount,
    memberCount: entitlement.memberCount,
    estimatedMonthlyAmount: entitlement.estimatedMonthlyAmount,
  };
}

function isBillingFoundationMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/billing_subscriptions|billing_events|invoices/i.test(message)) return true;
  if (/relation .* does not exist|schema cache|Could not find|PGRST20[045]/i.test(message)) return true;
  return false;
}

function buildBillingLineItems(snapshot: BillingSnapshot) {
  const chargeableCareProfileCount = getChargeableCareProfileCountDuringBeta(snapshot.careProfileCount);
  return [
    {
      label: "主要照護對象（首位測試期減免）",
      quantity: chargeableCareProfileCount,
      included_quantity: Math.min(snapshot.careProfileCount, CARE_WEDO_INCLUDED_CARE_PROFILES_DURING_BETA),
      unit_amount: CARE_WEDO_CARE_PROFILE_MONTHLY_PRICE,
      amount: chargeableCareProfileCount * CARE_WEDO_CARE_PROFILE_MONTHLY_PRICE,
    },
    {
      label: "共同協作者",
      quantity: snapshot.paidCollaboratorCount,
      unit_amount: CARE_WEDO_PAID_COLLABORATOR_MONTHLY_PRICE,
      amount: snapshot.paidCollaboratorCount * CARE_WEDO_PAID_COLLABORATOR_MONTHLY_PRICE,
    },
  ];
}

async function upsertBillingSubscriptionSnapshot(
  env: Env,
  snapshot: BillingSnapshot,
  status = "beta",
): Promise<number | null> {
  const rows = await supabaseFetch<Array<{ id: number }>>(
    env,
    "billing_subscriptions?on_conflict=family_group_id&select=id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        family_group_id: snapshot.groupId,
        owner_user_id: snapshot.ownerUserId,
        plan_id: snapshot.planId,
        status,
        currency: "TWD",
        care_profile_count: snapshot.careProfileCount,
        paid_collaborator_count: snapshot.paidCollaboratorCount,
        estimated_monthly_amount: snapshot.estimatedMonthlyAmount,
        metadata: snapshot,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  return rows[0]?.id ?? null;
}

async function upsertBillingInvoiceDraft(
  env: Env,
  snapshot: BillingSnapshot,
  subscriptionId: number | null,
  status = "draft",
): Promise<void> {
  await supabaseFetch(
    env,
    "invoices?on_conflict=family_group_id,period",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        family_group_id: snapshot.groupId,
        subscription_id: subscriptionId,
        owner_user_id: snapshot.ownerUserId,
        period: currentPeriod(),
        status,
        currency: "TWD",
        care_profile_count: snapshot.careProfileCount,
        paid_collaborator_count: snapshot.paidCollaboratorCount,
        amount_due: snapshot.estimatedMonthlyAmount,
        line_items: buildBillingLineItems(snapshot),
      }),
    },
  );
}

export function buildBillingSnapshotFromEntitlement(
  entitlement: GroupBillingEntitlement,
  overrides: Partial<Pick<BillingSnapshot, "planId" | "careProfileCount" | "paidCollaboratorCount" | "memberCount" | "estimatedMonthlyAmount">> = {},
): BillingSnapshot {
  const careProfileCount = overrides.careProfileCount ?? entitlement.careProfileCount;
  const paidCollaboratorCount = overrides.paidCollaboratorCount ?? entitlement.paidCollaboratorCount;
  return {
    groupId: entitlement.groupId,
    ownerUserId: entitlement.ownerUserId,
    planId: overrides.planId ?? entitlement.planId,
    careProfileCount,
    paidCollaboratorCount,
    memberCount: overrides.memberCount ?? entitlement.memberCount,
    estimatedMonthlyAmount: overrides.estimatedMonthlyAmount
      ?? calculateCareCircleMonthlyAmount(careProfileCount, paidCollaboratorCount),
  };
}

export async function recordBillingCheckoutCreated(
  env: Env,
  input: BillingCheckoutCreatedInput,
): Promise<boolean> {
  try {
    const subscriptionId = await upsertBillingSubscriptionSnapshot(env, input.afterSnapshot, "checkout_pending");
    await upsertBillingInvoiceDraft(env, input.afterSnapshot, subscriptionId, "open");
    await supabaseFetch(env, "billing_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        family_group_id: input.groupId,
        subscription_id: subscriptionId,
        actor_user_id: input.actorUserId,
        event_type: "checkout_created",
        amount_delta: input.afterSnapshot.estimatedMonthlyAmount - input.beforeSnapshot.estimatedMonthlyAmount,
        before_snapshot: serializeBillingSnapshot(input.beforeSnapshot),
        after_snapshot: input.afterSnapshot,
        provider: input.provider,
        provider_checkout_id: input.providerCheckoutId || null,
        merchant_trade_no: input.merchantTradeNo || null,
        transition: {
          from: "beta",
          to: "checkout_pending",
          request_id: input.requestId,
        },
        note: input.actionType,
      }),
    });
    return true;
  } catch (error) {
    if (!isBillingFoundationMissingError(error)) {
      console.warn("Care WEDO billing checkout was not recorded", error);
    }
    return false;
  }
}

export async function recordBillingGroupEvent(
  env: Env,
  input: BillingGroupEventInput,
): Promise<boolean> {
  try {
    const beforeSnapshot = input.beforeSnapshot
      ? serializeBillingSnapshot(input.beforeSnapshot)
      : null;
    const afterEntitlement = await resolveGroupBillingEntitlement(env, input.groupId);
    const afterSnapshot = serializeBillingSnapshot(afterEntitlement);
    const previousSubscriptionStatus = input.beforeSnapshot?.subscriptionStatus;
    const subscriptionStatus = isPaidSubscriptionStatus(previousSubscriptionStatus)
      ? previousSubscriptionStatus
      : "beta";
    const subscriptionId = await upsertBillingSubscriptionSnapshot(env, afterSnapshot, subscriptionStatus);
    await upsertBillingInvoiceDraft(env, afterSnapshot, subscriptionId, subscriptionStatus === "active" ? "paid" : "draft");
    await supabaseFetch(env, "billing_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        family_group_id: input.groupId,
        subscription_id: subscriptionId,
        actor_user_id: input.actorUserId,
        subject_user_id: input.subjectUserId || null,
        care_profile_id: input.careProfileId || null,
        event_type: input.eventType,
        amount_delta: afterSnapshot.estimatedMonthlyAmount - (beforeSnapshot?.estimatedMonthlyAmount || 0),
        before_snapshot: beforeSnapshot || {},
        after_snapshot: afterSnapshot,
        note: input.note || null,
      }),
    });
    return true;
  } catch (error) {
    if (!isBillingFoundationMissingError(error)) {
      console.warn("Care WEDO billing event was not recorded", error);
    }
    return false;
  }
}

/**
 * Fetch the plan for a group.
 * Reads family_groups.plan_id → joins plans table.
 * Falls back to the free plan if the group or plan row is not found.
 */
export async function getGroupPlan(env: Env, groupId: number | null): Promise<PlanRow> {
  if (!groupId) return FREE_PLAN_FALLBACK;

  const groups = await supabaseFetch<Array<{ plan_id: string | null }>>(
    env,
    `family_groups?id=eq.${groupId}&select=plan_id&limit=1`,
  );
  const planId = groups[0]?.plan_id || "free";

  const plans = await supabaseFetch<PlanRow[]>(
    env,
    `plans?id=eq.${encodeURIComponent(planId)}&select=*&limit=1`,
  );
  return normalizePlanLimits(plans[0] ?? FREE_PLAN_FALLBACK);
}

type UserPlanRow = { plan: string; plan_expires_at: string | null };

export async function getUserPlan(env: Env, userId: number): Promise<{ plan: string; planExpiresAt: string | null }> {
  const rows = await supabaseFetch<UserPlanRow[]>(
    env,
    `users?id=eq.${userId}&select=plan,plan_expires_at&limit=1`,
  );
  const row = rows[0];
  if (!row) return { plan: "free", planExpiresAt: null };

  // If plan has expired, treat as free
  if (row.plan === "paid" && row.plan_expires_at) {
    const expires = new Date(row.plan_expires_at);
    if (expires < new Date()) return { plan: "free", planExpiresAt: row.plan_expires_at };
  }
  return { plan: row.plan || "free", planExpiresAt: row.plan_expires_at };
}

export async function getMonthlyOcrUsage(env: Env, userId: number): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Count appointments created this month via OCR (those with a reminder_text set by OCR)
  // We use created_at as proxy — OCR-created records share the same timestamp window
  const apts = await supabaseFetch<Array<{ id: number }>>(
    env,
    `appointments?user_id=eq.${userId}&created_at=gte.${startOfMonth}&select=id`,
  );
  const meds = await supabaseFetch<Array<{ id: number }>>(
    env,
    `medications?user_id=eq.${userId}&created_at=gte.${startOfMonth}&select=id`,
  );
  // Each OCR call typically creates 1-3 records; we count total records as usage proxy
  // A more precise approach would require a dedicated ocr_usage table (Sprint 2+)
  return apts.length + meds.length;
}

export async function checkOcrQuota(env: Env, userId: number): Promise<void> {
  const { plan } = await getUserPlan(env, userId);
  if (plan === "paid") return; // paid users have unlimited OCR

  const used = await getMonthlyOcrUsage(env, userId);
  if (used >= FREE_OCR_MONTHLY_LIMIT) {
    throw new Error(`本月免費次數已用完（${FREE_OCR_MONTHLY_LIMIT} 次），升級付費方案可無限使用。`);
  }
}

// ─── Group-based quota (Phase 2) ─────────────────────────────────────────────
// Replaces per-user appointment/medication count with a dedicated usage_quotas row.
// One OCR job = 1 deduction, regardless of how many records it creates.

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

export async function getGroupOcrUsage(env: Env, groupId: number | null): Promise<number> {
  if (!groupId) return 0;
  const rows = await supabaseFetch<Array<{ used_count: number }>>(
    env,
    `usage_quotas?group_id=eq.${groupId}&period=eq.${currentPeriod()}&feature=eq.ocr_upload&select=used_count&limit=1`,
  );
  return rows[0]?.used_count ?? 0;
}

/**
 * Check whether the group has remaining OCR quota this month.
 * Reads the group's plan to determine the limit.
 * Throws with a user-facing message if the quota is exhausted.
 * Returns the PlanRow so callers can pass it to incrementGroupOcrQuota.
 */
export async function checkGroupOcrQuota(env: Env, groupId: number | null): Promise<PlanRow> {
  if (!groupId) return FREE_PLAN_FALLBACK;

  const [plan, used, recipientCount] = await Promise.all([
    getGroupPlan(env, groupId),
    getGroupOcrUsage(env, groupId),
    getGroupRecipientCount(env, groupId),
  ]);
  const monthlyLimit = resolveMonthlyOcrLimit(plan, recipientCount);

  if (used >= monthlyLimit) {
    throw new Error(
      `本月 AI 文件整理次數已用完（${monthlyLimit} 次）。` +
      (plan.id === "free" ? "升級照護圈可獲得更多次數。" : "每位照護對象每月有 100 筆整理額度。"),
    );
  }
  return { ...plan, monthly_ocr_limit: monthlyLimit };
}

/**
 * Increment the group's OCR usage counter by 1.
 * Pass the PlanRow returned from checkGroupOcrQuota to avoid an extra DB fetch.
 */
export async function incrementGroupOcrQuota(
  env: Env,
  groupId: number | null,
  plan: PlanRow = FREE_PLAN_FALLBACK,
): Promise<void> {
  if (!groupId) return;
  const period = currentPeriod();
  const now = new Date().toISOString();

  // Read current row first, then write — PostgREST doesn't support column += 1
  const rows = await supabaseFetch<Array<{ id: number; used_count: number }>>(
    env,
    `usage_quotas?group_id=eq.${groupId}&period=eq.${period}&feature=eq.ocr_upload&select=id,used_count&limit=1`,
  );

  if (rows.length === 0) {
    await supabaseFetch(env, "usage_quotas", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        group_id: groupId,
        period,
        feature: "ocr_upload",
        used_count: 1,
        limit_count: plan.monthly_ocr_limit,
        plan_snapshot: plan.id,
        updated_at: now,
      }),
    });
  } else {
    await supabaseFetch(env, `usage_quotas?id=eq.${rows[0].id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ used_count: rows[0].used_count + 1, updated_at: now }),
    });
  }
}

// ─── Plan feature-limit checks ────────────────────────────────────────────────

type LimitCheckResult = {
  ok: boolean;
  error?: string;
  message?: string;
  plan?: PlanRow;
};

export async function hasUserFeatureFlag(
  env: Env,
  userId: number,
  featureKey: string,
): Promise<boolean> {
  const rows = await supabaseFetch<Array<{ enabled: boolean }>>(
    env,
    `user_feature_flags?user_id=eq.${userId}&feature_key=eq.${encodeURIComponent(featureKey)}&select=enabled&limit=1`,
  );
  return rows[0]?.enabled === true;
}

export async function canCreateFamilyGroup(
  env: Env,
  userId: number,
): Promise<LimitCheckResult> {
  const [memberships, ownedGroups] = await Promise.all([
    supabaseFetch<Array<{ group_id: number }>>(
      env,
      `user_family_groups?user_id=eq.${userId}&select=group_id`,
    ),
    supabaseFetch<Array<{ id: number }>>(
      env,
      `family_groups?owner_user_id=eq.${userId}&select=id`,
    ),
  ]);

  const groupIds = new Set<number>([
    ...memberships.map((membership) => membership.group_id),
    ...ownedGroups.map((group) => group.id),
  ]);

  if (groupIds.size === 0) return { ok: true };

  const canCreateMultiple = await hasUserFeatureFlag(env, userId, MULTIPLE_FAMILY_GROUPS_FEATURE);
  if (canCreateMultiple) return { ok: true };

  return {
    ok: false,
    error: "GROUP_LIMIT_REACHED",
    message: "目前每個帳號可建立 1 個照護空間。你可以在同一個照護空間中管理多位照護對象。",
  };
}

/**
 * Check whether a new member can join the group.
 * Only used for invite/join flows — NOT called when the owner auto-joins on creation.
 */
export async function checkGroupMemberLimit(
  env: Env,
  groupId: number,
): Promise<LimitCheckResult> {
  const plan = await getGroupPlan(env, groupId);

  if (!plan.family_group_enabled) {
    return {
      ok: false,
      error: "FAMILY_GROUP_REQUIRES_PAID_PLAN",
      message:
        "家庭共享是照護圈升級功能。升級後，即可邀請家人共同管理照護資訊。",
      plan,
    };
  }

  const members = await supabaseFetch<Array<{ user_id: number }>>(
    env,
    `user_family_groups?group_id=eq.${groupId}&select=user_id`,
  );

  const memberLimit = plan.id === "pro"
    ? CARE_WEDO_MAX_MEMBERS_PER_GROUP
    : plan.max_members;

  if (members.length >= memberLimit) {
    return {
      ok: false,
      error: "MEMBER_LIMIT_REACHED",
      message: plan.id === "pro"
        ? "每個家庭群組最多 1 位主帳號與 5 位協作者。超過這個，請用其他協作者帳號，另外開設家庭群組。"
        : `目前方案最多可加入 ${memberLimit} 位成員。`,
      plan,
    };
  }

  return { ok: true, plan };
}

/**
 * Check whether a new care recipient (profile) can be added to the group.
 */
export async function checkGroupRecipientLimit(
  env: Env,
  groupId: number,
): Promise<LimitCheckResult> {
  const plan = await getGroupPlan(env, groupId);

  const profiles = await supabaseFetch<Array<{ id: number }>>(
    env,
    `care_profiles?group_id=eq.${groupId}&select=id`,
  );

  const recipientLimit = plan.id === "pro"
    ? CARE_WEDO_MAX_CARE_PROFILES_PER_GROUP
    : plan.max_recipients;

  if (profiles.length >= recipientLimit) {
    return {
      ok: false,
      error: "RECIPIENT_LIMIT_REACHED",
      message: plan.id === "pro"
        ? "每個家庭群組最多 4 位主要照護對象。超過這個，請用其他協作者帳號，另外開設家庭群組。"
        : `目前方案最多可建立 ${recipientLimit} 位照護對象。`,
      plan,
    };
  }

  return { ok: true, plan };
}
