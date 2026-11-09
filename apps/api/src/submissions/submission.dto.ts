import { IsNotEmpty, IsString, Matches, ValidateBy } from 'class-validator';
import type { SubmissionReceipt } from './submission-data.js';

export class CreateSubmissionDto {
  @IsString({ message: 'must be a string' })
  @IsNotEmpty({ message: 'must not be empty' })
  @ValidateBy({
    name: 'noNul',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && !value.includes(String.fromCharCode(0)),
      defaultMessage: () => 'must not contain U+0000',
    },
  })
  @Matches(/^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/u, {
    message: 'must contain valid Unicode',
  })
  source!: string;
}

export type SubmissionReceiptDto = SubmissionReceipt;
