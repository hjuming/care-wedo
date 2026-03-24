from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_cors import CORS
from apscheduler.schedulers.background import BackgroundScheduler
import logging
import os

from app.config import config_by_name

db = SQLAlchemy()
migrate = Migrate()
scheduler = BackgroundScheduler()

def create_app(config_name="dev"):
    """Flask App Factory"""
    app = Flask(__name__)
    app.config.from_object(config_by_name[config_name])
    
    # 初始化擴充功能
    db.init_app(app)
    migrate.init_app(app, db)
    CORS(app)
    
    # 設定日誌
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    
    # 註冊 Blueprints
    from app.api.appointments import appointments_bp
    from app.api.parse import parse_bp
    from app.api.family import family_bp
    from app.api.ocr import ocr_bp
    from app.line_bot.webhook import line_bp, get_handler, register_handlers

    app.register_blueprint(appointments_bp, url_prefix="/api/appointments")
    app.register_blueprint(parse_bp, url_prefix="/api/parse")
    app.register_blueprint(family_bp, url_prefix="/api/family")
    app.register_blueprint(ocr_bp, url_prefix="/api/ocr")
    app.register_blueprint(line_bp) # Webhook 通常在根路徑或 /callback
    
    # 初始化 LINE Handler 並註冊事件
    with app.app_context():
        handler = get_handler()
        register_handlers(handler)
    
    # 啟動排程器（僅在非 debug 模式或主進程中啟動，避免重複執行）
    if not app.debug or os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        from app.services.reminder import check_and_send_reminders
        if not scheduler.running:
            scheduler.add_job(func=check_and_send_reminders, trigger="interval", hours=1, args=[app])
            scheduler.start()
            logger.info("APScheduler started.")
            
    return app
