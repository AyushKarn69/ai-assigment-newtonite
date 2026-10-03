// Teams & Members: administrators create teams; managers add people (by email) and manage roles.

import { api, newIdempotencyKey } from '../api.js';
import { esc, formatDateTime } from '../lib/format.js';
import { isAdmin, isManagerOf } from '../lib/permissions.js';
import { isLastManager, looksLikeEmail, memberSummary, sortMembers } from '../lib/teams.js';
import { loadSession, state } from '../store.js';
import { errorState, skeletonBlock } from '../states.js';
import {
  avatar,
  fieldClasses,
  icon,
  labelClasses,
  openModal,
  primaryButton,
  secondaryButton,
  toast,
} from '../ui.js';

const roleBadge = (role) =>
  role === 'MANAGER'
    ? '<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary-fixed text-on-primary-fixed-variant">Manager</span>'
    : '<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-secondary-container text-on-secondary-container">Member</span>';

export function mountTeams(container) {
  let teams = []; // [{ id, name, description, myRole, members }]
  let disposed = false;

  const admin = () => isAdmin(state.user);

  async function load(initial) {
    if (initial) container.innerHTML = `<div class="px-4 sm:px-8 py-7 space-y-6">${skeletonBlock('h-10')}${skeletonBlock('h-64')}</div>`;
    try {
      const list = (await api('GET', '/teams', { query: { pageSize: 100 } })).data;
      await Promise.all(
        list.map(async (team) => {
          team.members = sortMembers((await api('GET', `/teams/${team.id}/members`)).data);
        }),
      );
      if (disposed) return;
      teams = list;
      render();
    } catch (error) {
      if (disposed) return;
      container.innerHTML = `<div class="px-4 sm:px-8 py-10">${errorState(error, { backHref: '#/dashboard', backLabel: 'Back to Dashboard' })}</div>`;
    }
  }

  /** Reload the teams and also the shared session data (names, roles) used elsewhere in the app. */
  async function refreshAll() {
    await loadSession();
    await load(false);
  }

  function memberRow(team, member, canManage) {
    const self = member.userId === state.user.id;
    const last = isLastManager(team.members, member);
    const roleControl = canManage
      ? `<select data-role-select data-team="${esc(team.id)}" data-user="${esc(member.userId)}" aria-label="Role of ${esc(member.name)}"
           class="h-8 px-2 rounded bg-surface-container-low text-xs focus:outline-none focus:ring-1 focus:ring-primary">
           <option value="MEMBER"${member.role === 'MEMBER' ? ' selected' : ''}>Member</option>
           <option value="MANAGER"${member.role === 'MANAGER' ? ' selected' : ''}>Manager</option>
         </select>`
      : roleBadge(member.role);
    const removeButton = canManage
      ? `<button type="button" data-remove data-team="${esc(team.id)}" data-user="${esc(member.userId)}" data-name="${esc(member.name)}"
           class="p-1.5 rounded-lg text-secondary hover:bg-error-container hover:text-on-error-container" aria-label="Remove ${esc(member.name)}" title="${last ? 'The only manager cannot be removed' : 'Remove from team'}">${icon('person_remove', 'text-[18px]')}</button>`
      : '';
    return `
      <tr class="border-t border-outline-variant/30">
        <td class="py-3 px-4">
          <div class="flex items-center gap-2.5">${avatar(member.name, 'w-8 h-8 text-xs')}
            <div class="min-w-0"><p class="text-sm font-semibold truncate">${esc(member.name)}${self ? ' <span class="text-[10px] font-normal text-secondary">(you)</span>' : ''}</p>
            <p class="text-[11px] text-secondary truncate">${esc(member.email)}</p></div></div>
        </td>
        <td class="py-3 px-3 whitespace-nowrap">${roleControl}</td>
        <td class="py-3 px-3 whitespace-nowrap text-[11px] text-secondary hidden sm:table-cell">${esc(formatDateTime(member.joinedAt))}</td>
        <td class="py-3 px-3 text-right">${removeButton}</td>
      </tr>`;
  }

  function teamCard(team) {
    const canManage = isManagerOf(state.user, state.teams, team.id) || team.myRole === 'MANAGER' || admin();
    const addForm = canManage
      ? `<form data-add-member data-team="${esc(team.id)}" class="mt-4 rounded-xl bg-surface-container-low p-4" novalidate>
           <p class="${labelClasses}">Add a person to ${esc(team.name)}</p>
           <div class="flex flex-col sm:flex-row gap-2.5">
             <input name="email" type="email" aria-label="Email of the person to add" placeholder="their registered email" class="${fieldClasses} flex-1" />
             <select name="role" aria-label="Role" class="${fieldClasses} sm:w-36"><option value="MEMBER">Member</option><option value="MANAGER">Manager</option></select>
             <button type="submit" class="${primaryButton}">${icon('person_add', 'text-[16px]')}Add</button>
           </div>
           <p class="mt-2 text-[11px] text-error hidden" data-error></p>
           <p class="mt-2 text-[11px] text-secondary">They must have created an account first (Sign in → Create an account).</p>
         </form>`
      : '';
    return `
      <section class="bg-surface-container-lowest rounded-xl shadow-[0_2px_16px_rgba(58,48,42,0.04)] overflow-hidden" data-team-card="${esc(team.id)}">
        <div class="px-6 pt-6 pb-3 flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="font-headline text-2xl font-semibold tracking-tight">${esc(team.name)}</h2>
            ${team.description ? `<p class="mt-1 text-sm text-on-surface-variant">${esc(team.description)}</p>` : ''}
          </div>
          <div class="text-right">
            <p class="text-[11px] font-mono text-secondary">${esc(memberSummary(team.members))}</p>
            <p class="mt-1">${team.myRole ? roleBadge(team.myRole) : '<span class="text-[11px] text-secondary">Administrator view</span>'}</p>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead><tr class="text-[10px] font-mono uppercase tracking-widest text-secondary">
              <th class="py-2 px-4 font-bold">Person</th><th class="py-2 px-3 font-bold">Role</th><th class="py-2 px-3 font-bold hidden sm:table-cell">Joined</th><th></th>
            </tr></thead>
            <tbody>${team.members.map((m) => memberRow(team, m, canManage)).join('') || '<tr><td colspan="4" class="px-4 py-6 text-sm text-on-surface-variant">No members yet.</td></tr>'}</tbody>
          </table>
        </div>
        <div class="px-6 pb-6">${addForm}</div>
      </section>`;
  }

  function render() {
    const mine = state.teams.length > 0;
    const body = teams.length
      ? teams.map(teamCard).join('')
      : `<div class="bg-surface-container-lowest rounded-xl p-10 text-center shadow-[0_2px_16px_rgba(58,48,42,0.04)]">
           <div class="mx-auto w-11 h-11 rounded-full bg-surface-container flex items-center justify-center text-secondary">${icon('groups', 'text-[22px]')}</div>
           <h2 class="mt-4 font-headline text-xl font-semibold">${admin() ? 'No teams yet' : 'You are not in a team yet'}</h2>
           <p class="mt-1.5 text-sm text-on-surface-variant">${admin() ? 'Create the first team, then add people to it by email.' : `Ask a team manager or an administrator to add you, using your email <strong class="font-mono">${esc(state.user.email)}</strong>.`}</p>
         </div>`;

    container.innerHTML = `
      <div class="px-4 sm:px-8 py-7 space-y-6">
        <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <span class="text-[11px] font-mono uppercase tracking-widest text-primary font-bold">People &amp; Access</span>
            <h1 class="mt-1 text-3xl lg:text-4xl font-headline font-semibold tracking-tight leading-none">Teams &amp; Members</h1>
            <p class="mt-2 text-sm text-on-surface-variant max-w-2xl">${admin() ? 'Create teams and add the people who register. Managers can then add and organise their own team.' : mine ? 'Managers can add people to their team by email and change roles.' : ''}</p>
          </div>
          ${admin() ? `<button type="button" data-action="new-team" class="${primaryButton} h-10 px-4 self-start md:self-auto">${icon('add', 'text-[16px]')}New Team</button>` : ''}
        </div>
        <div class="space-y-6">${body}</div>
      </div>`;
  }

  // ---- new team (administrators) ----
  function openNewTeam() {
    const modal = openModal({
      title: 'New team',
      body: `
        <form id="new-team-form" class="space-y-4 mt-2" novalidate>
          <div id="nt-error" class="hidden rounded-lg px-3.5 py-2.5 text-xs bg-error-container text-on-error-container" role="alert"></div>
          <div><label class="${labelClasses}" for="nt-name">Team name</label>
            <input id="nt-name" name="name" maxlength="100" class="${fieldClasses}" placeholder="e.g. Platform Engineering" /></div>
          <div><label class="${labelClasses}" for="nt-desc">Description <span class="font-normal text-secondary">(optional)</span></label>
            <input id="nt-desc" name="description" maxlength="500" class="${fieldClasses}" /></div>
          <div><label class="${labelClasses}" for="nt-manager">First manager's email <span class="font-normal text-secondary">(optional — you can add people afterwards)</span></label>
            <input id="nt-manager" name="manager" type="email" class="${fieldClasses}" placeholder="their registered email" /></div>
          <div class="flex justify-end gap-2.5">
            <button type="button" data-modal-close class="${secondaryButton}">Cancel</button>
            <button type="submit" id="nt-submit" class="${primaryButton}">${icon('add', 'text-[16px]')}Create team</button>
          </div>
        </form>`,
    });
    const form = modal.el.querySelector('#new-team-form');
    const errorBox = modal.el.querySelector('#nt-error');
    const submit = modal.el.querySelector('#nt-submit');
    const key = newIdempotencyKey();
    form.elements.name.focus();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.classList.add('hidden');
      const name = form.elements.name.value.trim();
      const managerEmail = form.elements.manager.value.trim();
      if (!name) return showError('Give the team a name.');
      if (managerEmail && !looksLikeEmail(managerEmail)) return showError('That manager email does not look right.');

      submit.disabled = true;
      try {
        const description = form.elements.description.value.trim() || undefined;
        const { data: team } = await api('POST', '/teams', { body: { name, description }, idempotencyKey: key });
        if (managerEmail) {
          try {
            await api('POST', `/teams/${team.id}/members`, { body: { email: managerEmail, role: 'MANAGER' } });
          } catch (error) {
            toast(`Team created, but ${managerEmail} could not be added: ${error.message}`, 'error');
          }
        }
        modal.close();
        toast(`Team "${team.name}" created`, 'success');
        await refreshAll();
      } catch (error) {
        submit.disabled = false;
        showError(error.code === 'TEAM_NAME_TAKEN' ? 'A team with that name already exists.' : error.message);
      }
    });

    function showError(message) {
      errorBox.textContent = message;
      errorBox.classList.remove('hidden');
    }
  }

  // ---- events ----
  container.addEventListener('click', async (event) => {
    if (event.target.closest('[data-action="retry"]')) return load(true);
    if (event.target.closest('[data-action="new-team"]')) return openNewTeam();

    const remove = event.target.closest('[data-remove]');
    if (remove) {
      const { team, user, name } = remove.dataset;
      if (!window.confirm(`Remove ${name} from this team? They will lose access to its work items.`)) return;
      try {
        await api('DELETE', `/teams/${team}/members/${user}`);
        toast(`${name} removed`, 'success');
        await refreshAll();
      } catch (error) {
        toast(
          error.code === 'TEAM_REQUIRES_MANAGER' ? 'A team must keep at least one manager. Make someone else a manager first.' : error.message,
          'error',
        );
      }
    }
  });

  container.addEventListener('change', async (event) => {
    const select = event.target.closest('[data-role-select]');
    if (!select) return;
    const { team, user } = select.dataset;
    try {
      await api('PATCH', `/teams/${team}/members/${user}`, { body: { role: select.value } });
      toast('Role updated', 'success');
    } catch (error) {
      toast(
        error.code === 'TEAM_REQUIRES_MANAGER' ? 'A team must keep at least one manager. Make someone else a manager first.' : error.message,
        'error',
      );
    }
    await refreshAll(); // also puts the select back if the change was refused
  });

  container.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-add-member]');
    if (!form) return;
    event.preventDefault();

    const errorEl = form.querySelector('[data-error]');
    const show = (message) => {
      errorEl.textContent = message;
      errorEl.classList.toggle('hidden', !message);
    };
    show('');

    const email = form.elements.email.value.trim();
    if (!looksLikeEmail(email)) return show('Enter the email address they registered with.');

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { data } = await api('POST', `/teams/${form.dataset.team}/members`, {
        body: { email, role: form.elements.role.value },
      });
      toast(`${data.name} added`, 'success');
      await refreshAll();
    } catch (error) {
      button.disabled = false;
      if (error.code === 'USER_NOT_FOUND') show('Nobody is registered with that email yet. Ask them to create an account first.');
      else if (error.code === 'ALREADY_TEAM_MEMBER') show('They are already in this team.');
      else show(error.message);
    }
  });

  load(true);
  return () => {
    disposed = true;
  };
}
