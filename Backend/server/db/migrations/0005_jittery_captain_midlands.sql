CREATE TABLE `cnic_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`cnic_hash` text NOT NULL,
	`salt_version` text DEFAULT 'v1' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cnic_registrations_hash` ON `cnic_registrations` (`cnic_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cnic_registrations_tutor` ON `cnic_registrations` (`tutor_id`);--> statement-breakpoint
CREATE TABLE `notification_dedupe` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`sent_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_notification_dedupe_key` ON `notification_dedupe` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`link_path` text,
	`read_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_kind` ON `notifications` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `verification_appeals` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`track` text NOT NULL,
	`against_record_id` text NOT NULL,
	`claim_id` text,
	`tutor_reason` text NOT NULL,
	`eligible_from` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`decided_by` text,
	`decision_reason` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`against_record_id`) REFERENCES `verification_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claim_id`) REFERENCES `tutor_subject_claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_appeals_queue` ON `verification_appeals` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_appeals_against_record` ON `verification_appeals` (`against_record_id`);--> statement-breakpoint
CREATE INDEX `idx_appeals_tutor` ON `verification_appeals` (`tutor_id`,`status`);--> statement-breakpoint
CREATE TABLE `verification_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`track` text NOT NULL,
	`decision` text NOT NULL,
	`artefacts_checked_json` text NOT NULL,
	`decided_by` text NOT NULL,
	`decided_at` text NOT NULL,
	`reason` text NOT NULL,
	`expires_on` text,
	`claim_id` text,
	`supersedes_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claim_id`) REFERENCES `tutor_subject_claims`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_verification_records_tutor` ON `verification_records` (`tutor_id`,`track`,`decided_at`);--> statement-breakpoint
CREATE INDEX `idx_verification_records_expiry` ON `verification_records` (`track`,`decision`,`expires_on`);--> statement-breakpoint
CREATE INDEX `idx_verification_records_admin` ON `verification_records` (`decided_by`,`decided_at`);--> statement-breakpoint
ALTER TABLE `tutor_subject_claims` ADD `verified_at` text;--> statement-breakpoint
ALTER TABLE `tutor_subject_claims` ADD `expires_on` text;--> statement-breakpoint
ALTER TABLE `tutor_subject_claims` ADD `verified_score` real;--> statement-breakpoint
ALTER TABLE `tutor_subject_claims` ADD `appeal_count` integer DEFAULT 0 NOT NULL;