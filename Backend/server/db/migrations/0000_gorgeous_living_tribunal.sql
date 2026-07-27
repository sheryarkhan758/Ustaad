CREATE TABLE `parent_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`city_id` text,
	`area_id` text,
	`address_encrypted` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parent_profiles_user_id_unique` ON `parent_profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_parent_profiles_user` ON `parent_profiles` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_parent_profiles_area` ON `parent_profiles` (`area_id`);--> statement-breakpoint
CREATE TABLE `student_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_user_id` text,
	`self_user_id` text,
	`name` text NOT NULL,
	`gender` text,
	`level_id` text,
	`board_id` text,
	`school_name` text,
	`date_of_birth` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`parent_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`self_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_student_profiles_parent` ON `student_profiles` (`parent_user_id`);--> statement-breakpoint
CREATE INDEX `idx_student_profiles_self` ON `student_profiles` (`self_user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`display_name` text NOT NULL,
	`gender` text,
	`preferred_lang` text DEFAULT 'en' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`token_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_role_status` ON `users` (`role`,`status`);--> statement-breakpoint
CREATE TABLE `area_adjacency` (
	`area_id` text NOT NULL,
	`adjacent_area_id` text NOT NULL,
	`travel_minutes` integer NOT NULL,
	PRIMARY KEY(`area_id`, `adjacent_area_id`),
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`adjacent_area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_area_adjacency_adjacent` ON `area_adjacency` (`adjacent_area_id`);--> statement-breakpoint
CREATE TABLE `areas` (
	`id` text PRIMARY KEY NOT NULL,
	`city_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_areas_city` ON `areas` (`city_id`);--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_ur` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cities` (
	`id` text PRIMARY KEY NOT NULL,
	`province_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`province_id`) REFERENCES `provinces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cities_province` ON `cities` (`province_id`);--> statement-breakpoint
CREATE TABLE `i18n_strings` (
	`key` text NOT NULL,
	`lang` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`key`, `lang`)
);
--> statement-breakpoint
CREATE INDEX `idx_i18n_lang` ON `i18n_strings` (`lang`);--> statement-breakpoint
CREATE TABLE `levels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_levels_sort` ON `levels` (`sort_order`);--> statement-breakpoint
CREATE TABLE `provinces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provinces_code_unique` ON `provinces` (`code`);--> statement-breakpoint
CREATE TABLE `service_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_ur` text NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_ur` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topic_prerequisites` (
	`topic_id` text NOT NULL,
	`prerequisite_topic_id` text NOT NULL,
	PRIMARY KEY(`topic_id`, `prerequisite_topic_id`),
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prerequisite_topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_topic_prereq_prerequisite` ON `topic_prerequisites` (`prerequisite_topic_id`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`level_id` text NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`name_ur` text NOT NULL,
	`chapter_ref` text,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_topics_curriculum` ON `topics` (`subject_id`,`level_id`,`board_id`);--> statement-breakpoint
CREATE INDEX `idx_topics_subject` ON `topics` (`subject_id`);--> statement-breakpoint
CREATE TABLE `tutor_availability` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`mode` text NOT NULL,
	`area_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_availability_tutor` ON `tutor_availability` (`tutor_id`,`weekday`);--> statement-breakpoint
CREATE INDEX `idx_availability_area` ON `tutor_availability` (`area_id`);--> statement-breakpoint
CREATE TABLE `tutor_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`storage_path` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_documents_tutor` ON `tutor_documents` (`tutor_id`,`doc_type`);--> statement-breakpoint
CREATE TABLE `tutor_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`gender` text NOT NULL,
	`city_id` text NOT NULL,
	`bio` text,
	`bio_ur` text,
	`qualifications` text,
	`experience_years` integer DEFAULT 0 NOT NULL,
	`teaches_at_home` integer DEFAULT false NOT NULL,
	`teaches_online` integer DEFAULT false NOT NULL,
	`teaches_at_own_place` integer DEFAULT false NOT NULL,
	`willing_areas_json` text NOT NULL,
	`volunteer_flag` integer DEFAULT false NOT NULL,
	`profile_status` text DEFAULT 'draft' NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tutor_profiles_user_id_unique` ON `tutor_profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tutor_profiles_slug_unique` ON `tutor_profiles` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tutor_profiles_user` ON `tutor_profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tutor_profiles_slug` ON `tutor_profiles` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_tutor_profiles_search` ON `tutor_profiles` (`profile_status`,`gender`,`city_id`);--> statement-breakpoint
CREATE TABLE `tutor_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`subject_id` text,
	`level_id` text,
	`rate_type` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'PKR' NOT NULL,
	`sessions_per_week` integer,
	`minutes_per_session` integer,
	`mode` text NOT NULL,
	`group_size_max` integer,
	`per_head_amount` integer,
	`negotiable` integer DEFAULT false NOT NULL,
	`travel_charge` integer DEFAULT 0 NOT NULL,
	`normalised_hourly_amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_rates_tutor` ON `tutor_rates` (`tutor_id`);--> statement-breakpoint
CREATE INDEX `idx_rates_normalised` ON `tutor_rates` (`subject_id`,`level_id`,`normalised_hourly_amount`);--> statement-breakpoint
CREATE TABLE `tutor_safety_constraints` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`female_students_only` integer DEFAULT false NOT NULL,
	`guardian_presence_required` integer DEFAULT false NOT NULL,
	`restricted_area_ids_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tutor_safety_constraints_tutor_id_unique` ON `tutor_safety_constraints` (`tutor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_safety_tutor` ON `tutor_safety_constraints` (`tutor_id`);--> statement-breakpoint
CREATE TABLE `tutor_subject_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`level_id` text NOT NULL,
	`board_id` text NOT NULL,
	`topic_ids_json` text NOT NULL,
	`claim_status` text DEFAULT 'claimed' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_claims_tutor` ON `tutor_subject_claims` (`tutor_id`);--> statement-breakpoint
CREATE INDEX `idx_claims_curriculum` ON `tutor_subject_claims` (`subject_id`,`level_id`,`board_id`,`claim_status`);