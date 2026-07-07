export const CARE_SUBSCRIPTION_STATES = [
  "beta",
  "checkout_pending",
  "active",
  "past_due",
  "grace_period",
  "suspended",
  "cancel_at_period_end",
  "canceled",
] as const;

export type CareSubscriptionState = typeof CARE_SUBSCRIPTION_STATES[number];

export const CARE_SUBSCRIPTION_EVENTS = [
  "checkout_created",
  "checkout_expired",
  "payment_succeeded",
  "payment_failed",
  "retry_scheduled",
  "grace_period_started",
  "grace_period_expired",
  "cancel_requested",
  "cancel_reverted",
  "subscription_canceled",
  "refund_confirmed",
  "entitlement_changed",
] as const;

export type CareSubscriptionEventType = typeof CARE_SUBSCRIPTION_EVENTS[number];

export type CareSubscriptionInvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "failed"
  | "void"
  | "refunded";

export type CareSubscriptionSideEffect =
  | "record_billing_event"
  | "create_open_invoice"
  | "void_open_invoice"
  | "mark_invoice_paid"
  | "mark_invoice_failed"
  | "set_current_period"
  | "schedule_retry"
  | "start_grace_period"
  | "restrict_paid_writes"
  | "activate_paid_entitlements"
  | "set_cancel_at_period_end"
  | "clear_cancel_at_period_end"
  | "mark_subscription_canceled"
  | "record_entitlement_snapshot";

export type CareSubscriptionEvent = {
  type: CareSubscriptionEventType;
  provider?: string | null;
  providerEventId?: string | null;
  requestId?: string | null;
  checkoutExpiredReturnState?: Extract<CareSubscriptionState, "beta" | "canceled">;
};

export type CareSubscriptionTransitionResult = {
  accepted: boolean;
  from: CareSubscriptionState;
  to: CareSubscriptionState;
  changed: boolean;
  eventType: CareSubscriptionEventType;
  invoiceStatus?: CareSubscriptionInvoiceStatus;
  sideEffects: CareSubscriptionSideEffect[];
  requiresIdempotencyKey: boolean;
  idempotencyKey: string | null;
  reason?: string;
};

const STATE_SET = new Set<string>(CARE_SUBSCRIPTION_STATES);
const EVENT_SET = new Set<string>(CARE_SUBSCRIPTION_EVENTS);
const PROVIDER_WEBHOOK_EVENTS = new Set<CareSubscriptionEventType>([
  "checkout_expired",
  "payment_succeeded",
  "payment_failed",
  "subscription_canceled",
  "refund_confirmed",
]);

export function isCareSubscriptionState(value: unknown): value is CareSubscriptionState {
  return typeof value === "string" && STATE_SET.has(value);
}

export function isCareSubscriptionEventType(value: unknown): value is CareSubscriptionEventType {
  return typeof value === "string" && EVENT_SET.has(value);
}

export function requiresProviderEventId(eventType: CareSubscriptionEventType): boolean {
  return PROVIDER_WEBHOOK_EVENTS.has(eventType);
}

export function getSubscriptionEventIdempotencyKey(event: CareSubscriptionEvent): string | null {
  if (event.provider && event.providerEventId) return `${event.provider}:${event.providerEventId}`;
  if (event.requestId) return `request:${event.requestId}`;
  return null;
}

function accepted(
  from: CareSubscriptionState,
  to: CareSubscriptionState,
  event: CareSubscriptionEvent,
  sideEffects: CareSubscriptionSideEffect[],
  invoiceStatus?: CareSubscriptionInvoiceStatus,
): CareSubscriptionTransitionResult {
  const requiresIdempotencyKey = requiresProviderEventId(event.type);
  return {
    accepted: true,
    from,
    to,
    changed: from !== to,
    eventType: event.type,
    invoiceStatus,
    sideEffects: ["record_billing_event", ...sideEffects],
    requiresIdempotencyKey,
    idempotencyKey: getSubscriptionEventIdempotencyKey(event),
  };
}

function rejected(
  from: CareSubscriptionState,
  event: CareSubscriptionEvent,
  reason: string,
): CareSubscriptionTransitionResult {
  const requiresIdempotencyKey = requiresProviderEventId(event.type);
  return {
    accepted: false,
    from,
    to: from,
    changed: false,
    eventType: event.type,
    sideEffects: [],
    requiresIdempotencyKey,
    idempotencyKey: getSubscriptionEventIdempotencyKey(event),
    reason,
  };
}

