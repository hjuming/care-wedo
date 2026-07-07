import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getSubscriptionEventIdempotencyKey,
  requiresProviderEventId,
  transitionSubscriptionState,
} from "../_shared/subscription_state";

const providerEvent = (type: Parameters<typeof transitionSubscriptionState>[1]["type"], id = "evt_123") => ({
  type,
  provider: "line_pay",
  providerEventId: id,
});

test("subscription state machine accepts documented payment lifecycle transitions", () => {
  const checkout = transitionSubscriptionState("beta", { type: "checkout_created", requestId: "req_checkout_1" });
  assert.equal(checkout.accepted, true);
  assert.equal(checkout.to, "checkout_pending");
  assert.equal(checkout.invoiceStatus, "open");
  assert.deepEqual(checkout.sideEffects, ["record_billing_event", "create_open_invoice"]);
  assert.ok(!checkout.sideEffects.includes("activate_paid_entitlements"));

  const paid = transitionSubscriptionState("checkout_pending", providerEvent("payment_succeeded"));
  assert.equal(paid.accepted, true);
  assert.equal(paid.to, "active");
  assert.equal(paid.invoiceStatus, "paid");
  assert.ok(paid.sideEffects.includes("activate_paid_entitlements"));
  assert.equal(paid.idempotencyKey, "line_pay:evt_123");

  const failed = transitionSubscriptionState("active", providerEvent("payment_failed", "evt_failed"));
  assert.equal(failed.accepted, true);
  assert.equal(failed.to, "past_due");
  assert.equal(failed.invoiceStatus, "failed");
  assert.ok(failed.sideEffects.includes("restrict_paid_writes"));

  const grace = transitionSubscriptionState("past_due", { type: "grace_period_started" });
  assert.equal(grace.accepted, true);
  assert.equal(grace.to, "grace_period");

  const suspended = transitionSubscriptionState("grace_period", { type: "grace_period_expired" });
  assert.equal(suspended.accepted, true);
  assert.equal(suspended.to, "suspended");

  const recovered = transitionSubscriptionState("suspended", providerEvent("payment_succeeded", "evt_recovered"));
  assert.equal(recovered.accepted, true);
  assert.equal(recovered.to, "active");
});

test("subscription state machine handles cancel and re-checkout transitions without deleting data", () => {
  const cancel = transitionSubscriptionState("active", { type: "cancel_requested", requestId: "req_cancel_1" });
  assert.equal(cancel.accepted, true);
  assert.equal(cancel.to, "cancel_at_period_end");
  assert.ok(cancel.sideEffects.includes("set_cancel_at_period_end"));
  assert.ok(!cancel.sideEffects.includes("mark_subscription_canceled"));

  const reverted = transitionSubscriptionState("cancel_at_period_end", { type: "cancel_reverted", requestId: "req_revert_1" });
  assert.equal(reverted.accepted, true);
  assert.equal(reverted.to, "active");
  assert.ok(reverted.sideEffects.includes("clear_cancel_at_period_end"));

  const periodEnded = transitionSubscriptionState(
    "cancel_at_period_end",
    providerEvent("subscription_canceled", "evt_cancel_period_end"),
  );
  assert.equal(periodEnded.accepted, true);
  assert.equal(periodEnded.to, "canceled");
  assert.ok(periodEnded.sideEffects.includes("mark_subscription_canceled"));
  assert.ok(!periodEnded.sideEffects.includes("restrict_paid_writes"));

  const recheckout = transitionSubscriptionState("canceled", { type: "checkout_created", requestId: "req_recheckout" });
  assert.equal(recheckout.accepted, true);
  assert.equal(recheckout.to, "checkout_pending");
});

test("checkout pending never grants paid entitlements before payment succeeds", () => {
  const failedCheckout = transitionSubscriptionState("checkout_pending", {
    type: "payment_failed",
    provider: "line_pay",
    providerEventId: "evt_checkout_failed",
  });
  assert.equal(failedCheckout.accepted, true);
  assert.equal(failedCheckout.to, "beta");
  assert.equal(failedCheckout.invoiceStatus, "failed");
  assert.ok(!failedCheckout.sideEffects.includes("activate_paid_entitlements"));

  const expiredToBeta = transitionSubscriptionState("checkout_pending", {
    type: "checkout_expired",
    provider: "line_pay",
    providerEventId: "evt_checkout_expired",
  });
  assert.equal(expiredToBeta.accepted, true);
  assert.equal(expiredToBeta.to, "beta");
  assert.equal(expiredToBeta.invoiceStatus, "void");
  assert.ok(!expiredToBeta.sideEffects.includes("activate_paid_entitlements"));

  const expiredToCanceled = transitionSubscriptionState("checkout_pending", {
    type: "checkout_expired",
    provider: "line_pay",
    providerEventId: "evt_checkout_expired_2",
    checkoutExpiredReturnState: "canceled",
  });
  assert.equal(expiredToCanceled.accepted, true);
  assert.equal(expiredToCanceled.to, "canceled");
});

test("subscription state machine rejects undocumented or unsafe transitions", () => {
  const directActivation = transitionSubscriptionState("beta", providerEvent("payment_succeeded"));
  assert.equal(directActivation.accepted, false);
  assert.equal(directActivation.to, "beta");
  assert.equal(directActivation.reason, "transition_not_allowed");

  const invalidExpiry = transitionSubscriptionState("active", { type: "grace_period_expired" });
  assert.equal(invalidExpiry.accepted, false);
  assert.equal(invalidExpiry.to, "active");
  assert.equal(invalidExpiry.reason, "transition_not_allowed");

  const refund = transitionSubscriptionState("active", {
    type: "refund_confirmed",
    provider: "line_pay",
    providerEventId: "evt_refund",
  });
  assert.equal(refund.accepted, false);
  assert.equal(refund.reason, "refund_transition_requires_policy");
});

test("subscription webhook events require idempotency keys before transition side effects", () => {
  assert.equal(requiresProviderEventId("payment_succeeded"), true);
  assert.equal(requiresProviderEventId("checkout_created"), false);

  const missingProviderEvent = transitionSubscriptionState("checkout_pending", {
    type: "payment_succeeded",
    provider: "line_pay",
  });
  assert.equal(missingProviderEvent.accepted, false);
  assert.equal(missingProviderEvent.reason, "provider_event_id_required");
  assert.equal(missingProviderEvent.sideEffects.length, 0);

  assert.equal(
    getSubscriptionEventIdempotencyKey({ type: "payment_succeeded", provider: "line_pay", providerEventId: "evt_456" }),
    "line_pay:evt_456",
  );
  assert.equal(
    getSubscriptionEventIdempotencyKey({ type: "checkout_created", requestId: "req_789" }),
    "request:req_789",
  );
});

test("entitlement changes and retry scheduling record events without changing subscription state", () => {
  const entitlement = transitionSubscriptionState("active", { type: "entitlement_changed", requestId: "req_entitlement" });
  assert.equal(entitlement.accepted, true);
  assert.equal(entitlement.changed, false);
  assert.equal(entitlement.to, "active");
  assert.deepEqual(entitlement.sideEffects, ["record_billing_event", "record_entitlement_snapshot"]);

  const retry = transitionSubscriptionState("past_due", { type: "retry_scheduled", requestId: "req_retry" });
  assert.equal(retry.accepted, true);
  assert.equal(retry.changed, false);
  assert.equal(retry.to, "past_due");
  assert.ok(retry.sideEffects.includes("schedule_retry"));
});
