import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { UnauthorizedError } from '../../shared/errors/index';
import { AuthenticatedUser } from '../../shared/types/auth';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: AuthenticatedUser;
  }
}

/**
 * Factory: creates an authentication hook for Fastify.
 * Extracts Bearer token, verifies it, and attaches user context.
 */
export function createAuthHook(authService: AuthService) {
  return async function authHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header', 'MISSING_AUTH');
    }

    const token = authHeader.slice(7);
    if (!token) {
      throw new UnauthorizedError('Missing token', 'MISSING_TOKEN');
    }

    request.currentUser = await authService.verifyToken(token);
  };
}

/**
 * Utility: get the authenticated user from request or throw.
 */
export function getAuthenticatedUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.currentUser) {
    throw new UnauthorizedError('Not authenticated', 'NOT_AUTHENTICATED');
  }
  return request.currentUser;
}
