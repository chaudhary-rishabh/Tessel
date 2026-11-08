CREATE TYPE "public"."memory_source" AS ENUM('chat', 'user', 'tool');--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"source" "memory_source" NOT NULL,
	"source_thread_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_settings" (
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"memory_enabled" boolean DEFAULT true NOT NULL,
	"chat_search_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_settings_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "summary_through" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "memory_through" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_source_thread_id_threads_id_fk" FOREIGN KEY ("source_thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_settings" ADD CONSTRAINT "memory_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_settings" ADD CONSTRAINT "memory_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memories_owner_idx" ON "memories" USING btree ("user_id","workspace_id","updated_at");--> statement-breakpoint

-- Memories and memory settings are private to their user.
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memories_owner ON memories FOR ALL TO tessel_app
  USING (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint
ALTER TABLE memory_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memory_settings_owner ON memory_settings FOR ALL TO tessel_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL);
