-- Fixes from the codebase review.
-- Extra usage is matched to the ledger by request ID; also require the same
-- workspace, so a request ID can never move cost between workspaces.
CREATE OR REPLACE FUNCTION app.workspace_extra_cost(target uuid, since timestamptz)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(u.cost_nano_usd), 0)::bigint
  FROM usage_events u
  JOIN extra_usage_requests e ON e.request_id = u.request_id AND e.workspace_id = u.workspace_id
  WHERE e.workspace_id = target AND e.created_at >= since AND u.created_at >= since
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.workspace_extra_cost_between(target uuid, since timestamptz, until timestamptz)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(u.cost_nano_usd), 0)::bigint
  FROM usage_events u
  JOIN extra_usage_requests e ON e.request_id = u.request_id AND e.workspace_id = u.workspace_id
  WHERE e.workspace_id = target
    AND e.created_at >= since AND e.created_at < until
    AND u.created_at >= since AND u.created_at < until
$$;
--> statement-breakpoint
-- When someone leaves or is removed from a workspace, their access tokens and
-- connected apps for it are revoked, so rejoining later doesn't bring them back.
-- Runs as the table owner because an admin can't see another member's tokens;
-- it only acts once the person is no longer a member.
CREATE OR REPLACE FUNCTION app.revoke_member_access(target_workspace uuid, target_user uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE personal_access_tokens SET revoked_at = now()
  WHERE workspace_id = target_workspace AND user_id = target_user AND revoked_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.workspace_id = target_workspace AND m.user_id = target_user
    );
  UPDATE oauth_grants SET revoked_at = now()
  WHERE workspace_id = target_workspace AND user_id = target_user AND revoked_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.workspace_id = target_workspace AND m.user_id = target_user
    );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.revoke_member_access(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.revoke_member_access(uuid, uuid) TO tessel_app;
--> statement-breakpoint
-- One spelling across the app: agent runs and tool calls already say "cancelled".
ALTER TYPE "public"."billing_status" RENAME VALUE 'canceled' TO 'cancelled';
