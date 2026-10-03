// Error, empty and loading states (modelled on the "Resilience & Operational States" screen).

import { esc } from './lib/format.js';
import { icon, primaryButton, secondaryButton } from './ui.js';

/** Card shown in place of a view when its data could not be loaded. */
export function errorState(error, { retryLabel = 'Try again', backHref = '#/work-items', backLabel = 'Return to Work Items', title: titleOverride } = {}) {
  const status = error?.status ?? 0;
  const message = esc(error?.message ?? 'Something went wrong.');

  let tag;
  let title;
  let tone = 'bg-error-container text-tertiary';
  let iconName;
  let body = message;
  let retry = false;

  if (status === 403) {
    tag = 'RBAC VIOLATION • 403';
    title = 'Operational Clearance Denied';
    iconName = 'gpp_bad';
    body = `${message} If you think you should have access, ask a manager of the team to add you.`;
  } else if (status === 404) {
    tag = 'ENTITY MISSING • 404';
    title = 'Item Not Located';
    iconName = 'search_off';
    tone = 'bg-surface-container-high text-secondary';
  } else if (status === 0) {
    tag = 'CONNECTION • OFFLINE';
    title = 'Connection Interrupted';
    iconName = 'cloud_off';
    tone = 'bg-primary-fixed text-primary';
    retry = true;
  } else if (status === 429) {
    tag = 'RATE LIMIT • 429';
    title = 'Too Many Requests';
    iconName = 'speed';
    retry = true;
  } else {
    tag = `GATEWAY DEGRADATION • ${status}`;
    title = 'Something Went Wrong';
    iconName = 'warning';
    tone = 'bg-primary-fixed text-primary';
    retry = true;
  }

  if (titleOverride) title = titleOverride;

  return `
    <div class="max-w-xl mx-auto bg-surface-container-lowest rounded-xl p-8 shadow-[0_2px_16px_rgba(58,48,42,0.04)]" role="alert">
      <div class="w-10 h-10 rounded-lg flex items-center justify-center ${tone}">${icon(iconName, 'text-[22px]')}</div>
      <p class="mt-5 text-[10px] font-mono font-bold uppercase tracking-widest text-tertiary">${esc(tag)}</p>
      <h2 class="mt-1 font-headline text-2xl font-semibold tracking-tight">${esc(title)}</h2>
      <p class="mt-3 text-sm text-on-surface-variant leading-relaxed">${body}</p>
      ${error?.code ? `<p class="mt-4 inline-block px-2.5 py-1.5 rounded bg-surface-container text-[11px] font-mono text-secondary">${esc(error.code)}</p>` : ''}
      <div class="mt-6 flex gap-2.5">
        ${retry ? `<button type="button" data-action="retry" class="${primaryButton}">${icon('refresh', 'text-[16px]')}${esc(retryLabel)}</button>` : ''}
        <a href="${esc(backHref)}" class="${secondaryButton}">${icon('arrow_back', 'text-[16px]')}${esc(backLabel)}</a>
      </div>
    </div>`;
}

/** "No Operational Records" panel; `hint` is the filter text that matched nothing. */
export function emptyState({ title = 'No Operational Records', message, hint, clearable = false } = {}) {
  return `
    <div class="py-14 px-6 text-center">
      <div class="mx-auto w-11 h-11 rounded-full bg-surface-container flex items-center justify-center text-secondary">${icon('manage_search', 'text-[22px]')}</div>
      <h3 class="mt-4 font-headline text-xl font-semibold">${esc(title)}</h3>
      <p class="mt-1.5 text-sm text-on-surface-variant">${esc(message ?? 'Nothing to show here yet.')}</p>
      ${hint ? `<p class="mt-3 inline-block px-2.5 py-1 rounded bg-surface-container text-[11px] font-mono text-secondary">${esc(hint)}</p>` : ''}
      ${clearable ? `<div class="mt-5"><button type="button" data-action="clear-filters" class="${secondaryButton}">Clear Active Filters</button></div>` : ''}
    </div>`;
}

/** Placeholder table rows while a list loads. */
export function skeletonRows(count = 6, columns = 7) {
  const cells = Array.from({ length: columns }, (_, i) => `<td class="py-4 px-4"><div class="skeleton h-3.5 ${i === 1 ? 'w-64' : 'w-16'}"></div></td>`).join('');
  return Array.from({ length: count }, () => `<tr>${cells}</tr>`).join('');
}

export const skeletonBlock = (height = 'h-40') => `<div class="skeleton ${height} w-full"></div>`;
