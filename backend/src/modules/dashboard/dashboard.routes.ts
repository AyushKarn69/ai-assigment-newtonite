import { FastifyInstance } from 'fastify';
import { AuthService } from '../auth/auth.service';
import { createAuthHook, getAuthenticatedUser } from '../auth/auth.middleware';
import { DashboardService } from './dashboard.service';
import { successResponse } from '../../shared/types/index';

export function registerDashboardRoutes(
  app: FastifyInstance,
  dashboardService: DashboardService,
  authService: AuthService,
): void {
  const preHandler = createAuthHook(authService);

  app.get('/api/dashboard', { preHandler }, async (request, reply) => {
    const actor = getAuthenticatedUser(request);
    return reply.status(200).send(successResponse(await dashboardService.get(actor)));
  });
}
