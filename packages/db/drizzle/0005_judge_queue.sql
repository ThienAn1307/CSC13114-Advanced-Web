CREATE TABLE "check_jobs" (
	"submission_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp (3) with time zone,
	"claim_token" uuid,
	"failure_cause" text,
	CONSTRAINT "check_jobs_status_check" CHECK ("check_jobs"."status" in ('queued', 'checking', 'done', 'failed')),
	CONSTRAINT "check_jobs_lease_check" CHECK (("check_jobs"."status" = 'checking') = ("check_jobs"."lease_until" is not null)),
	CONSTRAINT "check_jobs_token_check" CHECK ("check_jobs"."claim_token" is null or "check_jobs"."status" = 'checking'),
	CONSTRAINT "check_jobs_failure_check" CHECK (("check_jobs"."status" = 'failed') = ("check_jobs"."failure_cause" is not null))
);
--> statement-breakpoint
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_status_check";--> statement-breakpoint
DROP INDEX "submissions_queued_idx";--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "lease_until" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "failure_cause" text;--> statement-breakpoint
ALTER TABLE "check_jobs" ADD CONSTRAINT "check_jobs_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_jobs_claimable_idx" ON "check_jobs" USING btree ("created_at","submission_id") WHERE "check_jobs"."status" in ('queued', 'checking');--> statement-breakpoint
CREATE INDEX "submissions_claimable_idx" ON "submissions" USING btree ("received_at","id") WHERE "submissions"."status" in ('queued', 'judging');--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_lease_check" CHECK (("submissions"."status" = 'judging') = ("submissions"."lease_until" is not null));--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_token_check" CHECK ("submissions"."claim_token" is null or "submissions"."status" = 'judging');--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_failure_check" CHECK (("submissions"."status" = 'failed') = ("submissions"."failure_cause" is not null));--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_status_check" CHECK ("submissions"."status" in ('queued', 'judging', 'judged', 'failed'));