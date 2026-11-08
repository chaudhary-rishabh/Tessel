CREATE TYPE "public"."usage_route" AS ENUM('gateway', 'direct');--> statement-breakpoint
CREATE TYPE "public"."usage_status" AS ENUM('ok', 'error', 'aborted', 'blocked');--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" text,
	"feature" text NOT NULL,
	"model_id" text NOT NULL,
	"route" "usage_route" NOT NULL,
	"status" "usage_status" NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cost_nano_usd" bigint DEFAULT 0 NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_events_workspace_created_idx" ON "usage_events" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "usage_events_user_created_idx" ON "usage_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "usage_events_request_idx" ON "usage_events" USING btree ("request_id") WHERE "usage_events"."request_id" is not null;--> statement-breakpoint

-- The ledger is append-only for the app: no edits, no deletes.
REVOKE UPDATE, DELETE ON usage_events FROM tessel_app;
--> statement-breakpoint
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Members see their own usage; owners and admins see the whole workspace.
CREATE POLICY usage_events_select ON usage_events FOR SELECT TO tessel_app
  USING (
    user_id = app.current_user_id()
    OR app.workspace_role(workspace_id) IN ('owner', 'admin')
  );
--> statement-breakpoint

-- Usage is always recorded for the acting user, in a workspace they belong to.
CREATE POLICY usage_events_insert ON usage_events FOR INSERT TO tessel_app
  WITH CHECK (
    user_id = app.current_user_id()
    AND app.workspace_role(workspace_id) IS NOT NULL
  );
--> statement-breakpoint

-- A workspace's total spend since a moment, for spend caps. Any member may
-- read the total (not the rows), so caps work for every role.
CREATE OR REPLACE FUNCTION app.workspace_spend_since(target_workspace uuid, since timestamptz)
  RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN app.workspace_role(target_workspace) IS NULL THEN NULL
    ELSE (
      SELECT coalesce(sum(cost_nano_usd), 0)::bigint FROM public.usage_events
      WHERE workspace_id = target_workspace AND created_at >= since
    )
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.workspace_spend_since(uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.workspace_spend_since(uuid, timestamptz) TO tessel_app;
