import pino from 'pino';
import { getConfig } from '../../config';

let _logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!_logger) {
    const config = getConfig();

    _logger = pino({
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
      serializers: {
        err: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
      },
    });
  }

  return _logger;
}

/**
 * Create a child logger scoped to a module.
 */
export function createModuleLogger(module: string): pino.Logger {
  return getLogger().child({ module });
}

/** Reset logger — only for tests */
export function resetLogger(): void {
  _logger = null;
}
