// Shared presentation helpers: badges, avatars, toasts, dialogs.

import { esc, humanize, initials } from './lib/format.js';

export const icon = (name, classes = '') =>
  `<span class="material-symbols-outlined ${classes}" aria-hidden="true">${esc(name)}</span>`;

// ---- work item vocabulary -------------------------------------------------

export const TYPES = {
  CUSTOMER_ISSUE: { label: 'Customer Issue', icon: 'support_agent', badge: 'bg-secondary-container text-on-secondary-container' },
  ENGINEERING_PROBLEM: { label: 'Engineering', icon: 'bug_report', badge: 'bg-primary-fixed text-on-primary-fixed-variant' },
  PAYMENT_INVESTIGATION: { label: 'Payment', icon: 'payments', badge: 'bg-surface-container-high text-on-surface-variant' },
  PRODUCTION_INCIDENT: { label: 'Incident', icon: 'crisis_alert', badge: 'bg-tertiary-fixed text-on-tertiary-fixed' },
  COMPLIANCE_REQUEST: { label: 'Compliance', icon: 'gavel', badge: 'bg-surface-container-high text-on-surface-variant' },
  APPROVAL_TASK: { label: 'Approval', icon: 'task_alt', badge: 'bg-primary-fixed text-on-primary-fixed-variant' },
};

export const STATUSES = {
  OPEN: { label: 'Open', badge: 'bg-secondary-container text-on-secondary-container', dot: 'bg-secondary' },
  IN_PROGRESS: { label: 'In Progress', badge: 'bg-primary-fixed text-on-primary-fixed-variant', dot: 'bg-primary' },
  BLOCKED: { label: 'Blocked', badge: 'bg-error-container text-on-error-container', dot: 'bg-error' },
  IN_REVIEW: { label: 'In Review', badge: 'bg-tertiary-fixed text-on-tertiary-fixed', dot: 'bg-tertiary' },
  RESOLVED: { label: 'Resolved', badge: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-600' },
  CLOSED: { label: 'Closed', badge: 'bg-surface-container-high text-secondary', dot: 'bg-outline' },
};

export const PRIORITIES = {
  CRITICAL: { label: 'Critical', short: 'P0', badge: 'bg-tertiary text-on-tertiary' },
  HIGH: { label: 'High', short: 'P1', badge: 'bg-primary text-on-primary' },
  MEDIUM: { label: 'Medium', short: 'P2', badge: 'bg-surface-container-high text-on-surface' },
  LOW: { label: 'Low', short: 'P3', badge: 'bg-surface-container text-secondary' },
};

export const typeBadge = (type) => {
  const t = TYPES[type] ?? { label: humanize(type), badge: 'bg-surface-container text-on-surface-variant' };
  return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${t.badge}">${esc(t.label)}</span>`;
};

export const statusBadge = (status) => {
  const s = STATUSES[status] ?? { label: humanize(status), badge: 'bg-surface-container', dot: 'bg-outline' };
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${s.badge}"><span class="w-1.5 h-1.5 rounded-full ${s.dot}"></span>${esc(s.label)}</span>`;
};

export const priorityBadge = (priority, { long = false } = {}) => {
  const p = PRIORITIES[priority] ?? { label: humanize(priority), short: '?', badge: 'bg-surface-container' };
  return `<span title="${esc(p.label)}" class="inline-flex items-center px-2 py-0.5 rounded font-mono font-bold text-[10px] ${p.badge}">${esc(long ? `${p.short} ${p.label}` : p.short)}</span>`;
};

export const typeIcon = (type) => {
  const t = TYPES[type];
  return icon(t?.icon ?? 'assignment', 'text-[17px] text-secondary');
};

// ---- people ----------------------------------------------------------------

const AVATAR_TONES = [
  'bg-primary-fixed text-on-primary-fixed-variant',
  'bg-tertiary-fixed text-on-tertiary-fixed',
  'bg-secondary-container text-on-secondary-container',
  'bg-surface-container-high text-on-surface',
];

/** A round initials avatar; the colour is stable for a given name. */
export function avatar(name, sizeClass = 'w-6 h-6 text-[10px]') {
  let hash = 0;
  for (const ch of String(name ?? '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length];
  return `<span class="inline-flex items-center justify-center rounded-full font-semibold shrink-0 ${sizeClass} ${tone}" title="${esc(name)}">${esc(initials(name))}</span>`;
}

export const personChip = (name) =>
  name
    ? `<div class="flex items-center gap-2">${avatar(name)}<span class="text-xs font-medium">${esc(name)}</span></div>`
    : `<span class="text-xs italic text-secondary">Unassigned</span>`;

// ---- feedback --------------------------------------------------------------

/** Brief message in the corner. kind: 'success' | 'error' | 'info' */
export function toast(message, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.className = 'fixed bottom-5 right-5 z-[100] flex flex-col gap-2 items-end';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const tone = {
    success: 'bg-inverse-surface text-inverse-on-surface',
    error: 'bg-error text-on-error',
    info: 'bg-inverse-surface text-inverse-on-surface',
  }[kind];
  const iconName = { success: 'check_circle', error: 'error', info: 'info' }[kind];

  const el = document.createElement('div');
  el.className = `toast-enter flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm shadow-[0_6px_24px_rgba(58,48,42,0.18)] max-w-sm ${tone}`;
  el.innerHTML = `${icon(iconName, 'text-[18px]')}<span>${esc(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}

/**
 * Open a modal dialog. `body` is trusted HTML (callers escape user text).
 * Returns { el, close } — `el` is the <dialog>; it removes itself when closed.
 */
export function openModal({ title, body, width = 'max-w-lg', onClose } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = `rounded-xl p-0 w-full ${width} bg-surface-container-lowest text-on-surface shadow-[0_12px_48px_rgba(58,48,42,0.25)] backdrop:bg-black/30`;
  dialog.innerHTML = `
    <div class="px-7 pt-6 pb-2 flex items-start justify-between gap-4">
      <h2 class="font-headline text-2xl font-semibold tracking-tight">${esc(title)}</h2>
      <button type="button" data-modal-close class="p-1 -mr-2 rounded-lg text-secondary hover:bg-surface-container" aria-label="Close">${icon('close', 'text-[20px]')}</button>
    </div>
    <div class="px-7 pb-7" data-modal-body>${body}</div>`;
  document.body.appendChild(dialog);

  // Clean up explicitly rather than relying only on the `close` event, which some
  // environments deliver late; `cleanup` is safe to call more than once.
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    dialog.remove();
    onClose?.();
  };
  const close = () => {
    if (dialog.open) dialog.close();
    cleanup();
  };
  dialog.addEventListener('close', cleanup); // e.g. the Escape key closes natively
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest('[data-modal-close]')) close();
  });
  dialog.showModal();
  return { el: dialog, close };
}

/** Form-field markup used by dialogs and the edit form. */
export const fieldClasses =
  'w-full rounded-lg bg-surface-container-lowest border border-outline-variant/60 px-3 py-2 text-sm text-on-surface placeholder:text-secondary focus:border-primary focus:ring-1 focus:ring-primary';
export const labelClasses = 'block text-xs font-semibold text-on-surface-variant mb-1.5';
export const primaryButton =
  'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-primary hover:bg-primary-container text-on-primary hover:text-on-primary-container text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed';
export const secondaryButton =
  'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg border border-outline-variant/70 bg-transparent hover:bg-surface-container text-on-surface-variant text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed';
