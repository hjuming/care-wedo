from flask import Blueprint, jsonify

from app.models import Medication
from app.services.persistence import serialize_medication

medications_bp = Blueprint("medications", __name__)


@medications_bp.route("/", methods=["GET"])
def get_medications():
    meds = Medication.query.filter_by(active=True).order_by(Medication.created_at.desc()).all()
    return jsonify([serialize_medication(m) for m in meds])
