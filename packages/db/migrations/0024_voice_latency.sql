-- Voice latency for the admin app, across everyone's conversations. Row-level
-- security keeps voice timings private to each user, so admins read these
-- aggregates through security-definer functions (the API checks the admin role).
CREATE OR REPLACE FUNCTION app.admin_voice_by_day(since timestamptz)
RETURNS TABLE (day date, turns bigint, sessions bigint, p50_ms integer, p95_ms integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (t.created_at AT TIME ZONE 'UTC')::date, count(*), count(DISTINCT t.session_id),
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY t.total_ms))::integer,
    round(percentile_cont(0.95) WITHIN GROUP (ORDER BY t.total_ms))::integer
  FROM voice_turns t
  WHERE t.created_at >= since
  GROUP BY 1
  ORDER BY 1
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.admin_voice_summary(since timestamptz, target_ms integer)
RETURNS TABLE (
  sessions bigint, turns bigint, user_audio_ms bigint,
  p50_ms integer, p95_ms integer, within_target bigint, preemptive bigint, interrupted bigint,
  end_of_turn_p50_ms integer, model_first_token_p50_ms integer, first_audio_p50_ms integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    (SELECT count(*) FROM voice_sessions s WHERE s.created_at >= since),
    count(*),
    (SELECT coalesce(sum(s.user_audio_ms), 0)::bigint FROM voice_sessions s WHERE s.created_at >= since),
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY t.total_ms))::integer,
    round(percentile_cont(0.95) WITHIN GROUP (ORDER BY t.total_ms))::integer,
    count(*) FILTER (WHERE t.total_ms <= target_ms),
    count(*) FILTER (WHERE t.preemptive),
    count(*) FILTER (WHERE t.interrupted),
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY t.end_of_turn_ms))::integer,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY t.model_first_token_ms))::integer,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY t.first_audio_ms))::integer
  FROM voice_turns t
  WHERE t.created_at >= since
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_voice_by_day(timestamptz),
  app.admin_voice_summary(timestamptz, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_voice_by_day(timestamptz),
  app.admin_voice_summary(timestamptz, integer) TO tessel_app;
