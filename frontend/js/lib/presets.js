// Work-item list filters: quick presets, URL <-> params, and the API query they produce.

/** "Open" work: everything that still needs attention (matches the dashboard counters). */
export const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'];

/** Quick filter chips. Each is expressed as API query parameters. */
export const PRESETS = [
  { key: 'all', label: 'All', params: {}, countKey: 'total', tone: 'dark' },
  { key: 'mine', label: 'My Work', params: { assignee: 'me', status: OPEN_STATUSES.join(',') }, countKey: 'myWork' },
  { key: 'unassigned', label: 'Unassigned', params: { assignee: 'unassigned', status: OPEN_STATUSES.join(',') }, countKey: 'unassigned' },
  { key: 'critical', label: 'High / Critical', params: { priority: 'CRITICAL,HIGH', status: OPEN_STATUSES.join(',') }, countKey: 'highCritical', tone: 'danger' },
  { key: 'blocked', label: 'Blocked', params: { status: 'BLOCKED' }, countKey: 'blocked' },
];

export const SORTS = [
  { key: 'updated', label: 'Updated (Most Recent)', sortBy: 'updatedAt', sortOrder: 'desc' },
  { key: 'created', label: 'Created (Newest)', sortBy: 'createdAt', sortOrder: 'desc' },
  { key: 'oldest', label: 'Created (Oldest)', sortBy: 'createdAt', sortOrder: 'asc' },
  { key: 'priority', label: 'Priority (Highest)', sortBy: 'priority', sortOrder: 'desc' },
  { key: 'priority-asc', label: 'Priority (Lowest)', sortBy: 'priority', sortOrder: 'asc' },
];

export const PAGE_SIZES = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

const FILTER_KEYS = ['teamId', 'type', 'status', 'priority', 'assignee'];

/**
 * Turn the UI state into API query parameters.
 *
 * A preset contributes its filters first; an explicit dropdown choice for the same
 * field overrides it. Empty values are dropped.
 */
export function buildApiQuery(state) {
  const preset = PRESETS.find((p) => p.key === state.preset) ?? PRESETS[0];
  const query = { ...preset.params };

  for (const key of FILTER_KEYS) {
    if (state[key]) query[key] = state[key];
  }
  const search = (state.search ?? '').trim();
  if (search) query.search = search;

  const sort = SORTS.find((s) => s.key === state.sort) ?? SORTS[0];
  query.sortBy = sort.sortBy;
  query.sortOrder = sort.sortOrder;

  query.page = Math.max(1, Number(state.page) || 1);
  query.pageSize = PAGE_SIZES.includes(Number(state.pageSize)) ? Number(state.pageSize) : DEFAULT_PAGE_SIZE;
  return query;
}

/** Parse "?a=1&b=2" (from the location hash) into a plain object. */
export function parseQueryString(queryString) {
  const out = {};
  const params = new URLSearchParams(queryString.startsWith('?') ? queryString.slice(1) : queryString);
  for (const [key, value] of params) out[key] = value;
  return out;
}

/** Serialize UI state to "?a=1&b=2", leaving out empty values and defaults. */
export function toQueryString(state) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'page' && Number(value) === 1) continue;
    if (key === 'pageSize' && Number(value) === DEFAULT_PAGE_SIZE) continue;
    if (key === 'preset' && value === 'all') continue;
    if (key === 'sort' && value === 'updated') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Visible page numbers with gaps, e.g. [1, 2, 3, '…', 9] */
export function pageWindow(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…');
    out.push(sorted[i]);
  }
  return out;
}
