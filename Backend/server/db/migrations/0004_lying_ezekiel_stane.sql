PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tutor_subject_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`level_id` text NOT NULL,
	`board_id` text NOT NULL,
	`topic_ids_json` text NOT NULL,
	`claim_status` text DEFAULT 'asserted' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tutor_subject_claims`("id", "tutor_id", "subject_id", "level_id", "board_id", "topic_ids_json", "claim_status", "created_at") SELECT "id", "tutor_id", "subject_id", "level_id", "board_id", "topic_ids_json", "claim_status", "created_at" FROM `tutor_subject_claims`;--> statement-breakpoint
DROP TABLE `tutor_subject_claims`;--> statement-breakpoint
ALTER TABLE `__new_tutor_subject_claims` RENAME TO `tutor_subject_claims`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_claims_tutor` ON `tutor_subject_claims` (`tutor_id`);--> statement-breakpoint
CREATE INDEX `idx_claims_curriculum` ON `tutor_subject_claims` (`subject_id`,`level_id`,`board_id`,`claim_status`);