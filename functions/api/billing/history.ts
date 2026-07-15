import { getRequestUser } from "../../_shared/auth_context";
import { supabaseFetch, type Env } from "../../_shared/supabase";

type BillingHistoryEnv = Env;

async function assertGroupMember(env: Env, userId: number, groupId: number): Promise<void> {
  const rows = await supabaseFetch<Array<{ user_id: number }>>(
    env,
    `user_family_groups?user_id=eq.${userId}&group_id=eq.${groupId}&select=user_id&limit=1`,
  );
  if (!rows[0]) throw new Error("您不是此群組成員");
}

export const onRequestGet: PagesFunction<BillingHistoryEnv> = async (context) => {
  try {
    const { env } = context;
    const { userId } = await getRequestUser(context);
    const url = new URL(context.request.url);
    const groupId = Number(url.searchParams.get("group_id"));
    const requestedLimit = Number(url.searchParams.get("limit") || 50);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    if (!Number.isInteger(groupId) || groupId <= 0) {
      return Response.json({ error: "group_id_required" }, { status: 400 });
    }

    await assertGroupMember(env, userId, groupId);
    const [invoices, events] = await Promise.all([
      supabaseFetch<Array<Record<string, unknown>>>(
        env,
        `invoices?family_group_id=eq.${groupId}&select=id,period,status,currency,amount_due,care_profile_count,paid_collaborator_count,issued_at,paid_at,created_at&order=created_at.desc&limit=${limit}`,
      ),
      supabaseFetch<Array<Record<string, unknown>>>(
        env,
        `billing_events?family_group_id=eq.${groupId}&select=id,event_type,provider,merchant_trade_no,provider_trade_no,amount_delta,note,created_at&order=created_at.desc&limit=${limit}`,
      ),
    ]);

    const history = [
      ...invoices.map((invoice) => ({
        kind: "invoice",
        id: invoice.id,
        occurred_at: invoice.paid_at || invoice.issued_at || invoice.created_at,
        period: invoice.period,
        status: invoice.status,
        currency: invoice.currency,
        amount: invoice.amount_due,
        care_profile_count: invoice.care_profile_count,
        paid_collaborator_count: invoice.paid_collaborator_count,
      })),
      ...events.map((event) => ({
        kind: "event",
        id: event.id,
        occurred_at: event.created_at,
        event_type: event.event_type,
        provider: event.provider,
        merchant_trade_no: event.merchant_trade_no,
        provider_trade_no: event.provider_trade_no,
        amount_delta: event.amount_delta,
        note: event.note,
      })),
    ]
      .sort((left, right) => String(right.occurred_at || "").localeCompare(String(left.occurred_at || "")))
      .slice(0, limit);

    return Response.json({ history });
  } catch (error) {
    const message = error instanceof Error ? error.message : "billing_history_failed";
    const status = message.includes("請先登入") ? 401 : message.includes("不是此群組") ? 403 : 500;
    return Response.json({ error: message }, { status });
  }
};
