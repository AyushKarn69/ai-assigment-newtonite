import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryActivityRepository } from './activity.repository';
import { ActivityType } from './activity.entity';

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 10, 0, seconds));

describe('InMemoryActivityRepository', () => {
  let repo: InMemoryActivityRepository;

  const append = (workItemId: string, type = ActivityType.UPDATED, seconds = 0) =>
    repo.append({ workItemId, type, actorId: 'u1', createdAt: at(seconds) });

  beforeEach(() => {
    repo = new InMemoryActivityRepository();
  });

  it('ACTREPO-001: sequence numbers start at 1 and are independent per work item', async () => {
    expect((await append('w1')).sequence).toBe(1);
    expect((await append('w1')).sequence).toBe(2);
    expect((await append('w2')).sequence).toBe(1);
    expect((await append('w1')).sequence).toBe(3);
  });

  it('ACTREPO-002: concurrent appends get distinct, gap-free sequence numbers', async () => {
    const entries = await Promise.all(Array.from({ length: 25 }, () => append('w1')));

    const sequences = entries.map((e) => e.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('ACTREPO-003: list is scoped to the work item, filterable by type and orderable', async () => {
    await append('w1', ActivityType.CREATED, 0);
    await append('w1', ActivityType.UPDATED, 1);
    await append('w1', ActivityType.LOCK_ACQUIRED, 2);
    await append('w2', ActivityType.UPDATED, 3);

    const base = { workItemId: 'w1', order: 'asc' as const, page: 1, pageSize: 50 };
    const all = await repo.list(base);
    expect(all.totalCount).toBe(3);
    expect(all.items.map((e) => e.type)).toEqual([
      ActivityType.CREATED,
      ActivityType.UPDATED,
      ActivityType.LOCK_ACQUIRED,
    ]);

    const newestFirst = await repo.list({ ...base, order: 'desc' });
    expect(newestFirst.items.map((e) => e.sequence)).toEqual([3, 2, 1]);

    const onlyUpdates = await repo.list({ ...base, type: ActivityType.UPDATED });
    expect(onlyUpdates.totalCount).toBe(1);
  });

  it('ACTREPO-004: list paginates by position in the ordering', async () => {
    for (let i = 0; i < 5; i++) await append('w1', ActivityType.UPDATED, i);

    const query = { workItemId: 'w1', order: 'asc' as const, pageSize: 2 };
    const second = await repo.list({ ...query, page: 2 });
    const third = await repo.list({ ...query, page: 3 });

    expect(second.items.map((e) => e.sequence)).toEqual([3, 4]);
    expect(third.items.map((e) => e.sequence)).toEqual([5]);
    expect(third.totalCount).toBe(5);
  });

  it('ACTREPO-005: stored history cannot be altered through returned or supplied objects', async () => {
    const changes = [{ field: 'title', from: 'a', to: 'b' }];
    const metadata = { version: 2 };
    const appended = await repo.append({
      workItemId: 'w1',
      type: ActivityType.UPDATED,
      actorId: 'u1',
      createdAt: at(0),
      changes,
      metadata,
    });

    // mutate everything the caller holds
    changes[0].to = 'tampered';
    metadata.version = 99;
    appended.changes[0].to = 'tampered';
    appended.metadata.version = 99;
    appended.type = ActivityType.CREATED;

    const [stored] = (
      await repo.list({ workItemId: 'w1', order: 'asc', page: 1, pageSize: 10 })
    ).items;
    expect(stored.changes).toEqual([{ field: 'title', from: 'a', to: 'b' }]);
    expect(stored.metadata).toEqual({ version: 2 });
    expect(stored.type).toBe(ActivityType.UPDATED);

    stored.changes.length = 0; // mutating a listed entry must not affect later lists either
    const [again] = (
      await repo.list({ workItemId: 'w1', order: 'asc', page: 1, pageSize: 10 })
    ).items;
    expect(again.changes).toHaveLength(1);
  });

  it('ACTREPO-006: changes and metadata default to empty', async () => {
    const entry = await append('w1', ActivityType.LOCK_RELEASED);
    expect(entry.changes).toEqual([]);
    expect(entry.metadata).toEqual({});
  });
});
