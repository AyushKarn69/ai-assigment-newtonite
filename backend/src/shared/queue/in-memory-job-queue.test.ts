import { describe, it, expect } from 'vitest';
import { InMemoryJobQueue } from './in-memory-job-queue';

const fast = () => new InMemoryJobQueue({ maxAttempts: 3, backoffMs: 0 });

describe('InMemoryJobQueue', () => {
  it('QUEUE-001: enqueue returns before the job runs; drain waits for it', async () => {
    const queue = fast();
    const ran: number[] = [];
    queue.register<number>('n', async (n) => {
      ran.push(n);
    });

    await queue.enqueue('n', 1);
    expect(ran).toEqual([]); // not run synchronously inside enqueue
    await queue.drain();
    expect(ran).toEqual([1]);
  });

  it('QUEUE-002: jobs run one at a time in the order they were enqueued', async () => {
    const queue = fast();
    const events: string[] = [];
    queue.register<number>('slow-then-fast', async (n) => {
      events.push(`start ${n}`);
      await new Promise((r) => setTimeout(r, n === 1 ? 20 : 0));
      events.push(`end ${n}`);
    });

    await queue.enqueue('slow-then-fast', 1);
    await queue.enqueue('slow-then-fast', 2);
    await queue.drain();
    expect(events).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  it('QUEUE-003: a failing job is retried and succeeds on a later attempt', async () => {
    const queue = fast();
    let calls = 0;
    queue.register('flaky', async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
    });

    await queue.enqueue('flaky', {});
    await queue.drain();
    expect(calls).toBe(3);
    expect(queue.failedJobs()).toEqual([]);
  });

  it('QUEUE-004: after maxAttempts the job is dead-lettered with its error', async () => {
    const queue = fast();
    let calls = 0;
    queue.register('broken', async () => {
      calls += 1;
      throw new Error('always fails');
    });

    await queue.enqueue('broken', { id: 7 });
    await queue.drain();

    expect(calls).toBe(3);
    const [failed] = queue.failedJobs();
    expect(failed).toMatchObject({
      name: 'broken',
      payload: { id: 7 },
      attempts: 3,
      error: 'always fails',
    });
  });

  it('QUEUE-005: one failing job does not stop later jobs', async () => {
    const queue = fast();
    const ran: string[] = [];
    queue.register('bad', async () => {
      throw new Error('nope');
    });
    queue.register<string>('good', async (s) => {
      ran.push(s);
    });

    await queue.enqueue('bad', null);
    await queue.enqueue('good', 'after');
    await queue.drain();
    expect(ran).toEqual(['after']);
    expect(queue.failedJobs()).toHaveLength(1);
  });

  it('QUEUE-006: a job with no registered handler is dead-lettered', async () => {
    const queue = fast();
    await queue.enqueue('unknown-job', {});
    await queue.drain();

    expect(queue.failedJobs()[0]).toMatchObject({ name: 'unknown-job' });
    expect(queue.failedJobs()[0].error).toContain('No handler');
  });

  it('QUEUE-007: jobs enqueued by a running job are processed before drain resolves', async () => {
    const queue = fast();
    const ran: string[] = [];
    queue.register('parent', async () => {
      ran.push('parent');
      await queue.enqueue('child', {});
    });
    queue.register('child', async () => {
      ran.push('child');
    });

    await queue.enqueue('parent', {});
    await queue.drain();
    expect(ran).toEqual(['parent', 'child']);
  });

  it('QUEUE-008: drain on an idle queue resolves immediately; multiple drains all resolve', async () => {
    const queue = fast();
    await queue.drain();

    queue.register('x', async () => {});
    await queue.enqueue('x', {});
    await Promise.all([queue.drain(), queue.drain()]);
  });

  it('QUEUE-009: after close, new jobs are refused but queued jobs finish', async () => {
    const queue = fast();
    const ran: number[] = [];
    queue.register<number>('n', async (n) => {
      ran.push(n);
    });

    await queue.enqueue('n', 1);
    await queue.close();
    expect(ran).toEqual([1]);
    await expect(queue.enqueue('n', 2)).rejects.toThrow('closed');
  });

  it('QUEUE-010: retries and dead-letters are reported to the logger', async () => {
    const queue = fast();
    const logs: string[] = [];
    queue.setLogger({
      warn: (_ctx, message) => logs.push(`warn: ${message}`),
      error: (_ctx, message) => logs.push(`error: ${message}`),
    });
    queue.register('broken', async () => {
      throw new Error('x');
    });

    await queue.enqueue('broken', {});
    await queue.drain();
    expect(logs).toEqual([
      'warn: Job failed, will retry',
      'warn: Job failed, will retry',
      'error: Job moved to dead-letter list',
    ]);
  });
});
