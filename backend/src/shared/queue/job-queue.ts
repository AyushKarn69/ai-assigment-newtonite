export type JobHandler<T = unknown> = (payload: T) => Promise<void>;

export interface FailedJob {
  name: string;
  payload: unknown;
  attempts: number;
  error: string;
  failedAt: Date;
}

export interface QueueLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

/**
 * Background job queue.
 *
 * `enqueue` returns as soon as the job is accepted; the handler runs later,
 * outside the request that produced it, so slow or failing side effects (such as
 * sending notifications) can never fail or slow down the originating request.
 *
 * Jobs are retried with exponential backoff and moved to a dead-letter list once
 * attempts are exhausted. The in-memory implementation is single-process; the
 * planned BullMQ/Redis implementation provides the same contract across instances.
 */
export interface JobQueue {
  register<T>(name: string, handler: JobHandler<T>): void;
  enqueue<T>(name: string, payload: T): Promise<void>;
  /** Resolves once every queued job (including retries) has finished. */
  drain(): Promise<void>;
  /** Stop accepting jobs, finish what is queued. */
  close(): Promise<void>;
  /** Dead-lettered jobs, oldest first. */
  failedJobs(): FailedJob[];
  setLogger(logger: QueueLogger): void;
}
