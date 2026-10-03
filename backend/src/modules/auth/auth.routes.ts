import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { UserService } from '../users/user.service';
import { createAuthHook, getAuthenticatedUser } from './auth.middleware';
import { LoginThrottle } from './login-throttle';
import { ForbiddenError } from '../../shared/errors/index';
import { validateBody } from '../../shared/middleware/index';
import { successResponse } from '../../shared/types/index';

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

/** bcrypt only looks at the first 72 bytes, so longer passwords would be silently truncated. */
const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  email: z.string().trim().email('Invalid email format').max(254),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes'),
});

export interface AuthRouteOptions {
  allowRegistration: boolean;
  /** Limits sign-ups per client address. */
  registrationThrottle: LoginThrottle;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  userService: UserService,
  options: AuthRouteOptions = { allowRegistration: false, registrationThrottle: new LoginThrottle({ now: () => new Date() }) },
): void {
  const authHook = createAuthHook(authService);

  app.post('/api/auth/login', async (request, reply) => {
    const body = validateBody(request, loginSchema);
    const result = await authService.login(body);
    return reply.status(200).send(successResponse(result));
  });

  app.post('/api/auth/register', async (request, reply) => {
    if (!options.allowRegistration) {
      throw new ForbiddenError('Self-service registration is turned off', 'REGISTRATION_DISABLED');
    }
    // every attempt that gets past the on/off switch counts, so one address cannot mass-create accounts
    options.registrationThrottle.assertAllowed(request.ip);
    const body = validateBody(request, registerSchema);
    options.registrationThrottle.recordFailure(request.ip);

    const result = await authService.register(body);
    return reply.status(201).send(successResponse(result));
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
