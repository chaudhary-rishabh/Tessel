CREATE TABLE "ai_model_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_config_single_row" CHECK ("ai_model_config"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_model_config" ADD CONSTRAINT "ai_model_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Suspended accounts' personal access tokens and OAuth tokens stop working too.
CREATE OR REPLACE FUNCTION app.resolve_access_token(hash text)
RETURNS TABLE (token_id uuid, user_id uuid, workspace_id uuid, scopes text[], role user_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.user_id, t.workspace_id, t.scopes, u.role
  FROM personal_access_tokens t
  JOIN users u ON u.id = t.user_id
  JOIN workspace_members m ON m.workspace_id = t.workspace_id AND m.user_id = t.user_id
  WHERE t.token_hash = hash
    AND t.revoked_at IS NULL
    AND (t.expires_at IS NULL OR t.expires_at > now())
    AND u.suspended_at IS NULL
$$;
--> statement-breakpoint
-- Platform-wide figures for the admin app. Usage and workspaces are behind
-- row-level security, so these run as the table owner. The API only calls
-- them for platform admins.
CREATE OR REPLACE FUNCTION app.admin_overview()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'users', (SELECT count(*) FROM users),
    'activeUsers7d', (SELECT count(*) FROM users WHERE last_login_at > now() - interval '7 days'),
    'newUsers7d', (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days'),
    'suspendedUsers', (SELECT count(*) FROM users WHERE suspended_at IS NOT NULL),
    'workspaces', (SELECT count(*) FROM workspaces),
    'teamWorkspaces', (SELECT count(*) FROM workspaces WHERE NOT is_personal),
    'documents', (SELECT count(*) FROM documents),
    'costTodayNanoUsd', (SELECT coalesce(sum(cost_nano_usd), 0) FROM usage_events WHERE created_at >= date_trunc('day', now())),
    'cost30dNanoUsd', (SELECT coalesce(sum(cost_nano_usd), 0) FROM usage_events WHERE created_at > now() - interval '30 days'),
    'calls30d', (SELECT count(*) FROM usage_events WHERE created_at > now() - interval '30 days')
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.admin_usage_by_day(since timestamptz)
RETURNS TABLE (day date, model_id text, calls bigint, input_tokens bigint, output_tokens bigint, cost_nano_usd bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (u.created_at AT TIME ZONE 'UTC')::date, u.model_id, count(*),
    sum(u.input_tokens)::bigint, sum(u.output_tokens)::bigint, sum(u.cost_nano_usd)::bigint
  FROM usage_events u
  WHERE u.created_at >= since
  GROUP BY 1, 2
  ORDER BY 1, 2
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.admin_top_workspaces(since timestamptz, max_rows integer)
RETURNS TABLE (workspace_id uuid, name text, calls bigint, cost_nano_usd bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT w.id, w.name, count(*), sum(u.cost_nano_usd)::bigint
  FROM usage_events u JOIN workspaces w ON w.id = u.workspace_id
  WHERE u.created_at >= since
  GROUP BY w.id, w.name
  ORDER BY 4 DESC
  LIMIT max_rows
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.admin_top_users(since timestamptz, max_rows integer)
RETURNS TABLE (user_id uuid, name text, email text, calls bigint, cost_nano_usd bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT us.id, us.name, us.email, count(*), sum(u.cost_nano_usd)::bigint
  FROM usage_events u JOIN users us ON us.id = u.user_id
  WHERE u.created_at >= since
  GROUP BY us.id, us.name, us.email
  ORDER BY 5 DESC
  LIMIT max_rows
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.admin_user_workspaces(target uuid)
RETURNS TABLE (workspace_id uuid, name text, role workspace_role, is_personal boolean, member_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT w.id, w.name, m.role, w.is_personal,
    (SELECT count(*) FROM workspace_members x WHERE x.workspace_id = w.id)
  FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.user_id = target
  ORDER BY w.is_personal DESC, w.created_at
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.admin_user_cost(target uuid, since timestamptz)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(cost_nano_usd), 0)::bigint FROM usage_events
  WHERE user_id = target AND created_at >= since
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_overview(), app.admin_usage_by_day(timestamptz),
  app.admin_top_workspaces(timestamptz, integer), app.admin_top_users(timestamptz, integer),
  app.admin_user_workspaces(uuid), app.admin_user_cost(uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_overview(), app.admin_usage_by_day(timestamptz),
  app.admin_top_workspaces(timestamptz, integer), app.admin_top_users(timestamptz, integer),
  app.admin_user_workspaces(uuid), app.admin_user_cost(uuid, timestamptz) TO tessel_app;
