import { getConfig } from './config';
import path from 'node:path';
import { buildApp } from './app';
import { createContainer } from './container';
import { DEMO_PASSWORD, seedDemoData } from './seed';
import { createModuleLogger } from './shared/utils/logger';

const logger = createModuleLogger('server');

async function main(): Promise<void> {
  const config = getConfig();

  const container = createContainer(config);
  if (config.SEED_DEMO_DATA) {
    const seeded = await seedDemoData(container);
    logger.info(
      { ...seeded, accounts: 'ada@newtonite.test (admin), sarah@, liam@, elena@, carlos@, priya@newtonite.test' },
      `Demo data loaded — every demo account uses the password "${DEMO_PASSWORD}"`,
    );
  }

  // backend/src (tsx) and backend/dist (node) are both two levels below the repo root
  const frontendDir = config.FRONTEND_DIR ?? path.resolve(__dirname, '../../frontend');
  const app = await buildApp({ config, container, frontendDir });

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
