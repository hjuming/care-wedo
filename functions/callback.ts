type Env = {
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
};

type LineEvent = {
  type: string;
  replyToken?: string;
  message?: {
    type: string;
    text?: string;
    id?: string;
  };
};

type LineWebhookBody = {
  events?: LineEvent[];
};

const encoder = new TextEncoder();

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function createLineSignature(body: string, channelSecret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const bytes = new Uint8Array(signature);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

async function verifyLineSignature(request: Request, body: string, env: Env) {
  if (!env.LINE_CHANNEL_SECRET) return false;
  const signature = request.headers.get("x-line-signature");
  if (!signature) return false;
  const expected = await createLineSignature(body, env.LINE_CHANNEL_SECRET);
  return timingSafeEqual(signature, expected);
}

async function replyText(env: Env, replyToken: string, text: string) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured.");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE reply failed (${response.status}): ${detail}`);
  }
}

async function handleEvent(env: Env, event: LineEvent) {
  if (event.type !== "message" || !event.replyToken) return;

  if (event.message?.type === "image") {
    await replyText(
      env,
      event.replyToken,
      "收到醫療單據照片了。Cloudflare 版 LINE 圖片解析正在接上中；目前請先到 care.wedopr.com 使用「掃描醫療單據」。",
    );
    return;
  }

  const incomingText = event.message?.text || "";
  const reply =
    incomingText.includes("網址") || incomingText.toLowerCase().includes("url")
      ? "Care WEDO 已上線：https://care.wedopr.com"
      : "Care WEDO 已收到訊息。你可以先到 https://care.wedopr.com 掃描醫療單據，我會協助整理回診與用藥提醒。";

  await replyText(env, event.replyToken, reply);
}

export const onRequestGet: PagesFunction = async () => {
  return Response.json({
    status: "ok",
    service: "Care WEDO LINE Webhook",
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const bodyText = await request.text();
  const isValid = await verifyLineSignature(request, bodyText, env);

  if (!isValid) {
    return Response.json({ error: "Invalid LINE signature" }, { status: 401 });
  }

  const body = JSON.parse(bodyText) as LineWebhookBody;
  const events = body.events || [];

  try {
    await Promise.all(events.map((event) => handleEvent(env, event)));
    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "LINE webhook failed" },
      { status: 500 },
    );
  }
};
