import os
from datetime import timedelta

class Config:
    """基礎配置類別"""
    SECRET_KEY = os.getenv("SECRET_KEY", "care-wedo-secret-key")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # LINE Bot 設定
    LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN")
    LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET")
    
    # Gemini API 設定
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
    GEMINI_MODEL_NAME = "gemini-2.0-flash"

    # Claude API 設定（OCR 用）
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
    CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")

    # 提醒功能設定
    REMINDER_HOURS_BEFORE = int(os.getenv("REMINDER_HOURS_BEFORE", 24))

class DevelopmentConfig(Config):
    """開發環境配置"""
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///care_wedo_dev.db")

class ProductionConfig(Config):
    """正式環境配置"""
    DEBUG = False
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///care_wedo_prod.db")

config_by_name = {
    "dev": DevelopmentConfig,
    "prod": ProductionConfig
}
