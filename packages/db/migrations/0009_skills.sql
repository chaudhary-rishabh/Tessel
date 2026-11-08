CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"instructions" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skills_workspace_name_idx" ON "skills" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "skills_workspace_created_idx" ON "skills" USING btree ("workspace_id","created_at");--> statement-breakpoint

-- Skills are shared with the whole workspace: every member can read them
-- and write their own. The author, owners, and admins can change or delete one.
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY skills_select ON skills FOR SELECT TO tessel_app
  USING (app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY skills_insert ON skills FOR INSERT TO tessel_app
  WITH CHECK (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY skills_update ON skills FOR UPDATE TO tessel_app
  USING (
    app.workspace_role(workspace_id) IS NOT NULL
    AND (user_id = app.current_user_id() OR app.workspace_role(workspace_id) IN ('owner', 'admin'))
  )
  WITH CHECK (app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY skills_delete ON skills FOR DELETE TO tessel_app
  USING (
    app.workspace_role(workspace_id) IS NOT NULL
    AND (user_id = app.current_user_id() OR app.workspace_role(workspace_id) IN ('owner', 'admin'))
  );
