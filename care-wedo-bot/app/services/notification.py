import logging
from linebot.v3.messaging import (
    Configuration, ApiClient, MessagingApi,
    ReplyMessageRequest, TextMessage, PushMessageRequest
)
from flask import current_app

logger = logging.getLogger(__name__)

def get_messaging_api():
    """取得 LINE Messaging Api 實例業務功能。業務"""
    config = Configuration(access_token=current_app.config['LINE_CHANNEL_ACCESS_TOKEN'])
    api_client = ApiClient(config)
    return MessagingApi(api_client)

def reply_text(reply_token, text):
    """回覆文字訊息業務功能。業務"""
    with get_messaging_api() as api:
        api.reply_message(
            ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(text=text)]
            )
        )

def push_text(to_user_id, text):
    """推播文字訊息業務功能。業務"""
    try:
        with get_messaging_api() as api:
            api.push_message(
                PushMessageRequest(
                    to=to_user_id,
                    messages=[TextMessage(text=text)]
                )
            )
    except Exception as e:
        logger.error(f"LINE 推播失敗: {e}")

def reply_flex(reply_token, alt_text, flex_contents):
    """回覆 Flex Message 業務功能。業務"""
    from linebot.v3.messaging import ReplyMessageRequest, FlexMessage, FlexContainer
    with get_messaging_api() as api:
        api.reply_message(
            ReplyMessageRequest(
                reply_token=reply_token,
                messages=[FlexMessage(
                    alt_text=alt_text,
                    contents=FlexContainer.from_dict(flex_contents)
                )]
            )
        )

def push_flex(to_user_id, alt_text, flex_contents):
    """推播 Flex Message 業務功能。業務"""
    from linebot.v3.messaging import PushMessageRequest, FlexMessage, FlexContainer
    try:
        with get_messaging_api() as api:
            api.push_message(
                PushMessageRequest(
                    to=to_user_id,
                    messages=[FlexMessage(
                        alt_text=alt_text,
                        contents=FlexContainer.from_dict(flex_contents)
                    )]
                )
            )
    except Exception as e:
        logger.error(f"LINE Flex 推播失敗: {e}")
