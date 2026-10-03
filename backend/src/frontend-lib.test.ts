// Unit tests for the web app's pure helper modules (frontend/js/lib).
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain JS modules without type declarations
import { esc, humanize, initials, shortId, relativeTime, formatDuration, excerpt } from '../../frontend/js/lib/format.js';
// @ts-expect-error plain JS modules without type declarations
import { PRESETS, OPEN_STATUSES, buildApiQuery, parseQueryString, toQueryString, pageWindow } from '../../frontend/js/lib/presets.js';
// @ts-expect-error plain JS modules without type declarations
import { isAdmin, isManagerOf, transitionNeedsManager, usableTransitions, roleLabel } from '../../frontend/js/lib/permissions.js';
// @ts-expect-error plain JS modules without type declarations
import { changedFields, conflictRows, theirOnlyChanges } from '../../frontend/js/lib/diff.js';
// @ts-expect-error plain JS modules without type declarations
import { validateRegistration, passwordStrength, byteLength } from '../../frontend/js/lib/validation.js';
// @ts-expect-error plain JS modules without type declarations
import { describeActivity } from '../../frontend/js/lib/activity.js';

describe('format', () => {
  it('UILIB-001: esc neutralises markup in text and attributes', () => {
    expect(esc('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(esc(`it's & "quoted"`)).toBe('it&#39;s &amp; &quot;quoted&quot;');
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(42)).toBe('42');
  });

  it('UILIB-002: humanize, initials and shortId', () => {
    expect(humanize('IN_PROGRESS')).toBe('In Progress');
    expect(humanize('CRITICAL')).toBe('Critical');
    expect(humanize('')).toBe('');
    expect(initials('Sarah Chen')).toBe('SC');
    expect(initials('Madonna')).toBe('MA');
    expect(initials('  ')).toBe('?');
    expect(initials('Jean Luc Picard')).toBe('JP');
    expect(shortId('123e4567-e89b-12d3')).toBe('123e4567');
  });

  it('UILIB-003: relativeTime reads naturally and tolerates bad input', () => {
    const now = Date.parse('2026-01-10T12:00:00Z');
    const ago = (s: number) => new Date(now - s * 1000).toISOString();
    expect(relativeTime(ago(2), now)).toBe('just now');
    expect(relativeTime(ago(30), now)).toBe('30s ago');
    expect(relativeTime(ago(4 * 60), now)).toBe('4m ago');
    expect(relativeTime(ago(3 * 3600), now)).toBe('3h ago');
    expect(relativeTime(ago(2 * 86400), now)).toBe('2d ago');
    expect(relativeTime('not a date', now)).toBe('');
  });

  it('UILIB-004: formatDuration and excerpt', () => {
    expect(formatDuration(40)).toBe('40s');
    expect(formatDuration(120)).toBe('2m');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(3700)).toBe('1h 1m');
    expect(formatDuration(-5)).toBe('0s');
    expect(excerpt('  lots   of\n space ')).toBe('lots of space');
    expect(excerpt('x'.repeat(200), 20)).toHaveLength(20);
    expect(excerpt('x'.repeat(200), 20).endsWith('…')).toBe(true);
  });
});

describe('presets and query building', () => {
  it('UILIB-005: each preset maps to the same filters the dashboard counters use', () => {
    const byKey = Object.fromEntries(PRESETS.map((p: any) => [p.key, p]));
    expect(byKey.mine.params).toEqual({ assignee: 'me', status: OPEN_STATUSES.join(',') });
    expect(byKey.unassigned.params).toEqual({ assignee: 'unassigned', status: OPEN_STATUSES.join(',') });
    expect(byKey.critical.params).toEqual({ priority: 'CRITICAL,HIGH', status: OPEN_STATUSES.join(',') });
    expect(byKey.blocked.params).toEqual({ status: 'BLOCKED' });
    expect(OPEN_STATUSES).not.toContain('RESOLVED');
    expect(OPEN_STATUSES).not.toContain('CLOSED');
  });

  it('UILIB-006: buildApiQuery applies defaults, sorting and paging', () => {
    expect(buildApiQuery({})).toEqual({ sortBy: 'updatedAt', sortOrder: 'desc', page: 1, pageSize: 25 });
    expect(buildApiQuery({ sort: 'priority', page: '3', pageSize: '50' })).toMatchObject({
      sortBy: 'priority',
      sortOrder: 'desc',
      page: 3,
      pageSize: 50,
    });
  });

  it('UILIB-007: an explicit dropdown choice overrides the preset for that field only', () => {
    const q = buildApiQuery({ preset: 'critical', priority: 'LOW', teamId: 't1' });
    expect(q.priority).toBe('LOW'); // overridden
    expect(q.status).toBe(OPEN_STATUSES.join(',')); // preset still applies
    expect(q.teamId).toBe('t1');
  });

  it('UILIB-008: search is trimmed and blanks are dropped; bad sizes fall back', () => {
    expect(buildApiQuery({ search: '  kafka  ' }).search).toBe('kafka');
    expect(buildApiQuery({ search: '   ' })).not.toHaveProperty('search');
    expect(buildApiQuery({ status: '' })).not.toHaveProperty('status');
    expect(buildApiQuery({ pageSize: '7', page: '-4' })).toMatchObject({ pageSize: 25, page: 1 });
    expect(buildApiQuery({ preset: 'nonsense' })).not.toHaveProperty('assignee');
  });

  it('UILIB-009: state round-trips through the URL, omitting defaults', () => {
    expect(toQueryString({ preset: 'all', page: 1, pageSize: 25, sort: 'updated', search: '' })).toBe('');
    const qs = toQueryString({ preset: 'mine', search: 'a&b', page: 2, teamId: undefined });
    expect(qs).toBe('?preset=mine&search=a%26b&page=2');
    expect(parseQueryString(qs)).toEqual({ preset: 'mine', search: 'a&b', page: '2' });
    expect(parseQueryString('')).toEqual({});
  });

  it('UILIB-010: pageWindow keeps first, last and neighbours with gaps', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(1, 20)).toEqual([1, 2, '…', 20]);
    expect(pageWindow(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20]);
    expect(pageWindow(20, 20)).toEqual([1, '…', 19, 20]);
    expect(pageWindow(1, 0)).toEqual([]);
  });
});

describe('permissions', () => {
  const admin = { id: 'a', role: 'ADMIN' };
  const user = { id: 'u', role: 'USER' };
  const teams = [
    { id: 't1', myRole: 'MANAGER' },
    { id: 't2', myRole: 'MEMBER' },
  ];

  it('UILIB-011: managers and admins can manage; members cannot', () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isManagerOf(user, teams, 't1')).toBe(true);
    expect(isManagerOf(user, teams, 't2')).toBe(false);
    expect(isManagerOf(user, teams, 'unknown')).toBe(false);
    expect(isManagerOf(admin, [], 'anything')).toBe(true);
  });

  it('UILIB-012: closing and reopening need a manager; other moves do not', () => {
    expect(transitionNeedsManager('RESOLVED', 'CLOSED')).toBe(true);
    expect(transitionNeedsManager('CLOSED', 'OPEN')).toBe(true);
    expect(transitionNeedsManager('OPEN', 'IN_PROGRESS')).toBe(false);
  });

  it('UILIB-013: usableTransitions hides moves the user would be refused', () => {
    const item = { teamId: 't2', status: 'RESOLVED', allowedTransitions: ['IN_PROGRESS', 'CLOSED'] };
    expect(usableTransitions(user, teams, item)).toEqual(['IN_PROGRESS']); // member in t2
    expect(usableTransitions(user, teams, { ...item, teamId: 't1' })).toEqual(['IN_PROGRESS', 'CLOSED']);
    expect(usableTransitions(admin, teams, item)).toEqual(['IN_PROGRESS', 'CLOSED']);
    expect(usableTransitions(user, teams, { teamId: 't1', status: 'OPEN' })).toEqual([]);
  });

  it('UILIB-014: roleLabel summarises the user', () => {
    expect(roleLabel(admin, [])).toBe('Administrator');
    expect(roleLabel(user, teams)).toBe('Team Manager');
    expect(roleLabel(user, [{ id: 't', myRole: 'MEMBER' }])).toBe('Team Member');
    expect(roleLabel(user, [])).toBe('No team yet');
  });
});

describe('diff (conflict handling)', () => {
  const base = { title: 'A', description: 'd', priority: 'LOW', type: 'CUSTOMER_ISSUE' };

  it('UILIB-015: changedFields lists only what the draft changed', () => {
    expect(changedFields(base, { title: 'B', description: 'd' })).toEqual(['title']);
    expect(changedFields(base, {})).toEqual([]);
  });

  it('UILIB-016: conflictRows flags fields both people changed differently', () => {
    const draft = { title: 'Mine', priority: 'HIGH' };
    const current = { ...base, title: 'Theirs', priority: 'HIGH' };
    const rows = conflictRows(base, draft, current);

    expect(rows).toEqual([
      { field: 'title', mine: 'Mine', current: 'Theirs', collides: true, same: false },
      { field: 'priority', mine: 'HIGH', current: 'HIGH', collides: false, same: true },
    ]);
  });

  it('UILIB-017: a field only I changed is not a collision even after a version bump', () => {
    const rows = conflictRows(base, { title: 'Mine' }, { ...base, priority: 'HIGH' });
    expect(rows).toEqual([{ field: 'title', mine: 'Mine', current: 'A', collides: false, same: false }]);
  });

  it('UILIB-018: theirOnlyChanges finds updates I did not touch', () => {
    const current = { ...base, priority: 'CRITICAL', title: 'Theirs' };
    expect(theirOnlyChanges(base, { title: 'Mine' }, current)).toEqual(['priority']);
  });
});

describe('activity wording', () => {
  const names: Record<string, string> = { u1: 'Max', u2: 'Mo' };
  const nameOf = (id: string) => names[id] ?? 'Unknown';

  it('UILIB-019: describes creation, comments and lock events', () => {
    expect(describeActivity({ type: 'CREATED', actorName: 'Mo' }, nameOf)).toMatchObject({ actor: 'Mo', verb: 'created this work item' });
    expect(describeActivity({ type: 'COMMENT_ADDED', actorName: 'Mo' }, nameOf).verb).toBe('added a comment');
    expect(describeActivity({ type: 'LOCK_ACQUIRED', actorName: 'Mo' }, nameOf).verb).toBe('started editing');
    expect(describeActivity({ type: 'LOCK_RELEASED', actorName: 'Mo' }, nameOf).verb).toBe('finished editing');
    expect(
      describeActivity({ type: 'LOCK_FORCE_RELEASED', actorName: 'Ada', metadata: { previousHolderId: 'u1' } }, nameOf).verb,
    ).toBe("released Max's edit lock");
  });

  it('UILIB-020: updates list each change with readable before/after values', () => {
    const entry = {
      type: 'UPDATED',
      actorName: 'Mo',
      changes: [
        { field: 'status', from: 'OPEN', to: 'IN_PROGRESS' },
        { field: 'assigneeId', from: null, to: 'u1' },
        { field: 'priority', from: 'LOW', to: 'HIGH' },
        { field: 'title', from: 'Old', to: 'New' },
        { field: 'description', from: 'x', to: 'y' },
      ],
    };
    const { changes } = describeActivity(entry, nameOf);

    expect(changes).toEqual([
      { label: 'status', from: 'Open', to: 'In Progress' },
      { label: 'owner', from: 'Unassigned', to: 'Max' },
      { label: 'priority', from: 'Low', to: 'High' },
      { label: 'title', from: 'Old', to: 'New' },
      { label: 'description', from: null, to: null, note: 'edited' },
    ]);
  });

  it('UILIB-021: unknown event types and missing names degrade gracefully', () => {
    expect(describeActivity({ type: 'SOMETHING_NEW' }, nameOf)).toMatchObject({ actor: 'Someone', verb: 'something new' });
  });
});

describe('sign-up form validation', () => {
  const good = { name: 'Nora New', email: 'nora@example.com', password: 'a-good-password', confirm: 'a-good-password' };

  it('UILIB-022: a complete, valid form has no errors', () => {
    expect(validateRegistration(good)).toEqual({});
    expect(validateRegistration({ ...good, name: '  Nora  ', email: ' nora@example.com ' })).toEqual({});
  });

  it('UILIB-023: each field reports its own problem', () => {
    expect(Object.keys(validateRegistration({ name: '', email: '', password: '', confirm: '' })).sort()).toEqual(['email', 'name', 'password']);
    expect(validateRegistration({ ...good, name: 'x'.repeat(101) }).name).toMatch(/too long/);
    expect(validateRegistration({ ...good, email: 'nope' }).email).toMatch(/email/);
    expect(validateRegistration({ ...good, email: 'a@b' }).email).toBeDefined();
  });

  it('UILIB-024: password rules mirror the server (8 characters, 72 bytes)', () => {
    expect(validateRegistration({ ...good, password: '1234567', confirm: '1234567' }).password).toMatch(/8/);
    expect(validateRegistration({ ...good, password: 'x'.repeat(72), confirm: 'x'.repeat(72) })).toEqual({});
    expect(validateRegistration({ ...good, password: 'x'.repeat(73), confirm: 'x'.repeat(73) }).password).toMatch(/72/);
    // 37 two-byte characters is only 37 characters but 74 bytes
    expect(byteLength('é'.repeat(37))).toBe(74);
    expect(validateRegistration({ ...good, password: 'é'.repeat(37), confirm: 'é'.repeat(37) }).password).toMatch(/72/);
  });

  it('UILIB-025: the confirmation must match, and is only checked once the password itself is fine', () => {
    expect(validateRegistration({ ...good, confirm: 'different-password' }).confirm).toMatch(/match/);
    expect(validateRegistration({ ...good, password: 'short', confirm: 'other' })).not.toHaveProperty('confirm');
  });

  it('UILIB-026: password strength is only a hint: short < ok < long and mixed', () => {
    expect(passwordStrength('short')).toBe(0);
    expect(passwordStrength('alllowercase')).toBeLessThan(passwordStrength('Mixed-Case-and-Digits-123'));
    expect(passwordStrength('Mixed-Case-and-Digits-123')).toBe(3);
    expect(passwordStrength(undefined)).toBe(0);
  });
});
