import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, Harness } from '../../test-utils/harness';
import { WorkItemPriority, WorkItemStatus, WorkItemType } from '../work-items/work-item.entity';

describe('Dashboard', () => {
  let h: Harness;

  const create = (teamId: string, createdBy: string, priority: WorkItemPriority, assigneeId: string | null, status: WorkItemStatus, title: string) =>
    h.container.workItemRepository
      .create({ title, description: '', type: WorkItemType.CUSTOMER_ISSUE, priority, teamId, createdBy, assigneeId })
      .then(async (item) => {
        if (status !== WorkItemStatus.OPEN) {
          await h.container.workItemRepository.update(item.id, 1, { status });
        }
        return item;
      });

  const dashboard = async (who: string) => {
    const response = await h.api('GET', '/api/dashboard', who);
    expect(response.statusCode).toBe(200);
    return response.json().data;
  };

  beforeAll(async () => {
    h = await createHarness();
    const { alpha, beta } = h.teams;
    const { OPEN, IN_PROGRESS, BLOCKED, CLOSED, RESOLVED } = WorkItemStatus;
    const { LOW, MEDIUM, HIGH, CRITICAL } = WorkItemPriority;

    // alpha: 6 items
    await create(alpha, h.ids.mia, HIGH, h.ids.mo, OPEN, 'a1 open high mine');
    await create(alpha, h.ids.mia, CRITICAL, h.ids.mo, IN_PROGRESS, 'a2 in-progress critical mine');
    await create(alpha, h.ids.mia, LOW, null, OPEN, 'a3 open low unassigned');
    await create(alpha, h.ids.mia, MEDIUM, h.ids.max, BLOCKED, 'a4 blocked medium max');
    await create(alpha, h.ids.mia, HIGH, h.ids.mo, CLOSED, 'a5 closed high mine');
    await create(alpha, h.ids.mia, CRITICAL, null, RESOLVED, 'a6 resolved critical unassigned');
    // beta: 2 items
    await create(beta, h.ids.olga, CRITICAL, null, OPEN, 'b1 open critical unassigned');
    await create(beta, h.ids.olga, LOW, h.ids.olga, IN_PROGRESS, 'b2 in-progress low olga');
  });
  afterAll(async () => {
    await h.close();
  });

  it('DASH-001: requires authentication', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/dashboard' })).statusCode).toBe(401);
  });

  it('DASH-002: counts only the open work in the viewer\'s teams (closed/resolved excluded)', async () => {
    const mo = await dashboard('mo');

    expect(mo.counts).toEqual({
      myWork: 2, // a1, a2 — not the closed a5
      highCritical: 2, // a1, a2 — not closed a5 / resolved a6
      unassigned: 1, // a3 — not resolved a6
      blocked: 1, // a4
      open: 4, // a1..a4
      total: 6,
    });
  });

  it('DASH-003: byStatus counts every status', async () => {
    const mo = await dashboard('mo');
    expect(mo.byStatus).toEqual({
      OPEN: 2,
      IN_PROGRESS: 1,
      BLOCKED: 1,
      IN_REVIEW: 0,
      RESOLVED: 1,
      CLOSED: 1,
    });
  });

  it("DASH-004: 'my work' is personal — another member of the same team sees their own number", async () => {
    const max = await dashboard('max');
    expect(max.counts.myWork).toBe(1); // a4 is blocked but still open work
    expect(max.counts.total).toBe(6);
  });

  it('DASH-005: team load lists each visible team with open, blocked and unassigned counts', async () => {
    const mo = await dashboard('mo');
    expect(mo.teamLoad).toEqual([
      { teamId: h.teams.alpha, teamName: 'Alpha', open: 4, blocked: 1, unassigned: 1 },
    ]);
  });

  it('DASH-006: a user in a different team sees only their own team\'s numbers', async () => {
    const olga = await dashboard('olga');
    expect(olga.counts).toMatchObject({ total: 2, open: 2, myWork: 1, unassigned: 1, blocked: 0 });
    expect(olga.teamLoad.map((t: { teamName: string }) => t.teamName)).toEqual(['Beta']);
  });

  it('DASH-007: admin sees every team, busiest first', async () => {
    const admin = await dashboard('admin');
    expect(admin.counts.total).toBe(8);
    expect(admin.teamLoad.map((t: { teamName: string; open: number }) => [t.teamName, t.open])).toEqual([
      ['Alpha', 4],
      ['Beta', 2],
    ]);
  });

  it('DASH-008: a user with no teams gets an empty dashboard', async () => {
    const nina = await dashboard('nina');
    expect(nina.counts).toEqual({ myWork: 0, highCritical: 0, unassigned: 0, blocked: 0, open: 0, total: 0 });
    expect(nina.teamLoad).toEqual([]);
    expect(nina.recentActivity).toEqual([]);
    expect(Object.values(nina.byStatus).every((n) => n === 0)).toBe(true);
  });

  it('DASH-009: recent activity is newest first, capped at 10, with item key, title and actor name', async () => {
    // generate real activity through the API
    const id = await h.createItem('mo', { title: 'Activity source' });
    await h.api('POST', `/api/work-items/${id}/lock`, 'mo');
    await h.api('PATCH', `/api/work-items/${id}`, 'mo', { version: 1, title: 'Activity source (edited)' });
    await h.api('POST', `/api/work-items/${id}/comments`, 'max', { body: 'looking' });

    const mo = await dashboard('mo');
    const recent = mo.recentActivity;
    expect(recent.length).toBeLessThanOrEqual(10);
    expect(recent.map((e: { type: string }) => e.type).slice(0, 4)).toEqual([
      'COMMENT_ADDED',
      'UPDATED',
      'LOCK_ACQUIRED',
      'CREATED',
    ]);
    expect(recent[0]).toMatchObject({
      workItemId: id,
      workItemTitle: 'Activity source (edited)',
      actorName: 'max',
    });
    expect(recent[0].workItemKey).toMatch(/^NW-\d+$/);

    // never more than the cap, even with lots of activity
    for (let i = 0; i < 15; i++) await h.api('POST', `/api/work-items/${id}/comments`, 'mo', { body: `n${i}` });
    expect((await dashboard('mo')).recentActivity).toHaveLength(10);
  });

  it("DASH-010: recent activity never includes other teams' items", async () => {
    const betaItem = await h.createItem('olga', { teamId: h.teams.beta, title: 'Beta only secret' });
    await h.api('POST', `/api/work-items/${betaItem}/comments`, 'olga', { body: 'private' });

    const mo = await dashboard('mo');
    expect(mo.recentActivity.some((e: { workItemId: string }) => e.workItemId === betaItem)).toBe(false);
    const olga = await dashboard('olga');
    expect(olga.recentActivity[0].workItemId).toBe(betaItem);
    const admin = await dashboard('admin');
    expect(admin.recentActivity.some((e: { workItemId: string }) => e.workItemId === betaItem)).toBe(true);
  });

  it('DASH-011: numbers follow changes — blocking an item raises the blocked count', async () => {
    const before = (await dashboard('mia')).counts.blocked;
    const id = await h.createItem('mo', { title: 'About to block' });
    await h.api('POST', `/api/work-items/${id}/lock`, 'mo');
    await h.api('PATCH', `/api/work-items/${id}`, 'mo', { version: 1, status: 'IN_PROGRESS' });
    await h.api('PATCH', `/api/work-items/${id}`, 'mo', { version: 2, status: 'BLOCKED' });

    expect((await dashboard('mia')).counts.blocked).toBe(before + 1);
  });
});
