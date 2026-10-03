import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { createAuthHook, getAuthenticatedUser } from '../auth/auth.middleware';
import { ActivityService } from './activity.service';
import { ActivityType } from './activity.entity';
import { validateParams, validateQuery } from '../../shared/middleware/index';
import { buildPaginationMeta, successResponse } from '../../shared/types/index';
import { paginationSchema } from '../../shared/validation/index';

const idParams = z.object({ id: z.string().uuid() });

const listQuery = paginationSchema.extend({
  type: z.enum(ActivityType).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export function registerActivityRoutes(
  app: FastifyInstance,
  activityService: ActivityService,
  authService: AuthService,
): void {
  const preHandler = createAuthHook(authService);

  app.get('/api/work-items/:id/activity', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, idParams);
    const query = validateQuery(request, listQuery);
    const { items, totalCount } = await activityService.list(actor, id, query);
    return reply
      .status(200)
      .send(successResponse(items, buildPaginationMeta(query.page, query.pageSize, totalCount)));
  });
}
