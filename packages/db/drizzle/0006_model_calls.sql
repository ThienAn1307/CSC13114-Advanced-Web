CREATE TABLE "model_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"submission_id" uuid NOT NULL,
	"lab_id" uuid NOT NULL,
	"constraint_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"request_id" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_nano_usd" bigint,
	"ms" integer,
	"outcome" text DEFAULT 'started' NOT NULL,
	"error" text,
	CONSTRAINT "model_calls_outcome_check" CHECK ("model_calls"."outcome" in ('started', 'answered', 'bad-schema', 'evidence-mismatch', 'timeout', 'model-error'))
);
--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_constraint_id_lab_constraints_id_fk" FOREIGN KEY ("constraint_id") REFERENCES "public"."lab_constraints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_calls_lab_idx" ON "model_calls" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "model_calls_submission_idx" ON "model_calls" USING btree ("submission_id");