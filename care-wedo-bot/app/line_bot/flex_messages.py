def appointment_card(apt_data: dict) -> dict:
    """單筆預約卡片，mega size bubble (銀髮友善) 業務功能。業務"""
    # 色彩規範
    MAIN_GREEN = "#2E7D32"
    ACCENT_ORANGE = "#FF6F00"
    DANGER_RED = "#D32F2F"
    TEXT_DARK = "#212121"
    
    # 組合 header
    header = {
        "type": "box",
        "layout": "vertical",
        "contents": [
            {
                "type": "text",
                "text": f"📅 {apt_data.get('date', '')} {apt_data.get('department', '')}",
                "weight": "bold",
                "size": "xl",
                "color": "#FFFFFF",
                "wrap": True
            }
        ],
        "backgroundColor": MAIN_GREEN,
        "paddingAll": "20px"
    }
    
    # 組合 body 內容
    body_contents = [
        {
            "type": "text",
            "text": f"👨‍⚕️ {apt_data.get('doctor', '醫師')}",
            "weight": "bold",
            "size": "xl",
            "color": TEXT_DARK,
            "wrap": True
        },
        {
            "type": "text",
            "text": f"{apt_data.get('number', '')} 號",
            "weight": "bold",
            "size": "3xl",
            "color": ACCENT_ORANGE,
            "margin": "md",
            "wrap": True
        },
        {
            "type": "text",
            "text": f"📍 {apt_data.get('location', '')}",
            "size": "lg",
            "color": TEXT_DARK,
            "margin": "md",
            "wrap": True
        }
    ]
    
    # 注意事項
    if apt_data.get('notes'):
        body_contents.append({
            "type": "text",
            "text": f"📝 備註：{apt_data.get('notes')}",
            "size": "md",
            "color": "#757575",
            "margin": "md",
            "wrap": True
        })
        
    # 空腹警告
    if apt_data.get('fasting_required'):
        hours = apt_data.get('fasting_hours', '8')
        body_contents.append({
            "type": "box",
            "layout": "vertical",
            "margin": "lg",
            "paddingAll": "10px",
            "backgroundColor": "#FFEBEE",
            "cornerRadius": "md",
            "contents": [
                {
                    "type": "text",
                    "text": f"⚠️ 需空腹 {hours} 小時",
                    "weight": "bold",
                    "size": "lg",
                    "color": DANGER_RED,
                    "wrap": True
                }
            ]
        })
        
    body = {
        "type": "box",
        "layout": "vertical",
        "contents": body_contents,
        "paddingAll": "20px"
    }
    
    # Footer 按鈕
    footer = {
        "type": "box",
        "layout": "vertical",
        "spacing": "sm",
        "contents": [
            {
                "type": "button",
                "style": "primary",
                "height": "sm",
                "color": MAIN_GREEN,
                "action": {
                    "type": "uri",
                    "label": "📍 導航",
                    "uri": f"https://www.google.com/maps/search/?api=1&query={apt_data.get('hospital', '')}"
                }
            },
            {
                "type": "button",
                "style": "secondary",
                "height": "sm",
                "action": {
                    "type": "postback",
                    "label": "📆 加到行事曆",
                    "data": f"action=calendar&id={apt_data.get('id', '')}"
                }
            },
            {
                "type": "button",
                "style": "link",
                "height": "sm",
                "action": {
                    "type": "postback",
                    "label": "✅ 我知道了",
                    "data": f"action=ack&id={apt_data.get('id', '')}"
                }
            }
        ],
        "paddingAll": "10px"
    }
    
    return {
        "type": "bubble",
        "size": "mega",
        "header": header,
        "body": body,
        "footer": footer
    }

def appointment_carousel(apt_list: list) -> dict:
    """多筆預約輪播 (上限 10 筆) 業務功能。業務"""
    bubbles = [appointment_card(apt) for apt in apt_list[:10]]
    return {
        "type": "carousel",
        "contents": bubbles
    }

