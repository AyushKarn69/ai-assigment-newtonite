import { describe, it, expect, beforeEach } from 'vitest';
import { createHarness, Harness } from '../../test-utils/harness';
import { InMemoryIdempotencyStore } from './in-memory-idempotency-store';

const t0 = new Date('2026-06-01T10:00:00.000Z');
const later = (ms: number) => new Date(t0.getTime() + ms);
const response = { statusCode: 201, body: '{"ok":true}', contentType: 'application/json' };

describe('InMemoryIdempotencyStore', () => {
  let store: InMemoryIdempotencyStore;
  beforeEach(() => {
    store = new InMemoryIdempotencyStore({ ttlMs: 1000, inProgressTtlMs: 100 });
  });

  it('IDEMSTORE-001: first sight of a key is new; a repeat while running is in_progress', async () => {
    expect(await store.begin('u1', 'k', 'fp', t0)).toEqual({ status: 'new' });
    expect(await store.begin('u1', 'k', 'fp', t0)).toEqual({ status: 'in_progress' });
  });

  it('IDEMSTORE-002: after completion the same request replays the stored response', async () => {
    await store.begin('u1', 'k', 'fp', t0);
    await store.complete('u1', 'k', response, t0);

    expect(await store.begin('u1', 'k', 'fp', later(10))).toEqual({ status: 'replay', response });
  });

  it('IDEMSTORE-003: the same key with a different request is a conflict', async () => {
    await store.begin('u1', 'k', 'fp-a', t0);
    expect(await store.begin('u1', 'k', 'fp-b', t0)).toEqual({ status: 'conflict' });
    await store.complete('u1', 'k', response, t0);
    expect(await store.begin('u1', 'k', 'fp-b', t0)).toEqual({ status: 'conflict' });
  });

  it('IDEMSTORE-004: keys are scoped per user', async () => {
    expect(await store.begin('u1', 'k', 'fp', t0)).toEqual({ status: 'new' });
    expect(await store.begin('u2', 'k', 'fp', t0)).toEqual({ status: 'new' });
  });

  it('IDEMSTORE-005: abandoning an unfinished key lets it be retried; a completed one is kept', async () => {
    await store.begin('u1', 'a', 'fp', t0);
    await store.abandon('u1', 'a');
    expect(await store.begin('u1', 'a', 'fp', t0)).toEqual({ status: 'new' });

    await store.begin('u1', 'b', 'fp', t0);
    await store.complete('u1', 'b', response, t0);
    await store.abandon('u1', 'b');
    expect((await store.begin('u1', 'b', 'fp', t0)).status).toBe('replay');
  });

  it('IDEMSTORE-006: completed results expire after the TTL; abandoned in-progress keys sooner', async () => {
    await store.begin('u1', 'done', 'fp', t0);
    await store.complete('u1', 'done', response, t0);
    expect((await store.begin('u1', 'done', 'fp', later(999))).status).toBe('replay');
    expect((await store.begin('u1', 'done', 'fp', later(1000))).status).toBe('new');

    await store.begin('u1', 'stuck', 'fp', t0);
    expect((await store.begin('u1', 'stuck', 'fp', later(99))).status).toBe('in_progress');
    expect((await store.begin('u1', 'stuck', 'fp', later(100))).status).toBe('new');
  });

  it('IDEMSTORE-007: of many simultaneous callers exactly one gets new', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.begin('u1', 'k', 'fp', t0)),
    );
    expect(results.filter((r) => r.status === 'new')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'in_progress')).toHaveLength(19);
  });
});

