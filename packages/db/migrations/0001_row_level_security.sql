-- Row-level security for tenant data.
--
-- The API connects as `tessel_app`, a role that neither owns the tables nor
-- bypasses RLS, so these policies always apply to it. Each request runs in a
-- transaction that sets `app.user_id` (see withUserContext in @tessel/db).
-- Without that setting, tenant tables return nothing.
--
-- `users` and `refresh_tokens` are not tenant-scoped: auth must read them
-- before a user context exists. Access to them is enforced in application code.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tessel_app') THEN
    -- Login and password are configured outside migrations (pnpm db:migrate
    -- sets them from DATABASE_URL), so no secret lives in this file.
    CREATE ROLE tessel_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO tessel_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tessel_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tessel_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tessel_app;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO tessel_app;
--> statement-breakpoint

-- The user the current transaction acts for, or NULL when unset.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint

-- Membership helpers run as the table owner (SECURITY DEFINER) so policies can
-- read workspace_members without recursing into its own policies.
CREATE OR REPLACE FUNCTION app.workspace_role(target_workspace uuid) RETURNS public.workspace_role
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.workspace_members
  WHERE workspace_id = target_workspace AND user_id = app.current_user_id()
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.is_workspace_owner(target_workspace uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = target_workspace AND owner_id = app.current_user_id()
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.workspace_role(uuid), app.is_workspace_owner(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.workspace_role(uuid), app.is_workspace_owner(uuid) TO tessel_app;
--> statement-breakpoint

-- Workspaces: members can read; owners and admins can rename; only the owner
-- can delete. The owner can always read the row, so INSERT ... RETURNING works
-- before the owner's membership row exists.
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspaces_select ON workspaces FOR SELECT TO tessel_app
  USING (owner_id = app.current_user_id() OR app.workspace_role(id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY workspaces_insert ON workspaces FOR INSERT TO tessel_app
  WITH CHECK (owner_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY workspaces_update ON workspaces FOR UPDATE TO tessel_app
  USING (app.workspace_role(id) IN ('owner', 'admin'))
  WITH CHECK (app.workspace_role(id) IN ('owner', 'admin'));
--> statement-breakpoint
CREATE POLICY workspaces_delete ON workspaces FOR DELETE TO tessel_app
  USING (owner_id = app.current_user_id());
--> statement-breakpoint

-- Members: members see the member list. The workspace owner can add
-- themselves as owner once; owners manage everyone else; admins manage
-- members but can never create, change, or remove an owner.
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_members_select ON workspace_members FOR SELECT TO tessel_app
  USING (app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY workspace_members_insert ON workspace_members FOR INSERT TO tessel_app
  WITH CHECK (
    (user_id = app.current_user_id() AND role = 'owner' AND app.is_workspace_owner(workspace_id))
    OR app.workspace_role(workspace_id) = 'owner'
    OR (app.workspace_role(workspace_id) = 'admin' AND role <> 'owner')
  );
--> statement-breakpoint
CREATE POLICY workspace_members_update ON workspace_members FOR UPDATE TO tessel_app
  USING (
    app.workspace_role(workspace_id) = 'owner'
    OR (app.workspace_role(workspace_id) = 'admin' AND role <> 'owner')
  )
  WITH CHECK (
    app.workspace_role(workspace_id) = 'owner'
    OR (app.workspace_role(workspace_id) = 'admin' AND role <> 'owner')
  );
--> statement-breakpoint
CREATE POLICY workspace_members_delete ON workspace_members FOR DELETE TO tessel_app
  USING (
    role <> 'owner'
    AND (
      user_id = app.current_user_id()
      OR app.workspace_role(workspace_id) = 'owner'
      OR (app.workspace_role(workspace_id) = 'admin' AND role = 'member')
    )
  );
