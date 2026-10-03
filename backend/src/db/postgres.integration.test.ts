// Integration tests that run against a REAL PostgreSQL database (TEST_DATABASE_URL).
// They are skipped when no test database is configured. All of them live in this one file
// because they share the database and each test starts from empty tables.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient, Prisma } from '../shared/db/prisma';
import { createTestConfig } from '../config';
import { createContainer } from '../container';
import { createHarness, Harness } from '../test-utils/harness';
import { resetDatabase, testDatabaseUrl, testPrisma } from '../test-utils/db';
import { WorkItemPriority, WorkItemType } from '../modules/work-items/work-item.entity';
import { ActivityType } from '../modules/activity/activity.entity';

const url = testDatabaseUrl();
const MINUTE = 60_000;
const T0 = new Date('2026-05-01T12:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);

describe.skipIf(!url)('PostgreSQL integration', () => {
  let h: Harness;
  let db: PrismaClient;
  let nowMs: number;
  const clock = { now: () => new Date(nowMs) };

  beforeEach(async () => {
    nowMs = T0.getTime();
    db = testPrisma();
    await resetDatabase();
    h = await createHarness({ prisma: db, clock, config: { LOCK_TIMEOUT_MINUTES: 30 } });
  });
  afterEach(async () => {
    await h.close();
  });

  // ---- helpers ----
  const lockStore = () => h.container.workItemLockStore;
  const tx = () => h.container.workItemTransactions;

  /** A user row without the cost of password hashing. */
  async function makeUser(name: string): Promise<string> {
    const user = await h.container.userRepository.create({
      email: `${name}@db.test`,
      name,
      password: 'unused',
      passwordHash: 'not-a-real-hash',
    });
    return user.id;
  }

  async function newItemId(): Promise<string> {
    return h.createItem('mo');
  }

  const lockRows = (workItemId: string) => db.workItemLock.findMany({ where: { workItemId } });
  const itemRow = (id: string) => db.workItem.findUniqueOrThrow({ where: { id } });
  const activityCount = (id: string) => db.activity.count({ where: { workItemId: id } });

  const buildTitleUpdate = (actorId: string, itemId: string, title: string) => ({
    patch: { title },
    buildActivity: (before: { title: string }, after: { version: number }) => ({
      workItemId: itemId,
      type: ActivityType.UPDATED,
      actorId,
      changes: [{ field: 'title', from: before.title, to: title }],
      metadata: { version: after.version },
    }),
  });

  // =====================================================================
  describe('persistence', () => {
    it('DB-PERSIST-001: everything survives a restart (new connection, new container)', async () => {
      const itemId = await h.createItem('mo', { title: 'Survives restart' });
      await h.api('POST', `/api/work-items/${itemId}/lock`, 'mo');
      await h.api('PATCH', `/api/work-items/${itemId}`, 'mo', { version: 1, title: 'Edited before restart', priority: 'HIGH' });
      await h.api('POST', `/api/work-items/${itemId}/comments`, 'max', { body: 'noted before restart' });
      await h.container.jobQueue.drain();
      const lockBefore = (await h.container.workItemLockStore.get(itemId, clock.now()))!;

      // a brand-new connection pool and container, as after a server restart
      const fresh = new PrismaClient({ datasources: { db: { url: url! } } });
      try {
        const after = createContainer(createTestConfig({ DATABASE_URL: url }), { prisma: fresh, clock });

        const item = (await after.workItemRepository.findById(itemId))!;
        expect(item).toMatchObject({ title: 'Edited before restart', priority: 'HIGH', version: 2 });
        expect(item.key).toMatch(/^NW-\d+$/);

        const history = await after.activityRepository.list({ workItemId: itemId, order: 'asc', page: 1, pageSize: 50 });
        expect(history.items.map((e) => e.type)).toEqual(['CREATED', 'LOCK_ACQUIRED', 'UPDATED', 'COMMENT_ADDED']);
        expect(history.items.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);

        const comments = await after.commentRepository.list({ workItemId: itemId, order: 'asc', page: 1, pageSize: 10 });
        expect(comments.items.map((c) => c.body)).toEqual(['noted before restart']);

        const team = await after.teamRepository.findById(h.teams.alpha);
        expect(team?.name).toBe('Alpha');
        expect((await after.teamRepository.findMember(h.teams.alpha, h.ids.mia))?.role).toBe('MANAGER');

        // the edit lease is stored too: same holder, same token
        const lockAfter = await after.workItemLockStore.get(itemId, clock.now());
        expect(lockAfter).toMatchObject({ lockedBy: h.ids.mo, token: lockBefore.token });

        // and so are accounts: logging in works against the stored password hash
        const login = await after.authService.login({ email: 'mo@example.com', password: 'a-long-test-password' });
        expect(login.user.name).toBe('mo');

        // notifications generated in the background were stored as well
        const inbox = await after.notificationRepository.list({ userId: h.ids.mo, unreadOnly: false, page: 1, pageSize: 10 });
        expect(inbox.items.map((n) => n.type)).toContain('COMMENT_ADDED');
      } finally {
        await fresh.$disconnect();
      }
    });

    it('DB-PERSIST-002: the database itself enforces uniqueness and foreign keys', async () => {
      const code = async (promise: Promise<unknown>) => {
        try {
          await promise;
          return 'no error';
        } catch (error) {
          return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : String(error);
        }
      };
      const itemId = await newItemId();
      const seq = (await itemRow(itemId)).activitySeq;

      // unique constraints (P2002)
      expect(await code(db.user.create({ data: { email: 'mo@example.com', name: 'dup', passwordHash: 'x' } }))).toBe('P2002');
      expect(await code(db.team.create({ data: { name: 'ALPHA', nameKey: 'alpha' } }))).toBe('P2002');
      expect(await code(db.activity.create({ data: { workItemId: itemId, sequence: seq, type: 'UPDATED', actorId: h.ids.mo, createdAt: T0 } }))).toBe('P2002');
      expect(await code(db.teamMember.create({ data: { teamId: h.teams.alpha, userId: h.ids.mo, role: 'MEMBER' } }))).toBe('P2002');

      // foreign keys (P2003)
      expect(await code(db.workItem.create({ data: { number: 999999, key: 'NW-999999', title: 't', type: 'CUSTOMER_ISSUE', teamId: 'no-such-team', createdBy: h.ids.mo } }))).toBe('P2003');
      expect(await code(db.comment.create({ data: { workItemId: 'no-such-item', authorId: h.ids.mo, body: 'x', createdAt: T0 } }))).toBe('P2003');
      expect(await code(db.workItemLock.create({ data: { workItemId: 'no-such-item', lockedBy: h.ids.mo, token: 't', acquiredAt: T0, expiresAt: at(30) } }))).toBe('P2003');
    });

    it('DB-PERSIST-003: work item numbers come from a database sequence and are never reused', async () => {
      const ids = await Promise.all(Array.from({ length: 15 }, () => newItemId()));
      const numbers = (await db.workItem.findMany({ where: { id: { in: ids } } })).map((r) => r.number);

      expect(new Set(numbers).size).toBe(15);
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(1);
      const rows = await db.workItem.findMany({ where: { id: { in: ids } } });
      for (const row of rows) expect(row.key).toBe(`NW-${row.number}`);
    });

    it('DB-PERSIST-004: deleting a work item removes its lock, history and comments with it', async () => {
      const itemId = await newItemId();
      await h.api('POST', `/api/work-items/${itemId}/lock`, 'mo');
      await h.api('POST', `/api/work-items/${itemId}/comments`, 'mo', { body: 'bye' });
      await h.container.jobQueue.drain();

      await db.workItem.delete({ where: { id: itemId } });
      expect(await lockRows(itemId)).toHaveLength(0);
      expect(await activityCount(itemId)).toBe(0);
      expect(await db.comment.count({ where: { workItemId: itemId } })).toBe(0);
    });
  });

  // =====================================================================
  describe('work item change + activity are one transaction', () => {
    it('DB-ATOM-001: a save stores the change and its history entry together, in sequence', async () => {
      const itemId = await newItemId();
      await h.api('POST', `/api/work-items/${itemId}/lock`, 'mo');
      const before = await itemRow(itemId);

      const response = await h.api('PATCH', `/api/work-items/${itemId}`, 'mo', { version: 1, title: 'Changed', priority: 'CRITICAL' });
      expect(response.statusCode).toBe(200);

      const after = await itemRow(itemId);
      expect(after).toMatchObject({ title: 'Changed', priority: 'CRITICAL', version: 2 });
      const entry = await db.activity.findFirstOrThrow({ where: { workItemId: itemId, type: 'UPDATED' } });
      expect(entry.sequence).toBe(before.activitySeq + 1); // the very next number after the lock event
      expect(entry.changes).toEqual([
        { field: 'title', from: 'Payment stuck in pending', to: 'Changed' },
        { field: 'priority', from: 'MEDIUM', to: 'CRITICAL' },
      ]);
    });

    it('DB-ATOM-002: if the history entry cannot be written, the work item change is rolled back', async () => {
      const itemId = await newItemId();
      await lockStore().acquire(itemId, h.ids.mo, clock.now(), 30 * MINUTE);
      const proof = { userId: h.ids.mo, token: (await lockStore().get(itemId, clock.now()))!.token };
      const before = await itemRow(itemId);
      const historyBefore = await activityCount(itemId);

      // an activity entry pointing at a user that does not exist violates a foreign key
      await expect(
        tx().updateWithActivity({
          id: itemId,
          patch: { title: 'Should not stick' },
          proof,
          now: clock.now(),
          buildActivity: (b, a) => ({
            workItemId: itemId,
            type: ActivityType.UPDATED,
            actorId: 'no-such-user',
            changes: [{ field: 'title', from: b.title, to: 'Should not stick' }],
            metadata: { version: a.version },
          }),
        }),
      ).rejects.toThrow();

      const after = await itemRow(itemId);
      expect(after.title).toBe(before.title);
      expect(after.version).toBe(before.version);
      expect(after.activitySeq).toBe(before.activitySeq); // not even the sequence number was consumed
      expect(await activityCount(itemId)).toBe(historyBefore);
    });

    it('DB-ATOM-003: if building the history entry fails, nothing is stored', async () => {
      const itemId = await newItemId();
      await lockStore().acquire(itemId, h.ids.mo, clock.now(), 30 * MINUTE);
      const proof = { userId: h.ids.mo, token: (await lockStore().get(itemId, clock.now()))!.token };
      const before = await itemRow(itemId);

      await expect(
        tx().updateWithActivity({
          id: itemId,
          patch: { status: 'IN_PROGRESS' as never, title: 'nope' },
          proof,
          now: clock.now(),
          buildActivity: () => {
            throw new Error('boom');
          },
        }),
      ).rejects.toThrow('boom');

      const after = await itemRow(itemId);
      expect(after).toMatchObject({ title: before.title, status: before.status, version: before.version });
    });

    it('DB-ATOM-004: creating a work item is atomic with its CREATED entry', async () => {
      const countBefore = await db.workItem.count();
      await expect(
        tx().createWithActivity(
          { title: 'Orphan', description: '', type: WorkItemType.CUSTOMER_ISSUE, priority: WorkItemPriority.LOW, teamId: h.teams.alpha, createdBy: h.ids.mo, assigneeId: null },
          (item) => ({ workItemId: item.id, type: ActivityType.CREATED, actorId: 'no-such-user' }),
          clock.now(),
        ),
      ).rejects.toThrow();

      expect(await db.workItem.count()).toBe(countBefore);
      expect(await db.workItem.findFirst({ where: { title: 'Orphan' } })).toBeNull();

      // and the success path stores both
      const created = await tx().createWithActivity(
        { title: 'Whole', description: '', type: WorkItemType.CUSTOMER_ISSUE, priority: WorkItemPriority.LOW, teamId: h.teams.alpha, createdBy: h.ids.mo, assigneeId: null },
        (item) => ({ workItemId: item.id, type: ActivityType.CREATED, actorId: h.ids.mo }),
        clock.now(),
      );
      expect(created.activity.sequence).toBe(1);
      expect(await activityCount(created.item.id)).toBe(1);
    });

    it('DB-ATOM-005: the history never disagrees with the item — entries equal the counter, sequences have no gaps', async () => {
      const itemId = await newItemId();
      await h.api('POST', `/api/work-items/${itemId}/lock`, 'mo');
      await h.api('PATCH', `/api/work-items/${itemId}`, 'mo', { version: 1, title: 'a' });
      await h.api('PATCH', `/api/work-items/${itemId}`, 'mo', { version: 2, title: 'b' });
      await h.api('POST', `/api/work-items/${itemId}/comments`, 'max', { body: 'c' });
      await h.api('DELETE', `/api/work-items/${itemId}/lock`, 'mo');
      await h.api('POST', `/api/work-items/${itemId}/lock`, 'mia');
      await h.api('DELETE', `/api/work-items/${itemId}/lock`, 'admin'); // force release

      const entries = await db.activity.findMany({ where: { workItemId: itemId }, orderBy: { sequence: 'asc' } });
      const row = await itemRow(itemId);
      expect(entries.length).toBe(row.activitySeq);
      expect(entries.map((e) => e.sequence)).toEqual(entries.map((_, i) => i + 1));
      expect(entries.map((e) => e.type)).toEqual([
        'CREATED', 'LOCK_ACQUIRED', 'UPDATED', 'UPDATED', 'COMMENT_ADDED', 'LOCK_RELEASED', 'LOCK_ACQUIRED', 'LOCK_FORCE_RELEASED',
      ]);
    });

    it('DB-ATOM-006: simultaneous appends get distinct, gap-free sequence numbers', async () => {
      const itemId = await newItemId();
      await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          h.container.activityRepository.append({ workItemId: itemId, type: ActivityType.COMMENT_ADDED, actorId: h.ids.mo, createdAt: clock.now(), metadata: { n: i } }),
        ),
      );
      const sequences = (await db.activity.findMany({ where: { workItemId: itemId }, orderBy: { sequence: 'asc' } })).map((e) => e.sequence);
      expect(sequences).toEqual(Array.from({ length: 26 }, (_, i) => i + 1)); // 1 = CREATED, 2..26 = the appends
    });

    it('DB-ATOM-007: the write is protected by the lock, not by comparing versions — parallel saves by the holder all land', async () => {
      const itemId = await newItemId();
      await lockStore().acquire(itemId, h.ids.mo, clock.now(), 30 * MINUTE);
      const proof = { userId: h.ids.mo, token: (await lockStore().get(itemId, clock.now()))!.token };

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          tx().updateWithActivity({ id: itemId, proof, now: clock.now(), ...buildTitleUpdate(h.ids.mo, itemId, `title ${i}`) }),
        ),
      );
      expect(results.every((r) => r.ok)).toBe(true);

      const row = await itemRow(itemId);
      expect(row.version).toBe(11); // 1 + ten saves: no lost updates
      const updates = await db.activity.findMany({ where: { workItemId: itemId, type: 'UPDATED' }, orderBy: { sequence: 'asc' } });
      expect(updates).toHaveLength(10);
      expect(new Set(updates.map((u) => u.sequence)).size).toBe(10);
    });
  });

  // =====================================================================
  describe('locking', () => {
    it('DB-LOCK-001: 25 users acquiring at the same instant produce exactly one winner', async () => {
      const itemId = await newItemId();
      const users = await Promise.all(Array.from({ length: 25 }, (_, i) => makeUser(`racer${i}`)));

      const results = await Promise.all(users.map((u) => lockStore().acquire(itemId, u, clock.now(), 30 * MINUTE)));

      const winners = results.filter((r) => r.acquired);
      expect(winners).toHaveLength(1);
      const rows = await lockRows(itemId);
      expect(rows).toHaveLength(1); // the primary key allows only one lock row per item
      expect(rows[0].lockedBy).toBe(winners[0].lock.lockedBy);
      expect(rows[0].token).toBe(winners[0].lock.token);
      for (const loser of results.filter((r) => !r.acquired)) {
        expect(loser.lock.lockedBy).toBe(rows[0].lockedBy); // every loser is told who holds it
      }
    });

    it('DB-LOCK-002: the same race through the API: one 200, the rest 423 naming the holder', async () => {
      const itemId = await newItemId();
      const people = ['mia', 'mo', 'max', 'admin'];

      const responses = await Promise.all(people.map((who) => h.api('POST', `/api/work-items/${itemId}/lock`, who)));
      const codes = responses.map((r) => r.statusCode).sort();
      expect(codes).toEqual([200, 423, 423, 423]);

      const winner = people[responses.findIndex((r) => r.statusCode === 200)];
      expect((await lockRows(itemId))[0].lockedBy).toBe(h.ids[winner]);
      for (const loser of responses.filter((r) => r.statusCode === 423)) {
        expect(loser.json().error.lockInfo.lockedBy).toBe(h.ids[winner]);
      }
    });

    it('DB-LOCK-003: renewal keeps the token and start time; the heartbeat extends the 30-minute window; times round-trip exactly', async () => {
      const itemId = await newItemId();
      const first = await lockStore().acquire(itemId, h.ids.mo, at(0), 30 * MINUTE);
      expect(first.acquired && first.lock.expiresAt.toISOString()).toBe(at(30).toISOString());

      // the stored values are exactly what we gave (no time-zone shift)
      const row = (await lockRows(itemId))[0];
      expect(row.acquiredAt.toISOString()).toBe(at(0).toISOString());
      expect(row.expiresAt.toISOString()).toBe(at(30).toISOString());

      // heartbeat at +20 min restarts the window: now valid until +50
      const extended = await lockStore().extend(itemId, h.ids.mo, at(20), 30 * MINUTE);
      expect(extended?.expiresAt.toISOString()).toBe(at(50).toISOString());
      expect(await lockStore().get(itemId, at(49))).not.toBeNull();
      expect(await lockStore().get(itemId, at(50))).toBeNull(); // exactly at expiry: gone

      // re-acquiring your own live lock is a renewal: same token, original start time
      const again = await lockStore().acquire(itemId, h.ids.mo, at(40), 30 * MINUTE);
      expect(again).toMatchObject({ acquired: true, renewed: true });
      expect(again.lock.token).toBe(first.lock.token);
      expect(again.lock.acquiredAt.toISOString()).toBe(at(0).toISOString());
    });

    it('DB-LOCK-004: only the live holder can extend or release', async () => {
      const itemId = await newItemId();
      await lockStore().acquire(itemId, h.ids.mo, at(0), 30 * MINUTE);

      expect(await lockStore().extend(itemId, h.ids.max, at(1), 30 * MINUTE)).toBeNull(); // not the holder
      expect(await lockStore().extend(itemId, h.ids.mo, at(31), 30 * MINUTE)).toBeNull(); // expired: cannot revive
      expect(await lockStore().release(itemId, h.ids.max)).toBe(false);
      expect(await lockRows(itemId)).toHaveLength(1);
      expect(await lockStore().release(itemId, h.ids.mo)).toBe(true);
      expect(await lockRows(itemId)).toHaveLength(0);
    });

    it('DB-LOCK-005: an expired lease is replaced by the next acquirer, with a new token', async () => {
      const itemId = await newItemId();
      const old = await lockStore().acquire(itemId, h.ids.mo, at(0), 30 * MINUTE);

      const blocked = await lockStore().acquire(itemId, h.ids.max, at(29), 30 * MINUTE);
      expect(blocked.acquired).toBe(false); // still held at +29

      const replaced = await lockStore().acquire(itemId, h.ids.max, at(30), 30 * MINUTE); // lease ends at +30
      expect(replaced).toMatchObject({ acquired: true, renewed: false });
      expect(replaced.lock.lockedBy).toBe(h.ids.max);
      expect(replaced.lock.token).not.toBe(old.lock.token);
      expect(replaced.lock.acquiredAt.toISOString()).toBe(at(30).toISOString());

      const rows = await lockRows(itemId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ lockedBy: h.ids.max, token: replaced.lock.token });

      // simultaneous takeover of an expired lease still has exactly one winner
      const itemTwo = await newItemId();
      await lockStore().acquire(itemTwo, h.ids.mo, at(0), 30 * MINUTE);
      const users = await Promise.all(Array.from({ length: 12 }, (_, i) => makeUser(`taker${i}`)));
      const takeover = await Promise.all(users.map((u) => lockStore().acquire(itemTwo, u, at(45), 30 * MINUTE)));
      expect(takeover.filter((r) => r.acquired)).toHaveLength(1);
      expect(await lockRows(itemTwo)).toHaveLength(1);
    });

    it('DB-LOCK-006: a write with a stale lock is rejected and changes nothing', async () => {
      const itemId = await newItemId();
      const held = await lockStore().acquire(itemId, h.ids.mo, at(0), 30 * MINUTE);
      const proof = { userId: h.ids.mo, token: held.lock.token };
      const before = await itemRow(itemId);
      const historyBefore = await activityCount(itemId);
      const attempt = (p: { userId: string; token: string }, now: Date) =>
        tx().updateWithActivity({ id: itemId, proof: p, now, ...buildTitleUpdate(p.userId, itemId, 'rejected') });

      // wrong token, wrong user, expired lease
      expect(await attempt({ ...proof, token: 'forged-token' }, at(1))).toEqual({ ok: false, reason: 'LOCK_LOST' });
      expect(await attempt({ userId: h.ids.max, token: proof.token }, at(1))).toEqual({ ok: false, reason: 'LOCK_LOST' });
      expect(await attempt(proof, at(30))).toEqual({ ok: false, reason: 'LOCK_LOST' });

      // lease taken over by someone else: the old proof is dead even though the old token once was valid
      const taken = await lockStore().acquire(itemId, h.ids.max, at(31), 30 * MINUTE);
      expect(await attempt(proof, at(32))).toEqual({ ok: false, reason: 'LOCK_LOST' });

      // force-released: nothing to hold
      await lockStore().forceRelease(itemId);
      expect(await attempt({ userId: h.ids.max, token: taken.lock.token }, at(33))).toEqual({ ok: false, reason: 'LOCK_LOST' });

      const after = await itemRow(itemId);
      expect(after).toMatchObject({ title: before.title, version: before.version, activitySeq: before.activitySeq });
      expect(await activityCount(itemId)).toBe(historyBefore);

      // a correct, live proof is accepted
      const fresh = await lockStore().acquire(itemId, h.ids.mo, at(40), 30 * MINUTE);
      const ok = await attempt({ userId: h.ids.mo, token: fresh.lock.token }, at(41));
      expect(ok.ok).toBe(true);
      expect((await itemRow(itemId)).title).toBe('rejected'); // the accepted write used the same title
    });

    it('DB-LOCK-007: a lock lost between the check and the write is caught inside the transaction', async () => {
      const itemId = await newItemId();
      const a = await lockStore().acquire(itemId, h.ids.mo, clock.now(), 30 * MINUTE);
      const proofA = { userId: h.ids.mo, token: a.lock.token };

      // A passed the service's check; then A's lease is forcibly released and B takes it
      await lockStore().forceRelease(itemId);
      const b = await lockStore().acquire(itemId, h.ids.max, clock.now(), 30 * MINUTE);

      const lateWrite = await tx().updateWithActivity({ id: itemId, proof: proofA, now: clock.now(), ...buildTitleUpdate(h.ids.mo, itemId, 'A too late') });
      expect(lateWrite).toEqual({ ok: false, reason: 'LOCK_LOST' });

      const bWrite = await tx().updateWithActivity({ id: itemId, proof: { userId: h.ids.max, token: b.lock.token }, now: clock.now(), ...buildTitleUpdate(h.ids.max, itemId, 'B wins') });
      expect(bWrite.ok).toBe(true);
      expect((await itemRow(itemId)).title).toBe('B wins');
    });

    it('DB-LOCK-008: through the API — expiry, takeover, token header and token privacy', async () => {
      const itemId = await newItemId();
      const acquired = await h.api('POST', `/api/work-items/${itemId}/lock`, 'mo');
      const token: string = acquired.json().data.token;
      expect(token).toEqual(expect.any(String));
      expect(new Date(acquired.json().data.expiresAt).getTime() - nowMs).toBe(30 * MINUTE);

      // others never see the token; the holder does
      const seenByOther = await h.api('GET', `/api/work-items/${itemId}/lock`, 'max');
      expect(seenByOther.json().data.lockedBy).toBe(h.ids.mo);
      expect(seenByOther.json().data).not.toHaveProperty('token');
      expect((await h.api('GET', `/api/work-items/${itemId}/lock`, 'mo')).json().data.token).toBe(token);

      // a wrong token is refused even for the holder; the right one is accepted
      const wrong = await h.api('PATCH', `/api/work-items/${itemId}`, 'mo', { version: 1, title: 'x' }, { 'x-lock-token': 'forged' });
      expect(wrong.statusCode).toBe(409);
      expect(wrong.json().error.code).toBe('LOCK_TOKEN_MISMATCH');
      const right = await h.api('PATCH', `/api/work-items/${itemId}`, 'mo', { version: 1, title: 'with token' }, { 'x-lock-token': token });
      expect(right.statusCode).toBe(200);

      // 31 minutes pass without a heartbeat: the lease is gone and the holder cannot save
      nowMs += 31 * MINUTE;
      const stale = await h.api('PATCH', `/api/work-items/${itemId}`, 'mo', { version: 2, title: 'too late' });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('LOCK_REQUIRED');

      // someone else takes over; the old holder is now refused with 423, and cannot revive the lease
      expect((await h.api('POST', `/api/work-items/${itemId}/lock`, 'max')).statusCode).toBe(200);
      expect((await h.api('PATCH', `/api/work-items/${itemId}`, 'mo', { version: 2, title: 'still too late' })).statusCode).toBe(423);
      expect((await h.api('POST', `/api/work-items/${itemId}/lock/heartbeat`, 'mo')).statusCode).toBe(423);
      expect((await itemRow(itemId)).title).toBe('with token');
    });

    it('DB-LOCK-009: heartbeats through the API keep a long editing session alive', async () => {
      const itemId = await newItemId();
      await h.api('POST', `/api/work-items/${itemId}/lock`, 'mo');

      for (let i = 0; i < 4; i++) {
        nowMs += 20 * MINUTE; // each gap is under 30 minutes, but 80 minutes pass in total
        const beat = await h.api('POST', `/api/work-items/${itemId}/lock/heartbeat`, 'mo');
        expect(beat.statusCode).toBe(200);
      }
      const save = await h.api('PATCH', `/api/work-items/${itemId}`, 'mo', { version: 1, title: 'saved after 80 minutes' });
      expect(save.statusCode).toBe(200);
    });
  });
});
