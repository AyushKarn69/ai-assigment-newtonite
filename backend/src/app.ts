import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { Config, getConfig } from './config';
import { globalErrorHandler } from './shared/middleware/error-handler';
import { successResponse } from './shared/types/index';

export interface AppDependencies {
  config?: Config;
}

/**
 * Build and configure the Fastify application.
 *
 * This factory function allows injecting dependencies for testing.
 */
export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
  const config = deps.config ?? getConfig();

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
    contentSecurityPolicy: config.NODE_ENV === 'production' ? undefined : false,
  });

  // --- Global error handler ---
  app.setErrorHandler(globalErrorHandler);

  // --- Health / readiness ---
  app.get('/api/health', async () => {
    return successResponse({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  app.get('/api/ready', async () => {
    // Later: check database, redis connectivity
    return successResponse({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  });

  // --- Content type parser for JSON ---
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      try {
        const json = body ? JSON.parse(body as string) : undefined;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.log.info('Application built successfully');

  return app;
}
