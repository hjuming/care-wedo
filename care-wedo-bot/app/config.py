import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()

class Config:
    """基礎配置類別"""
    SECRET_KEY = os.getenv("SECRET_KEY")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    AUTO_CREATE_DB = os.getenv("AUTO_CREATE_DB", "true").lower() == "true"
    
    # LINE Bot 設定
    LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN")
    LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET")
    
    # Gemini API 設定
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
    GEMINI_MODEL_NAME = "gemini-2.0-flash"

    # 提醒功能設定
    REMINDER_HOURS_BEFORE = int(os.getenv("REMINDER_HOURS_BEFORE", 24))

class DevelopmentConfig(Config):
    """開發環境配置"""
    DEBUG = True
    SECRET_KEY = Config.SECRET_KEY or "care-wedo-dev-secret"
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///care_wedo_dev.db")

class ProductionConfig(Config):
    """正式環境配置"""
    DEBUG = False
    SECRET_KEY = Config.SECRET_KEY
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///care_wedo_prod.db")

    @classmethod
    def init_app(cls):
        if not cls.SECRET_KEY:
            raise RuntimeError("SECRET_KEY must be set in production")

class TestingConfig(Config):
    """測試環境配置"""
    TESTING = True
    DEBUG = False
    SECRET_KEY = "care-wedo-test-secret"
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    AUTO_CREATE_DB = False

config_by_name = {
    "dev": DevelopmentConfig,
    "prod": ProductionConfig,
    "test": TestingConfig,
}
