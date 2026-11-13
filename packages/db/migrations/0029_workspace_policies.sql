CREATE TABLE "workspace_policies" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"tool_policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blocked_connectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disabled_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_connections" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_policies" ADD CONSTRAINT "workspace_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_policies" ADD CONSTRAINT "workspace_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Members read their workspace's policies; owners and admins set them.
ALTER TABLE workspace_policies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_policies_select ON workspace_policies FOR SELECT TO tessel_app
  USING (app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY workspace_policies_write ON workspace_policies FOR ALL TO tessel_app
  USING (app.workspace_role(workspace_id) IN ('owner', 'admin'))
  WITH CHECK (app.workspace_role(workspace_id) IN ('owner', 'admin'));
--> statement-breakpoint

-- Everyone in the workspace can use a shared connector; only its creator changes it.
CREATE POLICY connector_connections_shared_select ON connector_connections FOR SELECT TO tessel_app
  USING (shared AND app.workspace_role(workspace_id) IS NOT NULL);
