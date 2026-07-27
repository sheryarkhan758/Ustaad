CREATE TABLE `tutor_search_signals` (
	`tutor_id` text PRIMARY KEY NOT NULL,
	`overall_score` real DEFAULT 0 NOT NULL,
	`best_topic_score` real DEFAULT 0 NOT NULL,
	`artefacts_checked_count` integer DEFAULT 0 NOT NULL,
	`verified_topic_count` integer DEFAULT 0 NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`weighted_review_count` real DEFAULT 0 NOT NULL,
	`last_active_at` text,
	`recency_score` real DEFAULT 0 NOT NULL,
	`min_normalised_hourly` integer,
	`computed_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_search_signals_overall` ON `tutor_search_signals` (`overall_score`);--> statement-breakpoint
CREATE INDEX `idx_search_signals_price` ON `tutor_search_signals` (`min_normalised_hourly`);--> statement-breakpoint
ALTER TABLE `rate_benchmarks` ADD `p25_hourly` integer;--> statement-breakpoint
ALTER TABLE `rate_benchmarks` ADD `p75_hourly` integer;--> statement-breakpoint
ALTER TABLE `rate_benchmarks` ADD `published` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tutor_reliability` ADD `on_time_rate` real;--> statement-breakpoint
ALTER TABLE `tutor_reliability` ADD `completion_rate` real;--> statement-breakpoint
ALTER TABLE `tutor_scores` ADD `competency_verified` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tutor_scores` ADD `expires_on` text;--> statement-breakpoint
CREATE INDEX `idx_tutor_scores_topic_verified` ON `tutor_scores` (`topic_id`,`competency_verified`,`composite_score`);