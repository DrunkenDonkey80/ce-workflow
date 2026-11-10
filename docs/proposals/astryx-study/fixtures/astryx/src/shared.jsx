import {Avatar} from '@astryxdesign/core/Avatar';
import {Badge} from '@astryxdesign/core/Badge';

const STATUS_BADGE = {Active: 'green', Review: 'yellow', Planned: 'neutral', Paused: 'blue'};

// Shape repeats the status meaning so it never relies on color alone: full, half, empty, pause bars.
export function StatusShape({status}) {
  return (
    <svg className="status-shape" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {status === 'Active' && <circle cx="6" cy="6" r="4.75" fill="currentColor" />}
      {status === 'Review' && <path d="M6 1.25a4.75 4.75 0 0 1 0 9.5z" fill="currentColor" />}
      {status === 'Paused' && <path d="M4.75 3.75v4.5M7.25 3.75v4.5" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}

export function StatusBadge({status, dataId}) {
  return (
    <span className="status-badge" data-id={dataId}>
      <Badge variant={STATUS_BADGE[status]} label={status} icon={<StatusShape status={status} />} />
    </span>
  );
}

function RelayMark() {
  // Two offset strokes meeting in the middle: a baton handed between runners.
  return (
    <svg className="brand-mark" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
      <path d="M4 18h10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M14 10h10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M14 18V10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function AppHeader({page, workspace}) {
  return (
    <header className="app-header" data-id="app-header">
      <div className="app-header-inner">
        <a className="brand" href="index.html" data-id="brand-link">
          <RelayMark />
          <span className="brand-text">
            <span className="brand-name" data-id="workspace-label">{workspace}</span>
            <span className="brand-team" data-id="team-label">Field operations</span>
          </span>
        </a>
        <nav className="app-nav" aria-label="Main" data-id="main-nav">
          <a href="index.html" data-id="nav-projects" aria-current={page === 'projects' ? 'page' : undefined}>
            Projects
          </a>
          <a href="settings.html" data-id="nav-settings" aria-current={page === 'settings' ? 'page' : undefined}>
            Settings
          </a>
        </nav>
        <span className="signed-in" data-id="signed-in-user">
          <Avatar name="Maya Chen" size="sm" tooltip={false} />
          <span className="visually-hidden">Signed in as Maya Chen</span>
        </span>
      </div>
    </header>
  );
}
