"""
Care WEDO LINE Bot — 主程式
銀髮族 AI 智慧照護助手 Prototype

功能：
1. 接收圖片 → AI 解析醫療單據 → 回傳結構化資訊 + 口語化提醒
2. 接收文字 → 查詢預約/用藥資訊 → 口語化回答
3. 定時推播提醒（就醫前一天、禁食提醒）
"""

import os
import json
import base64
import logging
from datetime import datetime, timedelta
from io import BytesIO

from flask import Flask, request, abort
from linebot.v3 import WebhookHandler
from linebot.v3.messaging import (
    Configuration, ApiClient, MessagingApi,
    ReplyMessageRequest, TextMessage, PushMessageRequest
)
from linebot.v3.webhooks import (
    MessageEvent, TextMessageContent, ImageMessageContent
)
from linebot.v3.exceptions import InvalidSignatureError
import google.generativeai as genai
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler

from prompts import MEDICAL_DOC_PARSE_PROMPT, VOICE_QUERY_PROMPT, FASTING_REMINDER_PROMPT

# ===== 初始化 =====
load_dotenv()
app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# LINE Bot 設定
line_config = Configuration(
    access_token=os.getenv("LINE_CHANNEL_ACCESS_TOKEN")
)
handler = WebhookHandler(os.getenv("LINE_CHANNEL_SECRET"))

# Gemini API 設定
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
model = genai.GenerativeModel("gemini-2.0-flash")

# ===== 簡易資料儲存（MVP 用 JSON 檔，正式版換資料庫）=====
DATA_FILE = "appointments.json"


def load_appointments():
    """載入預約資料"""
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"appointments": [], "medications": []}


def save_appointments(data):
    """儲存預約資料"""
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ===== AI 解析功能 =====

def parse_medical_image(image_bytes: bytes) -> dict:
    """
    用 Gemini Vision 解析醫療單據圖片
    長者拍照傳到 LINE → 這裡解析 → 回傳結構化資料
    """
    # 準備圖片資料
    image_parts = [
        {
            "mime_type": "image/jpeg",
            "data": image_bytes
        }
    ]

    response = model.generate_content([MEDICAL_DOC_PARSE_PROMPT, image_parts[0]])

    # 從回應中提取 JSON
    response_text = response.text
    try:
        # 嘗試找到 JSON 區塊
        json_start = response_text.find("{")
        json_end = response_text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            parsed = json.loads(response_text[json_start:json_end])
            return parsed
    except Exception as e:
        logger.error(f"無法解析 AI 回應為 JSON: {response_text}, 錯誤: {e}")

    return {"error": "無法解析此圖片，請重新拍攝或換一張更清晰的照片"}


def parse_medical_text(text: str) -> dict:
    """
    用 Gemini 解析文字形式的醫療資訊
    """
    prompt = f"{MEDICAL_DOC_PARSE_PROMPT}\n\n以下是要解析的文字：\n{text}"
    response = model.generate_content(prompt)

    response_text = response.text
    try:
        json_start = response_text.find("{")
        json_end = response_text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            return json.loads(response_text[json_start:json_end])
    except Exception as e:
        logger.error(f"文字解析失敗: {e}")

    return {"error": "無法解析"}


def answer_query(user_query: str) -> str:
    """
    回答長者的口語化問題
    """
    data = load_appointments()

    prompt = VOICE_QUERY_PROMPT.format(
        appointments_json=json.dumps(data, ensure_ascii=False, indent=2),
        user_query=user_query
    )

    response = model.generate_content(prompt)

    return response.text


def format_parsed_result(parsed: dict) -> str:
    """
    將解析結果轉成長者看得懂的大字訊息
    """
    if "error" in parsed:
        return f"抱歉，{parsed['error']}"

    lines = ["小護幫您看完了：\n"]

    # 顯示預約資訊
    for apt in parsed.get("appointments", []):
        lines.append(f"📅 {apt.get('date', '')} {apt.get('time', '')}")
        lines.append(f"🏥 {apt.get('hospital', '')} {apt.get('department', '')}")
        if apt.get("doctor"):
            lines.append(f"👨‍⚕️ {apt['doctor']} 醫師")
        if apt.get("number"):
            lines.append(f"🔢 第 {apt['number']} 號")
        if apt.get("location"):
            lines.append(f"📍 {apt['location']}")
        if apt.get("fasting_required"):
            lines.append(f"⚠️ 要空腹 {apt.get('fasting_hours', 8)} 小時！")
        if apt.get("reminder_text"):
            lines.append(f"\n💬 {apt['reminder_text']}")
        lines.append("")

    # 顯示用藥資訊
    for med in parsed.get("medications", []):
        lines.append(f"💊 {med.get('name', '')}")
        lines.append(f"   {med.get('frequency', '')}")
        if med.get("reminder_text"):
            lines.append(f"   💬 {med['reminder_text']}")
        lines.append("")

    return "\n".join(lines) if len(lines) > 1 else "沒有找到醫療相關資訊，請確認圖片是否清晰。"


