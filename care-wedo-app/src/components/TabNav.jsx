export default function TabNav({ tabs, activeTab, onChange }) {
  return (
    <div className="tab-nav">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={activeTab === tab.id ? "active" : ""}
        >{tab.label}</button>
      ))}
    </div>
  );
}
