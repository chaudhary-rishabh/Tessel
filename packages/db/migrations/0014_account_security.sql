CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signup_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"code_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_pending_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recovery_codes_user_idx" ON "recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signup_challenges_email_idx" ON "signup_challenges" USING btree ("email");--> statement-breakpoint
-- Accounts made before email verification existed count as verified.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;--> statement-breakpoint
-- Maintenance now also clears finished signups and password resets.
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

  RETURN jsonb_build_object(
    'refreshTokensDeleted', refresh_deleted,
    'accessTokensDeleted', tokens_deleted,
    'waitingRunsExpired', runs_expired,
    'agentRunsDeleted', runs_deleted,
    'oauthStatesCleared', states_cleared,
    'signupsDeleted', signups_deleted,
    'passwordResetsDeleted', resets_deleted
  );
END;
$$;
