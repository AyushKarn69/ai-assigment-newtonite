import { FailedJob, JobHandler, JobQueue, QueueLogger } from './job-queue';

export interface InMemoryJobQueueOptions {
  /** Total tries per job, including the first. Default 3. */
  maxAttempts?: number;
  /** Delay before retry n is `backoffMs * 2^(n-1)`. Default 250. Use 0 in tests. */
  backoffMs?: number;
}

interface Job {
  name: string;
  payload: unknown;
  attempt: number; // completed attempts so far
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * In-process queue that runs jobs one at a time, in order, on a later tick.
 * A job that keeps failing blocks the jobs behind it only for its own retries.
 */
export class InMemoryJobQueue implements JobQueue {
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private handlers = new Map<string, JobHandler>();
  private pending: Job[] = [];
  private failed: FailedJob[] = [];
  private running = false;
  private closed = false;
  private idleWaiters: Array<() => void> = [];
  private logger: QueueLogger | null = null;

  constructor(options: InMemoryJobQueueOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.backoffMs = options.backoffMs ?? 250;
  }

  register<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler);
  }

  async enqueue<T>(name: string, payload: T): Promise<void> {
    if (this.closed) throw new Error('Job queue is closed');
    this.pending.push({ name, payload, attempt: 0 });
    this.kick();
  }

  drain(): Promise<void> {
    if (!this.running && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.drain();
  }

  failedJobs(): FailedJob[] {
    return this.failed.map((f) => ({ ...f }));
  }

  setLogger(logger: QueueLogger): void {
    this.logger = logger;
  }

  /** Start the worker loop on a later tick if it is not already running. */
  private kick(): void {
    if (this.running) return;
    this.running = true;
    setImmediate(() => void this.run());
  }

  private async run(): Promise<void> {
    while (this.pending.length > 0) {
      const job = this.pending.shift()!;
      await this.process(job);
    }
    this.running = false;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private async process(job: Job): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      this.deadLetter(job, 'No handler registered for this job');
      return;
    }

    for (;;) {
      try {
        await handler(job.payload);
        return;
      } catch (error) {
        job.attempt += 1;
        const message = error instanceof Error ? error.message : String(error);
        if (job.attempt >= this.maxAttempts) {
          this.deadLetter(job, message);
          return;
        }
        this.logger?.warn(
          { job: job.name, attempt: job.attempt, maxAttempts: this.maxAttempts, error: message },
          'Job failed, will retry',
        );
        await sleep(this.backoffMs * 2 ** (job.attempt - 1));
      }
    }
  }

  private deadLetter(job: Job, error: string): void {
    this.failed.push({
      name: job.name,
      payload: job.payload,
      attempts: job.attempt,
      error,
      failedAt: new Date(),
    });
    this.logger?.error({ job: job.name, attempts: job.attempt, error }, 'Job moved to dead-letter list');
  }
}
