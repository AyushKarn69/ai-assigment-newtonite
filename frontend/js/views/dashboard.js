// Operational Command: counters, urgent work, my work, team load, recent activity.

import { api } from '../api.js';
import { describeActivity } from '../lib/activity.js';
import { esc, relativeTime } from '../lib/format.js';
import { OPEN_STATUSES } from '../lib/presets.js';
import { nameOf, teamName } from '../store.js';
import { errorState, skeletonBlock } from '../states.js';
import { avatar, icon, priorityBadge, statusBadge } from '../ui.js';

const REFRESH_MS = 30000;

export function mountDashboard(container) {
  let timer = null;
  let syncedAt = null;
  let clockTimer = null;
  let disposed = false;

  const open = OPEN_STATUSES.join(',');

  async function load(initial) {
    if (initial) container.innerHTML = skeleton();
    try {
      const [dash, urgent, mine] = await Promise.all([
        api('GET', '/dashboard'),
        api('GET', '/work-items', { query: { priority: 'CRITICAL,HIGH', status: open, sortBy: 'priority', sortOrder: 'desc', pageSize: 6 } }),
        api('GET', '/work-items', { query: { assignee: 'me', status: open, sortBy: 'priority', sortOrder: 'desc', pageSize: 6 } }),
      ]);
      if (disposed) return;
      syncedAt = Date.now();
      container.innerHTML = render(dash.data, urgent, mine);
      updateSynced();
    } catch (error) {
      if (disposed) return;
      if (initial) {
        container.innerHTML = `<div class="px-8 py-10">${errorState(error, { backHref: '#/dashboard', backLabel: 'Reload dashboard' })}</div>`;
      }
      // a failed background refresh keeps the last good data on screen
    }
  }

  container.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="retry"]')) load(true);
  });

  const updateSynced = () => {
    const el = container.querySelector('#synced');
    if (el && syncedAt) el.textContent = `Synced ${relativeTime(new Date(syncedAt).toISOString())}`;
  };

  load(true);
  timer = setInterval(() => load(false), REFRESH_MS);
  clockTimer = setInterval(updateSynced, 10000);

  return () => {
    disposed = true;
    clearInterval(timer);
    clearInterval(clockTimer);
  };
}

function skeleton() {
  return `<div class="px-8 py-7 space-y-6">
    <div class="skeleton h-10 w-72"></div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">${Array.from({ length: 4 }, () => skeletonBlock('h-28')).join('')}</div>
    <div class="grid lg:grid-cols-3 gap-6"><div class="lg:col-span-2">${skeletonBlock('h-96')}</div><div>${skeletonBlock('h-96')}</div></div>
  </div>`;
}

function statCard({ label, value, caption, href, iconName, tone }) {
  return `
    <a href="${href}" class="group block rounded-xl bg-surface-container-low hover:bg-surface-container p-5 transition-colors">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-mono uppercase tracking-widest text-secondary">${esc(label)}</span>
        <span class="${tone}">${icon(iconName, 'text-[20px]')}</span>
      </div>
      <div class="mt-3 flex items-baseline gap-2">
        <span class="font-headline text-4xl font-semibold leading-none">${value}</span>
        <span class="text-sm text-on-surface-variant">${esc(caption)}</span>
      </div>
    </a>`;
}

function itemRow(item) {
  return `
    <a href="#/work-items/${esc(item.id)}" class="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-container-low transition-colors">
      <div class="w-14 shrink-0">${priorityBadge(item.priority)}</div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold truncate">${esc(item.title)}</p>
        <p class="text-[11px] text-secondary mt-0.5 flex items-center gap-2 flex-wrap">
          <span class="font-mono font-bold text-primary">${esc(item.key)}</span>
          <span>${esc(teamName(item.teamId))}</span>
        </p>
      </div>
      <div class="hidden md:block shrink-0">${statusBadge(item.status)}</div>
      <div class="hidden sm:flex items-center gap-2 w-36 shrink-0">
        ${item.assigneeId ? `${avatar(nameOf(item.assigneeId))}<span class="text-xs truncate">${esc(nameOf(item.assigneeId))}</span>` : '<span class="text-xs italic text-secondary">Unassigned</span>'}
      </div>
    </a>`;
}

