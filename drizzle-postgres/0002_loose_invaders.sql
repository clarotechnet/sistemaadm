CREATE TABLE "raw_file_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"retention_mode" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_file_uploads_storage_path_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"mask_cpf" boolean DEFAULT true NOT NULL,
	"file_retention" text DEFAULT 'NONE' NOT NULL,
	"financial_tolerance" numeric(12, 2) DEFAULT '0.01' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "raw_file_uploads" ADD CONSTRAINT "raw_file_uploads_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_raw_file_uploads_user_created" ON "raw_file_uploads" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_raw_file_uploads_expires" ON "raw_file_uploads" USING btree ("expires_at");