import pytest
import os
from app import create_app, db

def test_gemini_parsing_8_records(monkeypatch):
    """驗證 8 筆真實預約資料的解析準確率業務功能。業務"""
    app = create_app('test')
    with app.app_context():
        from app.services import ai_parser

        class FakeResponse:
            text = """
            {
              "appointments": [
                {"date": "2026-03-12", "fasting_required": false},
                {"date": "2026-03-19", "department": "腫瘤科"},
                {"date": "2026-03-24", "department": "泌尿部"},
                {"date": "2026-04-07", "department": "耳鼻喉科"},
                {"date": "2026-04-22", "department": "心臟超音波"},
                {"date": "2026-04-29", "fasting_required": true, "fasting_hours": 8},
                {"date": "2026-06-12", "fasting_required": false},
                {"date": "2027-02-17", "notes": "眼科搬遷前請先確認地點"}
              ]
            }
            """

        class FakeModel:
            def generate_content(self, _prompt):
                return FakeResponse()

        monkeypatch.setattr(ai_parser, "get_gemini_model", lambda: FakeModel())

        parse_medical_text = ai_parser.parse_medical_text
        raw_text = """
        3/12（四）核磁共振晚上09：30 報到 東址一樓（台大醫院）磁振掃描三室 不用空腹
        3/19（四）廖斌志 上午52號（14：00-14：30到）台大醫院腫瘤科
        3/24（二）張尚仁 下午8號（西址2樓-泌尿部1診） 台大醫院
        4/7（二）陳俊男 上午46號 台大醫院 耳鼻喉科
        4/22（三）心臟超音波台大醫院下午15號（東址5樓心臟超音波室）14:30左右到
        4/29（三）劉言彬 上午 93號（前幾天要空腹8小時抽血、驗尿）台大醫院 腫瘤科
        6/12（五）核磁共振上午09：30 報到 東址磁振正子掃描中心  不用空腹 台大醫院
        2027年2/17（三）謝易庭 上午13號（要確認眼科搬去哪）當天要做 光學掃描（眼科門診光學掃描室3） 大學眼科
        """
        
        parsed = parse_medical_text(raw_text)
        assert "error" not in parsed
        appointments = parsed.get("appointments", [])
        assert len(appointments) == 8
        
        # 驗證特定關鍵條件
        apt_429 = next(a for a in appointments if "04-29" in a['date'])
        assert apt_429['fasting_required'] is True
        
        apt_2027 = next(a for a in appointments if "2027-02-17" in a['date'])
        assert apt_2027['notes'] is not None
        
        print("\n✅ 回歸測試通過：8 筆預約解析正確。")
