CREATE TABLE "judge_results" (
	"submission_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"finished_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "judge_results_status_check" CHECK ("judge_results"."status" in ('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE'))
);
--> statement-breakpoint
CREATE TABLE "review_decision_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proposal_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"previous_decision" text,
	"decision" text NOT NULL,
	"revision" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"submission_id" uuid NOT NULL,
	"constraint_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"reason" text,
	"decided_by" text NOT NULL,
	"unsure_cause" text,
	"decision" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp (3) with time zone,
	"review_evidence" jsonb,
	CONSTRAINT "review_proposals_verdict_check" CHECK ("review_proposals"."verdict" in ('pass', 'violation', 'unsure')),
	CONSTRAINT "review_proposals_decision_check" CHECK ("review_proposals"."decision" is null or "review_proposals"."decision" in ('pass', 'violation')),
	CONSTRAINT "review_proposals_decided_by_check" CHECK ("review_proposals"."decided_by" in ('hard-rule', 'model', 'guardrail'))
);
--> statement-breakpoint
ALTER TABLE "judge_results" ADD CONSTRAINT "judge_results_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision_events" ADD CONSTRAINT "review_decision_events_proposal_id_review_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."review_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision_events" ADD CONSTRAINT "review_decision_events_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_proposals" ADD CONSTRAINT "review_proposals_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_proposals" ADD CONSTRAINT "review_proposals_constraint_id_lab_constraints_id_fk" FOREIGN KEY ("constraint_id") REFERENCES "public"."lab_constraints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_proposals" ADD CONSTRAINT "review_proposals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_decision_events_revision_idx" ON "review_decision_events" USING btree ("proposal_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "review_proposals_submission_constraint_idx" ON "review_proposals" USING btree ("submission_id","constraint_id");