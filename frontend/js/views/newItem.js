// "New Work Item" dialog.

import { api, newIdempotencyKey } from '../api.js';
import { esc } from '../lib/format.js';
import { isManagerOf } from '../lib/permissions.js';
import { membersOf, state } from '../store.js';
import {
  PRIORITIES,
  TYPES,
  fieldClasses,
  icon,
  labelClasses,
  openModal,
  primaryButton,
  secondaryButton,
  toast,
} from '../ui.js';

const option = (value, label, selected = false) =>
  `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;

/** @param defaultTeamId  team to preselect (e.g. the one currently filtered) */
export function openNewItemModal({ defaultTeamId } = {}) {
  if (state.teams.length === 0) {
    toast('You need to be a member of a team before you can create work items.', 'error');
    return;
  }
  const initialTeam = state.teams.find((t) => t.id === defaultTeamId) ?? state.teams[0];

  const modal = openModal({
    title: 'New Work Item',
    width: 'max-w-xl',
    body: `
      <form id="new-item-form" class="space-y-4 mt-2" novalidate>
        <div id="new-item-error" class="hidden rounded-lg px-3.5 py-2.5 text-xs bg-error-container text-on-error-container" role="alert"></div>
        <div>
          <label class="${labelClasses}" for="ni-title">Title</label>
          <input id="ni-title" name="title" maxlength="200" class="${fieldClasses}" placeholder="What needs attention?" required />
          <p class="mt-1 text-[11px] text-error hidden" data-error-for="title"></p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="${labelClasses}" for="ni-team">Team</label>
            <select id="ni-team" name="teamId" class="${fieldClasses}">
              ${state.teams.map((t) => option(t.id, t.name, t.id === initialTeam.id)).join('')}
            </select>
          </div>
          <div>
            <label class="${labelClasses}" for="ni-type">Type</label>
            <select id="ni-type" name="type" class="${fieldClasses}">
              ${Object.entries(TYPES).map(([value, t]) => option(value, t.label)).join('')}
            </select>
          </div>
          <div>
            <label class="${labelClasses}" for="ni-priority">Priority</label>
            <select id="ni-priority" name="priority" class="${fieldClasses}">
              ${Object.entries(PRIORITIES).reverse().map(([value, p]) => option(value, `${p.short} · ${p.label}`, value === 'MEDIUM')).join('')}
            </select>
          </div>
        </div>
        <div id="ni-assignee-row" class="hidden">
          <label class="${labelClasses}" for="ni-assignee">Owner <span class="font-normal text-secondary">(managers can assign)</span></label>
          <select id="ni-assignee" name="assigneeId" class="${fieldClasses}"></select>
        </div>
        <div>
          <label class="${labelClasses}" for="ni-description">Description</label>
          <textarea id="ni-description" name="description" rows="5" maxlength="5000" class="${fieldClasses}" placeholder="Context, impact and anything the team needs to know"></textarea>
        </div>
        <div class="flex justify-end gap-2.5 pt-1">
          <button type="button" data-modal-close class="${secondaryButton}">Cancel</button>
          <button type="submit" id="ni-submit" class="${primaryButton}">${icon('add', 'text-[16px]')}Create Work Item</button>
        </div>
      </form>`,
  });

  const form = modal.el.querySelector('#new-item-form');
  const teamSelect = form.querySelector('#ni-team');
  const assigneeRow = form.querySelector('#ni-assignee-row');
  const assigneeSelect = form.querySelector('#ni-assignee');
  const errorBox = form.querySelector('#new-item-error');
  const submit = form.querySelector('#ni-submit');

  // Only managers of the chosen team may set an owner at creation
  function syncAssignee() {
    const teamId = teamSelect.value;
    const canAssign = isManagerOf(state.user, state.teams, teamId);
    assigneeRow.classList.toggle('hidden', !canAssign);
    assigneeSelect.innerHTML =
      option('', 'Unassigned') + membersOf(teamId).map((m) => option(m.userId, m.name)).join('');
  }
  teamSelect.addEventListener('change', syncAssignee);
  syncAssignee();
  form.querySelector('#ni-title').focus();

  const clearErrors = () => {
    errorBox.classList.add('hidden');
    form.querySelectorAll('[data-error-for]').forEach((el) => el.classList.add('hidden'));
  };

  // One idempotency key per distinct payload: a double-click or a retry after a dropped
  // connection can never create two items, but an edited form gets a fresh key.
  let lastPayload = null;
  let key = newIdempotencyKey();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();

    const data = Object.fromEntries(new FormData(form));
    const payload = {
      title: String(data.title ?? '').trim(),
      description: String(data.description ?? '').trim() || undefined,
      type: data.type,
      priority: data.priority,
      teamId: data.teamId,
      assigneeId: !assigneeRow.classList.contains('hidden') && data.assigneeId ? data.assigneeId : undefined,
    };
    if (!payload.title) {
      const el = form.querySelector('[data-error-for="title"]');
      el.textContent = 'Give the work item a title.';
      el.classList.remove('hidden');
      form.querySelector('#ni-title').focus();
      return;
    }

    const serialized = JSON.stringify(payload);
    if (serialized !== lastPayload) {
      key = newIdempotencyKey();
      lastPayload = serialized;
    }

    submit.disabled = true;
    try {
      const { data: created } = await api('POST', '/work-items', { body: payload, idempotencyKey: key });
      modal.close();
      toast(`${created.key} created`, 'success');
      location.hash = `#/work-items/${created.id}`;
    } catch (error) {
      submit.disabled = false;
      if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
        for (const detail of error.details) {
          const el = form.querySelector(`[data-error-for="${detail.path}"]`);
          if (el) {
            el.textContent = detail.message;
            el.classList.remove('hidden');
          }
        }
        errorBox.textContent = 'Please check the highlighted fields.';
      } else {
        errorBox.textContent = error.message;
      }
      errorBox.classList.remove('hidden');
    }
  });
}
