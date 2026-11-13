CREATE TABLE "message_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"content" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "version_count" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "version_index" integer;--> statement-breakpoint
ALTER TABLE "message_versions" ADD CONSTRAINT "message_versions_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_versions" ADD CONSTRAINT "message_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_versions" ADD CONSTRAINT "message_versions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_versions_message_idx" ON "message_versions" USING btree ("message_id","position");--> statement-breakpoint

-- Each user sees only the versions of their own chats.
ALTER TABLE message_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY message_versions_owner ON message_versions FOR ALL TO tessel_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
