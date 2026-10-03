import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { createAuthHook, getAuthenticatedUser } from '../auth/auth.middleware';
import { TeamService } from './team.service';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/index';
import { buildPaginationMeta, successResponse, TeamRole } from '../../shared/types/index';
import { paginationSchema } from '../../shared/validation/index';

const teamParams = z.object({ id: z.string().uuid() });
const memberParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

const createTeamBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().trim().max(500).optional(),
  managerId: z.string().uuid().optional(),
});

const addMemberBody = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().trim().email().optional(),
    role: z.nativeEnum(TeamRole).default(TeamRole.MEMBER),
  })
  .refine((body) => (body.userId === undefined) !== (body.email === undefined), {
    message: 'Provide either userId or email',
  });

const changeRoleBody = z.object({
  role: z.nativeEnum(TeamRole),
});

export function registerTeamRoutes(
  app: FastifyInstance,
  teamService: TeamService,
  authService: AuthService,
): void {
  const preHandler = createAuthHook(authService);

  app.get('/api/teams', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const page = validateQuery(request, paginationSchema);
    const { items, totalCount } = await teamService.listTeams(actor, page);
    return reply
      .status(200)
      .send(successResponse(items, buildPaginationMeta(page.page, page.pageSize, totalCount)));
  });

  app.post('/api/teams', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const body = validateBody(request, createTeamBody);
    const team = await teamService.createTeam(actor, body);
    return reply.status(201).send(successResponse(team));
  });

  app.get('/api/teams/:id', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, teamParams);
    return reply.status(200).send(successResponse(await teamService.getTeam(actor, id)));
  });

  app.get('/api/teams/:id/members', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, teamParams);
    return reply.status(200).send(successResponse(await teamService.listMembers(actor, id)));
  });

  app.post('/api/teams/:id/members', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id } = validateParams(request, teamParams);
    const body = validateBody(request, addMemberBody);
    const member = body.email
      ? await teamService.addMemberByEmail(actor, id, body.email, body.role)
      : await teamService.addMember(actor, id, body.userId!, body.role);
    return reply.status(201).send(successResponse(member));
  });

  app.patch('/api/teams/:id/members/:userId', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id, userId } = validateParams(request, memberParams);
    const body = validateBody(request, changeRoleBody);
    const member = await teamService.changeMemberRole(actor, id, userId, body.role);
    return reply.status(200).send(successResponse(member));
  });

  app.delete('/api/teams/:id/members/:userId', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    const { id, userId } = validateParams(request, memberParams);
    await teamService.removeMember(actor, id, userId);
    return reply.status(200).send(successResponse({ message: 'Member removed' }));
  });
}
