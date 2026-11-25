import { randomUUID } from 'node:crypto';
import { count, eq, sql } from 'drizzle-orm';
import { modelCalls } from './schema.js';
import type { Database } from './submission-data.js';

export interface CallStart {
  submissionId: string;
  labId: string;
  constraintId: string;
  attempt: number;
  model: string;
  prompt: string;
}

export interface CallEnd {
  model: string;
  requestId?: string;
  tokensIn?: number;
  tokensOut?: number;
  costNanoUsd?: number;
  ms: number;
  outcome: 'answered' | 'bad-schema' | 'evidence-mismatch' | 'timeout' | 'model-error';
  error?: string;
}

/** The call log (D14), which is also what the cap on calls per lab counts (D8). */
export class ModelCallLog {
  constructor(private readonly db: Database) {}

  /**
   * Writes the row of a call about to be made and returns its id, or null when the lab has used
   * its calls. A lock per lab makes counting and inserting one step for calls at the same moment.
   */
  async start(call: CallStart, maxCallsPerLab: number): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      const lock = `model-calls:${call.labId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
      const [used] = await tx
        .select({ n: count() })
        .from(modelCalls)
        .where(eq(modelCalls.labId, call.labId));
      if (used!.n >= maxCallsPerLab) return null;
      const id = randomUUID();
      await tx.insert(modelCalls).values({ id, ...call });
      return id;
    });
  }

  async finish(id: string, end: CallEnd): Promise<void> {
    await this.db.update(modelCalls).set(end).where(eq(modelCalls.id, id));
  }
}
