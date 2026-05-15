import { logError, logEvent } from "../_shared/logger";

interface Env {
  EMAILJS_SERVICE_ID?: string;
  EMAILJS_TEMPLATE_ID?: string;
  EMAILJS_PUBLIC_KEY?: string;
  VITE_EMAILJS_SERVICE_ID?: string;
  VITE_EMAILJS_TEMPLATE_ID?: string;
  VITE_EMAILJS_PUBLIC_KEY?: string;
}

type FeedbackBody = {
  name?: string;
  email?: string;
  topic?: string;
  message?: string;
};

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

function getEmailJsConfig(env: Env) {
  return {
    serviceId: env.EMAILJS_SERVICE_ID || env.VITE_EMAILJS_SERVICE_ID,
    templateId: env.EMAILJS_TEMPLATE_ID || env.VITE_EMAILJS_TEMPLATE_ID,
    publicKey: env.EMAILJS_PUBLIC_KEY || env.VITE_EMAILJS_PUBLIC_KEY,
  };
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204 });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { serviceId, templateId, publicKey } = getEmailJsConfig(env);
    if (!serviceId || !templateId || !publicKey) {
      logError("feedback.emailjs_missing_config", new Error("EmailJS runtime config is missing"), {
        hasServiceId: Boolean(serviceId),
        hasTemplateId: Boolean(templateId),
        hasPublicKey: Boolean(publicKey),
      });
      return json({ error: "回饋信箱尚未設定，請先用 Email 聯絡我們。" }, { status: 503 });
    }

    const body = await request.json<FeedbackBody>().catch(() => ({}));
    const cleanName = body.name?.trim() || "Care WEDO 使用者";
    const cleanEmail = body.email?.trim() || "";
    const cleanTopic = body.topic?.trim() || "其他建議";
    const cleanMessage = body.message?.trim() || "";

    if (!cleanMessage) {
      return json({ error: "請先寫下您的建議。" }, { status: 400 });
    }
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      return json({ error: "請留下有效 Email，我們才寄得到確認信。" }, { status: 400 });
    }

    const submittedAt = new Date();
    const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        template_params: {
          name: cleanName,
          email: cleanEmail,
          title: `${cleanTopic} 回饋`,
          from_name: cleanName,
          reply_to: cleanEmail,
          topic: cleanTopic,
          message: cleanMessage,
          source: "Care WEDO landing feedback",
          submitted_at: submittedAt.toISOString(),
          submitted_at_taipei: submittedAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }),
          website_url: "https://care.wedopr.com/",
          logo_url: "https://care.wedopr.com/android-chrome-192x192.png",
          hero_image_url: "https://care.wedopr.com/assets/images/og-care-wedo.png",
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      logError("feedback.emailjs_send_failed", new Error(`EmailJS failed with ${response.status}`), {
        status: response.status,
        detail,
        topic: cleanTopic,
      });
      return json({ error: "回饋暫時送不出去，請稍後再試。" }, { status: 502 });
    }

    logEvent("feedback.sent", { topic: cleanTopic });
    return json({ ok: true });
  } catch (error) {
    logError("feedback.unhandled", error);
    return json({ error: "回饋暫時送不出去，請稍後再試。" }, { status: 500 });
  }
};