describe('Idempotency-Key on create endpoints', () => {
  let h: Harness;
  let nowMs = Date.parse('2026-06-01T10:00:00.000Z');
  const clock = { now: () => new Date(nowMs) };

  beforeEach(async () => {
    h = await createHarness({ clock });
  });

  const body = (title = 'Refund stuck') => ({
    title,
    type: 'CUSTOMER_ISSUE',
    teamId: h.teams.alpha,
  });
  const create = (who: string, key: string | undefined, payload = body()) =>
    h.api('POST', '/api/work-items', who, payload, key === undefined ? {} : { 'idempotency-key': key });
  const countItems = async () =>
    (await h.api('GET', `/api/work-items?teamId=${h.teams.alpha}&pageSize=100`, 'mia')).json().meta.totalCount;

  it('IDEM-001: retrying with the same key replays the first response and creates nothing new', async () => {
    const first = await create('mo', 'key-1');
    const retry = await create('mo', 'key-1');

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json()); // same item, same id
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await countItems()).toBe(1);
  });

  it('IDEM-002: the same key with a different request is rejected and creates nothing', async () => {
    await create('mo', 'key-2', body('First'));
    const reused = await create('mo', 'key-2', body('Second'));

    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await countItems()).toBe(1);
  });

  it('IDEM-003: without a key every request is processed (behaviour unchanged)', async () => {
    await create('mo', undefined);
    await create('mo', undefined);
    expect(await countItems()).toBe(2);
  });

  it('IDEM-004: keys are per user — two users using the same key do not interfere', async () => {
    const a = await create('mo', 'shared-key');
    const b = await create('max', 'shared-key');

    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json().data.id).not.toBe(b.json().data.id);
    expect(b.headers['idempotent-replayed']).toBeUndefined();
  });

  it('IDEM-005: two simultaneous requests with the same key create exactly one item', async () => {
    const [a, b] = await Promise.all([create('mo', 'race'), create('mo', 'race')]);

    expect([a.statusCode, b.statusCode].filter((s) => s === 201)).toHaveLength(
      a.headers['idempotent-replayed'] || b.headers['idempotent-replayed'] ? 2 : 1,
    );
    const loser = a.statusCode === 409 ? a : b;
    if (loser.statusCode === 409) expect(loser.json().error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(await countItems()).toBe(1);
  });

  it('IDEM-006: failed requests are not remembered, so the client can fix and retry with the same key', async () => {
    const invalid = await create('mo', 'retry-me', { ...body(), title: '' });
    expect(invalid.statusCode).toBe(400);

    const denied = await h.api('POST', '/api/work-items', 'olga', body(), { 'idempotency-key': 'retry-me' });
    expect(denied.statusCode).toBe(403); // outsider, different user scope

    const fixed = await create('mo', 'retry-me');
    expect(fixed.statusCode).toBe(201);
    expect(fixed.headers['idempotent-replayed']).toBeUndefined();
    expect(await countItems()).toBe(1);
  });

  it('IDEM-007: malformed keys are rejected', async () => {
    for (const bad of ['', 'has space', 'x'.repeat(256), 'tab\tkey']) {
      const response = await create('mo', bad);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_IDEMPOTENCY_KEY');
    }
    expect(await countItems()).toBe(0);
  });

  it('IDEM-008: it also protects comments from being posted twice', async () => {
    const id = await h.createItem('mo');
    const post = () =>
      h.api('POST', `/api/work-items/${id}/comments`, 'mo', { body: 'only once' }, { 'idempotency-key': 'c-1' });

    const first = await post();
    const retry = await post();
    expect(retry.json()).toEqual(first.json());
    const list = await h.api('GET', `/api/work-items/${id}/comments`, 'mo');
    expect(list.json().meta.totalCount).toBe(1);
  });

  it('IDEM-009: it protects team creation and member adds', async () => {
    const team = () =>
      h.api('POST', '/api/teams', 'admin', { name: 'Gamma' }, { 'idempotency-key': 't-1' });
    const first = await team();
    const retry = await team();
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201); // without the key this would be 409 TEAM_NAME_TAKEN
    expect(retry.json().data.id).toBe(first.json().data.id);

    const teamId = first.json().data.id;
    const add = () =>
      h.api('POST', `/api/teams/${teamId}/members`, 'admin', { userId: h.ids.mo }, { 'idempotency-key': 'm-1' });
    expect((await add()).statusCode).toBe(201);
    expect((await add()).statusCode).toBe(201); // replay, not 409 ALREADY_TEAM_MEMBER
  });

  it('IDEM-010: the header is ignored on routes that do not use it', async () => {
    const id = await h.createItem('mo');
    const lock = () => h.api('POST', `/api/work-items/${id}/lock`, 'mo', undefined, { 'idempotency-key': 'l-1' });
    const a = await lock();
    const b = await lock();
    expect(a.headers['idempotent-replayed']).toBeUndefined();
    expect(b.headers['idempotent-replayed']).toBeUndefined();
    expect(b.statusCode).toBe(200);
  });

  it('IDEM-011: an unauthenticated request with a key is simply unauthorized and stores nothing', async () => {
    const anon = await h.app.inject({
      method: 'POST',
      url: '/api/work-items',
      headers: { 'idempotency-key': 'anon-1' },
      payload: body(),
    });
    expect(anon.statusCode).toBe(401);

    // the key is free for a real user afterwards
    expect((await create('mo', 'anon-1')).statusCode).toBe(201);
  });

  it('IDEM-012: a stored result is forgotten after 24 hours', async () => {
    const first = await create('mo', 'daily');
    nowMs += 23 * 60 * 60 * 1000;
    expect((await create('mo', 'daily')).json()).toEqual(first.json()); // still replayed

    nowMs += 2 * 60 * 60 * 1000; // 25h after the first
    const again = await create('mo', 'daily');
    expect(again.statusCode).toBe(201);
    expect(again.json().data.id).not.toBe(first.json().data.id);
  });
});
