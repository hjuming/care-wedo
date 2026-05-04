from flask import Blueprint, request, abort, current_app
from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.webhooks import MessageEvent, TextMessageContent, ImageMessageContent
import logging

from app.services.notification import reply_text, push_text, get_messaging_api, reply_flex, push_flex
from app.services.ai_parser import parse_medical_image, parse_medical_text, answer_query
from app.models import db, User, Appointment
from app.line_bot.flex_messages import scan_result, voice_answer, appointment_carousel
from linebot.v3.messaging import FlexMessage, FlexContainer

logger = logging.getLogger(__name__)
line_bp = Blueprint('line_bot', __name__)

# 初始化 Handler (需要延遲到 create_app 時，但這裡先設好封裝)
def get_handler():
    secret = current_app.config.get("LINE_CHANNEL_SECRET")
    if not secret:
        raise RuntimeError("LINE_CHANNEL_SECRET is not configured")
    return WebhookHandler(secret)

@line_bp.route("/callback", methods=["POST"])
def callback():
    signature = request.headers.get("X-Line-Signature", "")
    body = request.get_data(as_text=True)
    
    handler = get_handler()
    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        abort(400)
    return "OK"

def register_handlers(handler):
    """將事件处理器注册到 handler 業務功能。業務"""
    
    @handler.add(MessageEvent, message=ImageMessageContent)
    def handle_image(event):
        line_user_id = event.source.user_id
        # 確保用戶存在
        user = User.query.filter_by(line_user_id=line_user_id).first()
        if not user:
            user = User(line_user_id=line_user_id)
            db.session.add(user)
            db.session.commit()

        reply_text(event.reply_token, "收到圖片了，小護正在幫您看...請稍等 🔍")

        # 取得圖片內容
        api = get_messaging_api()
        message_content = api.get_message_content(event.message.id)
        image_bytes = message_content.content

        # AI 解析
        parsed = parse_medical_image(image_bytes)
        
        if "error" not in parsed:
            _save_parsed_data(user.id, parsed)
            flex_content = scan_result(parsed)
            push_flex(line_user_id, "解析結果", flex_content)
        else:
            push_text(line_user_id, parsed["error"])

    @handler.add(MessageEvent, message=TextMessageContent)
    def handle_text(event):
        user_text = event.message.text.strip()
        line_user_id = event.source.user_id
        
        user = User.query.filter_by(line_user_id=line_user_id).first()
        if not user:
            user = User(line_user_id=line_user_id)
            db.session.add(user)
            db.session.commit()

        # 簡單判斷是否為預約輸入
        medical_keywords = ["醫院", "門診", "掛號", "報到", "空腹", "抽血", "核磁", "超音波", "醫師", "科"]
        is_medical = sum(1 for kw in medical_keywords if kw in user_text) >= 2

        if is_medical:
            parsed = parse_medical_text(user_text)
            if "error" not in parsed:
                _save_parsed_data(user.id, parsed)
                flex_content = scan_result(parsed)
                reply_flex(event.reply_token, "解析結果", flex_content)
            else:
                reply_text(event.reply_token, "抱歉，小護看不懂這段文字，可以再說清楚一點嗎？")
        else:
            # 查詢
            apts = Appointment.query.filter_by(user_id=user.id, status='upcoming').all()
            apt_list = [{"date": a.date, "department": a.department, "hospital": a.hospital} for a in apts]
            answer = answer_query(user_text, apt_list)
            
            # 使用 voice_answer Flex Message
            flex_content = voice_answer(user_text, answer)
            reply_flex(event.reply_token, "小護回答", flex_content)

def _save_parsed_data(user_id, parsed):
    """儲存解析後的資料業務功能。業務"""
    from app.models import Appointment, Medication # 避免循環匯入
    for apt_data in parsed.get("appointments", []):
        apt = Appointment(
            user_id=user_id,
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
            reminder_text=apt_data.get("reminder_text")
        )
        db.session.add(apt)
    
    for med_data in parsed.get("medications", []):
        med = Medication(
            user_id=user_id,
            name=med_data.get("name"),
            dosage=med_data.get("dosage"),
            frequency=med_data.get("frequency"),
            purpose=med_data.get("purpose"),
            warnings=med_data.get("warnings"),
            reminder_text=med_data.get("reminder_text")
        )
        db.session.add(med)
        
    db.session.commit()
