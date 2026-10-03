import { getConfig } from './config';
import { buildApp } from './app';
import { createModuleLogger } from './shared/utils/logger';

const logger = createModuleLogger('server');

async function main(): Promise<void> {
  const config = getConfig();

  const app = await buildApp({ config });

  // --- Graceful shutdown ---
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

  for (const signal of signals) {
    process.on(signal, async () => {
      logger.info({ signal }, 'Received shutdown signal');
      try {
        await app.close();
        logger.info('Server closed gracefully');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });
  }

  // --- Start ---
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    logger.info(
      { port: config.PORT, host: config.HOST, env: config.NODE_ENV },
      `Server started on http://${config.HOST}:${config.PORT}`,
    );
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();
