import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryWorkItemLockStore } from './work-item-lock.store';

const TTL = 10 * 60_000;
const t0 = new Date('2026-01-01T10:00:00.000Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

describe('InMemoryWorkItemLockStore', () => {
  let store: InMemoryWorkItemLockStore;

  beforeEach(() => {
    store = new InMemoryWorkItemLockStore();
  });

  it('LSTORE-001: acquiring a free lock succeeds and sets the expiry', async () => {
    const result = await store.acquire('w1', 'alice', t0, TTL);

    expect(result.acquired).toBe(true);
    expect(result.lock).toEqual({
      workItemId: 'w1',
      lockedBy: 'alice',
      acquiredAt: t0,
      expiresAt: at(10),
    });
  });

  it('LSTORE-002: acquiring a lock held by someone else fails and reports the holder', async () => {
    await store.acquire('w1', 'alice', t0, TTL);
    const result = await store.acquire('w1', 'bob', at(1), TTL);

    expect(result.acquired).toBe(false);
    expect(result.lock.lockedBy).toBe('alice');
    expect(result.lock.expiresAt).toEqual(at(10)); // unchanged by the failed attempt
  });

  it('LSTORE-003: re-acquiring your own lock renews it but keeps acquiredAt', async () => {
    await store.acquire('w1', 'alice', t0, TTL);
    const result = await store.acquire('w1', 'alice', at(4), TTL);

    expect(result.acquired).toBe(true);
    expect(result.lock.acquiredAt).toEqual(t0);
    expect(result.lock.expiresAt).toEqual(at(14));
  });

  it('LSTORE-004: an expired lock can be taken over by someone else', async () => {
    await store.acquire('w1', 'alice', t0, TTL);
    const result = await store.acquire('w1', 'bob', at(10), TTL); // exactly at expiry

    expect(result.acquired).toBe(true);
    expect(result.lock).toMatchObject({ lockedBy: 'bob', acquiredAt: at(10) });
  });

  it('LSTORE-005: get returns the active lock and ignores an expired one', async () => {
    await store.acquire('w1', 'alice', t0, TTL);

    expect((await store.get('w1', at(9)))?.lockedBy).toBe('alice');
    expect(await store.get('w1', at(10))).toBeNull();
    expect(await store.get('unknown', t0)).toBeNull();
  });

  it('LSTORE-006: extend works only for the active holder', async () => {
    await store.acquire('w1', 'alice', t0, TTL);

    expect(await store.extend('w1', 'bob', at(1), TTL)).toBeNull();
    const extended = await store.extend('w1', 'alice', at(5), TTL);
    expect(extended?.expiresAt).toEqual(at(15));
    expect(extended?.acquiredAt).toEqual(t0);

    expect(await store.extend('w1', 'alice', at(15), TTL)).toBeNull(); // expired
    expect(await store.extend('unknown', 'alice', t0, TTL)).toBeNull();
  });

  it('LSTORE-007: release works only for the holder', async () => {
    await store.acquire('w1', 'alice', t0, TTL);

    expect(await store.release('w1', 'bob')).toBe(false);
    expect(await store.get('w1', t0)).not.toBeNull();
    expect(await store.release('w1', 'alice')).toBe(true);
    expect(await store.get('w1', t0)).toBeNull();
    expect(await store.release('w1', 'alice')).toBe(false);
  });

  it('LSTORE-008: forceRelease removes the lock whoever holds it', async () => {
    await store.acquire('w1', 'alice', t0, TTL);

    expect(await store.forceRelease('w1')).toBe(true);
    expect(await store.get('w1', t0)).toBeNull();
    expect(await store.forceRelease('w1')).toBe(false);
  });

  it('LSTORE-009: locks on different items are independent', async () => {
    await store.acquire('w1', 'alice', t0, TTL);
    const other = await store.acquire('w2', 'bob', t0, TTL);

    expect(other.acquired).toBe(true);
    expect((await store.get('w1', t0))?.lockedBy).toBe('alice');
    expect((await store.get('w2', t0))?.lockedBy).toBe('bob');
  });

  it('LSTORE-010: of many simultaneous acquirers exactly one wins', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.acquire('w1', `user-${i}`, t0, TTL)),
    );

    const winners = results.filter((r) => r.acquired);
    expect(winners).toHaveLength(1);
    const holder = winners[0].lock.lockedBy;
    for (const r of results) expect(r.lock.lockedBy).toBe(holder);
  });
});
