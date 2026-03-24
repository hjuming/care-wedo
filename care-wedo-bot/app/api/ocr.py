"""
Care WEDO — OCR API 端點
前端上傳圖片 → Claude Vision 解析 → 回傳結構化 JSON
"""

import base64
import logging
from flask import Blueprint, request, jsonify
from app.services.claude_ocr import parse_medical_images

logger = logging.getLogger(__name__)
ocr_bp = Blueprint("ocr", __name__)

# 允許的圖片類型
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB per file
MAX_FILES = 5


@ocr_bp.route("/", methods=["POST"])
def ocr_analyze():
    """
    接收圖片（multipart/form-data 或 JSON base64），呼叫 Claude OCR 解析。

    支援兩種上傳方式：
    1. multipart/form-data：欄位名 images（可多張）
    2. JSON body：{"images": [{"data": "base64...", "media_type": "image/jpeg"}]}
    """
    image_data_list = []

    if request.content_type and "multipart/form-data" in request.content_type:
        # 方式 1: Form upload
        files = request.files.getlist("images")
        if not files:
            return jsonify({"error": "請上傳至少一張圖片"}), 400

        if len(files) > MAX_FILES:
            return jsonify({"error": f"最多上傳 {MAX_FILES} 張圖片"}), 400

        for f in files:
            if f.content_type not in ALLOWED_TYPES:
                return jsonify({"error": f"不支援的檔案格式: {f.content_type}"}), 400

            file_bytes = f.read()
            if len(file_bytes) > MAX_FILE_SIZE:
                return jsonify({"error": "單張圖片不可超過 10MB"}), 400

            b64 = base64.b64encode(file_bytes).decode("utf-8")
            image_data_list.append({
                "data": b64,
                "media_type": f.content_type,
            })

    elif request.is_json:
        # 方式 2: JSON with base64
        data = request.get_json()
        images = data.get("images", [])
        if not images:
            return jsonify({"error": "請提供至少一張圖片"}), 400

        if len(images) > MAX_FILES:
            return jsonify({"error": f"最多上傳 {MAX_FILES} 張圖片"}), 400

        for img in images:
            if "data" not in img:
                return jsonify({"error": "圖片資料格式錯誤"}), 400
            media_type = img.get("media_type", "image/jpeg")
            if media_type not in ALLOWED_TYPES:
                return jsonify({"error": f"不支援的檔案格式: {media_type}"}), 400
            image_data_list.append({
                "data": img["data"],
                "media_type": media_type,
            })
    else:
        return jsonify({"error": "不支援的 Content-Type"}), 400

    logger.info(f"OCR 解析請求：{len(image_data_list)} 張圖片")

    result = parse_medical_images(image_data_list)

    if "error" in result:
        return jsonify(result), 422

    return jsonify({"success": True, "data": result})
