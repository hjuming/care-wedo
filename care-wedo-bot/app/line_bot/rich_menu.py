import os
import requests
from linebot.v3.messaging import (
    Configuration, ApiClient, MessagingApi, MessagingApiBlob,
    RichMenuRequest, RichMenuArea, RichMenuSize, RichMenuBounds,
    PostbackAction
)

def create_rich_menu():
    """建立並綁定 Rich Menu 業務功能。業務"""
    configuration = Configuration(access_token=os.getenv("LINE_CHANNEL_ACCESS_TOKEN"))
    
    with ApiClient(configuration) as api_client:
        line_bot_api = MessagingApi(api_client)
        
        # 1. 定義 Rich Menu 結構 (2500x843, 3格等分)
        rich_menu_request = RichMenuRequest(
            size=RichMenuSize(width=2500, height=843),
            selected=True,
            name="Care WEDO Menu",
            chat_bar_text="點我開選單",
            areas=[
                # 📸 拍照掃描
                RichMenuArea(
                    bounds=RichMenuBounds(x=0, y=0, width=833, height=843),
                    action=PostbackAction(label="📸 拍照掃描", data="action=scan")
                ),
                # 📅 我的預約
                RichMenuArea(
                    bounds=RichMenuBounds(x=833, y=0, width=834, height=843),
                    action=PostbackAction(label="📅 我的預約", data="action=my_appointments")
                ),
                # 🎙️ 問小護
                RichMenuArea(
                    bounds=RichMenuBounds(x=1667, y=0, width=833, height=843),
                    action=PostbackAction(label="🎙️ 問小護", data="action=voice_ask")
                )
            ]
        )
        
        # 2. 建立 Rich Menu
        rich_menu_id = line_bot_api.create_rich_menu(rich_menu_request=rich_menu_request).rich_menu_id
        print(f"Rich Menu created: {rich_menu_id}")
        
        # 3. TODO: 上傳背景圖片 (需準備好 2500x843 #2E7D32 背景圖)
        # 這裡暫時跳過實際圖片上傳，因為環境不具備圖片檔，建議由用戶手動上傳或延後實作
        
        # 4. 設定為預設選單
        line_bot_api.set_default_rich_menu(rich_menu_id=rich_menu_id)
        return rich_menu_id

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    create_rich_menu()
