CREATE TABLE "lab_constraints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lab_id" uuid NOT NULL,
	"text" text NOT NULL,
	"deduction_hundredths" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "lab_constraints_deduction_check" CHECK ("lab_constraints"."deduction_hundredths" between 0 and 1000)
);
--> statement-breakpoint
CREATE TABLE "lab_test_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lab_id" uuid NOT NULL,
	"input" text NOT NULL,
	"expected_output" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN "statement" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN "cpu_limit_seconds" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN "memory_limit_mb" integer DEFAULT 256 NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_constraints" ADD CONSTRAINT "lab_constraints_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_cases" ADD CONSTRAINT "lab_test_cases_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_constraints_lab_idx" ON "lab_constraints" USING btree ("lab_id","position");--> statement-breakpoint
CREATE INDEX "lab_test_cases_lab_idx" ON "lab_test_cases" USING btree ("lab_id","position");--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_cpu_limit_check" CHECK ("labs"."cpu_limit_seconds" between 1 and 5);--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_memory_limit_check" CHECK ("labs"."memory_limit_mb" between 64 and 512);