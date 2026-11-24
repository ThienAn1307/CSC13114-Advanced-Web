import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { API_CONFIG } from './config.js';
import type { ApiConfig } from './config.js';
import { SUBMISSION_DATA, SUBMISSION_QUEUE } from './submissions/submission-data.js';
import type { SubmissionData, SubmissionQueue } from './submissions/submission-data.js';
import { ACCOUNTS } from './auth/accounts.js';
import type { Accounts } from './auth/accounts.js';
import { LoginController } from './auth/login.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { CLASSROOMS } from './classes/classrooms.js';
import type { Classrooms } from './classes/classrooms.js';
import { ClassesController } from './classes/classes.controller.js';
import { MEMBERS } from './classes/members.js';
import type { Members } from './classes/members.js';
import { MembersController } from './classes/members.controller.js';
import { LABS } from './classes/labs.js';
import type { Labs } from './classes/labs.js';
import { LabsController } from './classes/labs.controller.js';
import { STUDENT_SUBMISSIONS } from './submissions/student-submissions.js';
import type { StudentSubmissions } from './submissions/student-submissions.js';
import { StudentSubmissionsController } from './submissions/student-submissions.controller.js';
import { SubmissionsModule } from './submissions/submissions.module.js';

export interface ApiDependencies {
  config: ApiConfig;
  data: SubmissionData;
  queue: SubmissionQueue;
  accounts?: Accounts;
  classrooms?: Classrooms;
  members?: Members;
  labs?: Labs;
  studentSubmissions?: StudentSubmissions;
}

@Global()
@Module({})
class ApiDependenciesModule {
  static register({
    config,
    data,
    queue,
    accounts,
    classrooms,
    members,
    labs,
    studentSubmissions,
  }: ApiDependencies): DynamicModule {
    return {
      module: ApiDependenciesModule,
      providers: [
        { provide: API_CONFIG, useValue: config },
        { provide: SUBMISSION_DATA, useValue: data },
        { provide: SUBMISSION_QUEUE, useValue: queue },
        { provide: ACCOUNTS, useValue: accounts ?? { findByEmail: () => Promise.resolve(null) } },
        {
          provide: CLASSROOMS,
          useValue: classrooms ?? {
            createClass: () => Promise.reject(new Error('Classroom data is unavailable.')),
            listClasses: () => Promise.reject(new Error('Classroom data is unavailable.')),
          },
        },
        {
          provide: MEMBERS,
          useValue: members ?? {
            add: () => Promise.reject(new Error('Member data is unavailable.')),
          },
        },
        {
          provide: LABS,
          useValue: labs ?? {
            list: () => Promise.reject(new Error('Lab data is unavailable.')),
            create: () => Promise.reject(new Error('Lab data is unavailable.')),
          },
        },
        {
          provide: STUDENT_SUBMISSIONS,
          useValue: studentSubmissions ?? {
            list: () => Promise.reject(new Error('Submission data is unavailable.')),
          },
        },
      ],
      exports: [
        API_CONFIG,
        SUBMISSION_DATA,
        SUBMISSION_QUEUE,
        ACCOUNTS,
        CLASSROOMS,
        MEMBERS,
        LABS,
        STUDENT_SUBMISSIONS,
      ],
    };
  }
}

@Module({})
export class AppModule {
  static register(dependencies: ApiDependencies): DynamicModule {
    return {
      module: AppModule,
      imports: [ApiDependenciesModule.register(dependencies), SubmissionsModule, AuthModule],
      controllers: [
        LoginController,
        ClassesController,
        MembersController,
        LabsController,
        StudentSubmissionsController,
      ],
    };
  }
}
