from flask import Flask
from flask import send_from_directory
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


def is_configured_secret(value):
    if not value:
        return False
    lowered = value.lower()
    return not (
        lowered.startswith("your_")
        or lowered.startswith("change-")
        or lowered in {"xxx", "placeholder"}
    )

def create_app(config_name="dev"):
    """Flask App Factory"""
    app = Flask(__name__)
    config_obj = config_by_name[config_name]
    if hasattr(config_obj, "init_app"):
        config_obj.init_app()
    app.config.from_object(config_obj)
    
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
    from app.api.dashboard import dashboard_bp
    from app.api.medications import medications_bp

    app.register_blueprint(appointments_bp, url_prefix="/api/appointments")
    app.register_blueprint(parse_bp, url_prefix="/api/parse")
    app.register_blueprint(family_bp, url_prefix="/api/family")
    app.register_blueprint(ocr_bp, url_prefix="/api/ocr")
    app.register_blueprint(dashboard_bp, url_prefix="/api")
    app.register_blueprint(medications_bp, url_prefix="/api/medications")

    line_is_configured = (
        not app.config.get("TESTING")
        and is_configured_secret(app.config.get("LINE_CHANNEL_SECRET"))
        and is_configured_secret(app.config.get("LINE_CHANNEL_ACCESS_TOKEN"))
    )
    if line_is_configured:
        from app.line_bot.webhook import line_bp, get_handler, register_handlers

        app.register_blueprint(line_bp)
    else:
        get_handler = None
        register_handlers = None

    @app.route("/api/health", methods=["GET"])
    def health():
        return {
            "status": "ok",
            "service": "Care WEDO",
            "version": "0.1.0",
        }

    frontend_dist = os.getenv(
        "CARE_WEDO_FRONTEND_DIST",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "care-wedo-app", "dist")),
    )

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        if not os.path.isdir(frontend_dist):
            return {
                "status": "ok",
                "service": "Care WEDO API",
                "frontend": "not_built",
            }

        requested_path = os.path.join(frontend_dist, path)
        if path and os.path.isfile(requested_path):
            return send_from_directory(frontend_dist, path)
        return send_from_directory(frontend_dist, "index.html")
    
    # 初始化 LINE Handler 並註冊事件
    with app.app_context():
        if app.config.get("AUTO_CREATE_DB"):
            try:
                db.create_all()
            except Exception as exc:
                logger.error("Database initialization failed: %s", exc)
        if line_is_configured:
            handler = get_handler()
            register_handlers(handler)
        else:
            logger.warning("LINE credentials are not configured; webhook handlers are disabled.")
    
    # 啟動排程器（僅在非 debug 模式或主進程中啟動，避免重複執行）
    if (
        not app.config.get("TESTING")
        and line_is_configured
        and (not app.debug or os.environ.get('WERKZEUG_RUN_MAIN') == 'true')
    ):
        from app.services.reminder import check_and_send_reminders
        if not scheduler.running:
            scheduler.add_job(func=check_and_send_reminders, trigger="interval", hours=1, args=[app])
            scheduler.start()
            logger.info("APScheduler started.")
            
    return app
