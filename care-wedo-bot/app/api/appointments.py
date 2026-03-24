from flask import Blueprint, request, jsonify
from app.models import db, Appointment, User
import logging

logger = logging.getLogger(__name__)
appointments_bp = Blueprint('appointments', __name__)

@appointments_bp.route("/", methods=["GET"])
def get_appointments():
    """取得所有預約業務功能。業務"""
    apts = Appointment.query.order_by(Appointment.date.asc()).all()
    result = []
    for a in apts:
        result.append({
            "id": a.id,
            "date": a.date,
            "time": a.time,
            "hospital": a.hospital,
            "department": a.department,
            "doctor": a.doctor,
            "location": a.location,
            "reminder_text": a.reminder_text,
            "fasting_required": a.fasting_required
        })
    return jsonify(result)

@appointments_bp.route("/", methods=["POST"])
def create_appointment():
    """手動建立預約業務功能。業務"""
    data = request.json
    apt = Appointment(**data)
    db.session.add(apt)
    db.session.commit()
    return jsonify({"message": "Appointment created", "id": apt.id}), 201

@appointments_bp.route("/<int:apt_id>", methods=["DELETE"])
def delete_appointment(apt_id):
    """刪除預約業務功能。業務"""
    apt = Appointment.query.get_or_404(apt_id)
    db.session.delete(apt)
    db.session.commit()
    return jsonify({"message": "Appointment deleted"})
