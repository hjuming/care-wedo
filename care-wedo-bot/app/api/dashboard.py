from flask import Blueprint, jsonify

from app.models import Appointment, Medication
from app.services.persistence import serialize_appointment, serialize_medication

dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.route("/dashboard", methods=["GET"])
def dashboard():
    appointments = Appointment.query.filter_by(status="upcoming").order_by(Appointment.date.asc()).all()
    medications = Medication.query.filter_by(active=True).order_by(Medication.created_at.desc()).all()

    checklist = []
    for apt in appointments[:3]:
        label = f"{apt.date or ''} {apt.department or apt.hospital or '回診'}"
        if apt.fasting_required:
            label += f"：需空腹 {apt.fasting_hours or 8} 小時"
        checklist.append(label)

    return jsonify({
        "patient": {
            "name": "家人",
            "age": "",
            "dept": appointments[0].department if appointments else "醫療照護",
            "diagnoses": [],
        },
        "appointments": [serialize_appointment(a) for a in appointments],
        "medications": [serialize_medication(m) for m in medications],
        "checklist": checklist,
    })
