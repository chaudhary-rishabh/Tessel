CREATE TYPE "public"."oauth_authorization_status" AS ENUM('pending', 'approved', 'denied', 'used');--> statement-breakpoint
CREATE TABLE "oauth_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"state" text,
	"scopes" text[] NOT NULL,
	"resource" text,
	"status" "oauth_authorization_status" DEFAULT 'pending' NOT NULL,
	"user_id" uuid,
	"workspace_id" uuid,
	"code_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_authorizations_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sealed_info" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"previous_refresh_token_hash" text,
	"metadata" jsonb,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_grants_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD COLUMN "grant_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_authorizations" ADD CONSTRAINT "oauth_authorizations_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorizations" ADD CONSTRAINT "oauth_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorizations" ADD CONSTRAINT "oauth_authorizations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_grants_user_idx" ON "oauth_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_previous_refresh_idx" ON "oauth_grants" USING btree ("previous_refresh_token_hash");--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Maintenance also clears finished MCP client sign-ins, their old hour-long
-- tokens, and grants a month after they were revoked.
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
    'oauthGrantsDeleted', grants_deleted
  );
END;
$$;
