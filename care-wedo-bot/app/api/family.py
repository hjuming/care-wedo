from flask import Blueprint, request, jsonify
family_bp = Blueprint('family', __name__)

@family_bp.route("/invite", methods=["POST"])
def create_invite():
    """產生家庭邀請碼业务功能。業務"""
    return jsonify({"invite_code": "123456"})

@family_bp.route("/join", methods=["POST"])
def join_family():
    """加入家庭群組业务功能。業務"""
    return jsonify({"message": "Joined family group"})
