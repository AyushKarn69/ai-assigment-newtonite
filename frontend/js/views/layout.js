// Signed-in shell: sidebar, top bar (search, new item, health, notifications, profile).

import { api, checkHealth } from '../api.js';
import { esc, humanize, relativeTime } from '../lib/format.js';
import { roleLabel } from '../lib/permissions.js';
import { state } from '../store.js';
import { avatar, icon, toast } from '../ui.js';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '#/dashboard' },
  { key: 'work-items', label: 'Work Items', icon: 'assignment', href: '#/work-items' },
];

const NOTIFICATION_ICONS = {
  ASSIGNED: 'person_add',
  UNASSIGNED: 'person_remove',
  STATUS_CHANGED: 'swap_horiz',
  COMMENT_ADDED: 'chat_bubble',
  LOCK_FORCE_RELEASED: 'lock_reset',
};

/**
 * Render the shell into `root` and return handles for the router and app.
 * @param callbacks { onSignOut(), onNewItem() }
 */
export function mountShell(root, { onSignOut, onNewItem }) {
  const user = state.user;
  const sidebarLink = (n) => `
    <a href="${n.href}" data-nav="${n.key}" class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all">
      ${icon(n.icon, 'text-[18px]')}<span>${n.label}</span>
    </a>`;

  root.innerHTML = `
    <aside class="hidden lg:flex fixed left-0 top-0 h-full w-64 bg-surface-container-low z-50 flex-col shadow-[0_1px_8px_rgba(58,48,42,0.04)]">
      <div class="h-16 px-5 flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-on-primary font-headline font-bold">N</div>
        <div class="flex flex-col leading-tight">
          <span class="font-headline text-base font-bold tracking-tight">Newtonite Ops</span>
          <span class="text-[10px] uppercase font-bold tracking-wider text-primary">Workspace</span>
        </div>
      </div>
      <div class="px-4 py-3">
        <p class="px-3 mb-2 text-[10px] uppercase font-bold tracking-widest text-secondary">Navigation</p>
        <nav class="space-y-1">${NAV.map(sidebarLink).join('')}</nav>
      </div>
    </aside>

    <header class="fixed top-0 left-0 lg:left-64 right-0 h-16 bg-surface/85 backdrop-blur-xl z-40 px-4 sm:px-6 flex items-center justify-between gap-3 shadow-[0_1px_8px_rgba(58,48,42,0.04)]">
      <div class="flex items-center gap-3 min-w-0">
        <nav class="flex lg:hidden items-center gap-1">
          ${NAV.map((n) => `<a href="${n.href}" data-nav="${n.key}" class="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container" title="${n.label}">${icon(n.icon, 'text-[20px]')}</a>`).join('')}
        </nav>
        <form id="quick-search" class="relative flex items-center" role="search">
          <span class="absolute left-3 text-secondary">${icon('search', 'text-[18px]')}</span>
          <input id="quick-search-input" type="search" aria-label="Search work items" class="h-9 pl-9 pr-3 w-44 sm:w-80 rounded-lg bg-surface-container-lowest text-sm text-on-surface placeholder:text-secondary focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Search title, ID or text…" />
        </form>
      </div>
      <div class="flex items-center gap-2 sm:gap-4">
        <button id="new-item" type="button" class="h-9 px-3.5 rounded-lg bg-primary hover:bg-primary-container text-on-primary hover:text-on-primary-container text-xs font-semibold flex items-center gap-1.5 transition-all">
          ${icon('add', 'text-[16px]')}<span class="hidden sm:inline">New Work Item</span>
        </button>
        <div id="health-pill" class="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-container-low text-xs text-on-surface-variant font-medium" title="API status">
          <span class="w-2 h-2 rounded-full bg-outline"></span><span>Checking…</span>
        </div>
        <div class="relative">
          <button id="bell" type="button" class="relative p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-all" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">
            ${icon('notifications', 'text-[20px]')}
            <span id="bell-badge" class="hidden absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-on-primary text-[9px] font-bold flex items-center justify-center"></span>
          </button>
          <div id="notif-panel" class="hidden absolute right-0 mt-2 w-[22rem] max-w-[92vw] bg-surface-container-lowest rounded-xl shadow-[0_12px_40px_rgba(58,48,42,0.18)] overflow-hidden z-50" role="menu"></div>
        </div>
        <div class="relative">
          <button id="profile" type="button" class="flex items-center gap-3 pl-1 rounded-lg" aria-haspopup="true" aria-expanded="false">
            <div class="hidden sm:flex flex-col text-right">
              <span class="text-xs font-semibold leading-tight">${esc(user.name)}</span>
              <span class="text-[11px] text-on-surface-variant leading-tight">${esc(roleLabel(user, state.teams))}</span>
            </div>
            ${avatar(user.name, 'w-8 h-8 text-xs')}
          </button>
          <div id="profile-menu" class="hidden absolute right-0 mt-2 w-56 bg-surface-container-lowest rounded-xl shadow-[0_12px_40px_rgba(58,48,42,0.18)] p-2 z-50">
            <div class="px-3 py-2"><p class="text-xs font-semibold">${esc(user.name)}</p><p class="text-[11px] text-secondary break-all">${esc(user.email)}</p></div>
            <button id="sign-out" type="button" class="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-on-surface-variant hover:bg-surface-container">${icon('logout', 'text-[18px]')}Sign out</button>
          </div>
        </div>
      </div>
    </header>

    <main class="relative pt-16 lg:ml-64 min-h-screen bg-background">
      <div id="view"></div>
      <footer class="px-8 py-4 text-[11px] text-secondary flex items-center gap-4 flex-wrap">
        <span id="footer-health" class="flex items-center gap-1.5"></span>
        <span class="font-mono">Signed in as ${esc(user.email)}</span>
      </footer>
    </main>`;

  const $ = (selector) => root.querySelector(selector);
  const panel = $('#notif-panel');
  const profileMenu = $('#profile-menu');
  let panelOpen = false;

  // ---- search & actions ----
  $('#quick-search').addEventListener('submit', (event) => {
    event.preventDefault();
    const term = $('#quick-search-input').value.trim();
    location.hash = term ? `#/work-items?search=${encodeURIComponent(term)}` : '#/work-items';
  });
  $('#new-item').addEventListener('click', () => onNewItem());
  $('#sign-out').addEventListener('click', () => onSignOut());

  // ---- menus ----
  const closeMenus = () => {
    panel.classList.add('hidden');
    profileMenu.classList.add('hidden');
    panelOpen = false;
    $('#bell').setAttribute('aria-expanded', 'false');
    $('#profile').setAttribute('aria-expanded', 'false');
  };
  $('#profile').addEventListener('click', (event) => {
    event.stopPropagation();
    const wasHidden = profileMenu.classList.contains('hidden');
    closeMenus();
    if (wasHidden) {
      profileMenu.classList.remove('hidden');
      $('#profile').setAttribute('aria-expanded', 'true');
    }
  });
  $('#bell').addEventListener('click', async (event) => {
    event.stopPropagation();
    const wasHidden = panel.classList.contains('hidden');
    closeMenus();
    if (wasHidden) {
      panel.classList.remove('hidden');
      panelOpen = true;
      $('#bell').setAttribute('aria-expanded', 'true');
      await renderNotifications();
    }
  });
  const onDocumentClick = (event) => {
    if (!panel.contains(event.target) && !profileMenu.contains(event.target)) closeMenus();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') closeMenus();
  };
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKey);

  // ---- notifications ----
  async function refreshUnread() {
    try {
      const { data } = await api('GET', '/notifications/unread-count');
      const badge = $('#bell-badge');
      if (!badge) return;
      badge.textContent = data.count > 99 ? '99+' : String(data.count);
      badge.classList.toggle('hidden', data.count === 0);
      $('#bell').setAttribute('aria-label', data.count ? `Notifications (${data.count} unread)` : 'Notifications');
    } catch {
      /* the next poll will try again */
    }
  }

  async function renderNotifications() {
    panel.innerHTML = `<div class="p-5 text-xs text-secondary">Loading…</div>`;
    try {
      const { data } = await api('GET', '/notifications', { query: { pageSize: 15 } });
      const rows = data
        .map(
          (n) => `
        <button type="button" data-notification="${esc(n.id)}" data-item="${esc(n.workItemId)}" data-unread="${n.readAt ? 'false' : 'true'}"
          class="w-full text-left flex gap-3 px-4 py-3 hover:bg-surface-container-low transition-colors ${n.readAt ? '' : 'bg-primary-fixed/40'}" role="menuitem">
          <span class="mt-0.5 text-primary">${icon(NOTIFICATION_ICONS[n.type] ?? 'notifications', 'text-[18px]')}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-xs ${n.readAt ? 'text-on-surface-variant' : 'font-semibold text-on-surface'}">${esc(n.message)}</span>
            <span class="block text-[11px] text-secondary truncate mt-0.5">${esc(n.workItemTitle)}</span>
            <span class="block text-[10px] text-secondary mt-1">${esc(humanize(n.type))} · ${esc(relativeTime(n.createdAt))}</span>
          </span>
          ${n.readAt ? '' : '<span class="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0"></span>'}
        </button>`,
        )
        .join('');
      panel.innerHTML = `
        <div class="flex items-center justify-between px-4 py-3">
          <span class="font-headline text-lg font-semibold">Notifications</span>
          <button type="button" id="read-all" class="text-[11px] font-semibold text-primary hover:underline">Mark all read</button>
        </div>
        <div class="max-h-96 overflow-y-auto">${rows || '<p class="px-4 pb-6 pt-2 text-sm text-on-surface-variant">You are all caught up.</p>'}</div>`;
    } catch (error) {
      panel.innerHTML = `<div class="p-5 text-xs text-error">${esc(error.message)}</div>`;
    }
  }

  panel.addEventListener('click', async (event) => {
    if (event.target.closest('#read-all')) {
      try {
        await api('POST', '/notifications/read-all');
        await Promise.all([renderNotifications(), refreshUnread()]);
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
    const row = event.target.closest('[data-notification]');
    if (!row) return;
    try {
      if (row.dataset.unread === 'true') await api('POST', `/notifications/${row.dataset.notification}/read`);
    } catch {
      /* navigating matters more than the read receipt */
    }
    closeMenus();
    refreshUnread();
    location.hash = `#/work-items/${row.dataset.item}`;
  });

  // ---- health ----
  async function refreshHealth() {
    const health = await checkHealth();
    const pill = $('#health-pill');
    const footer = $('#footer-health');
    if (!pill || !footer) return;
    pill.innerHTML = health.ok
      ? '<span class="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span><span>Operational</span>'
      : '<span class="w-2 h-2 rounded-full bg-error"></span><span>Unreachable</span>';
    footer.innerHTML = health.ok
      ? `<span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>API healthy · ${health.ms}ms`
      : '<span class="w-1.5 h-1.5 rounded-full bg-error"></span>API unreachable';
  }

  refreshUnread();
  refreshHealth();
  const timers = [setInterval(refreshUnread, 20000), setInterval(refreshHealth, 30000), setInterval(() => panelOpen && renderNotifications(), 20000)];

  return {
    view: $('#view'),
    /** Highlight the active sidebar item. */
    setActive(key) {
      root.querySelectorAll('[data-nav]').forEach((link) => {
        const active = link.dataset.nav === key;
        link.classList.toggle('bg-surface-container-high', active);
        link.classList.toggle('text-on-surface', active);
        link.classList.toggle('font-semibold', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
    },
    refreshUnread,
    destroy() {
      timers.forEach(clearInterval);
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKey);
    },
  };
}
