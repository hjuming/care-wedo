import { parseMedicalImages, saveParsedData, Env as OcrEnv } from "./_shared/medical_ocr";

type Env = OcrEnv & {
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
};

type LineEvent = {
  type: string;
  replyToken?: string;
  source: { userId: string };
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

/** 用 replyToken 回覆（只能用一次） */
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

/** 用 Push API 主動推送訊息給使用者（不需要 replyToken） */
async function pushText(env: Env, userId: string, text: string) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured.");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(`LINE push failed (${response.status}): ${detail}`);
  }
}

async function fetchLineContent(env: Env, messageId: string): Promise<string> {
  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!response.ok) throw new Error("無法從 LINE 下載圖片");
  
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 將解析結果格式化成易讀的摘要 */
function formatResultSummary(parsed: import("./_shared/medical_ocr").ParsedMedicalData): string {
  const lines: string[] = ["🎉 解析成功！以下是重點摘要：\n"];

  if (parsed.appointments?.length) {
    lines.push(`📅 回診提醒（${parsed.appointments.length} 筆）：`);
    for (const apt of parsed.appointments) {
      const parts: string[] = [];
      if (apt.date) parts.push(apt.time ? `${apt.date} ${apt.time}` : apt.date);
      if (apt.hospital) parts.push(apt.hospital);
      if (apt.department) parts.push(apt.department);
      if (apt.doctor) parts.push(`${apt.doctor}醫師`);
      if (apt.number) parts.push(`${apt.number}號`);
      lines.push(`• ${parts.join(" ｜ ")}`);
      if (apt.location) lines.push(`  📍 ${apt.location}`);
      if (apt.fasting_required) lines.push(`  ⚠️ 需空腹 ${apt.fasting_hours || 8} 小時`);
      if (apt.reminder_text) lines.push(`  💬 ${apt.reminder_text}`);
    }
    lines.push("");
  }

  if (parsed.medications?.length) {
    lines.push(`💊 用藥提醒（${parsed.medications.length} 筆）：`);
    for (const med of parsed.medications) {
      const parts: string[] = [];
      if (med.name) parts.push(med.name);
      if (med.dosage) parts.push(med.dosage);
      if (med.frequency) parts.push(med.frequency);
      lines.push(`• ${parts.join(" ｜ ")}`);
      if (med.purpose) lines.push(`  用途：${med.purpose}`);
      if (med.warnings) lines.push(`  ⚠️ ${med.warnings}`);
    }
    lines.push("");
  }

  lines.push("👉 查看完整清單：https://care.wedopr.com");
  return lines.join("\n");
}

/** 處理圖片 OCR（背景執行，用 Push API 回傳結果） */
async function processImageOCR(env: Env, event: LineEvent) {
  const userId = event.source.userId;
  try {
    const base64Image = await fetchLineContent(env, event.message!.id!);
    const parsedData = await parseMedicalImages(env, [{ data: base64Image, media_type: "image/jpeg" }]);
    await saveParsedData(env, parsedData, userId);

    const reply = formatResultSummary(parsedData);
    await pushText(env, userId, reply);
  } catch (error) {
    console.error("OCR Error:", error);
    const msg = error instanceof Error ? error.message : "未知錯誤";
    await pushText(env, userId, `抱歉，解析圖片時發生錯誤：${msg}\n請確認圖片清晰，或稍後再試。`);
  }
}

async function handleEvent(env: Env, event: LineEvent, waitUntil: (promise: Promise<any>) => void) {
  if (event.type !== "message" || !event.replyToken) return;

  if (event.message?.type === "image" && event.message.id) {
    // 1. 立即回覆「解析中」讓使用者安心
    await replyText(env, event.replyToken, "📋 收到圖片了！正在幫你解析醫療單據，請稍候⋯⋯");

    // 2. 背景處理 OCR，完成後用 Push API 推送結果
    waitUntil(processImageOCR(env, event));
    return;
  }

  const incomingText = event.message?.text || "";
  const reply =
    incomingText.includes("網址") || incomingText.toLowerCase().includes("url")
      ? "Care WEDO 已上線：https://care.wedopr.com"
      : "Care WEDO 已收到訊息。你可以直接傳送醫療單據照片給我，我會幫你自動解析！";

  await replyText(env, event.replyToken, reply);
}

export const onRequestGet: PagesFunction = async () => {
  return Response.json({
    status: "ok",
    service: "Care WEDO LINE Webhook",
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const bodyText = await request.text();
  const isValid = await verifyLineSignature(request, bodyText, env);

  if (!isValid) {
    return Response.json({ error: "Invalid LINE signature" }, { status: 401 });
  }

  const body = JSON.parse(bodyText) as LineWebhookBody;
  const events = body.events || [];

  // 偵測同一批 webhook 中是否有多張圖片
  const imageEvents = events.filter((e) => e.type === "message" && e.message?.type === "image");

  if (imageEvents.length > 1) {
    // 多張圖片：只處理第一張，提醒使用者一次傳一張
    const firstImage = imageEvents[0];
    if (firstImage.replyToken) {
      await replyText(
        env,
        firstImage.replyToken,
        "📋 收到多張圖片！為了確保精準判讀，建議一次傳送一張喔 😊\n\n我先幫你解析第一張，請稍候⋯⋯",
      );
    }
    waitUntil(processImageOCR(env, firstImage));

    // 處理非圖片事件（如文字訊息）
    const otherEvents = events.filter((e) => !(e.type === "message" && e.message?.type === "image"));
    await Promise.all(
      otherEvents.map((event) =>
        handleEvent(env, event, waitUntil).catch((err) => {
          console.error("Event handling error:", err);
        }),
      ),
    );
  } else {
    // 單張或無圖片：正常處理所有事件
    await Promise.all(
      events.map((event) =>
        handleEvent(env, event, waitUntil).catch((err) => {
          console.error("Event handling error:", err);
        }),
      ),
    );
  }

  return Response.json({ success: true });
};
