from flask import Blueprint, request, jsonify
from app.models import db, Appointment
from app.services.persistence import (
    get_or_create_user,
    serialize_appointment,
)
import logging

logger = logging.getLogger(__name__)
appointments_bp = Blueprint('appointments', __name__)

@appointments_bp.route("/", methods=["GET"])
def get_appointments():
    """取得所有預約"""
    apts = Appointment.query.order_by(Appointment.date.asc()).all()
    return jsonify([serialize_appointment(a) for a in apts])

@appointments_bp.route("/", methods=["POST"])
def create_appointment():
    """手動建立預約"""
    data = request.get_json() or {}
    if not data.get("date"):
        return jsonify({"error": "date is required"}), 400

    user = get_or_create_user()
    data.setdefault("user_id", user.id)
    apt = Appointment(**data)
    db.session.add(apt)
    db.session.commit()
    return jsonify(serialize_appointment(apt)), 201

@appointments_bp.route("/<int:apt_id>", methods=["DELETE"])
def delete_appointment(apt_id):
    """刪除預約"""
    apt = Appointment.query.get_or_404(apt_id)
    db.session.delete(apt)
    db.session.commit()
    return jsonify({"message": "Appointment deleted"})
