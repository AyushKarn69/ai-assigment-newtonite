import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, Harness, UNKNOWN_ID } from '../../test-utils/harness';

describe('Work item comments', () => {
  let h: Harness;
  let nowMs = Date.parse('2026-05-01T12:00:00.000Z');
  const clock = { now: () => new Date(nowMs) };

  const url = (id: string) => `/api/work-items/${id}/comments`;
  const add = (id: string, who: string, body: unknown) =>
    h.api('POST', url(id), who, { body } as Record<string, unknown>);

  beforeAll(async () => {
    h = await createHarness({ clock });
  });
  afterAll(async () => {
    await h.close();
  });

  it('COMM-001: endpoints require authentication', async () => {
    const id = await h.createItem();
    expect((await h.app.inject({ method: 'GET', url: url(id) })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'POST', url: url(id), payload: { body: 'x' } })).statusCode).toBe(401);
  });

  it('COMM-002: a member adds a comment; it records author, name and time', async () => {
    const id = await h.createItem();
    const response = await add(id, 'mo', 'Escalated to the payments team.');

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      workItemId: id,
      authorId: h.ids.mo,
      authorName: 'mo',
      body: 'Escalated to the payments team.',
      createdAt: new Date(nowMs).toISOString(),
    });
  });

  it('COMM-003: managers and admins can comment; other teams cannot', async () => {
    const id = await h.createItem();
    expect((await add(id, 'mia', 'manager note')).statusCode).toBe(201);
    expect((await add(id, 'admin', 'admin note')).statusCode).toBe(201);

    const outsider = await add(id, 'olga', 'let me in');
    expect(outsider.statusCode).toBe(403);
    expect(outsider.json().error.code).toBe('NOT_TEAM_MEMBER');
  });

  it('COMM-004: comments are validated and trimmed', async () => {
    const id = await h.createItem();
    for (const bad of ['', '   ', 'x'.repeat(5001), undefined, 42]) {
      const response = await add(id, 'mo', bad);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    }
    const ok = await add(id, 'mo', '  padded  ');
    expect(ok.json().data.body).toBe('padded');
    expect((await add(id, 'mo', 'x'.repeat(5000))).statusCode).toBe(201);
  });

  it('COMM-005: unknown item is 404 and malformed id is 400', async () => {
    const missing = await add(UNKNOWN_ID, 'admin', 'hello');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('WORK_ITEM_NOT_FOUND');
    expect((await h.api('GET', url('nope'), 'admin')).statusCode).toBe(400);
  });

  it('COMM-006: comments list oldest first by default, newest first on request', async () => {
    const id = await h.createItem();
    for (const text of ['first', 'second', 'third']) {
      await add(id, 'mo', text);
      nowMs += 1000;
    }

    const asc = await h.api('GET', url(id), 'max');
    expect(asc.json().data.map((c: { body: string }) => c.body)).toEqual(['first', 'second', 'third']);
    const desc = await h.api('GET', `${url(id)}?order=desc`, 'max');
    expect(desc.json().data.map((c: { body: string }) => c.body)).toEqual(['third', 'second', 'first']);
  });

  it('COMM-007: comments with identical timestamps keep their creation order', async () => {
    const id = await h.createItem();
    for (const text of ['a', 'b', 'c', 'd']) await add(id, 'mo', text); // same clock tick

    const list = await h.api('GET', url(id), 'mo');
    expect(list.json().data.map((c: { body: string }) => c.body)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('COMM-008: the list is paginated with correct metadata', async () => {
    const id = await h.createItem();
    for (let i = 1; i <= 5; i++) await add(id, 'mo', `c${i}`);

    const page2 = await h.api('GET', `${url(id)}?page=2&pageSize=2`, 'mo');
    expect(page2.json().data.map((c: { body: string }) => c.body)).toEqual(['c3', 'c4']);
    expect(page2.json().meta).toMatchObject({
      page: 2,
      pageSize: 2,
      totalCount: 5,
      totalPages: 3,
      hasNext: true,
      hasPrev: true,
    });
    expect((await h.api('GET', `${url(id)}?pageSize=101`, 'mo')).statusCode).toBe(400);
  });

  it("COMM-009: each item's comments are separate; an item with none returns an empty list", async () => {
    const a = await h.createItem();
    const b = await h.createItem();
    await add(a, 'mo', 'only on A');

    const listB = await h.api('GET', url(b), 'mo');
    expect(listB.json().data).toEqual([]);
    expect(listB.json().meta.totalCount).toBe(0);
  });

  it('COMM-010: only members and admins can read comments', async () => {
    const id = await h.createItem();
    await add(id, 'mo', 'private to alpha');

    expect((await h.api('GET', url(id), 'max')).statusCode).toBe(200);
    expect((await h.api('GET', url(id), 'admin')).statusCode).toBe(200);
    expect((await h.api('GET', url(id), 'olga')).statusCode).toBe(403);
    expect((await h.api('GET', url(id), 'nina')).statusCode).toBe(403);
  });

  it('COMM-011: commenting needs no edit lock and is not blocked by someone else holding it', async () => {
    const id = await h.createItem();
    await h.api('POST', `/api/work-items/${id}/lock`, 'mo');

    expect((await add(id, 'max', 'while mo is editing')).statusCode).toBe(201);
  });

  it('COMM-012: commenting works on closed items and does not change the item', async () => {
    const id = await h.createItem();
    await h.api('POST', `/api/work-items/${id}/lock`, 'mia');
    await h.api('PATCH', `/api/work-items/${id}`, 'mia', { version: 1, status: 'CLOSED' });
    const before = (await h.api('GET', `/api/work-items/${id}`, 'mia')).json().data;

    expect((await add(id, 'mo', 'postmortem link')).statusCode).toBe(201);
    const after = (await h.api('GET', `/api/work-items/${id}`, 'mia')).json().data;
    expect(after).toEqual(before); // same version and updatedAt
  });

  it('COMM-013: adding a comment is recorded in the activity history', async () => {
    const id = await h.createItem();
    const comment = (await add(id, 'mo', 'noted')).json().data;

    const history = (await h.api('GET', `/api/work-items/${id}/activity?order=asc`, 'mo')).json().data;
    const entry = history.find((e: { type: string }) => e.type === 'COMMENT_ADDED');
    expect(entry).toMatchObject({ actorId: h.ids.mo, metadata: { commentId: comment.id } });
    expect(JSON.stringify(entry)).not.toContain('noted'); // history links, it does not duplicate the text
  });

  it('COMM-014: comments cannot be edited or deleted', async () => {
    const id = await h.createItem();
    const comment = (await add(id, 'mo', 'permanent')).json().data;

    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const response = await h.api(method, `${url(id)}/${comment.id}`, 'admin', { body: 'changed' });
      expect(response.statusCode).toBe(404);
    }
    expect((await h.api('GET', url(id), 'mo')).json().data[0].body).toBe('permanent');
  });

  it('COMM-015: markdown and markup are stored verbatim (clients must escape on display)', async () => {
    const id = await h.createItem();
    const text = '**bold** <script>alert(1)</script> `code`';
    const created = await add(id, 'mo', text);
    expect(created.json().data.body).toBe(text);
  });
});
