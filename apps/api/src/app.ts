import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { raw } from 'express';
import type { NextFunction, Response } from 'express';
import { AppModule } from './app.module.js';
import type { ApiDependencies } from './app.module.js';
import { Problem, ProblemFilter, internalProblem } from './common/problem.js';
import type { SubmissionRequest } from './common/request.js';

export const MAX_BODY_BYTES = 262144;

export async function createApp(dependencies: ApiDependencies): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(dependencies), {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  });
  app.useGlobalFilters(new ProblemFilter());
  const readBody = raw({ type: () => true, limit: MAX_BODY_BYTES, inflate: false });
  app.use((request: SubmissionRequest, response: Response, next: NextFunction) => {
    // Capture once, before reading or parsing the request body.
    request.receivedAt = new Date();
    if (request.method !== 'POST' || !/^\/v1\/labs\/[^/]+\/submissions\/?$/i.test(request.path))
      return next();
    const contentType = request.headers['content-type'];
    if (
      !contentType ||
      !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)
    ) {
      return next(
        new Problem(
          'unsupported-media-type',
          'Content-Type must be application/json with UTF-8 encoding.',
        ),
      );
    }
    readBody(request, response, (error: unknown) => {
      if (error) {
        const type =
          typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
        return next(
          type === 'entity.too.large'
            ? new Problem('source-too-large', 'The body exceeds 262,144 bytes.')
            : internalProblem(),
        );
      }
      try {
        const bytes: unknown = request.body;
        const json = Buffer.isBuffer(bytes)
          ? new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          : '';
        request.body = JSON.parse(json) as unknown;
      } catch {
        return next(new Problem('malformed-json', 'The body must contain valid UTF-8 JSON.'));
      }
      next();
    });
  });
  await app.init();
  return app;
}
