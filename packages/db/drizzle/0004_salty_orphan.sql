CREATE TABLE "judge_test_results" (
	"submission_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "judge_test_results_submission_id_position_pk" PRIMARY KEY("submission_id","position"),
	CONSTRAINT "judge_test_results_position_check" CHECK ("judge_test_results"."position" > 0),
	CONSTRAINT "judge_test_results_status_check" CHECK ("judge_test_results"."status" in ('AC', 'WA', 'TLE', 'MLE', 'RE'))
);
--> statement-breakpoint
ALTER TABLE "judge_test_results" ADD CONSTRAINT "judge_test_results_submission_id_judge_results_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."judge_results"("submission_id") ON DELETE no action ON UPDATE no action;