/** Narrow-column variant: stacks the details so long titles stay readable. */
function compactRow(item) {
  return `
    <a href="#/work-items/${esc(item.id)}" class="block px-5 py-3.5 hover:bg-surface-container-low transition-colors">
      <div class="flex items-center gap-2 flex-wrap">
        ${priorityBadge(item.priority)}
        <span class="font-mono font-bold text-primary text-[11px]">${esc(item.key)}</span>
        ${statusBadge(item.status)}
      </div>
      <p class="mt-1.5 text-sm font-semibold leading-snug">${esc(item.title)}</p>
      <p class="mt-0.5 text-[11px] text-secondary">${esc(teamName(item.teamId))}</p>
    </a>`;
}

function activityRow(entry) {
  const info = describeActivity(entry, nameOf);
  const chips = info.changes
    .map((c) =>
      c.note
        ? `<span class="px-1.5 py-0.5 rounded bg-surface-container text-[10px] font-semibold uppercase">${esc(c.label)} ${esc(c.note)}</span>`
        : `<span class="px-1.5 py-0.5 rounded bg-primary-fixed text-on-primary-fixed-variant text-[10px] font-semibold uppercase">${esc(c.label)}: ${esc(c.from ?? '—')} → ${esc(c.to ?? '—')}</span>`,
    )
    .join(' ');
  return `
    <a href="#/work-items/${esc(entry.workItemId)}" class="flex gap-3 px-5 py-3.5 hover:bg-surface-container-low transition-colors">
      ${avatar(entry.actorName ?? '?', 'w-8 h-8 text-xs')}
      <div class="min-w-0 flex-1">
        <p class="text-sm"><span class="font-semibold">${esc(info.actor)}</span> ${esc(info.verb)}
          <span class="font-mono font-bold text-primary">${esc(entry.workItemKey)}</span></p>
        <p class="text-[11px] text-secondary truncate">${esc(entry.workItemTitle)}</p>
        ${chips ? `<div class="mt-1.5 flex flex-wrap gap-1.5">${chips}</div>` : ''}
      </div>
      <span class="text-[11px] text-secondary shrink-0">${esc(relativeTime(entry.createdAt))}</span>
    </a>`;
}

