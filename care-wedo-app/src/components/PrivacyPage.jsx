export default function PrivacyPage() {
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Care WEDO 導覽">
        <a href="https://care.wedopr.com/" className="brand-home">Care WEDO</a>
        <div className="landing-nav-links">
          <a href="/">首頁</a>
          <a href="/terms">服務條款</a>
          <a href="/login" className="nav-login-link">登入</a>
        </div>
      </nav>

      <section className="legal-hero">
        <span className="landing-version">隱私政策</span>
        <h1>我們如何保護您的資料</h1>
        <p>最後更新：2026 年 5 月・如有疑問請聯繫 <a href="mailto:care@wedopr.com">care@wedopr.com</a></p>
      </section>

      <section className="landing-section legal-section">
        <h2>1. 我們收集的資料</h2>
        <p>Care WEDO 在您使用服務時，可能收集以下資料：</p>
        <ul className="legal-list">
          <li><strong>LINE 個人資訊</strong>：透過 LINE LIFF 取得的使用者 ID、顯示名稱，用於辨識身分與顯示個人化內容。</li>
          <li><strong>醫療相關紀錄</strong>：您主動上傳或輸入的就診預約、藥物清單、醫院單據圖片解析結果。這些資料僅供您與您授權的家庭群組成員使用。</li>
          <li><strong>使用行為資料</strong>：系統日誌（API 請求時間、錯誤紀錄），用於改善服務品質，不會對應到個人身分對外揭露。</li>
        </ul>
      </section>

      <section className="landing-section legal-section">
        <h2>2. 資料使用目的</h2>
        <ul className="legal-list">
          <li>提供個人化照護提醒與家庭群組共享功能</li>
          <li>透過 LINE 推播每日健康簡報與空腹提醒</li>
          <li>AI 解析您上傳的醫院單據（影像不會對外傳輸，僅由 Google Gemini API 進行解析後丟棄）</li>
          <li>改善系統穩定性與使用者體驗</li>
        </ul>
      </section>

      <section className="landing-section legal-section">
        <h2>3. 資料儲存與保留</h2>
        <p>您的個人化資料儲存於 Supabase（PostgreSQL）資料庫，伺服器位於雲端。</p>
        <ul className="legal-list">
          <li><strong>測試期間</strong>：全功能免費開放，照護紀錄保留至您主動刪除帳號或申請刪除為止。</li>
          <li><strong>Free</strong>：正式版會保留最近 30 天資料，但不開放用戶查詢、觀看歷史資料。</li>
          <li><strong>照護圈升級</strong>：提供完整歷史查詢與長期保存；每位照護對象每月 100 筆 AI 整理額度。</li>
        </ul>
      </section>

      <section className="landing-section legal-section">
        <h2>4. 資料分享</h2>
        <p>Care WEDO <strong>不會</strong>將您的個人資料或醫療紀錄出售或提供給第三方用於商業目的。以下情況例外：</p>
        <ul className="legal-list">
          <li>您主動邀請加入家庭群組的成員，可查看群組內共享的照護資料。</li>
          <li>AI OCR 解析時，圖片內容會傳送給 Google Gemini API，Google 的隱私政策另行適用。解析完成後，原始圖片不由我們保存。</li>
          <li>法律要求的情況下配合相關機關。</li>
        </ul>
      </section>

      <section className="landing-section legal-section">
        <h2>5. 您的資料權利</h2>
        <p>您隨時可以：</p>
        <ul className="legal-list">
          <li><strong>查詢資料</strong>：登入後台即可查看您的全部照護紀錄。</li>
          <li><strong>修改資料</strong>：在後台直接編輯照護對象資訊與就診紀錄。</li>
          <li><strong>刪除資料</strong>：在「家人設定」頁面申請刪除帳號，系統將刪除您所有關聯的個人資料。或寄信至 <a href="mailto:care@wedopr.com">care@wedopr.com</a> 申請。</li>
        </ul>
      </section>

      <section className="landing-section legal-section">
        <h2>6. Cookie 與追蹤</h2>
        <p>Care WEDO 目前不使用第三方廣告追蹤 Cookie。LINE LIFF 登入機制使用瀏覽器本地儲存（LocalStorage）保存登入狀態。</p>
      </section>

      <section className="landing-section legal-section">
        <h2>7. 聯絡我們</h2>
        <p>如有隱私問題或資料刪除申請，請聯繫：<a href="mailto:care@wedopr.com">care@wedopr.com</a></p>
      </section>

      <footer className="landing-footer">
        <div className="footer-brand">
          <a href="https://care.wedopr.com/" className="footer-brand-link">Care WEDO</a>
          <span>讓照護資訊更清楚，讓家庭陪伴更安心。</span>
        </div>
        <div className="landing-footer-links">
          <a href="https://lin.ee/xzbyyvf" target="_blank" rel="noopener noreferrer">LINE 照護小管家</a>
          <a href="/terms">服務條款</a>
          <a href="mailto:care@wedopr.com">care@wedopr.com</a>
        </div>
        <p className="footer-copyright">© {new Date().getFullYear()} Care WEDO. All rights reserved.</p>
      </footer>
    </main>
  );
}
