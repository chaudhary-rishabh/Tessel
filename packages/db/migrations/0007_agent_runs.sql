CREATE TYPE "public"."agent_run_status" AS ENUM('waiting', 'running', 'completed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."message_status" ADD VALUE 'waiting';--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "agent_run_status" DEFAULT 'waiting' NOT NULL,
	"model_id" text NOT NULL,
	"checkpoint" jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_thread_status_idx" ON "agent_runs" USING btree ("thread_id","status");--> statement-breakpoint

-- Paused agent runs are as private as the chat they belong to.
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_runs_owner ON agent_runs FOR ALL TO tessel_app
  USING (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL);
