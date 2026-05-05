import heroBg from '../assets/hero-bg.png';

export default function Header({ date }) {
  return (
    <header className="app-header">
      <div className="app-header-main">
        <img
          src={heroBg}
          alt="Care WEDO Hero"
          className="app-header-image"
        />
        <div className="app-date-pill">
          <span>就診日期</span>
          <strong>{date}</strong>
        </div>
      </div>
      {/* PatientCard 將被放在外部傳入 children 或直接在 App 組合 */}
    </header>
  );
}
