import heroBg from '../assets/hero-bg.png';

export default function Header({ date }) {
  return (
    <div style={{
      background: "var(--header-gradient)",
      padding: "20px 20px 16px",
      borderBottom: "1px solid rgba(255,255,255,0.07)",
      position: "sticky",
      top: 0,
      zIndex: 100,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <img 
          src={heroBg} 
          alt="Care WEDO Hero" 
          style={{ height: 48, objectFit: "contain", borderRadius: 8 }} 
        />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>就診日期</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--primary)" }}>{date}</div>
        </div>
      </div>
      {/* PatientCard 將被放在外部傳入 children 或直接在 App 組合 */}
    </div>
  );
}
