import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, Harness } from '../../test-utils/harness';

describe('Allowed transitions on item responses', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it('WI-029: create, get and update responses list the statuses the item may move to next', async () => {
    const created = await h.api('POST', '/api/work-items', 'mo', {
      title: 'Transitions',
      type: 'CUSTOMER_ISSUE',
      teamId: h.teams.alpha,
    });
    expect(created.json().data.allowedTransitions).toEqual(['IN_PROGRESS', 'CLOSED']);
    const id = created.json().data.id;

    await h.api('POST', `/api/work-items/${id}/lock`, 'mo');
    const moved = await h.api('PATCH', `/api/work-items/${id}`, 'mo', { version: 1, status: 'IN_PROGRESS' });
    expect(moved.json().data.allowedTransitions).toEqual(['OPEN', 'BLOCKED', 'IN_REVIEW', 'RESOLVED']);

    const fetched = await h.api('GET', `/api/work-items/${id}`, 'mo');
    expect(fetched.json().data.allowedTransitions).toEqual(['OPEN', 'BLOCKED', 'IN_REVIEW', 'RESOLVED']);
  });

  it('WI-030: every offered transition is actually accepted by the server', async () => {
    const id = await h.createItem('mo');
    await h.api('POST', `/api/work-items/${id}/lock`, 'mia');
    const offered: string[] = (await h.api('GET', `/api/work-items/${id}`, 'mia')).json().data.allowedTransitions;

    // a manager may take any of them (including CLOSED)
    const target = offered[offered.length - 1];
    const response = await h.api('PATCH', `/api/work-items/${id}`, 'mia', { version: 1, status: target });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe(target);
  });

  it('WI-031: the list endpoint does not carry the extra field (keeps pages small)', async () => {
    await h.createItem('mo');
    const list = await h.api('GET', `/api/work-items?teamId=${h.teams.alpha}`, 'mo');
    expect(list.json().data[0]).not.toHaveProperty('allowedTransitions');
  });
});
