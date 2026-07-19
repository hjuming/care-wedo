import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("billing foundation schema defines auditable group billing tables", () => {
  const migration = readProjectFile("supabase/migration_phase55_billing_foundation.sql");
  const schema = readProjectFile("supabase/schema.sql");
  const combined = `${schema}\n${migration}`;

  assert.match(combined, /create table if not exists public\.billing_subscriptions/i);
  assert.match(combined, /create table if not exists public\.billing_events/i);
  assert.match(combined, /create table if not exists public\.invoices/i);
  assert.match(combined, /family_group_id bigint not null references public\.family_groups\(id\)/i);
  assert.match(combined, /owner_user_id bigint references public\.users\(id\)/i);
  assert.match(combined, /care_profile_count integer not null default 0/i);
  assert.match(combined, /paid_collaborator_count integer not null default 0/i);
  assert.match(combined, /estimated_monthly_amount integer not null default 0/i);
  assert.match(combined, /unique\(family_group_id, period\)/i);
  assert.match(combined, /provider_event_id text/i);
  assert.match(combined, /billing_events_provider_event_unique_idx/i);
});

test("billing foundation keeps public tables protected by RLS and service-role-only grants", () => {
  const migration = readProjectFile("supabase/migration_phase55_billing_foundation.sql");
  const schema = readProjectFile("supabase/schema.sql");
  const combined = `${schema}\n${migration}`;

  for (const table of ["billing_subscriptions", "billing_events", "invoices"]) {
    assert.match(combined, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(combined, new RegExp(`grant select, insert, update, delete on public\\.${table} to service_role`, "i"));
  }

  assert.doesNotMatch(migration, /grant\s+.*\s+on public\.(billing_subscriptions|billing_events|invoices)\s+to\s+(anon|authenticated)/i);
});

test("backend entitlement helper is the source of truth for Care WEDO billing math", () => {
  const billing = readProjectFile("functions/_shared/billing.ts");
  const pricingContract = readProjectFile("shared/care-wedo-pricing.js");
  const supabase = readProjectFile("functions/_shared/supabase.ts");

  assert.match(pricingContract, /recipient_monthly:\s*30/);
  assert.match(pricingContract, /collaborator_monthly:\s*10/);
  assert.match(pricingContract, /monthly_price_max:\s*250/);
  assert.match(billing, /CARE_WEDO_CARE_PROFILE_MONTHLY_PRICE = SHARED_CARE_WEDO_PRICING\.recipient_monthly/);
  assert.match(billing, /CARE_WEDO_PAID_COLLABORATOR_MONTHLY_PRICE = SHARED_CARE_WEDO_PRICING\.collaborator_monthly/);
  assert.match(billing, /CARE_WEDO_GROUP_MONTHLY_PRICE_MAX = CARE_WEDO_GROUP_LIMITS\.monthly_price_max/);
  assert.match(billing, /monthly_ocr_limit:\s*FREE_OCR_MONTHLY_LIMIT/);
  assert.doesNotMatch(billing, /monthly_ocr_limit:\s*10/);
  assert.match(billing, /export async function resolveGroupBillingEntitlement/);
  assert.match(billing, /owner_user_id/);
  assert.match(billing, /paidCollaboratorCount/);
  assert.match(billing, /member\.user_id !== ownerUserId/);
  assert.match(billing, /estimatedMonthlyAmount/);
  assert.match(billing, /canAddCareProfile/);
  assert.match(billing, /canInviteCollaborator/);
  assert.doesNotMatch(supabase, /export async function resolveGroupBillingEntitlement/);
});

test("groups GET API returns backend billing entitlement on each group", () => {
  const groupsApi = readProjectFile("functions/api/groups.ts");
  const component = readProjectFile("care-wedo-app/src/components/GroupSettings.jsx");

  assert.match(groupsApi, /billing_entitlement:\s*billingEntitlement/);
  assert.match(component, /getBillingLimitConfig/);
  assert.match(component, /billing_entitlement/);
});

test("billing events are recorded for paid care actions without blocking beta flows", () => {
  const billing = readProjectFile("functions/_shared/billing.ts");
  const groupsApi = readProjectFile("functions/api/groups.ts");
  const createProfileAction = groupsApi.slice(groupsApi.indexOf('if (body.action === "create_profile")'));
  const joinAction = groupsApi.slice(
    groupsApi.indexOf('if (body.action === "join")'),
    groupsApi.indexOf('if (body.action === "create_profile")'),
  );

  assert.match(billing, /export async function recordBillingGroupEvent/);
  assert.match(billing, /billing_subscriptions/);
  assert.match(billing, /billing_events/);
  assert.match(billing, /invoices/);
  assert.match(billing, /isBillingFoundationMissingError/);
  assert.match(billing, /amount_delta/);
  assert.match(billing, /line_items/);
  assert.match(billing, /return false/);

  assert.match(groupsApi, /recordBillingGroupEvent/);
  assert.match(createProfileAction, /resolveGroupBillingEntitlement\(env,\s*body\.group_id\)/);
  assert.match(createProfileAction, /eventType:\s*"care_profile_created"/);
  assert.match(createProfileAction, /careProfileId:\s*profile\.id/);
  assert.match(joinAction, /const shouldRecordCollaboratorJoin = existingMembership\.length === 0/);
  assert.match(joinAction, /eventType:\s*"collaborator_joined"/);
  assert.match(joinAction, /subjectUserId:\s*userId/);
});

test("subscription payments are gated by an explicit state machine before checkout UI", () => {
  const stateMachine = readProjectFile("SUBSCRIPTION_STATE_MACHINE.md");
  const helper = readProjectFile("functions/_shared/subscription_state.ts");
  const helperTest = readProjectFile("functions/_tests/subscription-state.test.ts");
  const component = readProjectFile("care-wedo-app/src/components/GroupSettings.jsx");
  const checkoutApi = readProjectFile("functions/api/billing/checkout.ts");

  for (const state of [
    "beta",
    "checkout_pending",
    "active",
    "past_due",
    "grace_period",
    "suspended",
    "cancel_at_period_end",
    "canceled",
  ]) {
    assert.match(stateMachine, new RegExp(`\\\`${state}\\\``));
  }

  for (const event of [
    "checkout_created",
    "payment_succeeded",
    "payment_failed",
    "grace_period_expired",
    "cancel_requested",
    "subscription_canceled",
  ]) {
    assert.match(stateMachine, new RegExp(`\\\`${event}\\\``));
    assert.match(helper, new RegExp(`"${event}"`));
  }

  assert.match(helper, /export function transitionSubscriptionState/);
  assert.match(helper, /requiresProviderEventId/);
  assert.match(helper, /provider_event_id_required/);
  assert.match(helper, /transition_not_allowed/);
  assert.match(helperTest, /subscription state machine accepts documented payment lifecycle transitions/);
  assert.match(helperTest, /checkout pending never grants paid entitlements before payment succeeds/);
  assert.match(helperTest, /subscription webhook events require idempotency keys/);
  assert.match(stateMachine, /provider_event_id/);
  assert.match(stateMachine, /idempotent/i);
  assert.match(stateMachine, /checkout_created` 不等於付款成功/);
  assert.match(stateMachine, /醫療資料不能因付款失敗或取消被硬刪/);
  assert.match(checkoutApi, /recordBillingCheckoutCreated/);
  assert.match(checkoutApi, /WEDO_BILLING_CHECKOUT_SECRET/);
  assert.match(component, /createBillingCheckout/);
  assert.match(component, /submitGatewayCheckout/);
  assert.doesNotMatch(`${checkoutApi}\n${component}`, /paymentIntent|card_number|credit_card_number/i);
});

test("central billing webhook requires HMAC verification and provider-event idempotency", () => {
  const webhookApi = readProjectFile("functions/api/billing/webhook.ts");
  const webhookHelper = readProjectFile("functions/_shared/billing_webhook.ts");
  const middleware = readProjectFile("functions/api/_middleware.ts");
  const envSchema = readProjectFile("env.schema.json");

  assert.match(middleware, /\/api\/billing\/webhook/);
  assert.match(envSchema, /WEDO_BILLING_GATEWAY_SECRET/);
  assert.match(webhookApi, /handleCentralBillingWebhook/);
  assert.match(webhookHelper, /verifyBillingWebhookSignature/);
  assert.match(webhookHelper, /x-wedo-billing-timestamp|provider_event_id_required|findDuplicateProviderEvent/s);
  assert.match(webhookHelper, /transitionSubscriptionState/);
  assert.match(webhookHelper, /plan_id:\s*"pro"/);
  assert.doesNotMatch(webhookHelper, /HashKey|HashIV|card_number|credit_card_number/i);
});
