CREATE TYPE "public"."voice_session_status" AS ENUM('starting', 'active', 'ended', 'failed');--> statement-breakpoint
CREATE TABLE "voice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"room_name" text NOT NULL,
	"model_id" text NOT NULL,
	"speech_provider" text,
	"voice_id" text,
	"status" "voice_session_status" DEFAULT 'starting' NOT NULL,
	"end_reason" text,
	"turns" integer DEFAULT 0 NOT NULL,
	"user_audio_ms" integer DEFAULT 0 NOT NULL,
	"latency_p50_ms" integer,
	"latency_p95_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "voice_sessions_room_name_unique" UNIQUE("room_name")
);
--> statement-breakpoint
CREATE TABLE "voice_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"end_of_turn_ms" integer NOT NULL,
	"model_first_token_ms" integer NOT NULL,
	"first_audio_ms" integer NOT NULL,
	"total_ms" integer NOT NULL,
	"preemptive" boolean DEFAULT false NOT NULL,
	"interrupted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "voice_session_id" uuid;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_turns" ADD CONSTRAINT "voice_turns_session_id_voice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."voice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_turns" ADD CONSTRAINT "voice_turns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_turns" ADD CONSTRAINT "voice_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_sessions_owner_recent_idx" ON "voice_sessions" USING btree ("workspace_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "voice_sessions_thread_idx" ON "voice_sessions" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "voice_turns_session_idx" ON "voice_turns" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "voice_turns_recent_idx" ON "voice_turns" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint

-- Voice conversations and their timings are as private as the chat they belong to.
ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY voice_sessions_owner ON voice_sessions FOR ALL TO tessel_app
  USING (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint
ALTER TABLE voice_turns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY voice_turns_owner ON voice_turns FOR ALL TO tessel_app
  USING (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint

-- The voice agent knows only a session's ID, which the API signed into the room
-- token. This says whose session it is, so the agent can act as that user (and
-- row-level security applies to everything it does after). Open sessions only.
CREATE OR REPLACE FUNCTION app.voice_session_owner(target uuid)
RETURNS TABLE (user_id uuid, workspace_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT user_id, workspace_id FROM voice_sessions
  WHERE id = target AND status IN ('starting', 'active');
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.voice_session_owner(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.voice_session_owner(uuid) TO tessel_app;
