import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { Config, createTestConfig } from '../config';
import { AppContainer, createContainer } from '../container';
import { TeamRole } from '../shared/types/auth';
import { JobQueue } from '../shared/queue/index';
import { Clock } from '../shared/utils/clock';
import { PrismaClient } from '../shared/db/prisma';
import { dbTestsEnabled, resetDatabase } from './db';

export const PASSWORD = 'a-long-test-password';
export const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';

export interface Harness {
  app: FastifyInstance;
  container: AppContainer;
  /** user id by name */
  ids: Record<string, string>;
  tokens: Record<string, string>;
  teams: { alpha: string; beta: string };
  /** Authenticated request as the named user. */
  api(
    method: Method,
    url: string,
    who: string,
    payload?: Record<string, unknown>,
    headers?: Record<string, string>,
  ): ReturnType<FastifyInstance['inject']>;
  /** Create a work item through the API as `who` and return its id. */
  createItem(who?: string, overrides?: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

/**
 * Standard cast for integration-style tests:
 *  admin (global ADMIN) · mia (alpha MANAGER) · mo, max (alpha MEMBERs)
 *  olga (beta MANAGER) · nina (no team)
 */
export async function createHarness(
  options: { config?: Partial<Config>; clock?: Clock; jobQueue?: JobQueue; prisma?: PrismaClient | null } = {},
): Promise<Harness> {
  if (dbTestsEnabled()) await resetDatabase(); // every harness starts from empty tables
  const config = createTestConfig(options.config);
  const container = createContainer(config, { clock: options.clock, jobQueue: options.jobQueue, prisma: options.prisma });

  const ids: Record<string, string> = {};
  const people: Array<[string, 'ADMIN' | 'USER']> = [
    ['admin', 'ADMIN'],
    ['mia', 'USER'],
    ['mo', 'USER'],
    ['max', 'USER'],
    ['olga', 'USER'],
    ['nina', 'USER'],
  ];
  for (const [name, role] of people) {
    const user = await container.userService.createUser({
      email: `${name}@example.com`,
      name,
      password: PASSWORD,
      role,
    });
    ids[name] = user.id;
  }

  const alpha = await container.teamRepository.create({ name: 'Alpha' });
  const beta = await container.teamRepository.create({ name: 'Beta' });
  await container.teamRepository.addMember(alpha.id, ids.mia, TeamRole.MANAGER);
  await container.teamRepository.addMember(alpha.id, ids.mo, TeamRole.MEMBER);
  await container.teamRepository.addMember(alpha.id, ids.max, TeamRole.MEMBER);
  await container.teamRepository.addMember(beta.id, ids.olga, TeamRole.MANAGER);

  const app = await buildApp({ config, container });
  await app.ready();

  const tokens: Record<string, string> = {};
  for (const [name] of people) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: `${name}@example.com`, password: PASSWORD },
    });
    tokens[name] = res.json().data.token;
  }

  const api: Harness['api'] = (method, url, who, payload, headers = {}) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${tokens[who]}`, ...headers },
      payload,
    });

  const createItem: Harness['createItem'] = async (who = 'mo', overrides = {}) => {
    const response = await api('POST', '/api/work-items', who, {
      title: 'Payment stuck in pending',
      description: 'Customer waiting',
      type: 'PAYMENT_INVESTIGATION',
      teamId: alpha.id,
      ...overrides,
    });
    if (response.statusCode !== 201) {
      throw new Error(`createItem failed: ${response.statusCode} ${response.body}`);
    }
    return response.json().data.id;
  };

  return {
    app,
    container,
    ids,
    tokens,
    teams: { alpha: alpha.id, beta: beta.id },
    api,
    createItem,
    close: () => app.close(),
  };
}
