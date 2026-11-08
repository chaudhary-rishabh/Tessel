CREATE TYPE "public"."connector_auth" AS ENUM('none', 'token', 'oauth');--> statement-breakpoint
CREATE TYPE "public"."connector_status" AS ENUM('pending', 'connected', 'needs_auth', 'error');--> statement-breakpoint
CREATE TABLE "connector_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"catalog_id" text,
	"name" text NOT NULL,
	"server_url" text NOT NULL,
	"auth" "connector_auth" NOT NULL,
	"credentials" text NOT NULL,
	"oauth_state_hash" text,
	"oauth_state_expires_at" timestamp with time zone,
	"status" "connector_status" DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_connections" ADD CONSTRAINT "connector_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_connections" ADD CONSTRAINT "connector_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_connections_owner_idx" ON "connector_connections" USING btree ("workspace_id","user_id");--> statement-breakpoint

-- Connections are private: only the user who made one can see or use it,
-- and only while they're still a member of the workspace.
ALTER TABLE connector_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY connector_connections_owner ON connector_connections FOR ALL TO tessel_app
  USING (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint

-- The OAuth callback arrives from the user's browser before we know who they
-- are; this finds the connection waiting for that state, and nothing else.
CREATE OR REPLACE FUNCTION app.connector_for_oauth_state(state_hash text)
RETURNS TABLE (connection_id uuid, owner_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, user_id FROM connector_connections
  WHERE oauth_state_hash = state_hash AND oauth_state_expires_at > now()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.connector_for_oauth_state(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.connector_for_oauth_state(text) TO tessel_app;
