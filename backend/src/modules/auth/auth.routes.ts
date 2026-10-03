import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { UserService } from '../users/user.service';
import { createAuthHook, getAuthenticatedUser } from './auth.middleware';
import { validateBody } from '../../shared/middleware/index';
import { successResponse } from '../../shared/types/index';

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  userService: UserService,
): void {
  const authHook = createAuthHook(authService);

  app.post('/api/auth/login', async (request, reply) => {
    const body = validateBody(request, loginSchema);
    const result = await authService.login(body);
    return reply.status(200).send(successResponse(result));
  });

  app.post('/api/auth/logout', {
    preHandler: authHook,
  }, async (request, reply) => {
    const token = request.headers.authorization!.slice(7);
    await authService.logout(token);
    return reply.status(200).send(successResponse({ message: 'Logged out successfully' }));
  });

  app.get('/api/users/me', {
    preHandler: authHook,
  }, async (request, reply) => {
    const { id } = getAuthenticatedUser(request);
    return reply.status(200).send(successResponse(await userService.findById(id)));
  });
}
