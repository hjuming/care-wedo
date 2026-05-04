export default function TermsPage() {
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Care WEDO 導覽">
        <a href="https://care.wedopr.com/" className="brand-home">Care WEDO</a>
        <div className="landing-nav-links">
          <a href="/">首頁</a>
          <a href="/privacy">隱私政策</a>
          <a href="/login" className="nav-login-link">登入</a>
        </div>
      </nav>

      <section className="legal-hero">
        <span className="landing-version">服務條款</span>
        <h1>使用前請詳閱</h1>
        <p>最後更新：2026 年 5 月・如有疑問請聯繫 <a href="mailto:care@wedopr.com">care@wedopr.com</a></p>
      </section>

      <section className="legal-disclaimer-card landing-section">
        <div className="disclaimer-inner">
          <span className="disclaimer-icon">⚕</span>
          <div>
            <h2>Care WEDO 不提供醫療診斷</h2>
            <p>
              Care WEDO 是一款<strong>照護資訊整理與提醒工具</strong>，旨在協助家庭成員整理就診行程、用藥紀錄與醫院單據摘要。
              本服務提供的所有資訊，包括 AI 解析結果、用藥摘要、就診提醒，<strong>均不構成醫療診斷、醫療建議或藥師建議</strong>，
              也不能取代專業醫師或藥師的判斷。
            </p>
            <p>如有任何健康疑慮或症狀，請務必諮詢合格醫療人員。緊急情況請撥打 <strong>119</strong> 或前往最近的急診室。</p>
          </div>
        </div>
      </section>

      <section className="landing-section legal-section">
        <h2>1. 服務說明</h2>
        <p>Care WEDO 由 WEDO 團隊提供，透過 <a href="https://line.me/R/ti/p/@249anlux" target="_blank" rel="noopener noreferrer">LINE 照護小管家</a>、Web Dashboard 及 LINE Bot 三個入口，協助家庭管理長輩的就診與用藥資訊。</p>
      </section>

      <section className="landing-section legal-section">
        <h2>2. 使用條件</h2>
        <ul className="legal-list">
          <li>您必須年滿 18 歲，或在監護人同意下使用本服務。</li>
          <li>您須透過 LINE 帳號進行身分驗證，並同意 LINE 的服務條款。</li>
          <li>您不得將本服務用於非法目的，或上傳侵犯他人隱私或版權的內容。</li>
        </ul>
      </section>

      <section className="landing-section legal-section">
        <h2>3. 免費方案與付費方案</h2>
        <ul className="legal-list">
          <li><strong>免費方案</strong>：每月限制 10 次 AI 圖片解析，無家庭群組與長期記憶功能。</li>
          <li><strong>付費方案</strong>：提供完整功能，包含家庭群組、多位照護對象、無限 OCR 解析與健康時間線。</li>
          <li>方案可隨時升級，降級或取消請依當時公告之退款政策辦理。</li>
        </ul>
      </section>

      <section className="landing-section legal-section">
        <h2>4. 資料責任</h2>
        <ul className="legal-list">
          <li>您上傳的資料（醫院單據、照護紀錄）由您自行負責確認其正確性。</li>
          <li>AI OCR 解析結果為自動產生，可能存在誤差，請以原始醫院文件為準。</li>
          <li>Care WEDO 不對因資料遺失、系統中斷或 AI 解析錯誤造成的任何損失負責。</li>
        </ul>
      </section>

      <section className="landing-section legal-section">
        <h2>5. 服務變更與終止</h2>
        <p>我們保留修改、暫停或終止服務的權利，並會提前 30 天通知付費用戶。免費方案用戶在合理時間內可申請匯出或刪除資料。</p>
      </section>

      <section className="landing-section legal-section">
        <h2>6. 準據法</h2>
        <p>本服務條款依據中華民國法律解釋與執行。如有爭議，以台灣台北地方法院為第一審管轄法院。</p>
      </section>

      <section className="landing-section legal-section">
        <h2>7. 聯絡我們</h2>
        <p>如有問題，請聯繫：<a href="mailto:care@wedopr.com">care@wedopr.com</a></p>
      </section>

      <footer className="landing-footer">
        <div className="footer-brand">
          <a href="https://care.wedopr.com/" className="footer-brand-link">Care WEDO</a>
          <span>讓照護資訊更清楚，讓家庭陪伴更安心。</span>
        </div>
        <div className="landing-footer-links">
          <a href="https://line.me/R/ti/p/@249anlux" target="_blank" rel="noopener noreferrer">LINE 照護小管家</a>
          <a href="/privacy">隱私政策</a>
          <a href="mailto:care@wedopr.com">care@wedopr.com</a>
        </div>
        <p className="footer-copyright">© {new Date().getFullYear()} Care WEDO. All rights reserved.</p>
      </footer>
    </main>
  );
}