export function transitionSubscriptionState(
  currentState: CareSubscriptionState,
  event: CareSubscriptionEvent,
): CareSubscriptionTransitionResult {
  if (!isCareSubscriptionState(currentState)) {
    throw new Error(`Unknown subscription state: ${String(currentState)}`);
  }
  if (!isCareSubscriptionEventType(event.type)) {
    throw new Error(`Unknown subscription event: ${String(event.type)}`);
  }

  if (requiresProviderEventId(event.type) && !getSubscriptionEventIdempotencyKey(event)) {
    return rejected(currentState, event, "provider_event_id_required");
  }

  if (event.type === "entitlement_changed") {
    return accepted(currentState, currentState, event, ["record_entitlement_snapshot"]);
  }

  if (event.type === "retry_scheduled") {
    if (currentState === "past_due" || currentState === "grace_period") {
      return accepted(currentState, currentState, event, ["schedule_retry"]);
    }
    return rejected(currentState, event, "transition_not_allowed");
  }

  if (event.type === "refund_confirmed") {
    return rejected(currentState, event, "refund_transition_requires_policy");
  }

  switch (currentState) {
    case "beta":
      if (event.type === "checkout_created") {
        return accepted(currentState, "checkout_pending", event, ["create_open_invoice"], "open");
      }
      break;

    case "checkout_pending":
      if (event.type === "payment_succeeded") {
        return accepted(
          currentState,
          "active",
          event,
          ["mark_invoice_paid", "set_current_period", "activate_paid_entitlements"],
          "paid",
        );
      }
      if (event.type === "payment_failed") {
        return accepted(
          currentState,
          "beta",
          event,
          ["mark_invoice_failed"],
          "failed",
        );
      }
      if (event.type === "checkout_expired") {
        return accepted(
          currentState,
          event.checkoutExpiredReturnState === "canceled" ? "canceled" : "beta",
          event,
          ["void_open_invoice"],
          "void",
        );
      }
      break;

    case "active":
      if (event.type === "payment_failed") {
        return accepted(
          currentState,
          "past_due",
          event,
          ["mark_invoice_failed", "schedule_retry", "restrict_paid_writes"],
          "failed",
        );
      }
      if (event.type === "cancel_requested") {
        return accepted(currentState, "cancel_at_period_end", event, ["set_cancel_at_period_end"]);
      }
      break;

    case "past_due":
      if (event.type === "payment_succeeded") {
        return accepted(
          currentState,
          "active",
          event,
          ["mark_invoice_paid", "set_current_period", "activate_paid_entitlements"],
          "paid",
        );
      }
      if (event.type === "grace_period_started") {
        return accepted(currentState, "grace_period", event, ["start_grace_period", "restrict_paid_writes"]);
      }
      break;

    case "grace_period":
      if (event.type === "payment_succeeded") {
        return accepted(
          currentState,
          "active",
          event,
          ["mark_invoice_paid", "set_current_period", "activate_paid_entitlements"],
          "paid",
        );
      }
      if (event.type === "grace_period_expired") {
        return accepted(currentState, "suspended", event, ["restrict_paid_writes"]);
      }
      break;

    case "suspended":
      if (event.type === "payment_succeeded") {
        return accepted(
          currentState,
          "active",
          event,
          ["mark_invoice_paid", "set_current_period", "activate_paid_entitlements"],
          "paid",
        );
      }
      if (event.type === "subscription_canceled") {
        return accepted(currentState, "canceled", event, ["mark_subscription_canceled"]);
      }
      break;

    case "cancel_at_period_end":
      if (event.type === "cancel_reverted") {
        return accepted(currentState, "active", event, ["clear_cancel_at_period_end"]);
      }
      if (event.type === "subscription_canceled") {
        return accepted(currentState, "canceled", event, ["mark_subscription_canceled"]);
      }
      break;

    case "canceled":
      if (event.type === "checkout_created") {
        return accepted(currentState, "checkout_pending", event, ["create_open_invoice"], "open");
      }
      break;
  }

  return rejected(currentState, event, "transition_not_allowed");
}
