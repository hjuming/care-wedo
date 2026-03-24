"""
Care WEDO — 本地測試腳本 (Gemini 版)
不需要 LINE Bot，直接在電腦上測試 AI 解析功能

使用方式：
  1. 先設定環境變數：export GOOGLE_API_KEY=你的key
  2. 執行：python3 test_parse.py
"""

import json
import os
from dotenv import load_dotenv
import google.generativeai as genai
from prompts import MEDICAL_DOC_PARSE_PROMPT, VOICE_QUERY_PROMPT

load_dotenv()

# Gemini API 設定
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
model = genai.GenerativeModel("gemini-2.0-flash")


def test_text_parsing():
    """
    測試：直接貼上你父親的真實預約文字，看 AI 能不能正確解析
    """
    # ===== 這就是你父親的真實預約資料 =====
    raw_text = """
    3/12（四）核磁共振晚上09：30 報到 東址一樓（台大醫院）
    磁振掃描三室
    不用空腹

    3/19（四）廖斌志 上午52號（14：00-14：30到）台大醫院腫瘤科

    3/24（二）張尚仁 下午8號（西址2樓-泌尿部1診） 台大醫院

    4/7（二）陳俊男 上午46號
    台大醫院 耳鼻喉科

    4/22（三）心臟超音波台大醫院下午15號（東址5樓心臟超音波室）14:30左右到

    4/29（三）劉言彬 上午 93號
    （前幾天要空腹8小時抽血、驗尿）台大醫院 腫瘤科

    6/12（五）核磁共振上午09：30 報到 東址磁振正子掃描中心  不用空腹 台大醫院

    2027年2/17（三）謝易庭 上午13號（要確認眼科搬去哪）當天要做 光學掃描（眼科門診光學掃描室3） 大學眼科
    """

    print("=" * 60)
    print("📋 測試一：解析預約文字 (Gemini)")
    print("=" * 60)
    print(f"輸入文字：\n{raw_text[:200]}...\n")

    prompt = f"{MEDICAL_DOC_PARSE_PROMPT}\n\n以下是要解析的文字：\n{raw_text}"
    response = model.generate_content(prompt)
    result_text = response.text

    print("🤖 AI 回應：")

    # 嘗試提取 JSON
    try:
        json_start = result_text.find("{")
        json_end = result_text.rfind("}") + 1
        if json_start >= 0:
            parsed = json.loads(result_text[json_start:json_end])
            print(json.dumps(parsed, ensure_ascii=False, indent=2))

            # 驗證解析結果
            print("\n" + "=" * 60)
            print("✅ 解析驗證")
            print("=" * 60)
            appointments = parsed.get("appointments", [])
            print(f"共解析出 {len(appointments)} 筆預約")

            for i, apt in enumerate(appointments, 1):
                print(f"\n  [{i}] {apt.get('date', '?')} {apt.get('department', '?')}")
                print(f"      醫院: {apt.get('hospital', '?')}")
                print(f"      醫師: {apt.get('doctor', '無')}")
                print(f"      地點: {apt.get('location', '?')}")
                print(f"      空腹: {'是' if apt.get('fasting_required') else '否'}")
                if apt.get("reminder_text"):
                    print(f"      💬 {apt['reminder_text']}")

            return parsed
        else:
            print(result_text)
    except Exception as e:
        print(f"解析失敗: {e}")
        print(result_text)

    return None


def test_voice_query(appointments_data: dict):
    """
    測試：模擬長者的口語問題
    """
    print("\n\n" + "=" * 60)
    print("🎙️ 測試二：語音查詢模擬 (Gemini)")
    print("=" * 60)

    test_queries = [
        "明天要看什麼科？",
        "這個月還有哪些要看的？",
        "哪一次要空腹？",
        "台大東址要怎麼去？",
        "下次看腫瘤科是什麼時候？",
    ]

    for query in test_queries:
        print(f"\n👴 長者問：「{query}」")

        prompt = VOICE_QUERY_PROMPT.format(
            appointments_json=json.dumps(appointments_data, ensure_ascii=False),
            user_query=query
        )

        response = model.generate_content(prompt)
        print(f"🤖 小護答：{response.text}")
        print("-" * 40)


if __name__ == "__main__":
    if not os.getenv("GOOGLE_API_KEY"):
        print("❌ 請先設定 GOOGLE_API_KEY 環境變數")
        print("   export GOOGLE_API_KEY=your_key_here")
        print("   或在 .env 檔案中設定")
        exit(1)

    print("🏥 Care WEDO — Gemini AI 解析測試\n")

    # 測試文字解析
    parsed = test_text_parsing()

    # 測試語音查詢
    if parsed:
        test_voice_query(parsed)
    else:
        # 用範例資料測試
        print("\n使用範例資料進行語音查詢測試...")
        if os.path.exists("sample_data.json"):
            with open("sample_data.json", "r", encoding="utf-8") as f:
                sample = json.load(f)
            test_voice_query(sample)
        else:
            print("找不到 sample_data.json")

    print("\n\n✅ 測試完成！")
