// Operational Work Items: search, quick filters, filter dropdowns, sorting, pagination.

import { api } from '../api.js';
import { esc, excerpt, relativeTime } from '../lib/format.js';
import { PAGE_SIZES, PRESETS, SORTS, buildApiQuery, pageWindow, toQueryString } from '../lib/presets.js';
import { nameOf, state, teamName } from '../store.js';
import { emptyState, errorState, skeletonRows } from '../states.js';
import { PRIORITIES, STATUSES, TYPES, icon, personChip, priorityBadge, primaryButton, statusBadge, typeBadge, typeIcon } from '../ui.js';

const FILTERS = [
  { key: 'teamId', label: 'Team', all: 'All Teams' },
  { key: 'type', label: 'Type', all: 'All Types' },
  { key: 'status', label: 'Status', all: 'All Statuses' },
  { key: 'priority', label: 'Priority', all: 'Any' },
  { key: 'assignee', label: 'Owner', all: 'Anyone' },
];

function filterOptions(key) {
  switch (key) {
    case 'teamId':
      return state.teams.map((t) => [t.id, t.name]);
    case 'type':
      return Object.entries(TYPES).map(([value, t]) => [value, t.label]);
    case 'status':
      return Object.entries(STATUSES).map(([value, s]) => [value, s.label]);
    case 'priority':
      return Object.entries(PRIORITIES).reverse().map(([value, p]) => [value, `${p.short} · ${p.label}`]);
    case 'assignee':
      return [
        ['me', 'Me'],
        ['unassigned', 'Unassigned'],
        ...[...state.directory.entries()].map(([id, person]) => [id, person.name]).sort((a, b) => a[1].localeCompare(b[1])),
      ];
    default:
      return [];
  }
}

const selectClasses =
  'w-full h-8 pl-3 pr-7 rounded bg-surface-container-low text-[11px] font-medium text-on-surface appearance-none focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer';

/**
 * @param container  element to render into
 * @param ctx        { query: object from the URL hash, onNewItem(teamId) }
 */
