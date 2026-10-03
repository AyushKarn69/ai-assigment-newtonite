import { createHash } from 'node:crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { BadRequestError, IdempotencyConflictError } from '../errors/index';
import { Clock } from '../utils/clock';
import { IdempotencyStore } from './idempotency-store';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Printable ASCII without spaces, 1–255 characters. */
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

export interface IdempotencyOptions {
  store: IdempotencyStore;
  clock: Clock;
  /** Who is calling? Returns null when the request is not (validly) authenticated. */
  resolveUserId(request: FastifyRequest): Promise<string | null>;
  /** POST route patterns that honour the header, e.g. '/api/work-items/:id/comments'. */
  routes: readonly string[];
}

type State = { kind: 'processing'; scope: string; key: string } | { kind: 'replayed' };

/**
 * Optional `Idempotency-Key` support for the listed POST routes.
 *
 *  - same key + same request → the first response is replayed (header
 *    `Idempotent-Replayed: true`) and nothing is created again;
 *  - same key + different request → 409 IDEMPOTENCY_KEY_REUSED;
 *  - same key while the first request is still running → 409 IDEMPOTENCY_IN_PROGRESS;
 *  - only successful (2xx) responses are remembered, so a failed attempt can be retried.
 *
 * Keys are scoped per user, so two users can never collide or see each other's results.
 */
export function registerIdempotency(app: FastifyInstance, options: IdempotencyOptions): void {
  const routes = new Set(options.routes);
  const states = new WeakMap<FastifyRequest, State>();

  app.addHook('preHandler', async (request, reply) => {
    const header = request.headers[IDEMPOTENCY_HEADER];
    if (header === undefined || request.method !== 'POST') return;
    if (!routes.has(request.routeOptions.url ?? '')) return;

    const userId = await options.resolveUserId(request);
    if (userId === null) return; // normal authentication will reject the request

    const key = Array.isArray(header) ? header[0] : header;
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestError(
        'Idempotency-Key must be 1-255 printable characters without spaces',
        'INVALID_IDEMPOTENCY_KEY',
      );
    }

    const fingerprint = createHash('sha256')
      .update(`${request.method}\n${request.url}\n${JSON.stringify(request.body ?? null)}`)
      .digest('hex');
    const result = await options.store.begin(userId, key, fingerprint, options.clock.now());

    switch (result.status) {
      case 'new':
        states.set(request, { kind: 'processing', scope: userId, key });
        return;
      case 'replay':
        states.set(request, { kind: 'replayed' });
        return reply
          .status(result.response.statusCode)
          .header('content-type', result.response.contentType)
          .header('idempotent-replayed', 'true')
          .send(result.response.body);
      case 'in_progress':
        throw new IdempotencyConflictError(
          'A request with this Idempotency-Key is still being processed',
          'IDEMPOTENCY_IN_PROGRESS',
        );
      case 'conflict':
        throw new IdempotencyConflictError(
          'This Idempotency-Key was already used for a different request',
          'IDEMPOTENCY_KEY_REUSED',
        );
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const state = states.get(request);
    if (!state || state.kind !== 'processing') return payload;
    states.delete(request);

    if (reply.statusCode >= 200 && reply.statusCode < 300) {
      await options.store.complete(
        state.scope,
        state.key,
        {
          statusCode: reply.statusCode,
          body: typeof payload === 'string' ? payload : String(payload),
          contentType: String(reply.getHeader('content-type') ?? 'application/json; charset=utf-8'),
        },
        options.clock.now(),
      );
    } else {
      await options.store.abandon(state.scope, state.key);
    }
    return payload;
  });
}
