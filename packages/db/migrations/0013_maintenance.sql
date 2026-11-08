-- Housekeeping, run daily by the worker. Each step runs as the table owner,
-- so it isn't limited by row-level security, and the function is the only
-- way the app role can do these deletes.
CREATE OR REPLACE FUNCTION app.run_maintenance()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  refresh_deleted integer;
  tokens_deleted integer;
  runs_expired integer;
  runs_deleted integer;
  states_cleared integer;
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

  RETURN jsonb_build_object(
    'refreshTokensDeleted', refresh_deleted,
    'accessTokensDeleted', tokens_deleted,
    'waitingRunsExpired', runs_expired,
    'agentRunsDeleted', runs_deleted,
    'oauthStatesCleared', states_cleared
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.run_maintenance() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.run_maintenance() TO tessel_app;
