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
  const supabase = readProjectFile("functions/_shared/supabase.ts");

  assert.match(supabase, /export const CARE_WEDO_CARE_PROFILE_MONTHLY_PRICE = 30/);
  assert.match(supabase, /export const CARE_WEDO_PAID_COLLABORATOR_MONTHLY_PRICE = 10/);
  assert.match(supabase, /export const CARE_WEDO_GROUP_MONTHLY_PRICE_MAX = 250/);
  assert.match(supabase, /export async function resolveGroupBillingEntitlement/);
  assert.match(supabase, /owner_user_id/);
  assert.match(supabase, /paidCollaboratorCount/);
  assert.match(supabase, /member\.user_id !== ownerUserId/);
  assert.match(supabase, /estimatedMonthlyAmount/);
  assert.match(supabase, /canAddCareProfile/);
  assert.match(supabase, /canInviteCollaborator/);
});

test("groups GET API returns backend billing entitlement on each group", () => {
  const groupsApi = readProjectFile("functions/api/groups.ts");
  const component = readProjectFile("care-wedo-app/src/components/GroupSettings.jsx");

  assert.match(groupsApi, /billing_entitlement:\s*billingEntitlement/);
  assert.match(component, /getBillingLimitConfig/);
  assert.match(component, /billing_entitlement/);
});

test("billing events are recorded for paid care actions without blocking beta flows", () => {
  const supabase = readProjectFile("functions/_shared/supabase.ts");
  const groupsApi = readProjectFile("functions/api/groups.ts");
  const createProfileAction = groupsApi.slice(groupsApi.indexOf('if (body.action === "create_profile")'));
  const joinAction = groupsApi.slice(
    groupsApi.indexOf('if (body.action === "join")'),
    groupsApi.indexOf('if (body.action === "create_profile")'),
  );

  assert.match(supabase, /export async function recordBillingGroupEvent/);
  assert.match(supabase, /billing_subscriptions/);
  assert.match(supabase, /billing_events/);
  assert.match(supabase, /invoices/);
  assert.match(supabase, /isBillingFoundationMissingError/);
  assert.match(supabase, /amount_delta/);
  assert.match(supabase, /line_items/);
  assert.match(supabase, /return false/);

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
  const app = readProjectFile("care-wedo-app/src/App.jsx");

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
  assert.doesNotMatch(app, /checkout|paymentIntent|信用卡付款/);
});
