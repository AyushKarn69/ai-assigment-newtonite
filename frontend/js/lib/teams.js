// Small pure helpers for the Teams page.

/** Managers first, then alphabetically by name (case-insensitive). Does not modify the input. */
export function sortMembers(members) {
  return [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'MANAGER' ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
  });
}

/** How many managers a team has (a team must always keep at least one). */
export function managerCount(members) {
  return members.filter((m) => m.role === 'MANAGER').length;
}

/** Is this the last manager, i.e. someone who cannot be demoted or removed? */
export function isLastManager(members, member) {
  return member.role === 'MANAGER' && managerCount(members) <= 1;
}

/** "3 members · 1 manager" */
export function memberSummary(members) {
  const managers = managerCount(members);
  const people = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${people(members.length, 'member')} · ${people(managers, 'manager')}`;
}

/** Mirror of the server's email check for the add-member form. */
export function looksLikeEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text ?? '').trim());
}
