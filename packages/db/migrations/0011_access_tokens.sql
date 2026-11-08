CREATE TABLE "personal_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_access_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_access_tokens_owner_idx" ON "personal_access_tokens" USING btree ("user_id","workspace_id");--> statement-breakpoint

-- Tokens are private to the user who made them.
ALTER TABLE personal_access_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY personal_access_tokens_owner ON personal_access_tokens FOR ALL TO tessel_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint

-- Requests with a token arrive before we know the user. This resolves a
-- token hash to its owner, only while the token is live and the owner is
-- still in the workspace.
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
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.resolve_access_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_access_token(text) TO tessel_app;
