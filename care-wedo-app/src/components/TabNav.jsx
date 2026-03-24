export default function TabNav({ tabs, activeTab, onChange }) {
  return (
    <div style={{
      display: "flex",
      padding: "16px 20px 0",
      gap: 8,
    }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            flex: 1,
            padding: "10px 4px",
            borderRadius: 10,
            border: "none",
            background: activeTab === tab.id
              ? "var(--primary-gradient)"
              : "rgba(255,255,255,0.07)",
            color: activeTab === tab.id ? "#fff" : "var(--text-muted)",
            fontSize: 11,
            fontWeight: activeTab === tab.id ? 700 : 400,
            cursor: "pointer",
            transition: "all 0.2s",
            letterSpacing: 0.5,
          }}
        >{tab.label}</button>
      ))}
    </div>
  );
}
