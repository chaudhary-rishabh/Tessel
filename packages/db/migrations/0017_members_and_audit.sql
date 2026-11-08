CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"workspace_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "login_tickets" ADD COLUMN "provider" "identity_provider";--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_workspace_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "workspace_invitations_workspace_idx" ON "workspace_invitations" USING btree ("workspace_id");--> statement-breakpoint
-- Invitations: a workspace's owners and admins manage them. Nobody can invite an owner.
ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_invitations_select ON workspace_invitations FOR SELECT TO tessel_app
  USING (app.workspace_role(workspace_id) IN ('owner', 'admin'));
--> statement-breakpoint
CREATE POLICY workspace_invitations_insert ON workspace_invitations FOR INSERT TO tessel_app
  WITH CHECK (app.workspace_role(workspace_id) IN ('owner', 'admin') AND role <> 'owner');
--> statement-breakpoint
CREATE POLICY workspace_invitations_update ON workspace_invitations FOR UPDATE TO tessel_app
  USING (app.workspace_role(workspace_id) IN ('owner', 'admin'))
  WITH CHECK (app.workspace_role(workspace_id) IN ('owner', 'admin') AND role <> 'owner');
--> statement-breakpoint
-- What an invitation link shows before it's accepted. Anyone with the link may see it.
CREATE OR REPLACE FUNCTION app.invitation_preview(hash text)
RETURNS TABLE (workspace_name text, inviter_name text, invited_email text, invited_role workspace_role, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT w.name, u.name, i.email, i.role, i.expires_at
  FROM workspace_invitations i
  JOIN workspaces w ON w.id = i.workspace_id
  LEFT JOIN users u ON u.id = i.invited_by
  WHERE i.token_hash = hash
    AND i.accepted_at IS NULL
    AND i.revoked_at IS NULL
    AND i.expires_at > now()
$$;
--> statement-breakpoint
-- Joins the current user to the invitation's workspace, if the invitation is
-- still open and was sent to their verified email. Returns nothing otherwise.
CREATE OR REPLACE FUNCTION app.accept_invitation(hash text)
RETURNS TABLE (joined_workspace_id uuid, joined_role workspace_role)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  invitation workspace_invitations%ROWTYPE;
  invitee_email text;
BEGIN
  SELECT * INTO invitation FROM workspace_invitations i
  WHERE i.token_hash = hash
    AND i.accepted_at IS NULL
    AND i.revoked_at IS NULL
    AND i.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT u.email INTO invitee_email FROM users u
  WHERE u.id = app.current_user_id() AND u.email_verified_at IS NOT NULL;
  IF invitee_email IS NULL OR invitee_email <> invitation.email THEN
    RETURN;
  END IF;
  INSERT INTO workspace_members AS m (workspace_id, user_id, role)
  VALUES (invitation.workspace_id, app.current_user_id(), invitation.role)
  ON CONFLICT ON CONSTRAINT workspace_members_workspace_id_user_id_pk DO NOTHING;
  UPDATE workspace_invitations SET accepted_at = now() WHERE id = invitation.id;
  joined_workspace_id := invitation.workspace_id;
  joined_role := invitation.role;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.invitation_preview(text), app.accept_invitation(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.invitation_preview(text), app.accept_invitation(text) TO tessel_app;
--> statement-breakpoint
-- Maintenance also clears invitations a month after they ended, and audit
-- events after a year.
CREATE OR REPLACE FUNCTION app.run_maintenance()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  refresh_deleted integer;
  tokens_deleted integer;
  runs_expired integer;
  runs_deleted integer;
  states_cleared integer;
  signups_deleted integer;
  resets_deleted integer;
  tickets_deleted integer;
  phone_codes_deleted integer;
  authorizations_deleted integer;
  oauth_tokens_deleted integer;
  grants_deleted integer;
  invitations_deleted integer;
  audit_deleted integer;
BEGIN
  -- Refresh tokens a day past expiry, or a week after they were revoked
  -- (kept that long so reuse of a stolen token is still detected).
  DELETE FROM refresh_tokens
  WHERE expires_at < now() - interval '1 day' OR revoked_at < now() - interval '7 days';
  GET DIAGNOSTICS refresh_deleted = ROW_COUNT;

  -- Personal access tokens a month after they expired or were revoked.
  DELETE FROM personal_access_tokens
  WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days';
  GET DIAGNOSTICS tokens_deleted = ROW_COUNT;

  -- Approvals nobody answered for a week: cancel the run and close the reply.
  WITH expired AS (
    UPDATE agent_runs SET status = 'cancelled', updated_at = now()
    WHERE status = 'waiting' AND updated_at < now() - interval '7 days'
    RETURNING message_id
  )
  UPDATE messages m SET
    status = 'complete',
    tool_calls = (
      SELECT COALESCE(
        jsonb_agg(
          CASE WHEN call->>'status' = 'waiting'
            THEN jsonb_set(call, '{status}', '"cancelled"')
            ELSE call END
          ORDER BY position
        ),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(m.tool_calls) WITH ORDINALITY AS t(call, position)
    )
  FROM expired
  WHERE m.id = expired.message_id;
  GET DIAGNOSTICS runs_expired = ROW_COUNT;

  -- Finished runs' checkpoints aren't needed after a month.
  DELETE FROM agent_runs
  WHERE status IN ('completed', 'cancelled') AND updated_at < now() - interval '30 days';
  GET DIAGNOSTICS runs_deleted = ROW_COUNT;

  -- Abandoned connector sign-ins.
  UPDATE connector_connections SET oauth_state_hash = NULL, oauth_state_expires_at = NULL
  WHERE oauth_state_expires_at < now();
  GET DIAGNOSTICS states_cleared = ROW_COUNT;

  -- Signup codes and reset links that have expired.
  DELETE FROM signup_challenges WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS signups_deleted = ROW_COUNT;
  DELETE FROM password_resets WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS resets_deleted = ROW_COUNT;
  DELETE FROM login_tickets WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS tickets_deleted = ROW_COUNT;
  DELETE FROM phone_challenges WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS phone_codes_deleted = ROW_COUNT;
  DELETE FROM oauth_authorizations WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS authorizations_deleted = ROW_COUNT;
  DELETE FROM personal_access_tokens
  WHERE grant_id IS NOT NULL AND expires_at < now() - interval '1 day';
  GET DIAGNOSTICS oauth_tokens_deleted = ROW_COUNT;
  DELETE FROM oauth_grants WHERE revoked_at < now() - interval '30 days';
  GET DIAGNOSTICS grants_deleted = ROW_COUNT;
  DELETE FROM workspace_invitations
  WHERE expires_at < now() - interval '30 days'
     OR accepted_at < now() - interval '30 days'
     OR revoked_at < now() - interval '30 days';
  GET DIAGNOSTICS invitations_deleted = ROW_COUNT;
  DELETE FROM audit_events WHERE created_at < now() - interval '365 days';
  GET DIAGNOSTICS audit_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'refreshTokensDeleted', refresh_deleted,
    'accessTokensDeleted', tokens_deleted,
    'waitingRunsExpired', runs_expired,
    'agentRunsDeleted', runs_deleted,
    'oauthStatesCleared', states_cleared,
    'signupsDeleted', signups_deleted,
    'passwordResetsDeleted', resets_deleted,
    'loginTicketsDeleted', tickets_deleted,
    'phoneCodesDeleted', phone_codes_deleted,
    'oauthAuthorizationsDeleted', authorizations_deleted,
    'oauthAccessTokensDeleted', oauth_tokens_deleted,
    'oauthGrantsDeleted', grants_deleted,
    'invitationsDeleted', invitations_deleted,
    'auditEventsDeleted', audit_deleted
  );
END;
$$;
