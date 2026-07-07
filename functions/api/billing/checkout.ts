import {
  buildBillingSnapshotFromEntitlement,
  calculateCareCircleMonthlyAmount,
  recordBillingCheckoutCreated,
  resolveGroupBillingEntitlement,
} from "../../_shared/billing";
import { getRequestUser } from "../../_shared/auth_context";
import { readJsonBody } from "../../_shared/request_body";
import { supabaseFetch, type Env } from "../../_shared/supabase";

type BillingCheckoutEnv = Env & {
  WEDO_BILLING_CHECKOUT_SECRET?: string;
  WEDO_BILLING_CHECKOUT_URL?: string;
  CARE_WEDO_PUBLIC_BASE_URL?: string;
};

type BillingCheckoutActionType = "create_profile" | "invite_collaborator" | "settle_group";

type BillingCheckoutRequestBody = {
  group_id?: number;
  action_type?: BillingCheckoutActionType;
  return_path?: string;
};

type BillingCheckoutResponse = {
  provider?: string;
  checkout?: {
    action?: string;
    method?: string;
    fields?: Record<string, string | number | boolean | null>;
  };
};

const DEFAULT_CHECKOUT_URL = "https://www.wedopr.com/api/billing/checkout";

function parsePositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isCheckoutActionType(value: unknown): value is BillingCheckoutActionType {
  return value === "create_profile" || value === "invite_collaborator" || value === "settle_group";
}

function normalizeReturnPath(value: unknown): string {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/app/settings?billing=return";
  return path.slice(0, 180);
}

