import { useSync } from '../app/sync';
import { Icon, type IconName } from './Icon';

export type Tab = 'tree' | 'sources' | 'people' | 'settings';

const ITEMS: { tab: Tab; label: string; icon: IconName }[] = [
  { tab: 'tree', label: 'Tree', icon: 'tree' },
  { tab: 'sources', label: 'Sources', icon: 'link' },
  { tab: 'people', label: 'People', icon: 'people' },
  { tab: 'settings', label: 'Settings', icon: 'gear' },
];

export function Sidebar({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const sync = useSync();
  const synced = sync.status === 'idle' || sync.status === 'saving';
  const attention = sync.status === 'conflict' || sync.status === 'choose' || sync.status === 'error';
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <svg viewBox="0 0 64 64" width="34" height="34" aria-hidden="true">
          <path d="M32 56 V32" stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M32 40 C22 38 16 32 14 24 M32 32 C42 30 48 24 50 16" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" fill="none" />
          <circle cx="32" cy="20" r="12" fill="currentColor" />
          <circle cx="15" cy="23" r="7" fill="#6aa56f" />
          <circle cx="50" cy="17" r="6" fill="#6aa56f" />
          <circle cx="38" cy="16" r="3.5" fill="#e8792b" />
          <circle cx="26" cy="24" r="3" fill="#e8792b" />
        </svg>
        <span>
          Árbol <small>MASACOVA</small>
        </span>
      </div>
      <ul className="nav-list">
        {ITEMS.map((item) => (
          <li key={item.tab}>
            <button type="button" className={`nav-btn${tab === item.tab ? ' is-active' : ''}`} aria-current={tab === item.tab ? 'page' : undefined} onClick={() => onTab(item.tab)}>
              <Icon name={item.icon} size={22} />
              <span>{item.label}</span>
              {item.tab === 'settings' && attention && <span className="dot" aria-label="needs attention" />}
            </button>
          </li>
        ))}
      </ul>
      <div className="side-foot">
        <span className={`pill${synced ? ' pill-on' : attention ? ' pill-warn' : ''}`}>
          <Icon name={synced ? 'cloud' : 'lock'} size={15} />
          {synced ? (sync.status === 'saving' ? 'Saving…' : 'Synced privately') : attention ? 'Check Settings' : 'This device only'}
        </span>
      </div>
    </nav>
  );
}
