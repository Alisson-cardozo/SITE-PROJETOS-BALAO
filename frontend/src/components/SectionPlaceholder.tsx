import type { NavItem } from '../config/userNavigation';

export function SectionPlaceholder({ item, note }: { item: NavItem; note?: string }) {
  const Icon = item.icon;

  return (
    <div className="section-placeholder">
      <div className="section-placeholder-icon">
        <Icon size={26} />
      </div>
      <h2>{item.label}</h2>
      <p>{item.description}</p>
      {note ? <p className="section-placeholder-note">{note}</p> : null}
      <span className="section-placeholder-tag">Modulo em construcao</span>
    </div>
  );
}
