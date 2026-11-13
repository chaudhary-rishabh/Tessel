CREATE TABLE "user_voices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'elevenlabs' NOT NULL,
	"provider_voice_id" text NOT NULL,
	"name" text NOT NULL,
	"consent_phrase" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "voice_preference" text;--> statement-breakpoint
ALTER TABLE "user_voices" ADD CONSTRAINT "user_voices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_voices_user_idx" ON "user_voices" USING btree ("user_id");--> statement-breakpoint

-- Each user sees and changes only their own voices.
ALTER TABLE user_voices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_voices_owner ON user_voices FOR ALL TO tessel_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
