CREATE TYPE "public"."media_kind" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid,
	"kind" "media_kind" NOT NULL,
	"status" "media_status" DEFAULT 'ready' NOT NULL,
	"prompt" text NOT NULL,
	"model_id" text NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"media_type" text,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"size_bytes" integer,
	"storage_key" text,
	"preview_key" text,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"error" text,
	"cost_nano_usd" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_owner_created_idx" ON "media" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "media_thread_idx" ON "media" USING btree ("thread_id");--> statement-breakpoint

-- Each user sees and changes only the media they made.
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY media_owner ON media FOR ALL TO tessel_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
