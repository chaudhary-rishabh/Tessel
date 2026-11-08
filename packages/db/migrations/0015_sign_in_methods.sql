CREATE TYPE "public"."identity_provider" AS ENUM('google', 'github');--> statement-breakpoint
CREATE TYPE "public"."phone_challenge_purpose" AS ENUM('verify', 'login');--> statement-breakpoint
CREATE TABLE "login_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ticket_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_tickets_ticket_hash_unique" UNIQUE("ticket_hash")
);
--> statement-breakpoint
CREATE TABLE "phone_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" "phone_challenge_purpose" NOT NULL,
	"phone" text NOT NULL,
	"user_id" uuid,
	"code_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_provider_account_unique" UNIQUE("provider","provider_user_id"),
	CONSTRAINT "user_identities_user_provider_unique" UNIQUE("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "login_tickets" ADD CONSTRAINT "login_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_challenges" ADD CONSTRAINT "phone_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phone_challenges_phone_idx" ON "phone_challenges" USING btree ("phone");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_unique" UNIQUE("phone");--> statement-breakpoint
-- Maintenance also clears used or expired sign-in tickets and phone codes.
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

  RETURN jsonb_build_object(
    'refreshTokensDeleted', refresh_deleted,
    'accessTokensDeleted', tokens_deleted,
    'waitingRunsExpired', runs_expired,
    'agentRunsDeleted', runs_deleted,
    'oauthStatesCleared', states_cleared,
    'signupsDeleted', signups_deleted,
    'passwordResetsDeleted', resets_deleted,
    'loginTicketsDeleted', tickets_deleted,
    'phoneCodesDeleted', phone_codes_deleted
  );
END;
$$;
