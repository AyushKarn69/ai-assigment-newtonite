// What the UI offers to the current user. The server enforces every rule — this only
// avoids showing buttons that would be refused. Rules mirror the backend handbook.

/** Is the user an administrator? */
export function isAdmin(user) {
  return user?.role === 'ADMIN';
}

/** Can the user manage (assign, close, reopen, force-unlock) in this team? */
export function isManagerOf(user, teams, teamId) {
  if (isAdmin(user)) return true;
  return teams.some((t) => t.id === teamId && t.myRole === 'MANAGER');
}

/** Moving to CLOSED, or reopening from CLOSED, is a manager decision. */
export function transitionNeedsManager(from, to) {
  return to === 'CLOSED' || from === 'CLOSED';
}

/** Which of the server-offered transitions this user may actually perform. */
export function usableTransitions(user, teams, item) {
  const manager = isManagerOf(user, teams, item.teamId);
  return (item.allowedTransitions ?? []).filter(
    (to) => manager || !transitionNeedsManager(item.status, to),
  );
}

/** Short role label for the profile area. */
export function roleLabel(user, teams) {
  if (isAdmin(user)) return 'Administrator';
  if (teams.some((t) => t.myRole === 'MANAGER')) return 'Team Manager';
  return teams.length > 0 ? 'Team Member' : 'No team yet';
}
