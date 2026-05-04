import { parseMedicalImages, saveParsedData, Env as OcrEnv } from "./_shared/medical_ocr";
import { getAccessibleProfiles, getOrCreateDefaultUser, supabaseFetch } from "./_shared/supabase";

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
  postback?: {
    data: string;
  };
};

type LineWebhookBody = {
  events?: LineEvent[];
};

const encoder = new TextEncoder();
const DEFAULT_RECIPIENT = "親愛的爸爸 / 媽媽";

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
async function pushText(env: Env, userId: string, text: string, quickReply?: any) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured.");
  }

  const message: any = { type: "text", text };
  if (quickReply) {
    message.quickReply = quickReply;
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: userId,
      messages: [message],
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
function formatResultSummary(parsed: import("./_shared/medical_ocr").ParsedMedicalData, profileName: string): string {
  const lines: string[] = [`${DEFAULT_RECIPIENT}，我幫您把單子整理好了。\n`];

  if (parsed.appointments?.length) {
    lines.push(`要記得的時間（${parsed.appointments.length} 筆）：`);
    for (const apt of parsed.appointments) {
      const parts: string[] = [];
      if (apt.date) parts.push(apt.time ? `${apt.date} ${apt.time}` : apt.date);
      if (apt.hospital) parts.push(apt.hospital);
      if (apt.department) parts.push(apt.department);
      if (apt.doctor) parts.push(`${apt.doctor}醫師`);
      if (apt.number) parts.push(`${apt.number}號`);
      lines.push(`• ${parts.join(" ｜ ")}`);
      if (apt.location) lines.push(`  地點：${apt.location}`);
      if (apt.fasting_required) lines.push(`  記得：前 ${apt.fasting_hours || 8} 小時先不要吃東西。`);
      if (apt.reminder_text) lines.push(`  ${apt.reminder_text}`);
    }
    lines.push("");
  }

  if (parsed.medications?.length) {
    lines.push(`藥的提醒（${parsed.medications.length} 筆）：`);
    for (const med of parsed.medications) {
      const parts: string[] = [];
      if (med.name) parts.push(med.name);
      if (med.dosage) parts.push(med.dosage);
      if (med.frequency) parts.push(med.frequency);
      lines.push(`• ${parts.join(" ｜ ")}`);
      if (med.purpose) lines.push(`  用來：${med.purpose}`);
      if (med.warnings) lines.push(`  注意：${med.warnings}`);
      if (med.reminder_text) lines.push(`  ${med.reminder_text}`);
    }
    lines.push("");
  }

  lines.push(`💡 這筆資料已存入【${profileName}】的紀錄中。`);
  lines.push("想看完整清單或修改，請點這裡：https://care.wedopr.com");
  return lines.join("\n");
}

/** 處理圖片 OCR（背景執行，用 Push API 回傳結果） */
async function processImageOCR(env: Env, event: LineEvent) {
  const lineUserId = event.source.userId;
  try {
    const base64Image = await fetchLineContent(env, event.message!.id!);
    const parsedData = await parseMedicalImages(env, [{ data: base64Image, media_type: "image/jpeg" }]);
    const saved = await saveParsedData(env, parsedData, lineUserId);
    const userId = await getOrCreateDefaultUser(env, lineUserId);
    const profiles = await getAccessibleProfiles(env, userId);

    const reply = formatResultSummary(parsedData, saved.profileName);

    let quickReply = undefined;
    const aptIds = saved.appointment_ids.join(",");
    const medIds = saved.medication_ids.join(",");
    
    if (profiles.length > 1 && (aptIds.length > 0 || medIds.length > 0)) {
      const otherProfiles = profiles.filter(p => p.display_name !== saved.profileName).slice(0, 5); // LINE limit is 13, but let's take 5
      
      quickReply = {
        items: otherProfiles.map(p => {
          const actionData = new URLSearchParams();
          actionData.set("action", "reassign");
          actionData.set("p", String(p.id));
          if (aptIds) actionData.set("a", aptIds);
          if (medIds) actionData.set("m", medIds);

          return {
            type: "action",
            action: {
              type: "postback",
              label: p.display_name,
              data: actionData.toString().slice(0, 300), // Ensure max 300 chars
              displayText: `這是 ${p.display_name} 的紀錄`
            }
          };
        })
      };
    }

    await pushText(env, lineUserId, reply, quickReply);
  } catch (error) {
    console.error("OCR Error:", error);
    const msg = error instanceof Error ? error.message : "未知錯誤";
    await pushText(env, lineUserId, `${DEFAULT_RECIPIENT}，這張照片我暫時看不清楚。\n\n可以再拍一次嗎？盡量讓整張單子平放、字清楚一點。\n\n系統訊息：${msg}`);
  }
}

async function handleEvent(env: Env, event: LineEvent, waitUntil: (promise: Promise<any>) => void) {
  if (event.type === "postback" && event.postback?.data && event.replyToken) {
    const params = new URLSearchParams(event.postback.data);
    if (params.get("action") === "reassign") {
      const targetProfileId = params.get("p");
      const aptIds = params.get("a");
      const medIds = params.get("m");
      
      try {
        if (aptIds && targetProfileId) {
          await supabaseFetch(env, `appointments?id=in.(${aptIds})`, {
            method: "PATCH",
            body: JSON.stringify({ profile_id: Number(targetProfileId) })
          });
        }
        if (medIds && targetProfileId) {
          await supabaseFetch(env, `medications?id=in.(${medIds})`, {
            method: "PATCH",
            body: JSON.stringify({ profile_id: Number(targetProfileId) })
          });
        }
        await replyText(env, event.replyToken, `沒問題，已經幫您歸類好了！`);
      } catch (err) {
        console.error("Reassign error:", err);
        await replyText(env, event.replyToken, `抱歉，歸類時發生錯誤，請稍後再試。`);
      }
      return;
    }
  }

  if (event.type !== "message" || !event.replyToken) return;

  if (event.message?.type === "image" && event.message.id) {
    // 1. 立即回覆「解析中」讓使用者安心
    await replyText(env, event.replyToken, `${DEFAULT_RECIPIENT}，收到照片了。\n我正在幫您看單子，等一下整理好給您。`);

    // 2. 背景處理 OCR，完成後用 Push API 推送結果
    waitUntil(processImageOCR(env, event));
    return;
  }

  const incomingText = event.message?.text || "";
  const reply =
    incomingText.includes("網址") || incomingText.toLowerCase().includes("url")
      ? "這裡可以看完整清單：https://care.wedopr.com"
      : `${DEFAULT_RECIPIENT}，您可以直接把醫院單子拍照傳給我。\n我會幫您整理成看診、領藥和吃藥提醒。`;

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
        `${DEFAULT_RECIPIENT}，我收到好幾張照片。\n為了看得更準，建議一次傳一張。\n\n我先幫您看第一張。`,
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
