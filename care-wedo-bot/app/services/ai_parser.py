import google.generativeai as genai
import json
import logging
from flask import current_app
from prompts import MEDICAL_DOC_PARSE_PROMPT, VOICE_QUERY_PROMPT

logger = logging.getLogger(__name__)

def get_gemini_model():
    """初始化並取得 Gemini 模型"""
    api_key = current_app.config.get("GOOGLE_API_KEY")
    model_name = current_app.config.get("GEMINI_MODEL_NAME", "gemini-2.0-flash")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(model_name)

def parse_medical_image(image_bytes: bytes) -> dict:
    """用 Gemini Vision 解析醫療單據圖片業務功能。業務"""
    model = get_gemini_model()
    image_parts = [{"mime_type": "image/jpeg", "data": image_bytes}]
    
    try:
        response = model.generate_content([MEDICAL_DOC_PARSE_PROMPT, image_parts[0]])
        return _extract_json(response.text)
    except Exception as e:
        logger.error(f"Gemini 解析圖片失敗: {e}")
        return {"error": "無法解析此圖片，請重新拍攝或換一張更清晰的照片"}

def parse_medical_text(text: str) -> dict:
    """用 Gemini 解析文字形式的醫療資訊業務功能。業務"""
    model = get_gemini_model()
    prompt = f"{MEDICAL_DOC_PARSE_PROMPT}\n\n以下是要解析的文字：\n{text}"
    
    try:
        response = model.generate_content(prompt)
        return _extract_json(response.text)
    except Exception as e:
        logger.error(f"Gemini 解析文字失敗: {e}")
        return {"error": "無法解析"}

def answer_query(user_query: str, appointments_data: list) -> str:
    """回答長者的口語化問題業務功能。業務"""
    model = get_gemini_model()
    prompt = VOICE_QUERY_PROMPT.format(
        appointments_json=json.dumps(appointments_data, ensure_ascii=False, indent=2),
        user_query=user_query
    )
    
    try:
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        logger.error(f"Gemini 回答問題失敗: {e}")
        return "抱歉，小護現在有點累，請稍後再試。"

def _extract_json(text: str) -> dict:
    """從 AI 回應中提取 JSON 區塊業務功能。業務"""
    try:
        json_start = text.find("{")
        json_end = text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            return json.loads(text[json_start:json_end])
    except Exception as e:
        logger.error(f"提取 JSON 失敗: {e}, 內容: {text}")
    return {"error": "格式解析失敗"}
