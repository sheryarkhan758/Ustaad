CREATE TABLE `ai_call_log` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`component` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_micros` integer DEFAULT 0 NOT NULL,
	`cache_hit` integer DEFAULT 0 NOT NULL,
	`failed_over` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_call_log_day` ON `ai_call_log` (`day`,`cache_hit`);--> statement-breakpoint
CREATE INDEX `idx_ai_call_log_component` ON `ai_call_log` (`component`,`day`);