import type { OnApplicationShutdown } from '@nestjs/common';
// Relative, like packages/shared elsewhere in this app: `tsc -p tsconfig.build.json` compiles
// it into dist; importing `@leetkob/db` by name would load the .ts source at run time.
import type { DbHandle } from '../../../packages/db/src/client.js';
import { DrizzleSubmissionData } from '../../../packages/db/src/submission-data.js';
import type { SubmissionData } from './submissions/submission-data.js';

/**
 * The PostgreSQL adapter, owning its pool. Nest calls onApplicationShutdown on value providers
 * too, so `app.close()` (and the SIGTERM hook that bootstrap enables) closes the pool.
 */
export class PostgresSubmissionData
  extends DrizzleSubmissionData
  implements SubmissionData, OnApplicationShutdown
{
  constructor(private readonly handle: DbHandle) {
    super(handle.db);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
