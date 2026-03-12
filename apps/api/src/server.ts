import 'dotenv/config';
import { buildApp } from './app';
import { loadConfig } from './config';

const HOST = '0.0.0.0';

async function start(): Promise<void> {
  const app = await buildApp();
  const config = loadConfig();

  try {
    await app.listen({ port: config.apiPort, host: HOST });
    app.log.info(`API listening on http://${HOST}:${config.apiPort}`);

    if (config.workerEnabled) {
      app.services.worker.start();
      app.log.info('Worker is enabled');
    } else {
      app.log.info('Worker is disabled');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
