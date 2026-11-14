CREATE TABLE "workspace_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_memories" ADD CONSTRAINT "workspace_memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memories" ADD CONSTRAINT "workspace_memories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memories" ADD CONSTRAINT "workspace_memories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_memories_workspace_idx" ON "workspace_memories" USING btree ("workspace_id","updated_at");--> statement-breakpoint
-- Everyone in the workspace reads team memory and can add to it; the author,
-- owners, and admins change or delete it.
ALTER TABLE workspace_memories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_memories_read ON workspace_memories FOR SELECT TO tessel_app
  USING (app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY workspace_memories_add ON workspace_memories FOR INSERT TO tessel_app
  WITH CHECK (app.workspace_role(workspace_id) IS NOT NULL AND created_by = app.current_user_id());
--> statement-breakpoint
CREATE POLICY workspace_memories_change ON workspace_memories FOR UPDATE TO tessel_app
  USING (
    app.workspace_role(workspace_id) IN ('owner', 'admin')
    OR (app.workspace_role(workspace_id) IS NOT NULL AND created_by = app.current_user_id())
  )
  WITH CHECK (app.workspace_role(workspace_id) IS NOT NULL AND updated_by = app.current_user_id());
--> statement-breakpoint
CREATE POLICY workspace_memories_remove ON workspace_memories FOR DELETE TO tessel_app
  USING (
    app.workspace_role(workspace_id) IN ('owner', 'admin')
    OR (app.workspace_role(workspace_id) IS NOT NULL AND created_by = app.current_user_id())
  );
