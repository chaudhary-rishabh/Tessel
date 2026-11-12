CREATE TABLE "email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verifications_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_verifications_user_idx" ON "email_verifications" USING btree ("user_id");--> statement-breakpoint
-- Signup no longer proves the email first (D-100), so anyone can create an
-- account with an address they don't own. When the real owner proves the
-- address (Google or GitHub with that email, or a password reset link), every
-- way into the account set up before then is removed: the password, two-step
-- sign-in, the phone number, linked sign-ins, sessions, access tokens, and
-- connected apps. Only accounts whose email isn't confirmed yet are touched.
-- Personal access tokens and OAuth grants sit behind row-level security, so
-- this runs as the owner.
CREATE OR REPLACE FUNCTION app.reset_unverified_account(target_user uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = target_user AND email_verified_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE users SET
    password_hash = NULL,
    totp_secret = NULL,
    totp_pending_secret = NULL,
    totp_enabled_at = NULL,
    totp_last_step = NULL,
    phone = NULL,
    phone_verified_at = NULL
  WHERE id = target_user;
  DELETE FROM recovery_codes WHERE user_id = target_user;
  DELETE FROM user_identities WHERE user_id = target_user;
  DELETE FROM login_tickets WHERE user_id = target_user;
  DELETE FROM oauth_authorizations WHERE user_id = target_user;
  UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = target_user AND revoked_at IS NULL;
  UPDATE personal_access_tokens SET revoked_at = now()
  WHERE user_id = target_user AND revoked_at IS NULL;
  UPDATE oauth_grants SET revoked_at = now() WHERE user_id = target_user AND revoked_at IS NULL;
  RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.reset_unverified_account(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.reset_unverified_account(uuid) TO tessel_app;
