ALTER TABLE `group_members` ADD `explanation_json` text NOT NULL;--> statement-breakpoint
ALTER TABLE `group_members` ADD `booking_id` text;--> statement-breakpoint
ALTER TABLE `group_proposals` ADD `board_id` text NOT NULL REFERENCES boards(id);--> statement-breakpoint
ALTER TABLE `group_proposals` ADD `topic_ids_json` text NOT NULL;--> statement-breakpoint
ALTER TABLE `group_proposals` ADD `availability_json` text NOT NULL;--> statement-breakpoint
ALTER TABLE `group_proposals` ADD `gender_preference` text DEFAULT 'no_preference' NOT NULL;--> statement-breakpoint
ALTER TABLE `group_proposals` ADD `group_key` text NOT NULL;--> statement-breakpoint
ALTER TABLE `group_proposals` ADD `tutor_accepted_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_group_proposals_key` ON `group_proposals` (`tutor_id`,`group_key`);