function render(dash, urgent, mine) {
  const { counts, teamLoad, recentActivity } = dash;
  const maxOpen = Math.max(1, ...teamLoad.map((t) => t.open));

  const cards = [
    statCard({ label: 'My Work', value: counts.myWork, caption: 'Assigned', href: '#/work-items?preset=mine', iconName: 'person', tone: 'text-primary' }),
    statCard({ label: 'High / Critical', value: counts.highCritical, caption: 'Active', href: '#/work-items?preset=critical', iconName: 'priority_high', tone: 'text-tertiary' }),
    statCard({ label: 'Unassigned', value: counts.unassigned, caption: 'Needs triage', href: '#/work-items?preset=unassigned', iconName: 'inbox', tone: 'text-secondary' }),
    statCard({ label: 'Blocked Work', value: counts.blocked, caption: 'Awaiting fixes', href: '#/work-items?preset=blocked', iconName: 'block', tone: 'text-error' }),
  ].join('');

  const urgentRows = urgent.data.length
    ? urgent.data.map(itemRow).join('')
    : `<p class="px-5 py-10 text-sm text-on-surface-variant text-center">No open high or critical work. Nicely done.</p>`;
  const mineRows = mine.data.length
    ? mine.data.map(compactRow).join('')
    : `<p class="px-5 py-8 text-sm text-on-surface-variant text-center">Nothing is assigned to you right now.</p>`;
  const teamRows = teamLoad.length
    ? teamLoad
        .map(
          (t) => `
      <div>
        <div class="flex items-baseline justify-between gap-3">
          <span class="text-sm font-medium truncate">${esc(t.teamName)}</span>
          <span class="font-mono text-xs text-primary font-bold shrink-0">${t.open} open</span>
        </div>
        <div class="mt-1.5 h-1.5 rounded-full bg-surface-container-high overflow-hidden"><div class="h-full rounded-full bg-primary" style="width:${Math.round((t.open / maxOpen) * 100)}%"></div></div>
        <p class="mt-1 text-[11px] text-secondary">${t.blocked} blocked · ${t.unassigned} unassigned</p>
      </div>`,
        )
        .join('')
    : `<p class="text-sm text-on-surface-variant">You are not part of any team yet.</p>`;
  const activityRows = recentActivity.length
    ? recentActivity.map(activityRow).join('')
    : `<p class="px-5 py-8 text-sm text-on-surface-variant text-center">No activity yet.</p>`;

  return `
    <div class="px-4 sm:px-8 py-7 space-y-6">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <span class="text-[11px] font-mono uppercase tracking-widest text-primary font-bold">Operations Hub</span>
          <span class="text-secondary">•</span>
          <span id="synced" class="text-[11px] text-secondary font-mono"></span>
        </div>
        <h1 class="text-3xl lg:text-4xl font-headline font-semibold tracking-tight leading-none">Operational Command</h1>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">${cards}</div>

      <div class="grid lg:grid-cols-3 gap-6 items-start">
        <div class="lg:col-span-2 space-y-6 min-w-0">
          <section class="rounded-xl bg-surface-container-lowest shadow-[0_2px_16px_rgba(58,48,42,0.04)] overflow-hidden">
            <div class="px-5 pt-5 pb-3 flex items-center justify-between">
              <h2 class="font-headline text-xl font-semibold flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-tertiary"></span>Needs Immediate Action</h2>
              <a href="#/work-items?preset=critical" class="text-[11px] font-semibold text-primary hover:underline">View all (${counts.highCritical})</a>
            </div>
            <div class="divide-y divide-outline-variant/40">${urgentRows}</div>
          </section>

          <section class="rounded-xl bg-surface-container-lowest shadow-[0_2px_16px_rgba(58,48,42,0.04)] overflow-hidden">
            <div class="px-5 pt-5 pb-3 flex items-center justify-between">
              <h2 class="font-headline text-xl font-semibold">Recently Updated</h2>
              <span class="text-[11px] font-mono text-secondary">Latest ${recentActivity.length} events</span>
            </div>
            <div class="divide-y divide-outline-variant/40">${activityRows}</div>
          </section>
        </div>

        <div class="space-y-6 min-w-0">
          <section class="rounded-xl bg-surface-container-lowest shadow-[0_2px_16px_rgba(58,48,42,0.04)] overflow-hidden">
            <div class="px-5 pt-5 pb-3 flex items-center justify-between">
              <h2 class="font-headline text-xl font-semibold">My Work</h2>
              <a href="#/work-items?preset=mine" class="text-[11px] font-semibold text-primary hover:underline">View all (${counts.myWork})</a>
            </div>
            <div class="divide-y divide-outline-variant/40">${mineRows}</div>
          </section>

          <section class="rounded-xl bg-surface-container-lowest shadow-[0_2px_16px_rgba(58,48,42,0.04)] p-5">
            <div class="flex items-center justify-between mb-4">
              <h2 class="font-headline text-xl font-semibold">Team Load</h2>
              <span class="text-[11px] text-secondary">${teamLoad.length} ${teamLoad.length === 1 ? 'team' : 'teams'}</span>
            </div>
            <div class="space-y-4">${teamRows}</div>
          </section>
        </div>
      </div>
    </div>`;
}
