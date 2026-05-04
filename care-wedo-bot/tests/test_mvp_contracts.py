import base64


def test_health_endpoint_reports_ready(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_ocr_endpoint_persists_parsed_appointments(client, monkeypatch):
    from app.api import ocr

    def fake_parse_medical_images(_images):
        return {
            "appointments": [
                {
                    "date": "2026-04-29",
                    "time": "09:00",
                    "hospital": "台大醫院",
                    "department": "腫瘤科",
                    "doctor": "劉言彬",
                    "number": "93",
                    "location": "西址1樓腫瘤醫學部",
                    "fasting_required": True,
                    "fasting_hours": 8,
                    "notes": "前幾天抽血驗尿",
                    "reminder_text": "爸爸，回診前要記得空腹抽血喔。",
                }
            ],
            "medications": [
                {
                    "name": "UFUR",
                    "dosage": "一顆",
                    "frequency": "每日2次",
                    "purpose": "化療口服藥",
                    "warnings": "",
                    "reminder_text": "早晚飯後各吃一顆。",
                }
            ],
        }

    monkeypatch.setattr(ocr, "parse_medical_images", fake_parse_medical_images)
    payload = {
        "images": [
            {
                "data": base64.b64encode(b"fake-image").decode("utf-8"),
                "media_type": "image/jpeg",
            }
        ]
    }

    response = client.post("/api/ocr/", json=payload)

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["appointments"][0]["department"] == "腫瘤科"

    appointments = client.get("/api/appointments/").get_json()
    assert appointments[0]["department"] == "腫瘤科"

    dashboard = client.get("/api/dashboard").get_json()
    assert dashboard["appointments"][0]["fasting_required"] is True
    assert dashboard["medications"][0]["name"] == "UFUR"
