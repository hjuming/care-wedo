import logging
from datetime import datetime, timedelta
from app.models import Appointment, User
from app.services.notification import push_text

logger = logging.getLogger(__name__)

def check_and_send_reminders(app):
    """每小時檢查一次預約提醒並發送推播業務功能。業務"""
    with app.app_context():
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        today = datetime.now().strftime("%Y-%m-%d")
        
        # 查詢明天的預約
        tomorrow_apts = Appointment.query.filter_by(date=tomorrow, status='upcoming').all()
        for apt in tomorrow_apts:
            user = User.query.get(apt.user_id)
            if user and user.line_user_id:
                reminder = f"📢 明天提醒\n\n"
                reminder += apt.reminder_text or f"明天 {apt.time} 要去 {apt.hospital}"
                if apt.fasting_required:
                    reminder += f"\n\n⚠️ 重要：今晚開始要空腹 {apt.fasting_hours or 8} 小時！"
                    reminder += f"\n晚上不要吃宵夜喔～"
                
                push_text(user.line_user_id, reminder)
                logger.info(f"已發送明日提醒給 {user.line_user_id}")

        # 查詢今天的預約
        today_apts = Appointment.query.filter_by(date=today, status='upcoming').all()
        for apt in today_apts:
            user = User.query.get(apt.user_id)
            if user and user.line_user_id:
                reminder = f"🏥 今天出發提醒\n\n"
                reminder += apt.reminder_text or f"今天 {apt.time} 要去 {apt.hospital}"
                if apt.location:
                    reminder += f"\n📍 報到地點：{apt.location}"
                
                push_text(user.line_user_id, reminder)
                logger.info(f"已發送今日提醒給 {user.line_user_id}")
