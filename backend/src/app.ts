import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { Config, getConfig } from './config';
import { globalErrorHandler } from './shared/middleware/error-handler';
import { successResponse } from './shared/types/index';
import { createContainer, AppContainer } from './container';
import { registerAuthRoutes } from './modules/auth/index';
import { registerTeamRoutes } from './modules/teams/index';
import { registerWorkItemRoutes, registerWorkItemLockRoutes } from './modules/work-items/index';
import { registerActivityRoutes } from './modules/activity/index';
import { registerCommentRoutes } from './modules/comments/index';
import { registerDashboardRoutes } from './modules/dashboard/index';
import { registerNotificationRoutes } from './modules/notifications/index';
import { registerIdempotency } from './shared/idempotency/index';
import { registerFrontend } from './frontend';
import { BadRequestError } from './shared/errors/index';
import { errorResponse } from './shared/types/index';

export interface AppDependencies {
  config?: Config;
  container?: AppContainer;
  /** Directory of the web app to serve at `/`. Omit to serve the API only. */
  frontendDir?: string;
}

/**
 * Build and configure the Fastify application.
 *
 * This factory function allows injecting dependencies for testing.
 */
export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
  const config = deps.config ?? getConfig();
  const container = deps.container ?? createContainer(config);

  const app = Fastify({
    logger: config.NODE_ENV === 'test'
      ? false
      : {
          level: config.LOG_LEVEL,
          transport:
            config.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { colorize: true } }
              : undefined,
        },
    disableRequestLogging: config.NODE_ENV === 'test',
  });

  // --- Plugins ---
  await app.register(cors, {
    origin: config.NODE_ENV === 'production' ? false : true,
    credentials: true,
  });

  await app.register(helmet, {
    // The web app uses the Tailwind CDN, Google Fonts and inline styles/scripts,
    // so production needs those allowed explicitly (see HANDBOOK, "Web app").
    contentSecurityPolicy:
      config.NODE_ENV === 'production'
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.tailwindcss.com'],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              fontSrc: ["'self'", 'https://fonts.gstatic.com'],
              imgSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
  });

  // --- Background jobs: log failures, and finish queued work on shutdown ---
  container.jobQueue.setLogger(app.log);
  app.addHook('onClose', async () => {
    await container.jobQueue.close();
  });

  // --- Global error handler ---
  app.setErrorHandler(globalErrorHandler);
  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(errorResponse('NOT_FOUND', `Route ${request.method} ${request.url} not found`));
  });

  // Every response carries the request id so a problem report can be traced in the logs
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  // --- Idempotency-Key support on the create endpoints ---
  registerIdempotency(app, {
    store: container.idempotencyStore,
    clock: container.clock,
    resolveUserId: async (request) => {
      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer ')) return null;
      try {
        return (await container.authService.verifyToken(header.slice(7))).id;
      } catch {
        return null;
      }
    },
    routes: [
      '/api/work-items',
      '/api/work-items/:id/comments',
      '/api/teams',
      '/api/teams/:id/members',
    ],
  });

  // --- Health / readiness ---
  app.get('/api/health', async () => {
    return successResponse({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  app.get('/api/ready', async () => {
    return successResponse({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  });

  // --- Module routes ---
  registerAuthRoutes(app, container.authService, container.userService);
  registerTeamRoutes(app, container.teamService, container.authService);
  registerWorkItemRoutes(app, container.workItemService, container.authService);
  registerWorkItemLockRoutes(app, container.workItemLockService, container.authService);
  registerActivityRoutes(app, container.activityService, container.authService);
  registerCommentRoutes(app, container.commentService, container.authService);
  registerDashboardRoutes(app, container.dashboardService, container.authService);
  registerNotificationRoutes(app, container.notificationService, container.authService);

  if (deps.frontendDir) registerFrontend(app, deps.frontendDir);

  // --- Content type parser for JSON ---
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      try {
        const json = body ? JSON.parse(body as string) : undefined;
        done(null, json);
      } catch {
        done(new BadRequestError('Request body is not valid JSON', 'INVALID_JSON'), undefined);
      }
    },
  );

  // Expose container on app for route handlers that need it
  app.decorate('container', container);

  return app;
}
