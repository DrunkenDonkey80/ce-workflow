import {useMemo, useRef, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Banner} from '@astryxdesign/core/Banner';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Search} from 'lucide-react';
import {PROJECTS, STATUSES, formatDue} from './data.js';
import {AppHeader, StatusBadge, StatusShape} from './shared.jsx';
import {EditProjectDialog} from './EditProjectDialog.jsx';

const LIST_STATES = ['Populated', 'Loading', 'Empty', 'Error'];

const OVERVIEW_NOTES = {
  Loading: 'Counting projects…',
  Empty: 'Nothing to summarise until the team has projects.',
  Error: 'The summary needs the project list. Retry below to load it.',
};

function Overview({projects, listState, onShowReview}) {
  if (listState !== 'Populated') {
    return (
      <section className="overview overview-unavailable" aria-labelledby="overview-heading" data-id="overview">
        <h2 id="overview-heading" className="visually-hidden" data-id="overview-heading">Overview</h2>
        <p className="overview-note" data-id="overview-note">{OVERVIEW_NOTES[listState]}</p>
      </section>
    );
  }
  const byDue = [...projects].sort((a, b) => a.due.localeCompare(b.due));
  const next = byDue[0];
  const inReview = projects.filter(p => p.status === 'Review');
  return (
    <section className="overview" aria-labelledby="overview-heading" data-id="overview">
      <h2 id="overview-heading" className="visually-hidden" data-id="overview-heading">Overview</h2>
      <div className="overview-grid">
        <div className="next-due" data-id="next-due">
          <p className="overview-label">Due first</p>
          <p className="next-due-date" data-id="next-due-date">{formatDue(next.due, false)}</p>
          <p className="next-due-name" data-id="next-due-name">{next.name}</p>
          <p className="overview-meta">{next.owner}, {next.status.toLowerCase()}</p>
        </div>
        <div className="review-queue" data-id="review-queue">
          <p className="overview-label">Waiting for review</p>
          <p className="review-count" data-id="review-count">
            {inReview.length} {inReview.length === 1 ? 'project' : 'projects'}
          </p>
          <p className="overview-meta">{inReview.map(p => p.name).join(', ') || 'Nothing is waiting.'}</p>
          {inReview.length > 0 && (
            <Button label="Show review queue" variant="secondary" onClick={onShowReview} data-id="show-review-queue" />
          )}
        </div>
        <dl className="status-counts" data-id="status-counts">
          {STATUSES.map(status => (
            <div key={status} className="status-count" data-id={`count-${status.toLowerCase()}`} data-status={status}>
              <dt><StatusShape status={status} /> {status}</dt>
              <dd>{projects.filter(p => p.status === status).length}</dd>
            </div>
          ))}
          <div className="status-count status-count-total" data-id="count-total">
            <dt>Total</dt>
            <dd>{projects.length}</dd>
          </div>
        </dl>
      </div>
      <ol className="relay-rail" aria-label="Due dates in order" data-id="relay-rail">
        {byDue.map(p => (
          <li key={p.id} className={p === next ? 'is-next' : undefined} data-id={`rail-${p.id}`} data-status={p.status}>
            <span className="rail-stop" aria-hidden="true"><StatusShape status={p.status} /></span>
            <span className="rail-date">{formatDue(p.due, false)}</span>
            <span className="rail-name">{p.name.split(' ')[0]}</span>
            <span className="visually-hidden">{p.name}, {p.status}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ProjectRow({project, onEdit, isJustSaved}) {
  return (
    <li className={`project-row${isJustSaved ? ' is-just-saved' : ''}`} data-id={`project-${project.id}`}>
      <h3 className="project-name" data-id={`project-${project.id}-name`}>{project.name}</h3>
      <div className="project-meta">
        <p className="project-owner" data-id={`project-${project.id}-owner`}>
          <span className="row-label">Owner </span>{project.owner}
        </p>
        <div className="project-status">
          <span className="visually-hidden">Status </span>
          <StatusBadge status={project.status} dataId={`project-${project.id}-status`} />
        </div>
        <p className="project-due" data-id={`project-${project.id}-due`}>
          <span className="row-label">Due </span><time dateTime={project.due}>{formatDue(project.due)}</time>
        </p>
      </div>
      <div className="project-action">
        <Button
          label="Edit"
          aria-label={`Edit ${project.name}`}
          variant="secondary"
          onClick={e => onEdit(project, e.currentTarget)}
          data-id={`edit-${project.id}`}
        />
      </div>
    </li>
  );
}

function ListLoading() {
  return (
    <div className="list-state list-loading" data-id="list-loading" aria-busy="true">
      <p className="loading-line" role="status">
        <Spinner size="sm" aria-label="Loading projects" /> Loading Field operations projects…
      </p>
      {[0, 1, 2].map(i => (
        <div key={i} className="skeleton-row" aria-hidden="true">
          <Skeleton width="55%" height={18} index={i} />
          <Skeleton width="30%" height={14} index={i} />
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const [projects, setProjects] = useState(PROJECTS);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [listState, setListState] = useState('Populated');
  const [editing, setEditing] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter(
      p =>
        (statusFilter === 'All' || p.status === statusFilter) &&
        (p.name.toLowerCase().includes(q) || p.owner.toLowerCase().includes(q)),
    );
  }, [projects, query, statusFilter]);

  const clearFilters = () => {
    setQuery('');
    setStatusFilter('All');
    searchRef.current?.focus();
  };

  const showReview = () => {
    setStatusFilter('Review');
    setQuery('');
    listRef.current?.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  };

  const saveProject = updated => {
    setProjects(list => list.map(p => (p.id === updated.id ? updated : p)));
    setSavedId(updated.id);
    setAnnouncement(`Saved changes to ${updated.name}.`);
  };

  const isPopulated = listState === 'Populated';
  const filterSummary = [query.trim() && `“${query.trim()}”`, statusFilter !== 'All' && statusFilter.toLowerCase()]
    .filter(Boolean)
    .join(' in ');

  let listBody;
  if (listState === 'Loading') {
    listBody = <ListLoading />;
  } else if (listState === 'Empty') {
    listBody = (
      <div className="list-state" data-id="list-empty">
        <EmptyState
          title="No projects in Field operations yet"
          description="Projects assigned to this team show up here as soon as they are created."
          headingLevel={3}
          actions={<Button label="Check again" variant="primary" onClick={() => setListState('Populated')} data-id="empty-check-again" />}
        />
      </div>
    );
  } else if (listState === 'Error') {
    listBody = (
      <div className="list-state" data-id="list-error" role="alert">
        <Banner
          status="error"
          title="Projects didn’t load"
          description="Relay couldn’t reach the project list, so nothing is shown. Your search and filter are kept. Retry to load the list again."
          endContent={<Button label="Retry" variant="secondary" onClick={() => setListState('Populated')} data-id="error-retry" />}
        />
      </div>
    );
  } else if (visible.length === 0) {
    listBody = (
      <div className="list-state" data-id="list-no-results">
        <EmptyState
          title="No matching projects"
          description={`Nothing matches ${filterSummary}. Clear the search and filter to see all ${projects.length} projects.`}
          headingLevel={3}
          actions={<Button label="Clear search and filter" variant="primary" onClick={clearFilters} data-id="clear-filters" />}
        />
      </div>
    );
  } else {
    listBody = (
      <ul className="project-rows" data-id="project-rows">
        {visible.map(p => (
          <ProjectRow
            key={p.id}
            project={p}
            isJustSaved={savedId === p.id}
            onEdit={(project, opener) => setEditing({project, opener})}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="page">
      <a className="skip-link" href="#main" data-id="skip-link">Skip to projects</a>
      <AppHeader page="projects" workspace="Relay" />
      <main id="main" className="page-main" data-id="main">
        <div className="page-title" data-id="page-title">
          <h1 data-id="page-heading">Field operations</h1>
          <p data-id="page-summary">Delivery work for the team, ordered by what is due first.</p>
        </div>

        <Overview projects={projects} listState={listState} onShowReview={showReview} />

        <section className="projects" aria-labelledby="projects-heading" data-id="projects-section" ref={listRef}>
          <div className="projects-head">
            <h2 id="projects-heading" data-id="projects-heading">Projects</h2>
            <p className="result-count" role="status" data-id="result-count">
              {isPopulated ? `Showing ${visible.length} of ${projects.length}` : ''}
              {isPopulated && announcement ? <span className="saved-note"> {announcement}</span> : null}
            </p>
          </div>
          <div className="toolbar" data-id="project-toolbar">
            <div className="toolbar-search">
              <TextInput
                type="search"
                label="Search by project or owner"
                value={query}
                onChange={setQuery}
                startIcon={Search}
                hasClear
                placeholder="Atlas, Lina Park, audit…"
                enterKeyHint="search"
                ref={searchRef}
                data-id="project-search"
              />
            </div>
            <div className="toolbar-filter" data-id="status-filter" role="group" aria-labelledby="status-filter-label">
              <span id="status-filter-label" className="field-label">Status</span>
              <SegmentedControl label="Filter by status" value={statusFilter} onChange={setStatusFilter} layout="fill">
                {['All', ...STATUSES].map(s => (
                  <SegmentedControlItem key={s} value={s} label={s} data-id={`status-filter-${s.toLowerCase()}`} />
                ))}
              </SegmentedControl>
            </div>
            <div className="toolbar-reset">
              <Button label="Reset filters" variant="ghost" onClick={clearFilters} data-id="reset-filters" />
            </div>
          </div>

          <div className="list-head" aria-hidden="true">
            <span>Project</span><span>Owner</span><span>Status</span><span>Due</span><span />
          </div>
          <div className="project-list" data-id="project-list" data-state={listState.toLowerCase()} aria-busy={listState === 'Loading'}>
            {listBody}
          </div>
        </section>

        <aside className="state-switcher" data-design-chrome data-id="state-switcher" aria-label="Prototype controls">
          <p className="state-switcher-label">Prototype only: project list state</p>
          <SegmentedControl label="Project list state" value={listState} onChange={setListState} size="sm">
            {LIST_STATES.map(s => (
              <SegmentedControlItem key={s} value={s} label={s} data-id={`state-${s.toLowerCase()}`} />
            ))}
          </SegmentedControl>
        </aside>
      </main>

      <EditProjectDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={project => {
          saveProject(project);
          setEditing(null);
        }}
      />
    </div>
  );
}
