import {
  handleCentralBillingWebhook,
  type BillingWebhookEnv,
} from "../../_shared/billing_webhook";

function errorStatus(message: string): number {
  if (message === "billing_webhook_unauthorized") return 401;
  if (
    message === "request_body_invalid"
    || message === "project_not_allowed"
    || message === "provider_event_id_required"
    || message === "family_group_id_required"
  ) return 400;
  if (message === "subscription_transition_rejected") return 409;
  return 500;
}

export const onRequestPost: PagesFunction<BillingWebhookEnv> = async ({ request, env }) => {
  try {
    const result = await handleCentralBillingWebhook(request, env);
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "billing_webhook_failed";
    return Response.json(
      { error: message },
      {
        status: errorStatus(message),
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
};
