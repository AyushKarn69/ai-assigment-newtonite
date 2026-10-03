// Who is signed in, which teams they can see, and a name directory for showing people.

import { api } from './api.js';
import { shortId } from './lib/format.js';

export const state = {
  user: null, // { id, email, name, role }
  teams: [], // [{ id, name, myRole, members: [...] }]
  directory: new Map(), // userId -> { name, email }
};

/** Load the signed-in user, their teams and the people they can see. */
export async function loadSession() {
  const me = (await api('GET', '/users/me')).data;
  const teams = (await api('GET', '/teams', { query: { pageSize: 100 } })).data;

  const directory = new Map([[me.id, { name: me.name, email: me.email }]]);
  await Promise.all(
    teams.map(async (team) => {
      try {
        team.members = (await api('GET', `/teams/${team.id}/members`)).data;
      } catch {
        team.members = [];
      }
      for (const member of team.members) {
        directory.set(member.userId, { name: member.name, email: member.email });
      }
    }),
  );

  state.user = me;
  state.teams = teams;
  state.directory = directory;
}

export function clearSession() {
  state.user = null;
  state.teams = [];
  state.directory = new Map();
}

/** Display name for a user id (falls back to a short id for people we cannot see). */
export function nameOf(userId) {
  if (!userId) return 'Unassigned';
  return state.directory.get(userId)?.name ?? `User ${shortId(userId)}`;
}

export function teamById(teamId) {
  return state.teams.find((t) => t.id === teamId);
}

export function teamName(teamId) {
  return teamById(teamId)?.name ?? 'Unknown team';
}

/** People who can be assigned work in a team. */
export function membersOf(teamId) {
  return teamById(teamId)?.members ?? [];
}
