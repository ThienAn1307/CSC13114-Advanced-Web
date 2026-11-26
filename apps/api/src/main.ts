import { createApp } from './app.js';
import type { ApiDependencies } from './app.module.js';
import { validateConfig } from './config.js';
import type { SubmissionData, SubmissionQueue } from './submissions/submission-data.js';

/** Y's composition root supplies the database adapter; tests supply fakes. */
export async function bootstrap(
  data: SubmissionData,
  queue: SubmissionQueue,
  services: Omit<ApiDependencies, 'config' | 'data' | 'queue'> = {},
): Promise<void> {
  const config = validateConfig(process.env);
  const app = await createApp({
    config,
    data,
    queue,
    ...services,
  });
  app.enableShutdownHooks();
  await app.listen(config.port);
}
