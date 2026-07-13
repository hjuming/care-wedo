export default function MobileBottomNav({ sections, activeSection, onChange }) {
  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="Care WEDO 手機底部導覽"
      style={{ "--mobile-nav-count": Math.max(1, Math.min(sections.length, 5)) }}
    >
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          className={activeSection === section.id ? "active" : ""}
          onClick={() => onChange(section.id)}
          aria-current={activeSection === section.id ? "page" : undefined}
        >
          <span aria-hidden="true">{section.icon}</span>
          <strong>{section.mobileLabel || section.label}</strong>
        </button>
      ))}
    </nav>
  );
}
