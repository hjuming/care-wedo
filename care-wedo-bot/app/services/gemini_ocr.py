"""
Care WEDO — Gemini OCR 醫療單據解析服務
使用 Google Gemini 2.0 Flash API 解析台灣醫療單據
"""

import base64
import json
import logging
import google.generativeai as genai
from flask import current_app

logger = logging.getLogger(__name__)

# OCR 解析提示詞（針對 Gemini Vision 優化）
GEMINI_OCR_PROMPT = """你是 Care WEDO 的醫療單據 OCR 解析引擎，專門辨識台灣醫療單據（掛號單、處方箋、檢查預約單、藥袋）。

請仔細辨識圖片中所有文字，並以 **純 JSON 格式** 回傳結構化資料。

回傳格式：
{
  "type": "appointment|medication|exam|report|mixed",
  "patient": {
    "name": "患者姓名",
    "age": "年齡（如有）",
    "id": "病歷號（如有）"
  },
  "visit_date": "就診日期 YYYY-MM-DD",
  "department": "科別",
  "doctor": "醫師姓名",
  "diagnoses": ["診斷1", "診斷2"],
  "appointments": [
    {
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "hospital": "醫院名稱",
      "department": "科別",
      "doctor": "醫師姓名",
      "number": "看診號碼",
      "location": "報到地點（如：西址1樓腫瘤醫學部）",
      "fasting_required": false,
      "fasting_hours": 0,
      "notes": "其他備註"
    }
  ],
  "medications": [
    {
      "name": "藥名",
      "use": "用途",
      "dosage": "劑量",
      "freq": "頻率（如：每日2次）",
      "qty": "數量",
      "days": 0,
      "warnings": "注意事項"
    }
  ],
  "exams": [
    {
      "type": "檢查類型（如：MRI、抽血）",
      "location": "檢查地點",
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "notes": "注意事項（如：需空腹）"
    }
  ],
  "reminders": [
    {
      "date": "YYYY-MM-DD 或日期描述",
      "label": "提醒標題",
      "desc": "提醒內容",
      "urgent": false
    }
  ],
  "next_visit": {
    "date": "YYYY-MM-DD",
    "dept": "科別",
    "doctor": "醫師",
    "note": "備註"
  }
}

重要規則：
1. 只輸出純 JSON，不要有 markdown 標記或任何前後文字。
2. 民國年轉換：民國年 + 1911 = 西元年（如：民國 115 年 = 2026 年）。
3. 特別注意台大醫院的「東址」與「西址」區域。
4. 欄位缺失就省略，不要填 null 或空字串。
5. 如果有多張單據，合併到同一個 JSON。
6. 藥物的管制等級（如管4）要標註在 warnings 中。
"""


def parse_medical_images(image_data_list: list[dict]) -> dict:
    """
    使用 Gemini Vision 解析一或多張醫療單據圖片。

    Args:
        image_data_list: [{"data": base64_string, "media_type": "image/jpeg"}, ...]

    Returns:
        解析後的結構化 JSON dict
    """
    api_key = current_app.config.get("GOOGLE_API_KEY")
    if not api_key:
        logger.error("GOOGLE_API_KEY 未設定")
        return {"error": "系統設定錯誤，請聯繫管理員"}

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")

        # 組裝 content：圖片 + 提示詞
        contents = [GEMINI_OCR_PROMPT]
        for img in image_data_list:
            # 將 Base64 解碼回 bytes
            img_bytes = base64.b64decode(img["data"])
            contents.append({
                "mime_type": img.get("media_type", "image/jpeg"),
                "data": img_bytes
            })

        response = model.generate_content(contents)
        return _extract_json(response.text)

    except Exception as e:
        logger.error(f"Gemini OCR 解析失敗: {e}")
        return {"error": "解析失敗，請確認圖片是否清晰"}


def parse_medical_image_bytes(image_bytes: bytes, media_type: str = "image/jpeg") -> dict:
    """
    直接從 bytes 解析單張圖片（給 LINE Bot 用）。
    """
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    return parse_medical_images([{"data": b64, "media_type": media_type}])


def _extract_json(text: str) -> dict:
    """從 AI 回應中提取 JSON"""
    # 先清除可能的 markdown 標記
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = lines[1:]  # 移除 ```json
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # fallback: 找最外層的 { }
        json_start = text.find("{")
        json_end = text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            try:
                return json.loads(text[json_start:json_end])
            except json.JSONDecodeError:
                pass

    logger.error(f"JSON 解析失敗，原始回應: {text[:200]}")
    return {"error": "AI 回應格式異常，請重試"}
