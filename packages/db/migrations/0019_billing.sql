CREATE TYPE "public"."billing_plan" AS ENUM('free', 'pro', 'max', 'team');--> statement-breakpoint
CREATE TYPE "public"."billing_provider" AS ENUM('stripe', 'razorpay');--> statement-breakpoint
CREATE TYPE "public"."billing_status" AS ENUM('active', 'past_due', 'canceled', 'incomplete');--> statement-breakpoint
CREATE TYPE "public"."usage_window_kind" AS ENUM('session', 'week');--> statement-breakpoint
CREATE TABLE "billing_accounts" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"plan" "billing_plan" DEFAULT 'free' NOT NULL,
	"status" "billing_status" DEFAULT 'active' NOT NULL,
	"provider" "billing_provider",
	"customer_id" text,
	"subscription_id" text,
	"seats" integer DEFAULT 1 NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"extra_usage_enabled" boolean DEFAULT false NOT NULL,
	"extra_usage_cap_nano_usd" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_subscription_id_unique" UNIQUE("subscription_id")
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extra_usage_requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_windows" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "usage_window_kind" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"resets_at" timestamp with time zone NOT NULL,
	CONSTRAINT "usage_windows_workspace_id_user_id_kind_pk" PRIMARY KEY("workspace_id","user_id","kind")
);
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_usage_requests" ADD CONSTRAINT "extra_usage_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_usage_requests" ADD CONSTRAINT "extra_usage_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_windows" ADD CONSTRAINT "usage_windows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_windows" ADD CONSTRAINT "usage_windows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extra_usage_requests_workspace_idx" ON "extra_usage_requests" USING btree ("workspace_id","created_at");--> statement-breakpoint
-- What a workspace has spent on extra usage since a time: the ledger cost of
-- every request made past a plan limit. Members can't read each other's
-- ledger rows, so this runs as the table owner.
CREATE OR REPLACE FUNCTION app.workspace_extra_cost(target uuid, since timestamptz)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(u.cost_nano_usd), 0)::bigint
  FROM usage_events u
  JOIN extra_usage_requests e ON e.request_id = u.request_id
  WHERE e.workspace_id = target AND e.created_at >= since AND u.created_at >= since
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.workspace_extra_cost(uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.workspace_extra_cost(uuid, timestamptz) TO tessel_app;
--> statement-breakpoint
-- The same, for one closed billing period.
CREATE OR REPLACE FUNCTION app.workspace_extra_cost_between(target uuid, since timestamptz, until timestamptz)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(u.cost_nano_usd), 0)::bigint
  FROM usage_events u
  JOIN extra_usage_requests e ON e.request_id = u.request_id
  WHERE e.workspace_id = target
    AND e.created_at >= since AND e.created_at < until
    AND u.created_at >= since AND u.created_at < until
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.workspace_extra_cost_between(uuid, timestamptz, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.workspace_extra_cost_between(uuid, timestamptz, timestamptz) TO tessel_app;
--> statement-breakpoint
-- Team plans pay per member; seat updates run from webhooks and membership
-- changes without a user context.
CREATE OR REPLACE FUNCTION app.workspace_member_count(target uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::integer FROM workspace_members WHERE workspace_id = target
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.workspace_member_count(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.workspace_member_count(uuid) TO tessel_app;
