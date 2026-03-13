ALTER TABLE "baseline_images" ADD COLUMN "preview_url" text;--> statement-breakpoint
ALTER TABLE "baseline_images" ADD COLUMN "verification_image_url" text;--> statement-breakpoint
ALTER TABLE "baseline_images" ADD COLUMN "metadata" jsonb;