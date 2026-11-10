import { createApp } from './app.js';
import { validateConfig } from './config.js';
import type { SubmissionData, SubmissionQueue } from './submissions/submission-data.js';

/** Y's composition root supplies the database adapter; tests supply fakes. */
export async function bootstrap(data: SubmissionData, queue: SubmissionQueue): Promise<void> {
  const config = validateConfig(process.env);
  const app = await createApp({ config, data, queue });
  app.enableShutdownHooks();
  await app.listen(config.port);
}
