from app import db
from app.models import Appointment, Medication, User

DEFAULT_WEB_USER_ID = "web-mvp"


def get_or_create_user(line_user_id=DEFAULT_WEB_USER_ID, name="Care WEDO MVP"):
    user = User.query.filter_by(line_user_id=line_user_id).first()
    if user:
        return user

    user = User(line_user_id=line_user_id, name=name)
    db.session.add(user)
    db.session.flush()
    return user


def save_parsed_data(parsed, user_id=None):
    user = User.query.get(user_id) if user_id else get_or_create_user()
    saved = {"appointment_ids": [], "medication_ids": []}

    for apt_data in parsed.get("appointments", []):
        apt = Appointment(
            user_id=user.id,
            date=apt_data.get("date"),
            time=apt_data.get("time"),
            hospital=apt_data.get("hospital"),
            department=apt_data.get("department"),
            doctor=apt_data.get("doctor"),
            number=apt_data.get("number"),
            location=apt_data.get("location"),
            fasting_required=apt_data.get("fasting_required", False),
            fasting_hours=apt_data.get("fasting_hours"),
            notes=apt_data.get("notes"),
            reminder_text=apt_data.get("reminder_text"),
        )
        db.session.add(apt)
        db.session.flush()
        saved["appointment_ids"].append(apt.id)

    for med_data in parsed.get("medications", []):
        med = Medication(
            user_id=user.id,
            name=med_data.get("name"),
            dosage=med_data.get("dosage"),
            frequency=med_data.get("frequency") or med_data.get("freq"),
            purpose=med_data.get("purpose") or med_data.get("use"),
            warnings=med_data.get("warnings"),
            reminder_text=med_data.get("reminder_text"),
        )
        db.session.add(med)
        db.session.flush()
        saved["medication_ids"].append(med.id)

    db.session.commit()
    return saved


def serialize_appointment(appointment):
    return {
        "id": appointment.id,
        "date": appointment.date,
        "time": appointment.time,
        "hospital": appointment.hospital,
        "department": appointment.department,
        "doctor": appointment.doctor,
        "number": appointment.number,
        "location": appointment.location,
        "fasting_required": appointment.fasting_required,
        "fasting_hours": appointment.fasting_hours,
        "notes": appointment.notes,
        "reminder_text": appointment.reminder_text,
        "status": appointment.status,
    }


def serialize_medication(medication):
    return {
        "id": medication.id,
        "name": medication.name,
        "dosage": medication.dosage,
        "frequency": medication.frequency,
        "purpose": medication.purpose,
        "warnings": medication.warnings,
        "reminder_text": medication.reminder_text,
        "active": medication.active,
    }
