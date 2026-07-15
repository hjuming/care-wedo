import { getRequestUser } from "../../_shared/auth_context";
import { supabaseFetch, type Env } from "../../_shared/supabase";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { env } = context;
    const { userId } = await getRequestUser(context);
    const url = new URL(context.request.url);
    const groupId = Number(url.searchParams.get("group_id"));
    const requestId = String(url.searchParams.get("request_id") || "").trim();
    if (!Number.isInteger(groupId) || groupId <= 0) return Response.json({ error: "group_id_required" }, { status: 400 });
    if (!requestId || requestId.length > 80) return Response.json({ error: "request_id_required" }, { status: 400 });

    const memberships = await supabaseFetch<Array<{ role: string | null; can_pay: boolean | null }>>(
      env,
      `user_family_groups?user_id=eq.${userId}&group_id=eq.${groupId}&select=role,can_pay&limit=1`,
    );
    const membership = memberships[0];
    if (!membership) return Response.json({ error: "您還沒有這個群組的權限" }, { status: 403 });

    const events = await supabaseFetch<Array<Record<string, unknown>>>(
      env,
      `billing_events?family_group_id=eq.${groupId}&select=event_type,merchant_trade_no,transition,created_at&order=created_at.desc&limit=100`,
    );
    const checkout = events.find((event) => (
      event.event_type === "checkout_created"
      && (event.transition as Record<string, unknown> | null)?.request_id === requestId
    ));
    if (!checkout) return Response.json({ status: "not_found" }, { status: 404 });

    const merchantTradeNo = String(checkout.merchant_trade_no || "");
    const providerEvent = events.find((event) => (
      event.merchant_trade_no === merchantTradeNo
      && event.event_type === "payment_succeeded"
    ));
    const failedEvent = events.find((event) => (
      event.merchant_trade_no === merchantTradeNo
      && event.event_type === "payment_failed"
    ));
    return Response.json({
      status: providerEvent ? "paid" : failedEvent ? "failed" : "pending",
      request_id: requestId,
      merchant_trade_no: merchantTradeNo || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "billing_status_failed";
    const status = message.includes("請先登入") ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};
