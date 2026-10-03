export interface StoredResponse {
  statusCode: number;
  body: string;
  contentType: string;
}

export type BeginResult =
  /** First time this key is seen: the caller should process the request. */
  | { status: 'new' }
  /** Already processed with the same request: return the stored response. */
  | { status: 'replay'; response: StoredResponse }
  /** The same request is still being processed right now. */
  | { status: 'in_progress' }
  /** The key was used before for a different request. */
  | { status: 'conflict' };

/**
 * Remembers the outcome of requests that carried an `Idempotency-Key`, so a
 * client that retries after a timeout or dropped connection cannot create the
 * same thing twice.
 *
 * `begin` must be atomic: of two simultaneous calls with the same scope and key,
 * exactly one gets `new`. (A Redis implementation would use `SET NX`.)
 */
export interface IdempotencyStore {
  begin(scope: string, key: string, fingerprint: string, now: Date): Promise<BeginResult>;
  complete(scope: string, key: string, response: StoredResponse, now: Date): Promise<void>;
  /** Forget an in-progress key (the request failed), so the client can retry. */
  abandon(scope: string, key: string): Promise<void>;
}
