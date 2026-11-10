// Fixed sample data from BRIEF.md. Due dates are ISO so they sort and feed DateInput directly.
export const OWNERS = ['Maya Chen', 'Sam Okafor', 'Lina Park', 'Arun Shah', 'Jo Rivera'];
export const STATUSES = ['Active', 'Review', 'Planned', 'Paused'];

export const PROJECTS = [
  {id: 'atlas', name: 'Atlas mobile rollout', owner: 'Maya Chen', status: 'Active', due: '2026-11-18'},
  {id: 'beacon', name: 'Beacon accessibility audit', owner: 'Sam Okafor', status: 'Review', due: '2026-11-20'},
  {id: 'cedar', name: 'Cedar partner portal', owner: 'Lina Park', status: 'Active', due: '2026-11-24'},
  {id: 'delta', name: 'Delta incident playbook', owner: 'Arun Shah', status: 'Planned', due: '2026-11-27'},
  {id: 'ember', name: 'Ember release checklist', owner: 'Jo Rivera', status: 'Review', due: '2026-11-30'},
  {id: 'fjord', name: 'Fjord field-research synthesis and next-quarter recommendations', owner: 'Maya Chen', status: 'Planned', due: '2026-12-04'},
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Formats without Date parsing so the day never shifts with the viewer's time zone.
export function formatDue(iso, withYear = true) {
  const [year, month, day] = iso.split('-');
  return `${day} ${MONTHS[Number(month) - 1]}${withYear ? ` ${year}` : ''}`;
}
