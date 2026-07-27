CREATE TABLE `admin_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`detail_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_admin_actions_actor` ON `admin_actions` (`admin_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_actions_target` ON `admin_actions` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_actions_action` ON `admin_actions` (`action`,`created_at`);--> statement-breakpoint
CREATE TABLE `flags` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reporter_user_id` text,
	`reason` text NOT NULL,
	`detail` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` text,
	`resolution_note` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_flags_queue` ON `flags` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_flags_target` ON `flags` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_flags_reporter` ON `flags` (`reporter_user_id`);--> statement-breakpoint
CREATE TABLE `org_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`org_name` text NOT NULL,
	`org_type` text NOT NULL,
	`description` text,
	`website` text,
	`approved_at` integer,
	`approved_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_profiles_user_id_unique` ON `org_profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_org_profiles_user` ON `org_profiles` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_org_profiles_approval` ON `org_profiles` (`approved_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `vacancies` (
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
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `org_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vacancies_org` ON `vacancies` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_vacancies_browse` ON `vacancies` (`status`,`subject_id`,`level_id`,`area_id`);--> statement-breakpoint
CREATE TABLE `vacancy_interests` (
	`id` text PRIMARY KEY NOT NULL,
	`vacancy_id` text NOT NULL,
	`tutor_id` text NOT NULL,
	`status` text DEFAULT 'expressed' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`vacancy_id`) REFERENCES `vacancies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vacancy_interests_unique` ON `vacancy_interests` (`vacancy_id`,`tutor_id`);--> statement-breakpoint
CREATE INDEX `idx_vacancy_interests_vacancy` ON `vacancy_interests` (`vacancy_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_vacancy_interests_tutor` ON `vacancy_interests` (`tutor_id`);--> statement-breakpoint
CREATE TABLE `agent_sessions` (
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
	`is_demo_seed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_user` ON `agent_sessions` (`user_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_type_status` ON `agent_sessions` (`type`,`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_demo` ON `agent_sessions` (`is_demo_seed`,`type`);--> statement-breakpoint
CREATE TABLE `diagnostics` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_session_id` text NOT NULL,
	`student_profile_id` text,
	`subject_id` text,
	`gap_map_json` text NOT NULL,
	`insufficient_info_json` text NOT NULL,
	`matched_tutor_ids_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_diagnostics_session` ON `diagnostics` (`agent_session_id`);--> statement-breakpoint
CREATE INDEX `idx_diagnostics_student` ON `diagnostics` (`student_profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ranking_explanations` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`score_hash` text NOT NULL,
	`breakdown_json` text NOT NULL,
	`narration` text NOT NULL,
	`lang` text NOT NULL,
	`model` text,
	`prompt_version` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ranking_explanations_cache` ON `ranking_explanations` (`tutor_id`,`topic_id`,`score_hash`,`lang`);--> statement-breakpoint
CREATE TABLE `study_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`diagnostic_id` text NOT NULL,
	`student_profile_id` text,
	`level_id` text,
	`target_date` text,
	`plan_json` text NOT NULL,
	`prereq_validated` integer DEFAULT false NOT NULL,
	`model` text,
	`prompt_version` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`diagnostic_id`) REFERENCES `diagnostics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_study_plans_diagnostic` ON `study_plans` (`diagnostic_id`);--> statement-breakpoint
CREATE INDEX `idx_study_plans_student` ON `study_plans` (`student_profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `verification_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_session_id` text NOT NULL,
	`tutor_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`items_json` text NOT NULL,
	`responses_json` text NOT NULL,
	`verdict` text NOT NULL,
	`score` real,
	`reasoning` text,
	`is_appeal` integer DEFAULT false NOT NULL,
	`admin_override` integer DEFAULT false NOT NULL,
	`override_reason` text,
	`model` text,
	`prompt_version` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_verification_tutor_topic` ON `verification_attempts` (`tutor_id`,`topic_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_verification_session` ON `verification_attempts` (`agent_session_id`);--> statement-breakpoint
CREATE INDEX `idx_verification_appeals` ON `verification_attempts` (`is_appeal`,`created_at`);--> statement-breakpoint
CREATE TABLE `bookings` (
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
	`slot_start` integer,
	`slot_end` integer,
	`agreed_rate` integer,
	`rate_type` text,
	`travel_charge_agreed` integer DEFAULT 0 NOT NULL,
	`agreed_rate_snapshot_json` text,
	`is_trial` integer DEFAULT false NOT NULL,
	`guardian_presence_required` integer DEFAULT false NOT NULL,
	`group_id` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`status_changed_by` text,
	`status_changed_at` integer,
	`requested_at` integer NOT NULL,
	`responded_at` integer,
	`confirmed_at` integer,
	`completed_at` integer,
	`cancelled_at` integer,
	`cancel_reason` text,
	`decline_under_safety_constraint` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
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
CREATE INDEX `idx_bookings_tutor_status` ON `bookings` (`tutor_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_bookings_requester` ON `bookings` (`requested_by_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_bookings_student` ON `bookings` (`student_profile_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_bookings_slot` ON `bookings` (`tutor_id`,`slot_start`,`slot_end`);--> statement-breakpoint
CREATE INDEX `idx_bookings_group` ON `bookings` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_bookings_status_requested` ON `bookings` (`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `session_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`tutor_id` text NOT NULL,
	`topics_covered_json` text NOT NULL,
	`mastery_ratings_json` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_session_notes_booking` ON `session_notes` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_session_notes_tutor` ON `session_notes` (`tutor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trial_fit_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`submitted_by` text NOT NULL,
	`communication` integer NOT NULL,
	`punctuality` integer NOT NULL,
	`engagement` integer NOT NULL,
	`pace` integer NOT NULL,
	`continue_decision` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trial_fit_checks_booking_id_unique` ON `trial_fit_checks` (`booking_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trial_fit_checks_booking` ON `trial_fit_checks` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_trial_fit_checks_submitter` ON `trial_fit_checks` (`submitted_by`);--> statement-breakpoint
CREATE TABLE `rate_benchmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`level_id` text NOT NULL,
	`area_id` text NOT NULL,
	`mode` text NOT NULL,
	`median_hourly` integer NOT NULL,
	`cohort_size` integer NOT NULL,
	`verified_count` integer DEFAULT 0 NOT NULL,
	`computed_at` integer NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rate_benchmarks_cell` ON `rate_benchmarks` (`subject_id`,`level_id`,`area_id`,`mode`);--> statement-breakpoint
CREATE INDEX `idx_rate_benchmarks_cohort` ON `rate_benchmarks` (`cohort_size`);--> statement-breakpoint
CREATE TABLE `tutor_reliability` (
	`tutor_id` text PRIMARY KEY NOT NULL,
	`median_response_mins` integer,
	`confirmation_rate` real,
	`completed_count` integer DEFAULT 0 NOT NULL,
	`no_show_count` integer DEFAULT 0 NOT NULL,
	`cancellation_rate` real,
	`safety_declines_excluded` integer DEFAULT 0 NOT NULL,
	`booking_basis` integer DEFAULT 0 NOT NULL,
	`computed_at` integer NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tutor_reliability_computed` ON `tutor_reliability` (`computed_at`);--> statement-breakpoint
CREATE TABLE `tutor_scores` (
	`tutor_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`composite_score` real NOT NULL,
	`dimension_scores_json` text NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`weighted_review_count` real DEFAULT 0 NOT NULL,
	`score_hash` text NOT NULL,
	`computed_at` integer NOT NULL,
	PRIMARY KEY(`tutor_id`, `topic_id`),
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tutor_scores_ranking` ON `tutor_scores` (`topic_id`,`composite_score`);--> statement-breakpoint
CREATE INDEX `idx_tutor_scores_hash` ON `tutor_scores` (`score_hash`);--> statement-breakpoint
CREATE TABLE `review_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`dimensions_json` text NOT NULL,
	`credibility_json` text NOT NULL,
	`topics_mentioned_json` text NOT NULL,
	`safety_concern_flag` integer DEFAULT false NOT NULL,
	`credibility_weight` real DEFAULT 1 NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_analyses_review_id_unique` ON `review_analyses` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_review_analyses_review` ON `review_analyses` (`review_id`);--> statement-breakpoint
CREATE INDEX `idx_review_analyses_hash` ON `review_analyses` (`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_review_analyses_safety` ON `review_analyses` (`safety_concern_flag`,`created_at`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`tutor_id` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`reviewer_role` text NOT NULL,
	`rating` integer NOT NULL,
	`text` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_booking_id_unique` ON `reviews` (`booking_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reviews_booking` ON `reviews` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_reviews_tutor` ON `reviews` (`tutor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reviews_reviewer` ON `reviews` (`reviewer_user_id`);--> statement-breakpoint
CREATE TABLE `payment_disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_record_id` text NOT NULL,
	`raised_by` text NOT NULL,
	`raised_by_party` text NOT NULL,
	`reason` text NOT NULL,
	`detail` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` text,
	`resolution_reason` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_record_id`) REFERENCES `payment_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`raised_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_payment_disputes_record` ON `payment_disputes` (`payment_record_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_disputes_status` ON `payment_disputes` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payment_disputes_raiser` ON `payment_disputes` (`raised_by`,`status`);--> statement-breakpoint
CREATE TABLE `payment_records` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`cycle_label` text NOT NULL,
	`agreed_amount` integer NOT NULL,
	`travel_charge` integer DEFAULT 0 NOT NULL,
	`rate_type` text NOT NULL,
	`engagement_type` text NOT NULL,
	`family_marked_paid_at` integer,
	`tutor_confirmed_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_payment_records_booking` ON `payment_records` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_records_status` ON `payment_records` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `group_members` (
	`proposal_id` text NOT NULL,
	`group_request_id` text NOT NULL,
	`student_profile_id` text NOT NULL,
	`confirmed_at` integer,
	`declined_at` integer,
	PRIMARY KEY(`proposal_id`, `group_request_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `group_proposals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_request_id`) REFERENCES `group_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_group_members_request` ON `group_members` (`group_request_id`);--> statement-breakpoint
CREATE INDEX `idx_group_members_student` ON `group_members` (`student_profile_id`);--> statement-breakpoint
CREATE TABLE `group_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`level_id` text NOT NULL,
	`area_id` text NOT NULL,
	`per_head_rate` integer NOT NULL,
	`proposed_at` integer NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`confirmed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_group_proposals_tutor` ON `group_proposals` (`tutor_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_group_proposals_match` ON `group_proposals` (`subject_id`,`level_id`,`area_id`,`status`);--> statement-breakpoint
CREATE TABLE `group_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`student_profile_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`level_id` text NOT NULL,
	`board_id` text NOT NULL,
	`topics_json` text NOT NULL,
	`area_id` text NOT NULL,
	`area_flex` integer DEFAULT false NOT NULL,
	`gender_preference` text DEFAULT 'no_preference' NOT NULL,
	`max_group_size` integer NOT NULL,
	`budget_max` integer,
	`availability_json` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_group_requests_match` ON `group_requests` (`subject_id`,`level_id`,`board_id`,`area_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_group_requests_expiry` ON `group_requests` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_group_requests_student` ON `group_requests` (`student_profile_id`);--> statement-breakpoint
CREATE TABLE `unmet_demand` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`topic_ids_json` text NOT NULL,
	`level_id` text,
	`board_id` text,
	`area_id` text,
	`gender_preference` text DEFAULT 'no_preference' NOT NULL,
	`budget_max` integer,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_unmet_demand_rollup` ON `unmet_demand` (`subject_id`,`area_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_unmet_demand_area` ON `unmet_demand` (`area_id`,`level_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `platform_feedback` (
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
	`safety_concern_flag` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`disposition_note` text,
	`triaged_by` text,
	`triaged_at` integer,
	`mail_dispatch_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`triaged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_platform_feedback_queue` ON `platform_feedback` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_platform_feedback_safety` ON `platform_feedback` (`safety_concern_flag`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_platform_feedback_user` ON `platform_feedback` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_platform_feedback_category` ON `platform_feedback` (`category`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_platform_feedback_dispatch` ON `platform_feedback` (`mail_dispatch_status`);--> statement-breakpoint
CREATE TABLE `volunteer_applications` (
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
	`created_at` integer NOT NULL,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`converted_tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_volunteer_applications_queue` ON `volunteer_applications` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_volunteer_applications_email` ON `volunteer_applications` (`email`);--> statement-breakpoint
CREATE INDEX `idx_volunteer_applications_area` ON `volunteer_applications` (`city_id`,`area_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_volunteer_applications_dispatch` ON `volunteer_applications` (`mail_dispatch_status`);