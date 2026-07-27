PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_admin_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`detail_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_admin_actions`("id", "admin_user_id", "action", "target_type", "target_id", "detail_json", "created_at") SELECT "id", "admin_user_id", "action", "target_type", "target_id", "detail_json", "created_at" FROM `admin_actions`;--> statement-breakpoint
DROP TABLE `admin_actions`;--> statement-breakpoint
ALTER TABLE `__new_admin_actions` RENAME TO `admin_actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_admin_actions_actor` ON `admin_actions` (`admin_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_actions_target` ON `admin_actions` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_actions_action` ON `admin_actions` (`action`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reporter_user_id` text,
	`reason` text NOT NULL,
	`detail` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` text,
	`resolution_note` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_flags`("id", "target_type", "target_id", "reporter_user_id", "reason", "detail", "status", "resolved_by", "resolution_note", "resolved_at", "created_at") SELECT "id", "target_type", "target_id", "reporter_user_id", "reason", "detail", "status", "resolved_by", "resolution_note", "resolved_at", "created_at" FROM `flags`;--> statement-breakpoint
DROP TABLE `flags`;--> statement-breakpoint
ALTER TABLE `__new_flags` RENAME TO `flags`;--> statement-breakpoint
CREATE INDEX `idx_flags_queue` ON `flags` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_flags_target` ON `flags` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_flags_reporter` ON `flags` (`reporter_user_id`);--> statement-breakpoint
CREATE TABLE `__new_org_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`org_name` text NOT NULL,
	`org_type` text NOT NULL,
	`description` text,
	`website` text,
	`approved_at` text,
	`approved_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_org_profiles`("id", "user_id", "org_name", "org_type", "description", "website", "approved_at", "approved_by", "created_at") SELECT "id", "user_id", "org_name", "org_type", "description", "website", "approved_at", "approved_by", "created_at" FROM `org_profiles`;--> statement-breakpoint
DROP TABLE `org_profiles`;--> statement-breakpoint
ALTER TABLE `__new_org_profiles` RENAME TO `org_profiles`;--> statement-breakpoint
CREATE UNIQUE INDEX `org_profiles_user_id_unique` ON `org_profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_org_profiles_user` ON `org_profiles` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_org_profiles_approval` ON `org_profiles` (`approved_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_vacancies` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`level_id` text NOT NULL,
	`board_id` text,
	`mode` text NOT NULL,
	`rate_offered` integer,
	`rate_type` text,
	`area_id` text,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `org_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_vacancies`("id", "org_id", "subject_id", "level_id", "board_id", "mode", "rate_offered", "rate_type", "area_id", "description", "status", "created_at") SELECT "id", "org_id", "subject_id", "level_id", "board_id", "mode", "rate_offered", "rate_type", "area_id", "description", "status", "created_at" FROM `vacancies`;--> statement-breakpoint
DROP TABLE `vacancies`;--> statement-breakpoint
ALTER TABLE `__new_vacancies` RENAME TO `vacancies`;--> statement-breakpoint
CREATE INDEX `idx_vacancies_org` ON `vacancies` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_vacancies_browse` ON `vacancies` (`status`,`subject_id`,`level_id`,`area_id`);--> statement-breakpoint
CREATE TABLE `__new_vacancy_interests` (
	`id` text PRIMARY KEY NOT NULL,
	`vacancy_id` text NOT NULL,
	`tutor_id` text NOT NULL,
	`status` text DEFAULT 'expressed' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`vacancy_id`) REFERENCES `vacancies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_vacancy_interests`("id", "vacancy_id", "tutor_id", "status", "created_at") SELECT "id", "vacancy_id", "tutor_id", "status", "created_at" FROM `vacancy_interests`;--> statement-breakpoint
DROP TABLE `vacancy_interests`;--> statement-breakpoint
ALTER TABLE `__new_vacancy_interests` RENAME TO `vacancy_interests`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vacancy_interests_unique` ON `vacancy_interests` (`vacancy_id`,`tutor_id`);--> statement-breakpoint
CREATE INDEX `idx_vacancy_interests_vacancy` ON `vacancy_interests` (`vacancy_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_vacancy_interests_tutor` ON `vacancy_interests` (`tutor_id`);--> statement-breakpoint
CREATE TABLE `__new_agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`user_id` text,
	`student_profile_id` text,
	`goal` text,
	`transcript_json` text NOT NULL,
	`scratchpad_json` text,
	`status` text DEFAULT 'active' NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`model` text,
	`prompt_version` text,
	`is_demo_seed` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_agent_sessions`("id", "type", "user_id", "student_profile_id", "goal", "transcript_json", "scratchpad_json", "status", "turn_count", "model", "prompt_version", "is_demo_seed", "created_at", "completed_at") SELECT "id", "type", "user_id", "student_profile_id", "goal", "transcript_json", "scratchpad_json", "status", "turn_count", "model", "prompt_version", "is_demo_seed", "created_at", "completed_at" FROM `agent_sessions`;--> statement-breakpoint
DROP TABLE `agent_sessions`;--> statement-breakpoint
ALTER TABLE `__new_agent_sessions` RENAME TO `agent_sessions`;--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_user` ON `agent_sessions` (`user_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_type_status` ON `agent_sessions` (`type`,`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_demo` ON `agent_sessions` (`is_demo_seed`,`type`);--> statement-breakpoint
CREATE TABLE `__new_diagnostics` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_session_id` text NOT NULL,
	`student_profile_id` text,
	`subject_id` text,
	`gap_map_json` text NOT NULL,
	`insufficient_info_json` text NOT NULL,
	`matched_tutor_ids_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_diagnostics`("id", "agent_session_id", "student_profile_id", "subject_id", "gap_map_json", "insufficient_info_json", "matched_tutor_ids_json", "created_at") SELECT "id", "agent_session_id", "student_profile_id", "subject_id", "gap_map_json", "insufficient_info_json", "matched_tutor_ids_json", "created_at" FROM `diagnostics`;--> statement-breakpoint
DROP TABLE `diagnostics`;--> statement-breakpoint
ALTER TABLE `__new_diagnostics` RENAME TO `diagnostics`;--> statement-breakpoint
CREATE INDEX `idx_diagnostics_session` ON `diagnostics` (`agent_session_id`);--> statement-breakpoint
CREATE INDEX `idx_diagnostics_student` ON `diagnostics` (`student_profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_ranking_explanations` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`score_hash` text NOT NULL,
	`breakdown_json` text NOT NULL,
	`narration` text NOT NULL,
	`lang` text NOT NULL,
	`model` text,
	`prompt_version` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ranking_explanations`("id", "tutor_id", "topic_id", "score_hash", "breakdown_json", "narration", "lang", "model", "prompt_version", "created_at") SELECT "id", "tutor_id", "topic_id", "score_hash", "breakdown_json", "narration", "lang", "model", "prompt_version", "created_at" FROM `ranking_explanations`;--> statement-breakpoint
DROP TABLE `ranking_explanations`;--> statement-breakpoint
ALTER TABLE `__new_ranking_explanations` RENAME TO `ranking_explanations`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ranking_explanations_cache` ON `ranking_explanations` (`tutor_id`,`topic_id`,`score_hash`,`lang`);--> statement-breakpoint
CREATE TABLE `__new_study_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`diagnostic_id` text NOT NULL,
	`student_profile_id` text,
	`level_id` text,
	`target_date` text,
	`plan_json` text NOT NULL,
	`prereq_validated` integer DEFAULT 0 NOT NULL,
	`model` text,
	`prompt_version` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`diagnostic_id`) REFERENCES `diagnostics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_study_plans`("id", "diagnostic_id", "student_profile_id", "level_id", "target_date", "plan_json", "prereq_validated", "model", "prompt_version", "created_at") SELECT "id", "diagnostic_id", "student_profile_id", "level_id", "target_date", "plan_json", "prereq_validated", "model", "prompt_version", "created_at" FROM `study_plans`;--> statement-breakpoint
DROP TABLE `study_plans`;--> statement-breakpoint
ALTER TABLE `__new_study_plans` RENAME TO `study_plans`;--> statement-breakpoint
CREATE INDEX `idx_study_plans_diagnostic` ON `study_plans` (`diagnostic_id`);--> statement-breakpoint
CREATE INDEX `idx_study_plans_student` ON `study_plans` (`student_profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_verification_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_session_id` text NOT NULL,
	`tutor_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`items_json` text NOT NULL,
	`responses_json` text NOT NULL,
	`verdict` text NOT NULL,
	`score` real,
	`reasoning` text,
	`is_appeal` integer DEFAULT 0 NOT NULL,
	`admin_override` integer DEFAULT 0 NOT NULL,
	`override_reason` text,
	`model` text,
	`prompt_version` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_verification_attempts`("id", "agent_session_id", "tutor_id", "topic_id", "items_json", "responses_json", "verdict", "score", "reasoning", "is_appeal", "admin_override", "override_reason", "model", "prompt_version", "created_at") SELECT "id", "agent_session_id", "tutor_id", "topic_id", "items_json", "responses_json", "verdict", "score", "reasoning", "is_appeal", "admin_override", "override_reason", "model", "prompt_version", "created_at" FROM `verification_attempts`;--> statement-breakpoint
DROP TABLE `verification_attempts`;--> statement-breakpoint
ALTER TABLE `__new_verification_attempts` RENAME TO `verification_attempts`;--> statement-breakpoint
CREATE INDEX `idx_verification_tutor_topic` ON `verification_attempts` (`tutor_id`,`topic_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_verification_session` ON `verification_attempts` (`agent_session_id`);--> statement-breakpoint
CREATE INDEX `idx_verification_appeals` ON `verification_attempts` (`is_appeal`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`student_profile_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`engagement_type` text NOT NULL,
	`session_purpose` text,
	`package_sessions_total` integer,
	`package_sessions_used` integer DEFAULT 0 NOT NULL,
	`subject_id` text NOT NULL,
	`level_id` text NOT NULL,
	`board_id` text NOT NULL,
	`topic_ids_json` text NOT NULL,
	`service_type_id` text,
	`mode` text NOT NULL,
	`area_id` text,
	`address_encrypted` text,
	`slot_start` text,
	`slot_end` text,
	`agreed_rate` integer,
	`rate_type` text,
	`travel_charge_agreed` integer DEFAULT 0 NOT NULL,
	`agreed_rate_snapshot_json` text,
	`is_trial` integer DEFAULT 0 NOT NULL,
	`guardian_presence_required` integer DEFAULT 0 NOT NULL,
	`group_id` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`status_changed_by` text,
	`status_changed_at` text,
	`requested_at` text NOT NULL,
	`responded_at` text,
	`confirmed_at` text,
	`completed_at` text,
	`cancelled_at` text,
	`cancel_reason` text,
	`decline_under_safety_constraint` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_type_id`) REFERENCES `service_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_bookings`("id", "tutor_id", "student_profile_id", "requested_by_user_id", "engagement_type", "session_purpose", "package_sessions_total", "package_sessions_used", "subject_id", "level_id", "board_id", "topic_ids_json", "service_type_id", "mode", "area_id", "address_encrypted", "slot_start", "slot_end", "agreed_rate", "rate_type", "travel_charge_agreed", "agreed_rate_snapshot_json", "is_trial", "guardian_presence_required", "group_id", "status", "status_changed_by", "status_changed_at", "requested_at", "responded_at", "confirmed_at", "completed_at", "cancelled_at", "cancel_reason", "decline_under_safety_constraint", "created_at") SELECT "id", "tutor_id", "student_profile_id", "requested_by_user_id", "engagement_type", "session_purpose", "package_sessions_total", "package_sessions_used", "subject_id", "level_id", "board_id", "topic_ids_json", "service_type_id", "mode", "area_id", "address_encrypted", "slot_start", "slot_end", "agreed_rate", "rate_type", "travel_charge_agreed", "agreed_rate_snapshot_json", "is_trial", "guardian_presence_required", "group_id", "status", "status_changed_by", "status_changed_at", "requested_at", "responded_at", "confirmed_at", "completed_at", "cancelled_at", "cancel_reason", "decline_under_safety_constraint", "created_at" FROM `bookings`;--> statement-breakpoint
DROP TABLE `bookings`;--> statement-breakpoint
ALTER TABLE `__new_bookings` RENAME TO `bookings`;--> statement-breakpoint
CREATE INDEX `idx_bookings_tutor_status` ON `bookings` (`tutor_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_bookings_requester` ON `bookings` (`requested_by_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_bookings_student` ON `bookings` (`student_profile_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_bookings_slot` ON `bookings` (`tutor_id`,`slot_start`,`slot_end`);--> statement-breakpoint
CREATE INDEX `idx_bookings_group` ON `bookings` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_bookings_status_requested` ON `bookings` (`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `__new_session_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`tutor_id` text NOT NULL,
	`topics_covered_json` text NOT NULL,
	`mastery_ratings_json` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_session_notes`("id", "booking_id", "tutor_id", "topics_covered_json", "mastery_ratings_json", "note", "created_at") SELECT "id", "booking_id", "tutor_id", "topics_covered_json", "mastery_ratings_json", "note", "created_at" FROM `session_notes`;--> statement-breakpoint
DROP TABLE `session_notes`;--> statement-breakpoint
ALTER TABLE `__new_session_notes` RENAME TO `session_notes`;--> statement-breakpoint
CREATE INDEX `idx_session_notes_booking` ON `session_notes` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_session_notes_tutor` ON `session_notes` (`tutor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_trial_fit_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`submitted_by` text NOT NULL,
	`communication` integer NOT NULL,
	`punctuality` integer NOT NULL,
	`engagement` integer NOT NULL,
	`pace` integer NOT NULL,
	`continue_decision` integer NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_trial_fit_checks`("id", "booking_id", "submitted_by", "communication", "punctuality", "engagement", "pace", "continue_decision", "note", "created_at") SELECT "id", "booking_id", "submitted_by", "communication", "punctuality", "engagement", "pace", "continue_decision", "note", "created_at" FROM `trial_fit_checks`;--> statement-breakpoint
DROP TABLE `trial_fit_checks`;--> statement-breakpoint
ALTER TABLE `__new_trial_fit_checks` RENAME TO `trial_fit_checks`;--> statement-breakpoint
CREATE UNIQUE INDEX `trial_fit_checks_booking_id_unique` ON `trial_fit_checks` (`booking_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trial_fit_checks_booking` ON `trial_fit_checks` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_trial_fit_checks_submitter` ON `trial_fit_checks` (`submitted_by`);--> statement-breakpoint
CREATE TABLE `__new_rate_benchmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`level_id` text NOT NULL,
	`area_id` text NOT NULL,
	`mode` text NOT NULL,
	`median_hourly` integer NOT NULL,
	`cohort_size` integer NOT NULL,
	`verified_count` integer DEFAULT 0 NOT NULL,
	`computed_at` text NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_rate_benchmarks`("id", "subject_id", "level_id", "area_id", "mode", "median_hourly", "cohort_size", "verified_count", "computed_at") SELECT "id", "subject_id", "level_id", "area_id", "mode", "median_hourly", "cohort_size", "verified_count", "computed_at" FROM `rate_benchmarks`;--> statement-breakpoint
DROP TABLE `rate_benchmarks`;--> statement-breakpoint
ALTER TABLE `__new_rate_benchmarks` RENAME TO `rate_benchmarks`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rate_benchmarks_cell` ON `rate_benchmarks` (`subject_id`,`level_id`,`area_id`,`mode`);--> statement-breakpoint
CREATE INDEX `idx_rate_benchmarks_cohort` ON `rate_benchmarks` (`cohort_size`);--> statement-breakpoint
CREATE TABLE `__new_tutor_reliability` (
	`tutor_id` text PRIMARY KEY NOT NULL,
	`median_response_mins` integer,
	`confirmation_rate` real,
	`completed_count` integer DEFAULT 0 NOT NULL,
	`no_show_count` integer DEFAULT 0 NOT NULL,
	`cancellation_rate` real,
	`safety_declines_excluded` integer DEFAULT 0 NOT NULL,
	`booking_basis` integer DEFAULT 0 NOT NULL,
	`computed_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tutor_reliability`("tutor_id", "median_response_mins", "confirmation_rate", "completed_count", "no_show_count", "cancellation_rate", "safety_declines_excluded", "booking_basis", "computed_at") SELECT "tutor_id", "median_response_mins", "confirmation_rate", "completed_count", "no_show_count", "cancellation_rate", "safety_declines_excluded", "booking_basis", "computed_at" FROM `tutor_reliability`;--> statement-breakpoint
DROP TABLE `tutor_reliability`;--> statement-breakpoint
ALTER TABLE `__new_tutor_reliability` RENAME TO `tutor_reliability`;--> statement-breakpoint
CREATE INDEX `idx_tutor_reliability_computed` ON `tutor_reliability` (`computed_at`);--> statement-breakpoint
CREATE TABLE `__new_tutor_scores` (
	`tutor_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`composite_score` real NOT NULL,
	`dimension_scores_json` text NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`weighted_review_count` real DEFAULT 0 NOT NULL,
	`score_hash` text NOT NULL,
	`computed_at` text NOT NULL,
	PRIMARY KEY(`tutor_id`, `topic_id`),
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tutor_scores`("tutor_id", "topic_id", "composite_score", "dimension_scores_json", "review_count", "weighted_review_count", "score_hash", "computed_at") SELECT "tutor_id", "topic_id", "composite_score", "dimension_scores_json", "review_count", "weighted_review_count", "score_hash", "computed_at" FROM `tutor_scores`;--> statement-breakpoint
DROP TABLE `tutor_scores`;--> statement-breakpoint
ALTER TABLE `__new_tutor_scores` RENAME TO `tutor_scores`;--> statement-breakpoint
CREATE INDEX `idx_tutor_scores_ranking` ON `tutor_scores` (`topic_id`,`composite_score`);--> statement-breakpoint
CREATE INDEX `idx_tutor_scores_hash` ON `tutor_scores` (`score_hash`);--> statement-breakpoint
CREATE TABLE `__new_review_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`dimensions_json` text NOT NULL,
	`credibility_json` text NOT NULL,
	`topics_mentioned_json` text NOT NULL,
	`safety_concern_flag` integer DEFAULT 0 NOT NULL,
	`credibility_weight` real DEFAULT 1 NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_review_analyses`("id", "review_id", "content_hash", "dimensions_json", "credibility_json", "topics_mentioned_json", "safety_concern_flag", "credibility_weight", "model", "prompt_version", "created_at") SELECT "id", "review_id", "content_hash", "dimensions_json", "credibility_json", "topics_mentioned_json", "safety_concern_flag", "credibility_weight", "model", "prompt_version", "created_at" FROM `review_analyses`;--> statement-breakpoint
DROP TABLE `review_analyses`;--> statement-breakpoint
ALTER TABLE `__new_review_analyses` RENAME TO `review_analyses`;--> statement-breakpoint
CREATE UNIQUE INDEX `review_analyses_review_id_unique` ON `review_analyses` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_review_analyses_review` ON `review_analyses` (`review_id`);--> statement-breakpoint
CREATE INDEX `idx_review_analyses_hash` ON `review_analyses` (`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_review_analyses_safety` ON `review_analyses` (`safety_concern_flag`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`tutor_id` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`reviewer_role` text NOT NULL,
	`rating` integer NOT NULL,
	`text` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_reviews`("id", "booking_id", "tutor_id", "reviewer_user_id", "reviewer_role", "rating", "text", "created_at") SELECT "id", "booking_id", "tutor_id", "reviewer_user_id", "reviewer_role", "rating", "text", "created_at" FROM `reviews`;--> statement-breakpoint
DROP TABLE `reviews`;--> statement-breakpoint
ALTER TABLE `__new_reviews` RENAME TO `reviews`;--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_booking_id_unique` ON `reviews` (`booking_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reviews_booking` ON `reviews` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_reviews_tutor` ON `reviews` (`tutor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reviews_reviewer` ON `reviews` (`reviewer_user_id`);--> statement-breakpoint
CREATE TABLE `__new_parent_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`city_id` text,
	`area_id` text,
	`address_encrypted` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_parent_profiles`("id", "user_id", "city_id", "area_id", "address_encrypted", "created_at") SELECT "id", "user_id", "city_id", "area_id", "address_encrypted", "created_at" FROM `parent_profiles`;--> statement-breakpoint
DROP TABLE `parent_profiles`;--> statement-breakpoint
ALTER TABLE `__new_parent_profiles` RENAME TO `parent_profiles`;--> statement-breakpoint
CREATE UNIQUE INDEX `parent_profiles_user_id_unique` ON `parent_profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_parent_profiles_user` ON `parent_profiles` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_parent_profiles_area` ON `parent_profiles` (`area_id`);--> statement-breakpoint
CREATE TABLE `__new_student_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_user_id` text,
	`self_user_id` text,
	`name` text NOT NULL,
	`gender` text,
	`level_id` text,
	`board_id` text,
	`school_name` text,
	`date_of_birth` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`parent_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`self_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_student_profiles`("id", "parent_user_id", "self_user_id", "name", "gender", "level_id", "board_id", "school_name", "date_of_birth", "created_at") SELECT "id", "parent_user_id", "self_user_id", "name", "gender", "level_id", "board_id", "school_name", "date_of_birth", "created_at" FROM `student_profiles`;--> statement-breakpoint
DROP TABLE `student_profiles`;--> statement-breakpoint
ALTER TABLE `__new_student_profiles` RENAME TO `student_profiles`;--> statement-breakpoint
CREATE INDEX `idx_student_profiles_parent` ON `student_profiles` (`parent_user_id`);--> statement-breakpoint
CREATE INDEX `idx_student_profiles_self` ON `student_profiles` (`self_user_id`);--> statement-breakpoint
CREATE TABLE `__new_users` (
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
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "phone", "password_hash", "role", "display_name", "gender", "preferred_lang", "status", "token_version", "created_at", "updated_at") SELECT "id", "email", "phone", "password_hash", "role", "display_name", "gender", "preferred_lang", "status", "token_version", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_role_status` ON `users` (`role`,`status`);--> statement-breakpoint
CREATE TABLE `__new_tutor_availability` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`mode` text NOT NULL,
	`area_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tutor_availability`("id", "tutor_id", "weekday", "start_time", "end_time", "mode", "area_id", "created_at") SELECT "id", "tutor_id", "weekday", "start_time", "end_time", "mode", "area_id", "created_at" FROM `tutor_availability`;--> statement-breakpoint
DROP TABLE `tutor_availability`;--> statement-breakpoint
ALTER TABLE `__new_tutor_availability` RENAME TO `tutor_availability`;--> statement-breakpoint
CREATE INDEX `idx_availability_tutor` ON `tutor_availability` (`tutor_id`,`weekday`);--> statement-breakpoint
CREATE INDEX `idx_availability_area` ON `tutor_availability` (`area_id`);--> statement-breakpoint
CREATE TABLE `__new_tutor_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`storage_path` text NOT NULL,
	`uploaded_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tutor_documents`("id", "tutor_id", "doc_type", "storage_path", "uploaded_at") SELECT "id", "tutor_id", "doc_type", "storage_path", "uploaded_at" FROM `tutor_documents`;--> statement-breakpoint
DROP TABLE `tutor_documents`;--> statement-breakpoint
ALTER TABLE `__new_tutor_documents` RENAME TO `tutor_documents`;--> statement-breakpoint
CREATE INDEX `idx_documents_tutor` ON `tutor_documents` (`tutor_id`,`doc_type`);--> statement-breakpoint
CREATE TABLE `__new_tutor_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`gender` text NOT NULL,
	`city_id` text NOT NULL,
	`bio` text,
	`bio_ur` text,
	`qualifications` text,
	`experience_years` integer DEFAULT 0 NOT NULL,
	`teaches_at_home` integer DEFAULT 0 NOT NULL,
	`teaches_online` integer DEFAULT 0 NOT NULL,
	`teaches_at_own_place` integer DEFAULT 0 NOT NULL,
	`willing_areas_json` text NOT NULL,
	`volunteer_flag` integer DEFAULT 0 NOT NULL,
	`profile_status` text DEFAULT 'draft' NOT NULL,
	`slug` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tutor_profiles`("id", "user_id", "gender", "city_id", "bio", "bio_ur", "qualifications", "experience_years", "teaches_at_home", "teaches_online", "teaches_at_own_place", "willing_areas_json", "volunteer_flag", "profile_status", "slug", "created_at") SELECT "id", "user_id", "gender", "city_id", "bio", "bio_ur", "qualifications", "experience_years", "teaches_at_home", "teaches_online", "teaches_at_own_place", "willing_areas_json", "volunteer_flag", "profile_status", "slug", "created_at" FROM `tutor_profiles`;--> statement-breakpoint
DROP TABLE `tutor_profiles`;--> statement-breakpoint
ALTER TABLE `__new_tutor_profiles` RENAME TO `tutor_profiles`;--> statement-breakpoint
CREATE UNIQUE INDEX `tutor_profiles_user_id_unique` ON `tutor_profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tutor_profiles_slug_unique` ON `tutor_profiles` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tutor_profiles_user` ON `tutor_profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tutor_profiles_slug` ON `tutor_profiles` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_tutor_profiles_search` ON `tutor_profiles` (`profile_status`,`gender`,`city_id`);--> statement-breakpoint
CREATE TABLE `__new_tutor_rates` (
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
	`negotiable` integer DEFAULT 0 NOT NULL,
	`travel_charge` integer DEFAULT 0 NOT NULL,
	`normalised_hourly_amount` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tutor_rates`("id", "tutor_id", "subject_id", "level_id", "rate_type", "amount", "currency", "sessions_per_week", "minutes_per_session", "mode", "group_size_max", "per_head_amount", "negotiable", "travel_charge", "normalised_hourly_amount", "created_at") SELECT "id", "tutor_id", "subject_id", "level_id", "rate_type", "amount", "currency", "sessions_per_week", "minutes_per_session", "mode", "group_size_max", "per_head_amount", "negotiable", "travel_charge", "normalised_hourly_amount", "created_at" FROM `tutor_rates`;--> statement-breakpoint
DROP TABLE `tutor_rates`;--> statement-breakpoint
ALTER TABLE `__new_tutor_rates` RENAME TO `tutor_rates`;--> statement-breakpoint
CREATE INDEX `idx_rates_tutor` ON `tutor_rates` (`tutor_id`);--> statement-breakpoint
CREATE INDEX `idx_rates_normalised` ON `tutor_rates` (`subject_id`,`level_id`,`normalised_hourly_amount`);--> statement-breakpoint
CREATE TABLE `__new_tutor_safety_constraints` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`female_students_only` integer DEFAULT 0 NOT NULL,
	`guardian_presence_required` integer DEFAULT 0 NOT NULL,
	`restricted_area_ids_json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tutor_safety_constraints`("id", "tutor_id", "female_students_only", "guardian_presence_required", "restricted_area_ids_json", "updated_at") SELECT "id", "tutor_id", "female_students_only", "guardian_presence_required", "restricted_area_ids_json", "updated_at" FROM `tutor_safety_constraints`;--> statement-breakpoint
DROP TABLE `tutor_safety_constraints`;--> statement-breakpoint
ALTER TABLE `__new_tutor_safety_constraints` RENAME TO `tutor_safety_constraints`;--> statement-breakpoint
CREATE UNIQUE INDEX `tutor_safety_constraints_tutor_id_unique` ON `tutor_safety_constraints` (`tutor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_safety_tutor` ON `tutor_safety_constraints` (`tutor_id`);--> statement-breakpoint
CREATE TABLE `__new_tutor_subject_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`level_id` text NOT NULL,
	`board_id` text NOT NULL,
	`topic_ids_json` text NOT NULL,
	`claim_status` text DEFAULT 'claimed' NOT NULL,
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
CREATE INDEX `idx_claims_tutor` ON `tutor_subject_claims` (`tutor_id`);--> statement-breakpoint
CREATE INDEX `idx_claims_curriculum` ON `tutor_subject_claims` (`subject_id`,`level_id`,`board_id`,`claim_status`);--> statement-breakpoint
CREATE TABLE `__new_payment_disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_record_id` text NOT NULL,
	`raised_by` text NOT NULL,
	`raised_by_party` text NOT NULL,
	`reason` text NOT NULL,
	`detail` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` text,
	`resolution_reason` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`payment_record_id`) REFERENCES `payment_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`raised_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_payment_disputes`("id", "payment_record_id", "raised_by", "raised_by_party", "reason", "detail", "status", "resolved_by", "resolution_reason", "resolved_at", "created_at") SELECT "id", "payment_record_id", "raised_by", "raised_by_party", "reason", "detail", "status", "resolved_by", "resolution_reason", "resolved_at", "created_at" FROM `payment_disputes`;--> statement-breakpoint
DROP TABLE `payment_disputes`;--> statement-breakpoint
ALTER TABLE `__new_payment_disputes` RENAME TO `payment_disputes`;--> statement-breakpoint
CREATE INDEX `idx_payment_disputes_record` ON `payment_disputes` (`payment_record_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_disputes_status` ON `payment_disputes` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payment_disputes_raiser` ON `payment_disputes` (`raised_by`,`status`);--> statement-breakpoint
CREATE TABLE `__new_payment_records` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`cycle_label` text NOT NULL,
	`agreed_amount` integer NOT NULL,
	`travel_charge` integer DEFAULT 0 NOT NULL,
	`rate_type` text NOT NULL,
	`engagement_type` text NOT NULL,
	`family_marked_paid_at` text,
	`tutor_confirmed_at` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_payment_records`("id", "booking_id", "cycle_label", "agreed_amount", "travel_charge", "rate_type", "engagement_type", "family_marked_paid_at", "tutor_confirmed_at", "status", "created_at") SELECT "id", "booking_id", "cycle_label", "agreed_amount", "travel_charge", "rate_type", "engagement_type", "family_marked_paid_at", "tutor_confirmed_at", "status", "created_at" FROM `payment_records`;--> statement-breakpoint
DROP TABLE `payment_records`;--> statement-breakpoint
ALTER TABLE `__new_payment_records` RENAME TO `payment_records`;--> statement-breakpoint
CREATE INDEX `idx_payment_records_booking` ON `payment_records` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_records_status` ON `payment_records` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_group_members` (
	`proposal_id` text NOT NULL,
	`group_request_id` text NOT NULL,
	`student_profile_id` text NOT NULL,
	`confirmed_at` text,
	`declined_at` text,
	PRIMARY KEY(`proposal_id`, `group_request_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `group_proposals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_request_id`) REFERENCES `group_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_group_members`("proposal_id", "group_request_id", "student_profile_id", "confirmed_at", "declined_at") SELECT "proposal_id", "group_request_id", "student_profile_id", "confirmed_at", "declined_at" FROM `group_members`;--> statement-breakpoint
DROP TABLE `group_members`;--> statement-breakpoint
ALTER TABLE `__new_group_members` RENAME TO `group_members`;--> statement-breakpoint
CREATE INDEX `idx_group_members_request` ON `group_members` (`group_request_id`);--> statement-breakpoint
CREATE INDEX `idx_group_members_student` ON `group_members` (`student_profile_id`);--> statement-breakpoint
CREATE TABLE `__new_group_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`level_id` text NOT NULL,
	`area_id` text NOT NULL,
	`per_head_rate` integer NOT NULL,
	`proposed_at` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`confirmed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_group_proposals`("id", "tutor_id", "subject_id", "level_id", "area_id", "per_head_rate", "proposed_at", "status", "confirmed_at", "created_at") SELECT "id", "tutor_id", "subject_id", "level_id", "area_id", "per_head_rate", "proposed_at", "status", "confirmed_at", "created_at" FROM `group_proposals`;--> statement-breakpoint
DROP TABLE `group_proposals`;--> statement-breakpoint
ALTER TABLE `__new_group_proposals` RENAME TO `group_proposals`;--> statement-breakpoint
CREATE INDEX `idx_group_proposals_tutor` ON `group_proposals` (`tutor_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_group_proposals_match` ON `group_proposals` (`subject_id`,`level_id`,`area_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_group_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`student_profile_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`level_id` text NOT NULL,
	`board_id` text NOT NULL,
	`topics_json` text NOT NULL,
	`area_id` text NOT NULL,
	`area_flex` integer DEFAULT 0 NOT NULL,
	`gender_preference` text DEFAULT 'no_preference' NOT NULL,
	`max_group_size` integer NOT NULL,
	`budget_max` integer,
	`availability_json` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_group_requests`("id", "student_profile_id", "subject_id", "level_id", "board_id", "topics_json", "area_id", "area_flex", "gender_preference", "max_group_size", "budget_max", "availability_json", "status", "expires_at", "created_at") SELECT "id", "student_profile_id", "subject_id", "level_id", "board_id", "topics_json", "area_id", "area_flex", "gender_preference", "max_group_size", "budget_max", "availability_json", "status", "expires_at", "created_at" FROM `group_requests`;--> statement-breakpoint
DROP TABLE `group_requests`;--> statement-breakpoint
ALTER TABLE `__new_group_requests` RENAME TO `group_requests`;--> statement-breakpoint
CREATE INDEX `idx_group_requests_match` ON `group_requests` (`subject_id`,`level_id`,`board_id`,`area_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_group_requests_expiry` ON `group_requests` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_group_requests_student` ON `group_requests` (`student_profile_id`);--> statement-breakpoint
CREATE TABLE `__new_unmet_demand` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`topic_ids_json` text NOT NULL,
	`level_id` text,
	`board_id` text,
	`area_id` text,
	`gender_preference` text DEFAULT 'no_preference' NOT NULL,
	`budget_max` integer,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_unmet_demand`("id", "subject_id", "topic_ids_json", "level_id", "board_id", "area_id", "gender_preference", "budget_max", "reason", "created_at") SELECT "id", "subject_id", "topic_ids_json", "level_id", "board_id", "area_id", "gender_preference", "budget_max", "reason", "created_at" FROM `unmet_demand`;--> statement-breakpoint
DROP TABLE `unmet_demand`;--> statement-breakpoint
ALTER TABLE `__new_unmet_demand` RENAME TO `unmet_demand`;--> statement-breakpoint
CREATE INDEX `idx_unmet_demand_rollup` ON `unmet_demand` (`subject_id`,`area_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_unmet_demand_area` ON `unmet_demand` (`area_id`,`level_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_platform_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`role` text,
	`category` text NOT NULL,
	`detail` text NOT NULL,
	`satisfaction_rating` integer,
	`page_path` text,
	`locale` text,
	`app_version` text,
	`attachment_path` text,
	`safety_concern_flag` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`disposition_note` text,
	`triaged_by` text,
	`triaged_at` text,
	`mail_dispatch_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`triaged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_platform_feedback`("id", "user_id", "role", "category", "detail", "satisfaction_rating", "page_path", "locale", "app_version", "attachment_path", "safety_concern_flag", "status", "disposition_note", "triaged_by", "triaged_at", "mail_dispatch_status", "created_at") SELECT "id", "user_id", "role", "category", "detail", "satisfaction_rating", "page_path", "locale", "app_version", "attachment_path", "safety_concern_flag", "status", "disposition_note", "triaged_by", "triaged_at", "mail_dispatch_status", "created_at" FROM `platform_feedback`;--> statement-breakpoint
DROP TABLE `platform_feedback`;--> statement-breakpoint
ALTER TABLE `__new_platform_feedback` RENAME TO `platform_feedback`;--> statement-breakpoint
CREATE INDEX `idx_platform_feedback_queue` ON `platform_feedback` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_platform_feedback_safety` ON `platform_feedback` (`safety_concern_flag`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_platform_feedback_user` ON `platform_feedback` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_platform_feedback_category` ON `platform_feedback` (`category`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_platform_feedback_dispatch` ON `platform_feedback` (`mail_dispatch_status`);--> statement-breakpoint
CREATE TABLE `__new_volunteer_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`city_id` text,
	`area_id` text,
	`gender` text,
	`subjects_json` text NOT NULL,
	`levels_json` text NOT NULL,
	`weekly_hours` integer,
	`delivery_modes_json` text NOT NULL,
	`motivation` text,
	`document_path` text,
	`status` text DEFAULT 'received' NOT NULL,
	`mail_dispatch_status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`review_note` text,
	`converted_tutor_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`converted_tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_volunteer_applications`("id", "full_name", "email", "phone", "city_id", "area_id", "gender", "subjects_json", "levels_json", "weekly_hours", "delivery_modes_json", "motivation", "document_path", "status", "mail_dispatch_status", "reviewed_by", "review_note", "converted_tutor_id", "created_at") SELECT "id", "full_name", "email", "phone", "city_id", "area_id", "gender", "subjects_json", "levels_json", "weekly_hours", "delivery_modes_json", "motivation", "document_path", "status", "mail_dispatch_status", "reviewed_by", "review_note", "converted_tutor_id", "created_at" FROM `volunteer_applications`;--> statement-breakpoint
DROP TABLE `volunteer_applications`;--> statement-breakpoint
ALTER TABLE `__new_volunteer_applications` RENAME TO `volunteer_applications`;--> statement-breakpoint
CREATE INDEX `idx_volunteer_applications_queue` ON `volunteer_applications` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_volunteer_applications_email` ON `volunteer_applications` (`email`);--> statement-breakpoint
CREATE INDEX `idx_volunteer_applications_area` ON `volunteer_applications` (`city_id`,`area_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_volunteer_applications_dispatch` ON `volunteer_applications` (`mail_dispatch_status`);