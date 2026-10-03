import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { createAuthHook, getAuthenticatedUser } from '../auth/auth.middleware';
import { CommentService } from './comment.service';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/index';
import { buildPaginationMeta, successResponse } from '../../shared/types/index';
import { paginationSchema } from '../../shared/validation/index';

const idParams = z.object({ id: z.string().uuid() });
const addBody = z.object({ body: z.string().trim().min(1, 'Comment cannot be empty').max(5000) });
const listQuery = paginationSchema.extend({ order: z.enum(['asc', 'desc']).default('asc') });

export function registerCommentRoutes(
  app: FastifyInstance,
  commentService: CommentService,
  authService: AuthService,
): void {
  const preHandler = createAuthHook(authService);

  app.get('/api/work-items/:id/comments', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, idParams);
    const query = validateQuery(request, listQuery);
    const { items, totalCount } = await commentService.list(actor, id, query);
    return reply
      .status(200)
      .send(successResponse(items, buildPaginationMeta(query.page, query.pageSize, totalCount)));
  });

  app.post('/api/work-items/:id/comments', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, idParams);
    const { body } = validateBody(request, addBody);
    return reply.status(201).send(successResponse(await commentService.add(actor, id, body)));
  });
}
