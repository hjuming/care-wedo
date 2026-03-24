from flask import Blueprint, request, jsonify
from app.services.ai_parser import parse_medical_text, parse_medical_image
import logging

logger = logging.getLogger(__name__)
parse_bp = Blueprint('parse', __name__)

@parse_bp.route("/", methods=["POST"])
def parse_text():
    """解析文字醫療資訊業務功能。業務"""
    data = request.json
    text = data.get("text")
    if not text:
        return jsonify({"error": "No text provided"}), 400
    
    result = parse_medical_text(text)
    return jsonify(result)

@parse_bp.route("/image", methods=["POST"])
def parse_image():
    """解析圖片醫療資訊業務功能。業務"""
    if 'image' not in request.files:
        return jsonify({"error": "No image uploaded"}), 400
    
    image_file = request.files['image']
    image_bytes = image_file.read()
    
    result = parse_medical_image(image_bytes)
    return jsonify(result)
