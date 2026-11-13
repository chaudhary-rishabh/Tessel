CREATE TYPE "public"."billing_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TABLE "usage_alerts" (
	"workspace_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_alerts_workspace_id_subject_period_start_pk" PRIMARY KEY("workspace_id","subject","period_start")
);
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "interval" "billing_interval" DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "extra_charged_through" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "tax_name" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "tax_id" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "tax_state" text;--> statement-breakpoint
ALTER TABLE "usage_alerts" ADD CONSTRAINT "usage_alerts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;