def fasting_alert(apt_data: dict) -> dict:
    """禁食特別警告卡片 業務功能。業務"""
    DANGER_RED = "#D32F2F"
    return {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": DANGER_RED,
            "contents": [
                {"type": "text", "text": "⚠️ 明天要空腹！", "weight": "bold", "size": "xl", "color": "#FFFFFF"}
            ]
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {"type": "text", "text": f"預約：{apt_data.get('department')}", "size": "lg", "wrap": True},
                {"type": "text", "text": apt_data.get('reminder_text', '今晚 12:00 後不能吃東西'), "weight": "bold", "size": "xxl", "color": DANGER_RED, "margin": "lg", "wrap": True}
            ]
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {"type": "button", "style": "primary", "color": DANGER_RED, "action": {"type": "postback", "label": "我記住了", "data": f"action=fasting_ack&id={apt_data.get('id')}"}}
            ]
        }
    }

def medication_reminder(med_list: list) -> dict:
    """每日用藥提醒卡片 (早/中/晚) 業務功能。業務"""
    def get_time_section(title, icon, meds):
        contents = [{"type": "text", "text": f"{icon} {title}", "weight": "bold", "size": "lg", "color": "#2E7D32"}]
        if not meds:
            contents.append({"type": "text", "text": "無", "size": "md", "color": "#BCBCBC"})
        else:
            for m in meds:
                contents.append({"type": "text", "text": f"💊 {m['name']} ({m['dosage']})", "size": "md", "wrap": True})
        return {"type": "box", "layout": "vertical", "margin": "md", "contents": contents}

    # 這裡假設 med_list 已經根據時段過濾，或者帶有時段資訊
    # 簡化版：全部列出
    body_contents = [get_time_section("用藥提醒", "⏰", med_list)]
    
    return {
        "type": "bubble",
        "body": {"type": "box", "layout": "vertical", "contents": body_contents},
        "footer": {
            "type": "box", "layout": "vertical", "contents": [
                {"type": "button", "style": "primary", "color": "#2E7D32", "action": {"type": "postback", "label": "✅ 已服藥", "data": "action=med_ack"}}
            ]
        }
    }

def scan_result(parsed_data: dict) -> dict:
    """掃描解析結果摘要 業務功能。業務"""
    apts = parsed_data.get("appointments", [])
    body_contents = [{"type": "text", "text": "小護幫您看完了 🔍", "weight": "bold", "size": "xl", "color": "#2E7D32"}]
    
    for apt in apts:
        body_contents.append({
            "type": "text", 
            "text": f"📅 {apt.get('date')} {apt.get('hospital')}", 
            "size": "lg", "margin": "md", "wrap": True
        })

    return {
        "type": "bubble",
        "body": {"type": "box", "layout": "vertical", "contents": body_contents},
        "footer": {
            "type": "box", "layout": "horizontal", "spacing": "sm", "contents": [
                {"type": "button", "style": "primary", "color": "#2E7D32", "action": {"type": "postback", "label": "全部儲存", "data": "action=save_all"}},
                {"type": "button", "style": "secondary", "action": {"type": "message", "label": "重新拍", "text": "重新掃描"}}
            ]
        }
    }

def voice_answer(question: str, answer: str) -> dict:
    """語音查詢結果 業務功能。業務"""
    return {
        "type": "bubble",
        "body": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {"type": "box", "layout": "vertical", "backgroundColor": "#F0F0F0", "paddingAll": "10px", "contents": [
                    {"type": "text", "text": f"問：{question}", "size": "md", "color": "#757575", "wrap": True}
                ]},
                {"type": "text", "text": answer, "weight": "bold", "size": "xl", "margin": "lg", "wrap": True}
            ]
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {"type": "button", "style": "link", "action": {"type": "postback", "label": "🔊 播放語音", "data": "action=tts"}}
            ]
        }
    }