export function mountWorkItems(container, { query = {}, onNewItem } = {}) {
  const s = {
    preset: PRESETS.some((p) => p.key === query.preset) ? query.preset : 'all',
    search: query.search ?? '',
    teamId: query.teamId ?? '',
    type: query.type ?? '',
    status: query.status ?? '',
    priority: query.priority ?? '',
    assignee: query.assignee ?? '',
    sort: SORTS.some((o) => o.key === query.sort) ? query.sort : 'updated',
    page: Number(query.page) || 1,
    pageSize: PAGE_SIZES.includes(Number(query.pageSize)) ? Number(query.pageSize) : 25,
  };
  let counts = null;
  let requestId = 0;
  let disposed = false;
  let searchTimer = null;
  let lastSynced = null;
  let clockTimer = null;

  container.innerHTML = `
    <div class="px-4 sm:px-8 py-7 space-y-6">
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[11px] font-mono uppercase tracking-widest text-primary font-bold">Triage Queue &amp; Catalog</span>
            <span class="text-secondary">•</span>
            <span id="wi-synced" class="text-[11px] text-secondary font-mono"></span>
          </div>
          <h1 class="text-3xl lg:text-4xl font-headline font-semibold tracking-tight leading-none">Operational Work Items</h1>
        </div>
        <button type="button" data-action="new-item" class="${primaryButton} h-10 px-4 self-start md:self-auto">${icon('add', 'text-[16px]')}Create Work Item</button>
      </div>

      <div class="bg-surface-container-lowest rounded-xl p-5 shadow-[0_2px_16px_rgba(58,48,42,0.04)] space-y-4">
        <div class="flex flex-col md:flex-row md:items-center gap-3">
          <label class="relative flex-1 flex items-center">
            <span class="absolute left-3 text-secondary">${icon('search', 'text-[18px]')}</span>
            <input id="wi-search" type="search" value="${esc(s.search)}" class="w-full h-10 pl-10 pr-3 rounded-lg bg-surface-container-low text-sm placeholder:text-secondary focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Filter by title, ID or description…" aria-label="Search work items" />
          </label>
          <label class="flex items-center gap-2 text-xs text-on-surface-variant">Sort:
            <select id="wi-sort" class="h-10 px-3 rounded-lg bg-surface-container-low text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary">
              ${SORTS.map((o) => `<option value="${o.key}"${o.key === s.sort ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div id="wi-chips" class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs whitespace-nowrap"></div>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 pt-1" id="wi-filters"></div>
      </div>

      <div class="bg-surface-container-lowest rounded-xl shadow-[0_2px_16px_rgba(58,48,42,0.04)] overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm text-left">
            <thead>
              <tr class="bg-surface-container-low text-[10px] font-mono uppercase tracking-widest text-secondary">
                <th class="py-3 px-4 font-bold">ID</th>
                <th class="py-3 px-4 font-bold">Title &amp; Context</th>
                <th class="py-3 px-3 font-bold">Type</th>
                <th class="py-3 px-3 font-bold">Status</th>
                <th class="py-3 px-3 font-bold">Priority</th>
                <th class="py-3 px-3 font-bold">Team</th>
                <th class="py-3 px-4 font-bold">Owner</th>
                <th class="py-3 px-3 font-bold">Updated</th>
              </tr>
            </thead>
            <tbody id="wi-rows"></tbody>
          </table>
        </div>
        <div id="wi-message"></div>
        <div id="wi-footer" class="hidden flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-4 text-xs text-on-surface-variant"></div>
      </div>
    </div>`;

  const $ = (selector) => container.querySelector(selector);

  function syncUrl() {
    history.replaceState(null, '', `#/work-items${toQueryString(s)}`);
  }

  function renderChips() {
    $('#wi-chips').innerHTML = PRESETS.map((p) => {
      const active = s.preset === p.key;
      const count = counts ? ` (${counts[p.countKey]})` : '';
      const tone = active
        ? 'bg-on-surface text-surface font-semibold'
        : p.tone === 'danger'
          ? 'bg-error-container hover:bg-tertiary-fixed text-on-error-container font-medium'
          : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-medium';
      return `<button type="button" data-preset="${p.key}" aria-pressed="${active}" class="px-3 py-1.5 rounded-full transition-all ${tone}">${esc(p.label)}${count}</button>`;
    }).join('');
  }

  function renderFilters() {
    $('#wi-filters').innerHTML = FILTERS.map((f) => {
      const options = filterOptions(f.key)
        .map(([value, label]) => `<option value="${esc(value)}"${s[f.key] === value ? ' selected' : ''}>${esc(label)}</option>`)
        .join('');
      return `
        <div class="relative">
          <select data-filter="${f.key}" aria-label="${esc(f.label)}" class="${selectClasses}">
            <option value="">${esc(f.label)}: ${esc(f.all)}</option>${options}
          </select>
          <span class="absolute right-2 top-1/2 -translate-y-1/2 text-secondary pointer-events-none">${icon('expand_more', 'text-[14px]')}</span>
        </div>`;
    }).join('');
  }

  const activeFilterText = () => {
    const parts = [];
    if (s.search.trim()) parts.push(`search:"${s.search.trim()}"`);
    if (s.preset !== 'all') parts.push(`view:${PRESETS.find((p) => p.key === s.preset).label}`);
    for (const f of FILTERS) if (s[f.key]) parts.push(`${f.key}:${s[f.key]}`);
    return parts.join(' ');
  };
  const hasActiveFilters = () => activeFilterText() !== '';

  function row(item) {
    const href = `#/work-items/${esc(item.id)}`;
    return `
      <tr class="hover:bg-surface-container-low transition-colors group cursor-pointer border-t border-outline-variant/30" data-href="${href}">
        <td class="py-3.5 px-4 whitespace-nowrap"><a class="font-mono font-bold text-primary hover:underline" href="${href}">${esc(item.key)}</a></td>
        <td class="py-3.5 px-4 max-w-md">
          <div class="flex items-start gap-2.5">
            <span class="mt-0.5">${typeIcon(item.type)}</span>
            <div class="min-w-0">
              <p class="font-semibold group-hover:text-primary transition-colors truncate ${item.status === 'CLOSED' ? 'line-through text-secondary' : ''}">${esc(item.title)}</p>
              <p class="text-[11px] text-secondary truncate mt-0.5">${esc(excerpt(item.description, 90)) || '&nbsp;'}</p>
            </div>
          </div>
        </td>
        <td class="py-3.5 px-3 whitespace-nowrap">${typeBadge(item.type)}</td>
        <td class="py-3.5 px-3 whitespace-nowrap">${statusBadge(item.status)}</td>
        <td class="py-3.5 px-3 whitespace-nowrap">${priorityBadge(item.priority)}</td>
        <td class="py-3.5 px-3 whitespace-nowrap text-secondary font-medium text-xs">${esc(teamName(item.teamId))}</td>
        <td class="py-3.5 px-4 whitespace-nowrap">${personChip(item.assigneeId ? nameOf(item.assigneeId) : null)}</td>
        <td class="py-3.5 px-3 whitespace-nowrap text-secondary text-[11px] font-mono">${esc(relativeTime(item.updatedAt))}</td>
      </tr>`;
  }

  function renderFooter(meta, shown) {
    const footer = $('#wi-footer');
    if (!meta || meta.totalCount === 0) {
      footer.classList.add('hidden');
      return;
    }
    footer.classList.remove('hidden');
    const first = (meta.page - 1) * meta.pageSize + 1;
    const pages = pageWindow(meta.page, meta.totalPages)
      .map((p) =>
        p === '…'
          ? '<span class="px-1 text-secondary">…</span>'
          : `<button type="button" data-page="${p}" aria-label="Page ${p}" ${p === meta.page ? 'aria-current="page"' : ''} class="w-8 h-8 rounded ${p === meta.page ? 'bg-primary text-on-primary font-bold' : 'bg-surface-container hover:bg-surface-container-high'}">${p}</button>`,
      )
      .join('');
    footer.innerHTML = `
      <div class="flex items-center gap-4">
        <span>Showing <strong>${first}-${first + shown - 1}</strong> of <strong>${meta.totalCount}</strong> items</span>
        <label class="flex items-center gap-2">Rows:
          <select id="wi-page-size" class="h-8 px-2 rounded bg-surface-container-low text-xs">
            ${PAGE_SIZES.map((n) => `<option value="${n}"${n === s.pageSize ? ' selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
      </div>
      <nav class="flex items-center gap-1" aria-label="Pagination">
        <button type="button" data-page="${meta.page - 1}" ${meta.hasPrev ? '' : 'disabled'} class="px-3 h-8 rounded bg-surface-container hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
        ${pages}
        <button type="button" data-page="${meta.page + 1}" ${meta.hasNext ? '' : 'disabled'} class="px-3 h-8 rounded bg-surface-container hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
      </nav>`;
  }

  async function loadCounts() {
    try {
      counts = (await api('GET', '/dashboard')).data.counts;
      if (!disposed) renderChips();
    } catch {
      /* chips simply show no counts */
    }
  }

  async function loadResults() {
    const mine = ++requestId;
    const rows = $('#wi-rows');
    const message = $('#wi-message');
    message.innerHTML = '';
    rows.innerHTML = skeletonRows(Math.min(s.pageSize, 8), 8);
    $('#wi-footer').classList.add('hidden');

    try {
      const { data, meta } = await api('GET', '/work-items', { query: buildApiQuery(s) });
      if (disposed || mine !== requestId) return; // a newer request superseded this one

      // asked for a page beyond the end (e.g. after filtering): go to the last one
      if (data.length === 0 && meta.totalCount > 0 && meta.page > meta.totalPages) {
        s.page = meta.totalPages;
        syncUrl();
        return loadResults();
      }

      lastSynced = Date.now();
      updateSynced();
      if (data.length === 0) {
        rows.innerHTML = '';
        message.innerHTML = hasActiveFilters()
          ? emptyState({ message: 'No matching tickets found for the current filters.', hint: activeFilterText(), clearable: true })
          : emptyState({ title: 'No work items yet', message: 'Create the first work item to get your team started.' });
        renderFooter(null, 0);
        return;
      }
      rows.innerHTML = data.map(row).join('');
      renderFooter(meta, data.length);
    } catch (error) {
      if (disposed || mine !== requestId) return;
      rows.innerHTML = '';
      message.innerHTML = `<div class="p-8">${errorState(error, { backHref: '#/dashboard', backLabel: 'Back to Dashboard' })}</div>`;
    }
  }

  function updateSynced() {
    const el = $('#wi-synced');
    if (el && lastSynced) el.textContent = `Synced ${relativeTime(new Date(lastSynced).toISOString())}`;
  }

  function refresh({ resetPage = true } = {}) {
    if (resetPage) s.page = 1;
    syncUrl();
    renderChips();
    loadResults();
  }

  // ---- events ----
  container.addEventListener('click', (event) => {
    const preset = event.target.closest('[data-preset]');
    if (preset) {
      s.preset = preset.dataset.preset;
      // a quick filter replaces the individual status/priority/owner choices
      s.status = s.priority = s.assignee = '';
      renderFilters();
      return refresh();
    }
    const page = event.target.closest('[data-page]');
    if (page && !page.disabled) {
      s.page = Number(page.dataset.page);
      refresh({ resetPage: false });
      container.scrollIntoView?.({ block: 'start' });
      return;
    }
    if (event.target.closest('[data-action="new-item"]')) return onNewItem?.(s.teamId || undefined);
    if (event.target.closest('[data-action="retry"]')) return loadResults();
    if (event.target.closest('[data-action="clear-filters"]')) {
      Object.assign(s, { preset: 'all', search: '', teamId: '', type: '', status: '', priority: '', assignee: '' });
      $('#wi-search').value = '';
      renderFilters();
      return refresh();
    }
    const tr = event.target.closest('tr[data-href]');
    if (tr && !event.target.closest('a')) location.hash = tr.dataset.href;
  });

  container.addEventListener('change', (event) => {
    const filter = event.target.closest('[data-filter]');
    if (filter) {
      s[filter.dataset.filter] = filter.value;
      return refresh();
    }
    if (event.target.id === 'wi-sort') {
      s.sort = event.target.value;
      return refresh();
    }
    if (event.target.id === 'wi-page-size') {
      s.pageSize = Number(event.target.value);
      return refresh();
    }
  });

  $('#wi-search').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      s.search = event.target.value;
      refresh();
    }, 300);
  });

  renderChips();
  renderFilters();
  syncUrl();
  loadCounts();
  loadResults();
  clockTimer = setInterval(updateSynced, 10000);

  return () => {
    disposed = true;
    clearTimeout(searchTimer);
    clearInterval(clockTimer);
  };
}
