ALTER TABLE "messages" ADD COLUMN "activity" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "agent_mode" text;