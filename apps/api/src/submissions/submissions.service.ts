import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sourceSizeBytes } from '../../../../packages/shared/src/index.js';
import { Problem } from '../common/problem.js';
import { isUuid } from '../common/request.js';
import { SUBMISSION_DATA, SUBMISSION_QUEUE } from './submission-data.js';
import type {
  StoredSubmission,
  SubmissionData,
  SubmissionQueue,
  SubmissionReceipt,
} from './submission-data.js';
import { validateIdempotencyKey, validateSubmission } from './submission-validation.js';

export interface SubmissionResult {
  receipt: SubmissionReceipt;
  replayed: boolean;
}

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    @Inject(SUBMISSION_DATA) private readonly data: SubmissionData,
    @Inject(SUBMISSION_QUEUE) private readonly queue: SubmissionQueue,
  ) {}

  async submit(
    studentId: string,
    labId: string,
    keyHeader: string | string[] | undefined,
    body: unknown,
    receivedAt: Date,
  ): Promise<SubmissionResult> {
    const key = validateIdempotencyKey(keyHeader);
    const { source } = validateSubmission(body);
    if (!isUuid(labId)) throw new Problem('lab-not-found', 'The lab was not found.');
    labId = labId.toLowerCase();
    const lab = await this.data.findLabForStudent(studentId, labId);
    // Theo FAQ-01: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-01
    if (!lab) throw new Problem('lab-not-found', 'The lab was not found.');
    const scope = { studentId, labId, key };
    // Hash exactly the validated source's UTF-8 bytes, without normalization.
    const requestHash = createHash('sha256').update(source, 'utf8').digest('hex');
    const stored = await this.data.findIdempotencyKey(scope);
    if (stored && stored.expiresAt.getTime() > receivedAt.getTime())
      return this.replay(stored, requestHash);
    // Theo FAQ-03: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-03
    if (receivedAt < lab.opensAt) throw new Problem('lab-not-open', 'The lab is not open yet.');
    if (receivedAt >= lab.deadlineAt)
      throw new Problem('lab-closed', 'The lab deadline has passed.');
    const receipt: SubmissionReceipt = {
      id: randomUUID(),
      labId,
      status: 'queued',
      receivedAt: receivedAt.toISOString(),
      sizeBytes: sourceSizeBytes(source),
    };
    const result = await this.data.insertSubmission({
      ...scope,
      source,
      requestHash,
      receipt,
      expiresAt: new Date(receivedAt.getTime() + 24 * 60 * 60 * 1000),
    });
    if (!result.created) return this.replay(result.stored, requestHash);
    try {
      await this.queue.enqueue(result.stored.receipt.id);
    } catch {
      // The durable queued row is the outbox; never expose queue errors or lose the 202.
      this.logger.warn('Submission saved; queue delivery deferred to the outbox sweep.');
    }
    return { receipt: result.stored.receipt, replayed: false };
  }

  private replay(stored: StoredSubmission, requestHash: string): SubmissionResult {
    if (stored.requestHash !== requestHash)
      throw new Problem(
        'idempotency-key-reused',
        'The key was already used with different source.',
      );
    return { receipt: stored.receipt, replayed: true };
  }
}
