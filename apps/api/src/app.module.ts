import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { API_CONFIG } from './config.js';
import type { ApiConfig } from './config.js';
import { SUBMISSION_DATA, SUBMISSION_QUEUE } from './submissions/submission-data.js';
import type { SubmissionData, SubmissionQueue } from './submissions/submission-data.js';
import { SubmissionsModule } from './submissions/submissions.module.js';

export interface ApiDependencies {
  config: ApiConfig;
  data: SubmissionData;
  queue: SubmissionQueue;
}

@Global()
@Module({})
class ApiDependenciesModule {
  static register({ config, data, queue }: ApiDependencies): DynamicModule {
    return {
      module: ApiDependenciesModule,
      providers: [
        { provide: API_CONFIG, useValue: config },
        { provide: SUBMISSION_DATA, useValue: data },
        { provide: SUBMISSION_QUEUE, useValue: queue },
      ],
      exports: [API_CONFIG, SUBMISSION_DATA, SUBMISSION_QUEUE],
    };
  }
}

@Module({})
export class AppModule {
  static register(dependencies: ApiDependencies): DynamicModule {
    return {
      module: AppModule,
      imports: [ApiDependenciesModule.register(dependencies), SubmissionsModule],
    };
  }
}
