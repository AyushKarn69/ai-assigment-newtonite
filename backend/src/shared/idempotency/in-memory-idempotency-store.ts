import { BeginResult, IdempotencyStore, StoredResponse } from './idempotency-store';

interface Entry {
  fingerprint: string;
  response: StoredResponse | null; // null while in progress
  expiresAt: number;
}

export interface InMemoryIdempotencyStoreOptions {
  /** How long a completed result is remembered. Default 24 hours. */
  ttlMs?: number;
  /** How long an unfinished request blocks retries (guards against abandoned requests). Default 2 minutes. */
  inProgressTtlMs?: number;
}

/**
 * In-memory idempotency store for single-instance use.
 * Will be replaced by a Redis-backed store for multi-instance production use.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly ttlMs: number;
  private readonly inProgressTtlMs: number;
  private entries = new Map<string, Entry>();

  constructor(options: InMemoryIdempotencyStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.inProgressTtlMs = options.inProgressTtlMs ?? 2 * 60 * 1000;
  }

  private static id(scope: string, key: string): string {
    return `${scope}\u0000${key}`;
  }

  async begin(scope: string, key: string, fingerprint: string, now: Date): Promise<BeginResult> {
    this.sweep(now);
    const id = InMemoryIdempotencyStore.id(scope, key);
    const existing = this.entries.get(id);

    if (!existing) {
      this.entries.set(id, {
        fingerprint,
        response: null,
        expiresAt: now.getTime() + this.inProgressTtlMs,
      });
      return { status: 'new' };
    }
    if (existing.fingerprint !== fingerprint) return { status: 'conflict' };
    if (existing.response === null) return { status: 'in_progress' };
    return { status: 'replay', response: { ...existing.response } };
  }

  async complete(scope: string, key: string, response: StoredResponse, now: Date): Promise<void> {
    const entry = this.entries.get(InMemoryIdempotencyStore.id(scope, key));
    if (!entry) return;
    entry.response = { ...response };
    entry.expiresAt = now.getTime() + this.ttlMs;
  }

  async abandon(scope: string, key: string): Promise<void> {
    const id = InMemoryIdempotencyStore.id(scope, key);
    // only discard unfinished entries; a completed result must keep replaying
    if (this.entries.get(id)?.response === null) this.entries.delete(id);
  }

  /** Test helper — reset all data */
  clear(): void {
    this.entries.clear();
  }

  private sweep(now: Date): void {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now.getTime()) this.entries.delete(id);
    }
  }
}
