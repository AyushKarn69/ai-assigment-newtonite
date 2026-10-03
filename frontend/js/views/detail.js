// Work item detail: attributes, editing (with the exclusive lock), comments, audit trail.

import { api, newIdempotencyKey } from '../api.js';
import { describeActivity } from '../lib/activity.js';
import { changedFields, conflictRows, theirOnlyChanges } from '../lib/diff.js';
import { esc, formatDateTime, formatDuration, humanize, relativeTime } from '../lib/format.js';
import { isManagerOf, usableTransitions } from '../lib/permissions.js';
import { membersOf, nameOf, state, teamName } from '../store.js';
import { errorState, skeletonBlock } from '../states.js';
import {
  PRIORITIES,
  STATUSES,
  TYPES,
  avatar,
  fieldClasses,
  icon,
  labelClasses,
  openModal,
  personChip,
  primaryButton,
  priorityBadge,
  secondaryButton,
  statusBadge,
  toast,
  typeBadge,
} from '../ui.js';

const POLL_MS = 15000;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const COMMENT_PAGE = 50;
const ACTIVITY_PAGE = 15;

export function mountDetail(container, { id }) {
  // ---- state ----
  let item = null;
  let lock = null;
  let comments = [];
  let commentsMeta = null;
  let activity = [];
  let activityMeta = null;

  let editing = false;
  let lockLost = false;
  let baseItem = null;
  let draft = null;
  let conflict = null; // { rows, theirs: [fields], current }
  let busy = false;

  let disposed = false;
  let pollTimer = null;
  let heartbeatTimer = null;
  let commentKey = newIdempotencyKey();
  let lastCommentBody = null;

  const me = () => state.user;
  const holdingLock = () => lock?.lockedBy === me().id;
  const lockedByOther = () => lock && lock.lockedBy !== me().id;
  const manager = () => item && isManagerOf(me(), state.teams, item.teamId);

  container.innerHTML = `<div class="px-4 sm:px-8 py-7 space-y-6">${skeletonBlock('h-10')}${skeletonBlock('h-96')}</div>`;

  // ---------------------------------------------------------------- loading
  async function loadAll() {
    try {
      const [itemRes, lockRes, commentRes, activityRes] = await Promise.all([
        api('GET', `/work-items/${id}`),
        api('GET', `/work-items/${id}/lock`),
        api('GET', `/work-items/${id}/comments`, { query: { pageSize: COMMENT_PAGE } }),
        api('GET', `/work-items/${id}/activity`, { query: { pageSize: ACTIVITY_PAGE } }),
      ]);
      if (disposed) return;
      item = itemRes.data;
      lock = lockRes.data;
      comments = commentRes.data;
      commentsMeta = commentRes.meta;
      activity = activityRes.data;
      activityMeta = activityRes.meta;
      renderShell();
    } catch (error) {
      if (disposed) return;
      container.innerHTML = `<div class="px-4 sm:px-8 py-10">${errorState(error)}</div>`;
    }
  }

  /** Quietly bring the page up to date (used by polling and after changes). */
  async function refresh({ comments: withComments = true } = {}) {
    try {
      const requests = [
        api('GET', `/work-items/${id}`),
        api('GET', `/work-items/${id}/lock`),
        api('GET', `/work-items/${id}/activity`, { query: { pageSize: Math.max(ACTIVITY_PAGE, activity.length) } }),
      ];
      if (withComments) requests.push(api('GET', `/work-items/${id}/comments`, { query: { pageSize: Math.max(COMMENT_PAGE, comments.length) } }));
      const [itemRes, lockRes, activityRes, commentRes] = await Promise.all(requests);
      if (disposed) return;
      item = itemRes.data;
      lock = lockRes.data;
      activity = activityRes.data;
      activityMeta = activityRes.meta;
      if (commentRes) {
        comments = commentRes.data;
        commentsMeta = commentRes.meta;
      }
      renderBanner();
      renderHeader();
      if (!editing) renderMain();
      renderAttributes();
      renderComments();
      renderActivity();
    } catch {
      /* keep what is on screen; the next poll retries */
    }
  }

  // ---------------------------------------------------------------- shell
  function renderShell() {
    container.innerHTML = `
      <div class="px-4 sm:px-8 py-7 space-y-5">
        <div id="d-header"></div>
        <div id="d-banner"></div>
        <div class="grid lg:grid-cols-3 gap-6 items-start">
          <div class="lg:col-span-2 space-y-6 min-w-0">
            <section id="d-main"></section>
            <section id="d-comments" class="bg-surface-container-lowest rounded-xl p-6 shadow-[0_2px_16px_rgba(58,48,42,0.04)]">
              <div class="flex items-center justify-between mb-4">
                <h2 class="font-headline text-xl font-semibold">Collaboration &amp; Notes</h2>
                <span id="d-comments-count" class="text-[11px] font-mono text-secondary"></span>
              </div>
              <div id="d-comments-list" class="space-y-5"></div>
              <form id="d-comment-form" class="mt-6 rounded-xl bg-surface-container-low p-4" novalidate>
                <label class="${labelClasses}" for="d-comment-body">Add a note or handover instruction</label>
                <textarea id="d-comment-body" rows="3" maxlength="5000" class="${fieldClasses}" placeholder="Write a comment… (Ctrl+Enter to post)"></textarea>
                <div class="mt-3 flex items-center justify-between">
                  <span id="d-comment-error" class="text-[11px] text-error"></span>
                  <button type="submit" id="d-comment-submit" class="${primaryButton}">${icon('send', 'text-[16px]')}Post Comment</button>
                </div>
              </form>
            </section>
            <section id="d-activity" class="bg-surface-container-lowest rounded-xl p-6 shadow-[0_2px_16px_rgba(58,48,42,0.04)]"></section>
          </div>
          <aside id="d-attrs" class="space-y-6"></aside>
        </div>
      </div>`;
    renderHeader();
    renderBanner();
    renderMain();
    renderAttributes();
    renderComments();
    renderActivity();
  }

  const $ = (selector) => container.querySelector(selector);

  // ---------------------------------------------------------------- header
  function renderHeader() {
    const el = $('#d-header');
    if (!el) return;
    const transitions = usableTransitions(me(), state.teams, item);
    const blocked = lockedByOther() || busy || editing;

    const statusSelect = transitions.length
      ? `<label class="flex items-center gap-2 text-xs text-on-surface-variant">Move to
          <select id="d-status" ${blocked ? 'disabled' : ''} class="h-9 px-3 rounded-lg bg-surface-container text-xs font-semibold text-on-surface focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50">
            <option value="">Status: ${esc(STATUSES[item.status]?.label ?? humanize(item.status))}</option>
            ${transitions.map((t) => `<option value="${t}">${esc(STATUSES[t]?.label ?? humanize(t))}</option>`).join('')}
          </select></label>`
      : '';
    const resolveButton = transitions.includes('RESOLVED')
      ? `<button type="button" data-action="resolve" ${blocked ? 'disabled' : ''} class="${primaryButton}">${icon('task_alt', 'text-[16px]')}Resolve Work Item</button>`
      : '';

    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <a href="#/work-items" class="font-mono uppercase tracking-widest text-secondary hover:text-primary">Work Items</a>
        <span class="text-secondary">/</span>
        <span class="font-mono font-bold text-primary">${esc(item.key)}</span>
        ${statusBadge(item.status)}
        ${priorityBadge(item.priority, { long: true })}
        ${typeBadge(item.type)}
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" data-action="edit" ${blocked ? 'disabled' : ''} class="${secondaryButton}">${icon('edit', 'text-[16px]')}Edit</button>
        ${statusSelect}
        ${manager() ? `<button type="button" data-action="reassign" ${blocked ? 'disabled' : ''} class="${secondaryButton}">${icon('swap_horiz', 'text-[16px]')}${item.assigneeId ? 'Reassign' : 'Assign'}</button>` : ''}
        ${resolveButton}
        ${lockedByOther() ? `<span class="text-[11px] text-secondary">${icon('lock', 'text-[14px] align-middle')} Locked by ${esc(nameOf(lock.lockedBy))}</span>` : ''}
      </div>`;
  }

  // ---------------------------------------------------------------- banners
  function renderBanner() {
    const el = $('#d-banner');
    if (!el) return;
    if (lockLost) {
      el.innerHTML = banner('warning', 'Your edit lock was lost', 'The lock expired and could not be renewed (someone else may now be editing). Copy your changes if you need them, then discard and start again.', 'bg-error-container text-on-error-container');
    } else if (lockedByOther()) {
      const remaining = Math.max(0, (new Date(lock.expiresAt).getTime() - Date.now()) / 1000);
      el.innerHTML = banner(
        'lock',
        `Being edited by ${esc(nameOf(lock.lockedBy))}`,
        `They hold the edit lock for about ${esc(formatDuration(remaining))} more. You can read and comment now, and edit once they finish.${manager() ? ' As a manager you can also release their lock.' : ''}`,
        'bg-primary-fixed text-on-primary-fixed-variant',
        manager() ? `<button type="button" data-action="force-unlock" class="${secondaryButton}">Release lock</button>` : '',
      );
    } else {
      el.innerHTML = '';
    }
  }

  const banner = (iconName, title, text, tone, actions = '') => `
    <div class="flex flex-wrap items-center gap-3 rounded-xl px-5 py-3.5 ${tone}" role="status">
      ${icon(iconName, 'text-[20px]')}
      <div class="min-w-0 flex-1"><p class="text-sm font-semibold">${title}</p><p class="text-xs mt-0.5 opacity-90">${text}</p></div>
      ${actions}
    </div>`;

  // ---------------------------------------------------------------- main card
  function renderMain() {
    const el = $('#d-main');
    if (!el) return;
    if (editing) {
      renderEditor(el);
      return;
    }
    el.innerHTML = `
      <div class="bg-surface-container-lowest rounded-xl p-6 sm:p-8 shadow-[0_2px_16px_rgba(58,48,42,0.04)]">
        <h1 class="font-headline text-3xl sm:text-4xl font-semibold tracking-tight leading-tight break-words">${esc(item.key)}: ${esc(item.title)}</h1>
        <p class="mt-2 text-xs text-secondary">Reported by ${esc(nameOf(item.createdBy))} · ${esc(relativeTime(item.createdAt))} · Team ${esc(teamName(item.teamId))}</p>
        <div class="mt-6 text-[10px] font-mono uppercase tracking-widest text-secondary">Description</div>
        <div class="mt-2 text-sm leading-relaxed prewrap">${item.description ? esc(item.description) : '<span class="italic text-secondary">No description provided.</span>'}</div>
      </div>`;
  }

  function renderEditor(el) {
    const remaining = lock ? Math.max(0, (new Date(lock.expiresAt).getTime() - Date.now()) / 1000) : 0;
    el.innerHTML = `
      <form id="d-edit-form" class="bg-surface-container-lowest rounded-xl p-6 sm:p-8 shadow-[0_2px_16px_rgba(58,48,42,0.04)] space-y-4" novalidate>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="font-headline text-2xl font-semibold">Edit ${esc(item.key)}</h2>
          <span class="text-[11px] ${lockLost ? 'text-error' : 'text-secondary'} flex items-center gap-1">${icon(lockLost ? 'lock_open' : 'lock', 'text-[14px]')}${lockLost ? 'Lock lost' : `You hold the edit lock · auto-renewing (${esc(formatDuration(remaining))} left)`}</span>
        </div>
        ${conflict ? conflictPanel() : ''}
        <div>
          <label class="${labelClasses}" for="e-title">Title</label>
          <input id="e-title" name="title" maxlength="200" value="${esc(draft.title)}" class="${fieldClasses}" />
          <p class="mt-1 text-[11px] text-error hidden" data-error-for="title"></p>
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="${labelClasses}" for="e-priority">Priority</label>
            <select id="e-priority" name="priority" class="${fieldClasses}">
              ${Object.entries(PRIORITIES).reverse().map(([v, p]) => `<option value="${v}"${draft.priority === v ? ' selected' : ''}>${esc(`${p.short} · ${p.label}`)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="${labelClasses}" for="e-type">Classification</label>
            <select id="e-type" name="type" class="${fieldClasses}">
              ${Object.entries(TYPES).map(([v, t]) => `<option value="${v}"${draft.type === v ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <label class="${labelClasses}" for="e-description">Description</label>
          <textarea id="e-description" name="description" rows="9" maxlength="5000" class="${fieldClasses}">${esc(draft.description)}</textarea>
        </div>
        <p id="e-error" class="hidden text-xs text-error" role="alert"></p>
        <div class="flex justify-end gap-2.5">
          <button type="button" data-action="cancel-edit" class="${secondaryButton}">${lockLost ? 'Discard' : 'Cancel'}</button>
          <button type="submit" id="e-save" ${lockLost ? 'disabled' : ''} class="${primaryButton}">${icon('save', 'text-[16px]')}Save changes</button>
        </div>
      </form>`;
    el.querySelector('#e-title').focus();
  }

  function conflictPanel() {
    const rows = conflict.rows
      .map(
        (r) => `
      <tr class="border-t border-outline-variant/40 align-top">
        <td class="py-2 pr-3 font-semibold text-xs">${esc(humanize(r.field))}${r.collides ? ' <span class="ml-1 text-[10px] text-error font-bold uppercase">both changed</span>' : ''}</td>
        <td class="py-2 pr-3 text-xs prewrap">${esc(r.mine)}</td>
        <td class="py-2 text-xs prewrap">${esc(r.current)}</td>
      </tr>`,
      )
      .join('');
    const others = conflict.theirs.length
      ? `<p class="mt-2 text-[11px]">Also changed by them (you did not touch): ${esc(conflict.theirs.map(humanize).join(', '))}.</p>`
      : '';
    return `
      <div class="rounded-xl bg-primary-fixed/60 p-5" role="alert">
        <p class="text-[10px] font-mono font-bold uppercase tracking-widest text-primary">Concurrency conflict · HTTP 409</p>
        <p class="mt-1 font-headline text-lg font-semibold">This work item changed while you were editing</p>
        <p class="mt-1 text-xs text-on-surface-variant">Nothing was overwritten. Compare your draft with what is stored now, then choose.</p>
        <div class="mt-3 overflow-x-auto rounded-lg bg-surface-container-lowest p-3">
          <table class="w-full text-left"><thead><tr class="text-[10px] font-mono uppercase tracking-widest text-secondary"><th class="pb-1.5 pr-3">Field</th><th class="pb-1.5 pr-3">Your draft</th><th class="pb-1.5">Current (v${conflict.current.version})</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
        ${others}
        <div class="mt-4 flex flex-wrap gap-2.5">
          <button type="button" data-action="keep-mine" class="${primaryButton}">Keep my changes</button>
          <button type="button" data-action="use-current" class="${secondaryButton}">Use the latest version</button>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- attributes
  function renderAttributes() {
    const el = $('#d-attrs');
    if (!el) return;
    const row = (label, value) => `
      <div class="flex items-center justify-between gap-4 py-2.5">
        <span class="text-xs text-secondary">${esc(label)}</span>
        <span class="text-xs font-medium text-right min-w-0">${value}</span>
      </div>`;
    el.innerHTML = `
      <section class="bg-surface-container-lowest rounded-xl p-6 shadow-[0_2px_16px_rgba(58,48,42,0.04)]">
        <h2 class="font-headline text-xl font-semibold mb-2">Work Item Attributes</h2>
        <div class="divide-y divide-outline-variant/40">
          ${row('Status', statusBadge(item.status))}
          ${row('Priority', priorityBadge(item.priority, { long: true }))}
          ${row('Classification', typeBadge(item.type))}
          ${row('Team', esc(teamName(item.teamId)))}
          ${row('Current Owner', personChip(item.assigneeId ? nameOf(item.assigneeId) : null))}
          ${row('Reporter', personChip(nameOf(item.createdBy)))}
          ${row('Created', esc(formatDateTime(item.createdAt)))}
          ${row('Last updated', esc(formatDateTime(item.updatedAt)))}
          ${row('Version', `<span class="font-mono">v${item.version}</span>`)}
          ${row('Edit lock', lock ? `${icon('lock', 'text-[14px] align-middle')} ${esc(holdingLock() ? 'You' : nameOf(lock.lockedBy))}` : '<span class="text-secondary">Free</span>')}
        </div>
      </section>`;
  }

  // ---------------------------------------------------------------- comments
  function renderComments() {
    const list = $('#d-comments-list');
    if (!list) return;
    const total = commentsMeta?.totalCount ?? comments.length;
    $('#d-comments-count').textContent = `${total} ${total === 1 ? 'entry' : 'entries'}`;
    if (comments.length === 0) {
      list.innerHTML = '<p class="text-sm text-on-surface-variant">No notes yet. Start the conversation below.</p>';
      return;
    }
    const more = commentsMeta && comments.length < commentsMeta.totalCount
      ? `<button type="button" data-action="more-comments" class="${secondaryButton}">Load more notes</button>`
      : '';
    list.innerHTML =
      comments
        .map(
          (c) => `
      <article class="flex gap-3">
        ${avatar(c.authorName ?? '?', 'w-9 h-9 text-xs')}
        <div class="min-w-0 flex-1 rounded-xl bg-surface-container-low px-4 py-3">
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-sm font-semibold">${esc(c.authorName ?? 'Unknown')}</span>
            <span class="text-[11px] text-secondary" title="${esc(formatDateTime(c.createdAt))}">${esc(relativeTime(c.createdAt))}</span>
          </div>
          <p class="mt-1 text-sm leading-relaxed prewrap">${esc(c.body)}</p>
        </div>
      </article>`,
        )
        .join('') + more;
  }

  // ---------------------------------------------------------------- activity
  function renderActivity() {
    const el = $('#d-activity');
    if (!el) return;
    const rows = activity
      .map((entry) => {
        const info = describeActivity(entry, nameOf);
        const dot = { primary: 'bg-primary', warning: 'bg-error', neutral: 'bg-tertiary', muted: 'bg-outline' }[info.tone] ?? 'bg-outline';
        const changes = info.changes
          .map((c) =>
            c.note
              ? `<span class="px-1.5 py-0.5 rounded bg-surface-container text-[10px] font-semibold uppercase">${esc(c.label)} ${esc(c.note)}</span>`
              : `<span class="px-1.5 py-0.5 rounded bg-primary-fixed text-on-primary-fixed-variant text-[10px] font-semibold">${esc(c.label)}: ${esc(c.from ?? '—')} → ${esc(c.to ?? '—')}</span>`,
          )
          .join(' ');
        return `
        <li class="relative pl-6 pb-5 last:pb-0">
          <span class="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ${dot}"></span>
          <p class="text-sm"><span class="font-semibold">${esc(info.actor)}</span> ${esc(info.verb)}</p>
          ${changes ? `<div class="mt-1.5 flex flex-wrap gap-1.5">${changes}</div>` : ''}
          <p class="mt-1 text-[11px] text-secondary" title="${esc(formatDateTime(entry.createdAt))}">${esc(relativeTime(entry.createdAt))}</p>
        </li>`;
      })
      .join('');
    const more = activityMeta && activity.length < activityMeta.totalCount
      ? `<div class="mt-4"><button type="button" data-action="more-activity" class="${secondaryButton}">Load older events</button></div>`
      : '';
    el.innerHTML = `
      <div class="flex items-center justify-between mb-5">
        <h2 class="font-headline text-xl font-semibold">Audit Trail &amp; Lifecycle Events</h2>
        <span class="text-[11px] font-mono text-secondary">Immutable log · ${plural(activityMeta?.totalCount ?? activity.length, 'event')}</span>
      </div>
      <ol class="border-l border-outline-variant/70 ml-1">${rows}</ol>${more}`;
  }

  // ---------------------------------------------------------------- locking
  async function acquireLock() {
    const { data } = await api('POST', `/work-items/${id}/lock`);
    lock = data;
    return data;
  }

  async function releaseLock({ quiet = true } = {}) {
    try {
      await api('DELETE', `/work-items/${id}/lock`);
    } catch (error) {
      if (!quiet) toast(error.message, 'error');
    }
    lock = null;
  }

  function startHeartbeat() {
    stopHeartbeat();
    const remaining = lock ? (new Date(lock.expiresAt).getTime() - Date.now()) / 1000 : 60;
    const every = Math.max(15, Math.floor(remaining / 3)) * 1000;
    heartbeatTimer = setInterval(async () => {
      try {
        lock = (await api('POST', `/work-items/${id}/lock/heartbeat`)).data;
      } catch {
        try {
          lock = await acquireLock(); // expired but still free: take it again
        } catch {
          lockLost = true;
          stopHeartbeat();
          renderBanner();
          renderMain();
        }
      }
    }, every);
  }
  const stopHeartbeat = () => clearInterval(heartbeatTimer);

  /** Describe why a lock was refused, then refresh so the banner shows who holds it. */
  async function handleLockRefusal(error) {
    if (error.status === 423) {
      toast(`${nameOf(error.lockInfo?.lockedBy)} is editing this work item right now.`, 'error');
    } else {
      toast(error.message, 'error');
    }
    await refresh({ comments: false });
  }

  // ---------------------------------------------------------------- actions
  /** Run a change that needs the lock (taking it just for the duration if we do not hold it). */
  async function mutate(patch, successMessage) {
    if (busy) return false;
    busy = true;
    renderHeader();
    const tookLock = !holdingLock();
    try {
      if (tookLock) await acquireLock();
      item = (await api('PATCH', `/work-items/${id}`, { body: { version: item.version, ...patch } })).data;
      toast(successMessage, 'success');
      return true;
    } catch (error) {
      if (error.code === 'WORK_ITEM_LOCKED') await handleLockRefusal(error);
      else if (error.code === 'VERSION_CONFLICT') toast('Someone else updated this work item. The latest version is shown — please try again.', 'error');
      else toast(error.message, 'error');
      return false;
    } finally {
      if (tookLock) await releaseLock();
      busy = false;
      await refresh({ comments: false });
    }
  }

  async function startEdit() {
    if (busy || editing) return;
    busy = true;
    renderHeader();
    try {
      await acquireLock();
    } catch (error) {
      busy = false;
      if (error.code === 'WORK_ITEM_LOCKED') await handleLockRefusal(error);
      else {
        toast(error.message, 'error');
        renderHeader();
      }
      return;
    }
    baseItem = { ...item };
    draft = { title: item.title, description: item.description, priority: item.priority, type: item.type };
    editing = true;
    lockLost = false;
    conflict = null;
    busy = false;
    startHeartbeat();
    renderHeader();
    renderBanner();
    renderMain();
    renderAttributes();
  }

  async function endEdit({ releaseTheLock = true } = {}) {
    stopHeartbeat();
    editing = false;
    conflict = null;
    draft = null;
    if (releaseTheLock && !lockLost) await releaseLock();
    lockLost = false;
    await refresh({ comments: false });
  }

  function readDraft() {
    const form = $('#d-edit-form');
    draft = {
      title: form.querySelector('#e-title').value.trim(),
      description: form.querySelector('#e-description').value,
      priority: form.querySelector('#e-priority').value,
      type: form.querySelector('#e-type').value,
    };
    return draft;
  }

  async function saveEdit(overrideVersion) {
    const form = $('#d-edit-form');
    const errorEl = form.querySelector('#e-error');
    errorEl.classList.add('hidden');
    form.querySelectorAll('[data-error-for]').forEach((n) => n.classList.add('hidden'));

    readDraft();
    if (!draft.title) {
      const t = form.querySelector('[data-error-for="title"]');
      t.textContent = 'The title cannot be empty.';
      t.classList.remove('hidden');
      return;
    }
    const fields = changedFields(baseItem, draft);
    if (fields.length === 0) {
      toast('No changes to save.', 'info');
      await endEdit();
      return;
    }

    const patch = Object.fromEntries(fields.map((f) => [f, draft[f]]));
    const version = overrideVersion ?? item.version;
    const saveButton = form.querySelector('#e-save');
    saveButton.disabled = true;
    try {
      item = (await api('PATCH', `/work-items/${id}`, { body: { version, ...patch } })).data;
      toast('Changes saved', 'success');
      await endEdit();
    } catch (error) {
      saveButton.disabled = lockLost;
      if (error.code === 'VERSION_CONFLICT') {
        const current = (await api('GET', `/work-items/${id}`)).data;
        conflict = {
          current,
          rows: conflictRows(baseItem, draft, current),
          theirs: theirOnlyChanges(baseItem, draft, current),
        };
        // Fields I did not touch: show what is stored now, and treat it as the new baseline
        // so "Keep my changes" only ever overwrites the fields I actually edited.
        for (const field of conflict.theirs) {
          draft[field] = current[field];
          baseItem[field] = current[field];
        }
        item = current;
        renderEditor($('#d-main'));
        renderAttributes();
        renderHeader();
      } else if (error.code === 'LOCK_REQUIRED' || error.code === 'WORK_ITEM_LOCKED') {
        lockLost = true;
        stopHeartbeat();
        renderBanner();
        renderEditor($('#d-main'));
      } else if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
        for (const d of error.details) {
          const t = form.querySelector(`[data-error-for="${d.path}"]`);
          if (t) {
            t.textContent = d.message;
            t.classList.remove('hidden');
          }
        }
      } else {
        errorEl.textContent = error.message;
        errorEl.classList.remove('hidden');
      }
    }
  }

  function openReassign() {
    const members = membersOf(item.teamId);
    const modal = openModal({
      title: item.assigneeId ? 'Reassign work item' : 'Assign work item',
      body: `
        <form id="reassign-form" class="space-y-4 mt-2">
          <div>
            <label class="${labelClasses}" for="ra-owner">Owner</label>
            <select id="ra-owner" class="${fieldClasses}">
              <option value="">Unassigned</option>
              ${members.map((m) => `<option value="${esc(m.userId)}"${m.userId === item.assigneeId ? ' selected' : ''}>${esc(m.name)}${m.role === 'MANAGER' ? ' (manager)' : ''}</option>`).join('')}
            </select>
          </div>
          <div class="flex justify-end gap-2.5">
            <button type="button" data-modal-close class="${secondaryButton}">Cancel</button>
            <button type="submit" class="${primaryButton}">Save owner</button>
          </div>
        </form>`,
    });
    modal.el.querySelector('#reassign-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = modal.el.querySelector('#ra-owner').value || null;
      modal.close();
      if (value === item.assigneeId) return;
      await mutate({ assigneeId: value }, value ? `Assigned to ${nameOf(value)}` : 'Owner cleared');
    });
  }

  async function forceUnlock() {
    try {
      await api('DELETE', `/work-items/${id}/lock`);
      toast('Lock released', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
    await refresh({ comments: false });
  }

  async function postComment(event) {
    event.preventDefault();
    const textarea = $('#d-comment-body');
    const errorEl = $('#d-comment-error');
    const submit = $('#d-comment-submit');
    const body = textarea.value.trim();
    errorEl.textContent = '';
    if (!body) {
      errorEl.textContent = 'Write something first.';
      return;
    }
    // same key for the same text (safe retries/double clicks), new key for new text
    if (body !== lastCommentBody) {
      commentKey = newIdempotencyKey();
      lastCommentBody = body;
    }
    submit.disabled = true;
    try {
      await api('POST', `/work-items/${id}/comments`, { body: { body }, idempotencyKey: commentKey });
      textarea.value = '';
      lastCommentBody = null;
      toast('Note posted', 'success');
      await refresh();
    } catch (error) {
      errorEl.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  async function loadMoreComments() {
    try {
      const page = Math.floor(comments.length / COMMENT_PAGE) + 1;
      const res = await api('GET', `/work-items/${id}/comments`, { query: { pageSize: COMMENT_PAGE, page } });
      comments = [...comments, ...res.data];
      commentsMeta = res.meta;
      renderComments();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function loadMoreActivity() {
    try {
      const page = Math.floor(activity.length / ACTIVITY_PAGE) + 1;
      const res = await api('GET', `/work-items/${id}/activity`, { query: { pageSize: ACTIVITY_PAGE, page } });
      activity = [...activity, ...res.data];
      activityMeta = res.meta;
      renderActivity();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  // ---------------------------------------------------------------- events
  container.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    switch (action) {
      case 'retry':
        return loadAll();
      case 'edit':
        return startEdit();
      case 'cancel-edit':
        return endEdit();
      case 'resolve':
        return mutate({ status: 'RESOLVED' }, 'Marked as resolved');
      case 'reassign':
        return openReassign();
      case 'force-unlock':
        return forceUnlock();
      case 'more-comments':
        return loadMoreComments();
      case 'more-activity':
        return loadMoreActivity();
      case 'keep-mine':
        // try again on top of the latest version, still holding the lock
        return saveEdit(conflict?.current.version);
      case 'use-current':
        return endEdit();
      default:
    }
  });

  container.addEventListener('change', async (event) => {
    if (event.target.id !== 'd-status' || !event.target.value) return;
    const status = event.target.value;
    event.target.value = '';
    await mutate({ status }, `Moved to ${STATUSES[status]?.label ?? humanize(status)}`);
  });

  container.addEventListener('submit', (event) => {
    if (event.target.id === 'd-edit-form') {
      event.preventDefault();
      saveEdit();
    } else if (event.target.id === 'd-comment-form') {
      postComment(event);
    }
  });

  container.addEventListener('keydown', (event) => {
    if (event.target.id === 'd-comment-body' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      postComment(event);
    }
  });

  // leave the page tidily: never strand an edit lock
  const releaseOnLeave = () => {
    if (holdingLock() && (editing || busy)) {
      api('DELETE', `/work-items/${id}/lock`, { keepalive: true }).catch(() => {});
    }
  };
  const warnOnLeave = (event) => {
    if (editing && !lockLost && baseItem) {
      try {
        if (changedFields(baseItem, readDraft()).length > 0) event.preventDefault();
      } catch {
        /* form not on screen */
      }
    }
  };
  window.addEventListener('pagehide', releaseOnLeave);
  window.addEventListener('beforeunload', warnOnLeave);

  pollTimer = setInterval(() => {
    if (!editing && !busy && !conflict) refresh();
    else if (editing) renderBanner();
  }, POLL_MS);

  loadAll();

  return () => {
    disposed = true;
    clearInterval(pollTimer);
    stopHeartbeat();
    window.removeEventListener('pagehide', releaseOnLeave);
    window.removeEventListener('beforeunload', warnOnLeave);
    if (holdingLock() && editing) {
      api('DELETE', `/work-items/${id}/lock`, { keepalive: true }).catch(() => {});
    }
  };
}
