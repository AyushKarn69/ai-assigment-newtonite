import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, Harness } from '../../test-utils/harness';
import { TeamRole } from '../../shared/types/auth';

type Item = { id: string; key: string; title: string };

describe('Work item search, filters and keys', () => {
  let h: Harness;
  let team: string; // dedicated team so counts are deterministic
  const itemIds: Record<string, string> = {};

  const list = async (query = '') => {
    const response = await h.api('GET', `/api/work-items?teamId=${team}${query ? `&${query}` : ''}`, 'olga');
    expect(response.statusCode).toBe(200);
    return response.json() as { data: Item[]; meta: { totalCount: number } };
  };
  const titles = async (query = '') => (await list(query)).data.map((i) => i.title).sort();

  async function create(who: string, fields: Record<string, unknown>): Promise<string> {
    return h.createItem(who, { teamId: team, ...fields });
  }
  async function edit(id: string, who: string, payload: Record<string, unknown>, version: number) {
    await h.api('DELETE', `/api/work-items/${id}/lock`, 'admin');
    await h.api('POST', `/api/work-items/${id}/lock`, who);
    const response = await h.api('PATCH', `/api/work-items/${id}`, who, { version, ...payload });
    expect(response.statusCode).toBe(200);
  }

  beforeAll(async () => {
    h = await createHarness();
    const search = await h.container.teamRepository.create({ name: 'Search Team' });
    team = search.id;
    await h.container.teamRepository.addMember(team, h.ids.olga, TeamRole.MANAGER);
    await h.container.teamRepository.addMember(team, h.ids.mo, TeamRole.MEMBER);
    await h.container.teamRepository.addMember(team, h.ids.max, TeamRole.MEMBER);

    itemIds.kafka = await create('olga', {
      title: 'Kafka consumer lag spike',
      description: 'Partition rebalance storm on analytics pipeline',
      type: 'ENGINEERING_PROBLEM',
      priority: 'CRITICAL',
      assigneeId: h.ids.mo,
    });
    itemIds.postgres = await create('olga', {
      title: 'Postgres row deadlock',
      description: 'Transactions aborted during batch migration',
      type: 'ENGINEERING_PROBLEM',
      priority: 'HIGH',
      assigneeId: h.ids.max,
    });
    itemIds.redis = await create('mo', {
      title: 'Redis eviction policy upgrade',
      description: 'Switch to allkeys-lfu',
      type: 'PRODUCTION_INCIDENT',
      priority: 'MEDIUM',
    });
    itemIds.tls = await create('mo', {
      title: 'Rotate TLS certificates',
      description: 'Edge proxies, kafka-adjacent hosts too',
      type: 'APPROVAL_TASK',
      priority: 'LOW',
    });
    itemIds.password = await create('max', {
      title: 'Customer cannot reset password',
      description: 'Reset email never arrives',
      type: 'CUSTOMER_ISSUE',
      priority: 'MEDIUM',
    });

    await edit(itemIds.postgres, 'olga', { status: 'IN_PROGRESS' }, 1);
    await edit(itemIds.postgres, 'olga', { status: 'BLOCKED' }, 2);
    await edit(itemIds.tls, 'olga', { status: 'CLOSED' }, 1);
  });
  afterAll(async () => {
    await h.close();
  });

  describe('search', () => {
    it('SRCH-001: matches the title, ignoring case', async () => {
      expect(await titles('search=KAFKA%20consumer')).toEqual(['Kafka consumer lag spike']);
      expect(await titles('search=deadlock')).toEqual(['Postgres row deadlock']);
    });

    it('SRCH-002: also matches the description', async () => {
      expect(await titles('search=allkeys-lfu')).toEqual(['Redis eviction policy upgrade']);
      expect(await titles('search=reset%20email')).toEqual(['Customer cannot reset password']);
    });

    it('SRCH-003: a term can match several items across title and description', async () => {
      expect(await titles('search=kafka')).toEqual([
        'Kafka consumer lag spike',
        'Rotate TLS certificates', // "kafka-adjacent" in its description
      ]);
    });

    it('SRCH-004: finds an item by its key or number', async () => {
      const kafka = (await h.api('GET', `/api/work-items/${itemIds.kafka}`, 'olga')).json().data;

      expect((await titles(`search=${kafka.key}`))).toEqual(['Kafka consumer lag spike']);
      expect((await titles(`search=${kafka.key.toLowerCase()}`))).toEqual(['Kafka consumer lag spike']);
      expect((await titles(`search=${kafka.number}`))).toContain('Kafka consumer lag spike');
    });

    it('SRCH-005: no match returns an empty page with totalCount 0', async () => {
      const result = await list('search=zzz-nothing-matches');
      expect(result.data).toEqual([]);
      expect(result.meta.totalCount).toBe(0);
    });

    it('SRCH-006: a blank search is ignored', async () => {
      expect((await list('search=')).meta.totalCount).toBe(5);
      expect((await list('search=%20%20')).meta.totalCount).toBe(5);
    });

    it('SRCH-007: search combines with filters (AND)', async () => {
      expect(await titles('search=kafka&type=ENGINEERING_PROBLEM')).toEqual(['Kafka consumer lag spike']);
      expect(await titles('search=kafka&priority=LOW')).toEqual(['Rotate TLS certificates']);
      expect(await titles('search=kafka&priority=MEDIUM')).toEqual([]);
    });

    it('SRCH-008: search never reveals items from teams the user is not in', async () => {
      const alphaItem = await h.createItem('mo', { title: 'Kafka secret in alpha team' });
      const response = await h.api('GET', '/api/work-items?search=secret%20in%20alpha&pageSize=100', 'olga');
      expect(response.json().data).toEqual([]);

      // while a member of that team finds it
      const own = await h.api('GET', '/api/work-items?search=secret%20in%20alpha', 'mo');
      expect(own.json().data.map((i: Item) => i.id)).toEqual([alphaItem]);
    });

    it('SRCH-009: totalCount reflects the filtered set across pages', async () => {
      const page1 = await h.api('GET', `/api/work-items?teamId=${team}&search=e&pageSize=2&page=1`, 'olga');
      const matching = (await list('search=e')).meta.totalCount;
      expect(page1.json().meta.totalCount).toBe(matching);
      expect(page1.json().data).toHaveLength(2);
    });

    it('SRCH-010: an over-long search term is rejected', async () => {
      const response = await h.api('GET', `/api/work-items?search=${'x'.repeat(201)}`, 'olga');
      expect(response.statusCode).toBe(400);
    });
  });

  describe('filters', () => {
    it('FILT-001: status accepts several values (any of)', async () => {
      expect(await titles('status=BLOCKED,CLOSED')).toEqual([
        'Postgres row deadlock',
        'Rotate TLS certificates',
      ]);
      expect((await list('status=OPEN')).meta.totalCount).toBe(3);
    });

    it('FILT-002: priority accepts several values — the "High / Critical" view', async () => {
      expect(await titles('priority=HIGH,CRITICAL')).toEqual([
        'Kafka consumer lag spike',
        'Postgres row deadlock',
      ]);
    });

    it('FILT-003: type accepts several values', async () => {
      expect(await titles('type=CUSTOMER_ISSUE,APPROVAL_TASK')).toEqual([
        'Customer cannot reset password',
        'Rotate TLS certificates',
      ]);
    });

    it('FILT-004: invalid or empty list values are rejected', async () => {
      for (const bad of ['status=OPEN,NOPE', 'status=', 'priority=URGENT', 'type=,']) {
        const response = await h.api('GET', `/api/work-items?${bad}`, 'olga');
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('FILT-005: assignee=me returns my work, assignee=unassigned the unowned items', async () => {
      const mine = await h.api('GET', `/api/work-items?teamId=${team}&assignee=me`, 'mo');
      expect(mine.json().data.map((i: Item) => i.title)).toEqual(['Kafka consumer lag spike']);

      const unassigned = await titles('assignee=unassigned');
      expect(unassigned).toEqual([
        'Customer cannot reset password',
        'Redis eviction policy upgrade',
        'Rotate TLS certificates',
      ]);
    });

    it('FILT-006: assignee accepts a user id; assigneeId remains an alias', async () => {
      expect(await titles(`assignee=${h.ids.max}`)).toEqual(['Postgres row deadlock']);
      expect(await titles(`assigneeId=${h.ids.max}`)).toEqual(['Postgres row deadlock']);
      expect((await h.api('GET', '/api/work-items?assignee=bogus', 'olga')).statusCode).toBe(400);
    });

    it('FILT-007: createdBy filters on the reporter', async () => {
      expect(await titles(`createdBy=${h.ids.max}`)).toEqual(['Customer cannot reset password']);
      expect(await titles(`createdBy=${h.ids.mo}`)).toEqual([
        'Redis eviction policy upgrade',
        'Rotate TLS certificates',
      ]);
    });

    it('FILT-008: filters combine with each other and with sorting', async () => {
      const response = await h.api(
        'GET',
        `/api/work-items?teamId=${team}&status=OPEN&priority=MEDIUM,CRITICAL&sortBy=priority&sortOrder=desc`,
        'olga',
      );
      expect(response.json().data.map((i: Item) => i.title)).toEqual([
        'Kafka consumer lag spike',
        'Redis eviction policy upgrade', // MEDIUM ties break by creation time, oldest first
        'Customer cannot reset password',
      ]);
    });
  });

  describe('keys', () => {
    it('KEY-001: items get sequential NW-numbers that are unique and stable', async () => {
      const a = (await h.api('GET', `/api/work-items/${itemIds.kafka}`, 'olga')).json().data;
      const b = (await h.api('GET', `/api/work-items/${itemIds.postgres}`, 'olga')).json().data;

      expect(a.key).toMatch(/^NW-\d+$/);
      expect(a.key).toBe(`NW-${a.number}`);
      expect(b.number).toBe(a.number + 1);
      // editing does not change the key
      const again = (await h.api('GET', `/api/work-items/${itemIds.postgres}`, 'olga')).json().data;
      expect(again.key).toBe(b.key);
    });

    it('KEY-002: concurrent creation never yields duplicate numbers', async () => {
      const ids = await Promise.all(Array.from({ length: 10 }, () => h.createItem('mo')));
      const keys = await Promise.all(
        ids.map(async (id) => (await h.api('GET', `/api/work-items/${id}`, 'mo')).json().data.key),
      );
      expect(new Set(keys).size).toBe(10);
    });
  });

  describe('profile', () => {
    it('PROF-001: /api/users/me returns the profile without sensitive fields', async () => {
      const response = await h.api('GET', '/api/users/me', 'mo');
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.data).toMatchObject({
        id: h.ids.mo,
        email: 'mo@example.com',
        name: 'mo',
        role: 'USER',
      });
      expect(JSON.stringify(body)).not.toMatch(/password/i);
    });
  });
});
