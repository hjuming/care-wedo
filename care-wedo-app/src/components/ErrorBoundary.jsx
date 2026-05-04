import { Component } from "react";

/**
 * 全域錯誤邊界 — 防止 React render 錯誤導致整個頁面白屏。
 * 顯示友善的錯誤訊息，讓使用者可以重新整理。
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[Care WEDO] Render Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily: "'Noto Sans TC', -apple-system, BlinkMacSystemFont, sans-serif",
          color: "#263128",
          background: "linear-gradient(180deg, rgba(255,250,242,0.88), rgba(247,241,232,0.94)), #f7f1e8",
          textAlign: "center",
          padding: "20px",
        }}>
          <div style={{
            maxWidth: "520px",
            background: "rgba(255,250,242,0.92)",
            border: "1px solid #e2d8c8",
            borderRadius: "24px",
            padding: "40px 32px",
            boxShadow: "0 18px 50px rgba(72,55,33,0.12)",
          }}>
            <h1 style={{ fontSize: "28px", marginBottom: "12px" }}>
              頁面暫時無法顯示
            </h1>
            <p style={{ color: "#667066", fontSize: "17px", lineHeight: "1.7", marginBottom: "24px" }}>
              系統遇到了意外狀況。請重新整理頁面，如果問題持續請聯繫我們。
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#256f5b",
                color: "white",
                border: "none",
                borderRadius: "12px",
                padding: "14px 28px",
                fontSize: "17px",
                fontWeight: "700",
                cursor: "pointer",
                minHeight: "52px",
              }}
            >
              重新整理頁面
            </button>
            {import.meta.env.DEV && this.state.error && (
              <pre style={{
                marginTop: "20px",
                textAlign: "left",
                fontSize: "13px",
                color: "#bd4a3a",
                background: "#fff0ed",
                padding: "12px",
                borderRadius: "8px",
                overflow: "auto",
                maxHeight: "200px",
              }}>
                {String(this.state.error)}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
