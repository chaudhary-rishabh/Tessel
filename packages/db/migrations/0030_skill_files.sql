CREATE TABLE "skill_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_files" ADD CONSTRAINT "skill_files_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_files" ADD CONSTRAINT "skill_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_files_skill_path_idx" ON "skill_files" USING btree ("skill_id","path");--> statement-breakpoint

-- Members read a skill's files; whoever can change the skill can change its files.
ALTER TABLE skill_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY skill_files_select ON skill_files FOR SELECT TO tessel_app
  USING (app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY skill_files_write ON skill_files FOR ALL TO tessel_app
  USING (
    app.workspace_role(workspace_id) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM skills s
      WHERE s.id = skill_id
        AND (s.user_id = app.current_user_id() OR app.workspace_role(s.workspace_id) IN ('owner', 'admin'))
    )
  )
  WITH CHECK (
    app.workspace_role(workspace_id) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM skills s
      WHERE s.id = skill_id AND s.workspace_id = skill_files.workspace_id
        AND (s.user_id = app.current_user_id() OR app.workspace_role(s.workspace_id) IN ('owner', 'admin'))
    )
  );
