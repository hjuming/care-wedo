import secrets

from flask import Blueprint, request, jsonify

family_bp = Blueprint('family', __name__)

@family_bp.route("/invite", methods=["POST"])
def create_invite():
    """產生家庭邀請碼（MVP 先回傳一次性格式，正式版再落庫）"""
    return jsonify({"invite_code": secrets.token_hex(3).upper()})

@family_bp.route("/join", methods=["POST"])
def join_family():
    """加入家庭群組业务功能。業務"""
    return jsonify({"message": "Joined family group"})
