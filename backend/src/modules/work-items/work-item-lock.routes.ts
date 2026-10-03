import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { createAuthHook, getAuthenticatedUser } from '../auth/auth.middleware';
import { WorkItemLockService } from './work-item-lock.service';
import { validateParams } from '../../shared/middleware/index';
import { successResponse } from '../../shared/types/index';

const idParams = z.object({ id: z.string().uuid() });

export function registerWorkItemLockRoutes(
  app: FastifyInstance,
  lockService: WorkItemLockService,
  authService: AuthService,
): void {
  const preHandler = createAuthHook(authService);

  app.get('/api/work-items/:id/lock', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, idParams);
    return reply.status(200).send(successResponse(await lockService.getLock(actor, id)));
  });

  app.post('/api/work-items/:id/lock', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, idParams);
    return reply.status(200).send(successResponse(await lockService.acquire(actor, id)));
  });

  app.post('/api/work-items/:id/lock/heartbeat', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, idParams);
    return reply.status(200).send(successResponse(await lockService.heartbeat(actor, id)));
  });

  app.delete('/api/work-items/:id/lock', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, idParams);
    await lockService.release(actor, id);
    return reply.status(200).send(successResponse({ message: 'Lock released' }));
  });
}
