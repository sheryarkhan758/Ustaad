ALTER TABLE `review_analyses` ADD `safety_concern_reason` text;--> statement-breakpoint
ALTER TABLE `review_analyses` ADD `generic_flag` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `review_analyses` ADD `contradiction_flag` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `review_analyses` ADD `detail_level` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `review_analyses` ADD `completed_sessions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_review_analyses_flags` ON `review_analyses` (`contradiction_flag`,`generic_flag`);--> statement-breakpoint
ALTER TABLE `reviews` ADD `analysis_status` text DEFAULT 'pending' NOT NULL;