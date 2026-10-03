import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { createAuthHook, getAuthenticatedUser } from '../auth/auth.middleware';
import { WorkItemService } from './work-item.service';
import {
  WORK_ITEM_SORT_FIELDS,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemType,
} from './work-item.entity';
import { allowedTransitions } from './work-item.workflow';
import { WorkItem } from './work-item.entity';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/index';
import { buildPaginationMeta, successResponse } from '../../shared/types/index';
import { paginationSchema } from '../../shared/validation/index';

const idParams = z.object({ id: z.string().uuid() });

const createBody = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().max(5000).optional(),
  type: z.enum(WorkItemType),
  priority: z.enum(WorkItemPriority).optional(),
  teamId: z.string().uuid(),
  assigneeId: z.string().uuid().nullable().optional(),
});

const updateBody = z
  .object({
    version: z.number().int().min(1),
    title: z.string().trim().min(1, 'Title cannot be empty').max(200).optional(),
    description: z.string().max(5000).optional(),
    type: z.enum(WorkItemType).optional(),
    priority: z.enum(WorkItemPriority).optional(),
    status: z.enum(WorkItemStatus).optional(),
    assigneeId: z.string().uuid().nullable().optional(),
  })
  .refine(({ version: _version, ...fields }) => Object.values(fields).some((v) => v !== undefined), {
    message: 'Provide at least one field to update',
  });

/** Comma-separated list of enum values, e.g. `status=OPEN,BLOCKED`. */
const csvOf = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).min(1))
    .optional();

const listQuery = paginationSchema.extend({
  teamId: z.string().uuid().optional(),
  status: csvOf(z.enum(WorkItemStatus)),
  type: csvOf(z.enum(WorkItemType)),
  priority: csvOf(z.enum(WorkItemPriority)),
  /** 'me', 'unassigned' or a user id. `assigneeId` is kept as an alias for a user id. */
  assignee: z.union([z.literal('me'), z.literal('unassigned'), z.string().uuid()]).optional(),
  assigneeId: z.string().uuid().optional(),
  createdBy: z.string().uuid().optional(),
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => value || undefined),
  sortBy: z.enum(WORK_ITEM_SORT_FIELDS).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/** Single-item responses include which statuses the item may move to next. */
const withTransitions = (item: WorkItem) => ({
  ...item,
  allowedTransitions: allowedTransitions(item.status),
});

export function registerWorkItemRoutes(
  app: FastifyInstance,
  workItemService: WorkItemService,
  authService: AuthService,
): void {
  const preHandler = createAuthHook(authService);

  app.get('/api/work-items', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const query = validateQuery(request, listQuery);
    const { assigneeId, ...filters } = query;
    const { items, totalCount } = await workItemService.list(actor, {
      ...filters,
      assignee: filters.assignee ?? assigneeId,
    });
    return reply
      .status(200)
      .send(successResponse(items, buildPaginationMeta(query.page, query.pageSize, totalCount)));
  });

  app.post('/api/work-items', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const body = validateBody(request, createBody);
    const item = await workItemService.create(actor, body);
    return reply.status(201).send(successResponse(withTransitions(item)));
  });

  app.get('/api/work-items/:id', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, idParams);
    return reply
      .status(200)
      .send(successResponse(withTransitions(await workItemService.getById(actor, id))));
  });

  app.patch('/api/work-items/:id', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, idParams);
    const body = validateBody(request, updateBody);
    return reply
      .status(200)
      .send(successResponse(withTransitions(await workItemService.update(actor, id, body))));
  });
}
