import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { createAuthHook, getAuthenticatedUser } from '../auth/auth.middleware';
import { NotificationService } from './notification.service';
import { validateParams, validateQuery } from '../../shared/middleware/index';
import { buildPaginationMeta, successResponse } from '../../shared/types/index';
import { paginationSchema } from '../../shared/validation/index';

const idParams = z.object({ id: z.string().uuid() });
const listQuery = paginationSchema.extend({
  unread: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export function registerNotificationRoutes(
  app: FastifyInstance,
  notificationService: NotificationService,
  authService: AuthService,
): void {
  const preHandler = createAuthHook(authService);

  app.get('/api/notifications', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { page, pageSize, unread } = validateQuery(request, listQuery);
    const result = await notificationService.list(actor, { unreadOnly: unread, page, pageSize });
    return reply
      .status(200)
      .send(successResponse(result.items, buildPaginationMeta(page, pageSize, result.totalCount)));
  });

  app.get('/api/notifications/unread-count', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    return reply
      .status(200)
      .send(successResponse({ count: await notificationService.unreadCount(actor) }));
  });

  app.post('/api/notifications/read-all', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    return reply
      .status(200)
      .send(successResponse({ updated: await notificationService.markAllRead(actor) }));
  });

  app.post('/api/notifications/:id/read', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, idParams);
    return reply.status(200).send(successResponse(await notificationService.markRead(actor, id)));
  });
}
