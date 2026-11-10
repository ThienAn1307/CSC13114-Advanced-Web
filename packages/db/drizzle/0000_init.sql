CREATE TABLE "class_members" (
	"class_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "class_members_class_id_user_id_pk" PRIMARY KEY("class_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "classes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"student_id" uuid NOT NULL,
	"lab_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"submission_id" uuid NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_student_id_lab_id_key_pk" PRIMARY KEY("student_id","lab_id","key"),
	CONSTRAINT "idempotency_keys_submission_id_unique" UNIQUE("submission_id"),
	CONSTRAINT "idempotency_keys_hash_check" CHECK ("idempotency_keys"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "idempotency_keys_key_check" CHECK ("idempotency_keys"."key" ~ '^[!-~]{1,255}$')
);
--> statement-breakpoint
CREATE TABLE "labs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"class_id" uuid NOT NULL,
	"title" text NOT NULL,
	"opens_at" timestamp (3) with time zone NOT NULL,
	"deadline_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "labs_window_check" CHECK ("labs"."deadline_at" > "labs"."opens_at")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lab_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"source" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"received_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "submissions_size_check" CHECK ("submissions"."size_bytes" between 1 and 65536),
	CONSTRAINT "submissions_status_check" CHECK ("submissions"."status" in ('queued'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('student', 'ta', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "class_members" ADD CONSTRAINT "class_members_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_members" ADD CONSTRAINT "class_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_members_user_idx" ON "class_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "labs_class_idx" ON "labs" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "submissions_lab_student_idx" ON "submissions" USING btree ("lab_id","student_id","received_at");--> statement-breakpoint
CREATE INDEX "submissions_queued_idx" ON "submissions" USING btree ("received_at","id") WHERE "submissions"."status" = 'queued';