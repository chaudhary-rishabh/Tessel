CREATE TYPE "public"."document_status" AS ENUM('uploading', 'queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"status" "document_status" DEFAULT 'uploading' NOT NULL,
	"error_code" text,
	"page_count" integer,
	"chunk_count" integer,
	"character_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
-- Attachments move from Postgres to S3. They were stored in the database
-- only before any production deployment, so existing rows are dropped
-- rather than copied.
DELETE FROM "attachments";--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "storage_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_workspace_created_idx" ON "documents" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint

-- Documents are the workspace's shared knowledge: every member can read
-- them and upload their own. The uploader, owners, and admins can change or
-- delete a document.
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY documents_select ON documents FOR SELECT TO tessel_app
  USING (app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY documents_insert ON documents FOR INSERT TO tessel_app
  WITH CHECK (user_id = app.current_user_id() AND app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY documents_update ON documents FOR UPDATE TO tessel_app
  USING (
    app.workspace_role(workspace_id) IS NOT NULL
    AND (user_id = app.current_user_id() OR app.workspace_role(workspace_id) IN ('owner', 'admin'))
  )
  WITH CHECK (app.workspace_role(workspace_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY documents_delete ON documents FOR DELETE TO tessel_app
  USING (
    app.workspace_role(workspace_id) IS NOT NULL
    AND (user_id = app.current_user_id() OR app.workspace_role(workspace_id) IN ('owner', 'admin'))
  );
--> statement-breakpoint

-- The worker learns about uploads from S3 events, which carry only the
-- object key. This tells it whose upload it is, so it can act as that user.
CREATE OR REPLACE FUNCTION app.document_uploader(target_document uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT user_id FROM public.documents WHERE id = target_document
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.document_uploader(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.document_uploader(uuid) TO tessel_app;