function resolvePublicBaseUrl(request: Request, env: BillingCheckoutEnv): string {
  const configured = String(env.CARE_WEDO_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  return url.origin;
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

async function signGatewayRequest(secret: string, timestamp: string, rawBody: string): Promise<string> {
  return hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
}

async function assertCanStartCheckout(env: Env, userId: number, groupId: number): Promise<void> {
  const rows = await supabaseFetch<Array<{ role: string | null; can_pay: boolean | null }>>(
    env,
    `user_family_groups?user_id=eq.${userId}&group_id=eq.${groupId}&select=role,can_pay&limit=1`,
  );
  const membership = rows[0];
  if (!membership) throw new Error("您還沒有這個群組的權限");
  if (membership.role === "admin" || membership.can_pay === true) return;
  throw new Error("只有群組管理者或付款負責人可以開始付款");
}

function buildCheckoutDescription(actionType: BillingCheckoutActionType): string {
  if (actionType === "create_profile") {
    return "新增照護對象後的 Care WEDO 照護圈月費";
  }
  if (actionType === "settle_group") {
    return "啟用目前 Care WEDO 家庭群組月費";
  }
  return "新增共同協作者後的 Care WEDO 照護圈月費";
}

export const onRequestPost: PagesFunction<BillingCheckoutEnv> = async (context) => {
  const { request, env } = context;
  try {
    if (!env.WEDO_BILLING_CHECKOUT_SECRET) {
      return Response.json({ error: "billing_checkout_not_configured" }, { status: 503 });
    }

    const { userId } = await getRequestUser(context);
    const body = await readJsonBody<BillingCheckoutRequestBody>(request);
    const groupId = parsePositiveInteger(body.group_id);
    if (!groupId) return Response.json({ error: "group_id_required" }, { status: 400 });
    if (!isCheckoutActionType(body.action_type)) {
      return Response.json({ error: "billing_action_not_supported" }, { status: 400 });
    }

    await assertCanStartCheckout(env, userId, groupId);

    const entitlement = await resolveGroupBillingEntitlement(env, groupId);
    const nextCareProfileCount = body.action_type === "create_profile"
      ? entitlement.careProfileCount + 1
      : entitlement.careProfileCount;
    const nextPaidCollaboratorCount = body.action_type === "invite_collaborator"
      ? entitlement.paidCollaboratorCount + 1
      : entitlement.paidCollaboratorCount;

    if (nextCareProfileCount > entitlement.maxCareProfiles) {
      return Response.json({ error: "care_profile_limit_reached" }, { status: 403 });
    }
    if (
      nextPaidCollaboratorCount > entitlement.maxPaidCollaborators
      || entitlement.memberCount + (body.action_type === "invite_collaborator" ? 1 : 0) > entitlement.maxMembersIncludingOwner
    ) {
      return Response.json({ error: "collaborator_limit_reached" }, { status: 403 });
    }

    const nextMonthlyAmount = calculateCareCircleMonthlyAmount(nextCareProfileCount, nextPaidCollaboratorCount);
    if (nextMonthlyAmount <= entitlement.paidMonthlyAmount) {
      return Response.json({
        checkout_required: false,
        amount: nextMonthlyAmount,
        currency: "TWD",
        message: "目前已付款方案已涵蓋這個動作。",
      });
    }
    if (nextMonthlyAmount <= 0) {
      return Response.json({
        checkout_required: false,
        amount: 0,
        currency: "TWD",
        message: "目前動作仍在測試期減免額度內。",
      });
    }

    const requestId = crypto.randomUUID();
    const publicBaseUrl = resolvePublicBaseUrl(request, env);
    const returnPath = normalizeReturnPath(body.return_path);
    const payload = {
      project: "care_wedo",
      project_order_id: `family_group_${groupId}`,
      amount: nextMonthlyAmount,
      currency: "TWD",
      item_name: `Care WEDO 照護圈 ${nextMonthlyAmount} 元/月`,
      description: buildCheckoutDescription(body.action_type),
      mode: "subscription",
      subscription: {
        period_type: "M",
        frequency: 1,
        exec_times: 12,
      },
      client_back_url: `${publicBaseUrl}${returnPath}`,
      metadata: {
        request_id: requestId,
        group_id: groupId,
        action_type: body.action_type,
        care_profile_count: nextCareProfileCount,
        paid_collaborator_count: nextPaidCollaboratorCount,
      },
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await signGatewayRequest(env.WEDO_BILLING_CHECKOUT_SECRET, timestamp, rawBody);
    const gatewayResponse = await fetch(env.WEDO_BILLING_CHECKOUT_URL || DEFAULT_CHECKOUT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wedo-billing-timestamp": timestamp,
        "x-wedo-billing-signature": signature,
      },
      body: rawBody,
    });
    const gatewayBody = await gatewayResponse.json().catch(() => ({})) as BillingCheckoutResponse & { error?: string };
    if (!gatewayResponse.ok || !gatewayBody.checkout?.action || !gatewayBody.checkout?.fields) {
      return Response.json(
        { error: gatewayBody.error || "billing_gateway_checkout_failed" },
        { status: gatewayResponse.ok ? 502 : gatewayResponse.status },
      );
    }

    const afterSnapshot = buildBillingSnapshotFromEntitlement(entitlement, {
      planId: "pro",
      careProfileCount: nextCareProfileCount,
      paidCollaboratorCount: nextPaidCollaboratorCount,
      memberCount: entitlement.memberCount + (body.action_type === "invite_collaborator" ? 1 : 0),
      estimatedMonthlyAmount: nextMonthlyAmount,
    });

    await recordBillingCheckoutCreated(env, {
      groupId,
      actorUserId: userId,
      actionType: body.action_type,
      requestId,
      provider: gatewayBody.provider || "ecpay",
      providerCheckoutId: String(gatewayBody.checkout.fields.MerchantTradeNo || ""),
      merchantTradeNo: String(gatewayBody.checkout.fields.MerchantTradeNo || ""),
      amount: nextMonthlyAmount,
      beforeSnapshot: entitlement,
      afterSnapshot,
    });

    return Response.json({
      checkout_required: true,
      provider: gatewayBody.provider || "ecpay",
      amount: nextMonthlyAmount,
      currency: "TWD",
      request_id: requestId,
      checkout: gatewayBody.checkout,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "billing_checkout_failed";
    const status = message.includes("請先登入")
      ? 401
      : message.includes("權限") || message.includes("付款負責人")
        ? 403
        : 500;
    return Response.json({ error: message }, { status });
  }
};