# ===== LINE Bot Webhook 處理 =====

@app.route("/callback", methods=["POST"])
def callback():
    signature = request.headers.get("X-Line-Signature", "")
    body = request.get_data(as_text=True)
    logger.info(f"收到 webhook: {body[:200]}")

    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        abort(400)

    return "OK"


@handler.add(MessageEvent, message=ImageMessageContent)
def handle_image(event):
    """
    收到圖片 → AI 解析醫療單據
    這是核心功能：長者拍照就能讀懂單子
    """
    with ApiClient(line_config) as api_client:
        messaging_api = MessagingApi(api_client)

        # 先回覆「正在處理」
        messaging_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text="收到圖片了，小護正在幫您看...請稍等 🔍")]
            )
        )

        # 取得圖片內容
        message_content = messaging_api.get_message_content(event.message.id)
        image_bytes = message_content.content

        # AI 解析
        try:
            parsed = parse_medical_image(image_bytes)

            # 儲存解析結果
            data = load_appointments()
            for apt in parsed.get("appointments", []):
                data["appointments"].append(apt)
            for med in parsed.get("medications", []):
                data["medications"].append(med)
            save_appointments(data)

            # 格式化回覆
            reply_text = format_parsed_result(parsed)

        except Exception as e:
            logger.error(f"解析失敗: {e}")
            reply_text = "抱歉，小護看不太清楚這張圖片。可以重新拍一張更清楚的嗎？"

        # 推送結果（因為 reply_token 已用過，改用 push）
        messaging_api.push_message(
            PushMessageRequest(
                to=event.source.user_id,
                messages=[TextMessage(text=reply_text)]
            )
        )


@handler.add(MessageEvent, message=TextMessageContent)
def handle_text(event):
    """
    收到文字訊息 → 判斷是查詢還是要新增預約
    """
    user_text = event.message.text.strip()

    with ApiClient(line_config) as api_client:
        messaging_api = MessagingApi(api_client)

        # 判斷是否包含預約關鍵字（可能是直接貼上預約資訊）
        medical_keywords = ["醫院", "門診", "掛號", "報到", "空腹", "抽血",
                            "核磁", "超音波", "醫師", "科"]
        is_medical_input = sum(1 for kw in medical_keywords if kw in user_text) >= 2

        if is_medical_input:
            # 當作醫療資訊來解析
            parsed = parse_medical_text(user_text)

            # 儲存
            data = load_appointments()
            for apt in parsed.get("appointments", []):
                data["appointments"].append(apt)
            save_appointments(data)

            reply_text = format_parsed_result(parsed)
        else:
            # 當作查詢來回答
            reply_text = answer_query(user_text)

        messaging_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text=reply_text)]
            )
        )


# ===== 定時提醒功能 =====

def check_and_send_reminders():
    """
    每小時檢查一次，如果明天有預約就發提醒
    """
    data = load_appointments()
    tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    today = datetime.now().strftime("%Y-%m-%d")

    for apt in data.get("appointments", []):
        apt_date = apt.get("date", "")

        # 明天的預約 → 發前一天提醒
        if apt_date == tomorrow:
            reminder = f"📢 明天提醒\n\n"
            reminder += apt.get("reminder_text", f"明天 {apt.get('time', '')} 要去 {apt.get('hospital', '')}")

            if apt.get("fasting_required"):
                fasting_hours = apt.get("fasting_hours", 8)
                reminder += f"\n\n⚠️ 重要：今晚開始要空腹 {fasting_hours} 小時！"
                reminder += f"\n晚上不要吃宵夜喔～"

            logger.info(f"發送明日提醒: {reminder}")
            # TODO: 發送 push message 給指定用戶
            # 需要先取得用戶 LINE User ID

        # 當天的預約 → 發出發提醒
        if apt_date == today:
            reminder = f"🏥 今天出發提醒\n\n"
            reminder += apt.get("reminder_text", f"今天 {apt.get('time', '')} 要去 {apt.get('hospital', '')}")
            if apt.get("location"):
                reminder += f"\n📍 報到地點：{apt['location']}"

            logger.info(f"發送當日提醒: {reminder}")


# 啟動排程器
scheduler = BackgroundScheduler()
scheduler.add_job(check_and_send_reminders, "interval", hours=1)
scheduler.start()


# ===== 健康檢查 =====

@app.route("/health", methods=["GET"])
def health():
    return {"status": "ok", "service": "Care WEDO Bot", "version": "0.1.0"}


@app.route("/", methods=["GET"])
def index():
    return """
    <h1>Care WEDO 小護 🏥</h1>
    <p>銀髮族 AI 智慧照護助手</p>
    <p>請在 LINE 上搜尋我們的官方帳號開始使用。</p>
    """


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
