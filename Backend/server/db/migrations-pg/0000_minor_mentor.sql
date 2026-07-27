CREATE TABLE "admin_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"detail_json" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reporter_user_id" text,
	"reason" text NOT NULL,
	"detail" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolution_note" text,
	"resolved_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_name" text NOT NULL,
	"org_type" text NOT NULL,
	"description" text,
	"website" text,
	"city_id" text NOT NULL,
	"area_id" text,
	"contact_email" text,
	"contact_phone" text,
	"approved_at" text,
	"approved_by" text,
	"created_at" text NOT NULL,
	CONSTRAINT "org_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "vacancies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"level_id" text NOT NULL,
	"board_id" text,
	"mode" text NOT NULL,
	"rate_offered" integer,
	"rate_type" text,
	"area_id" text,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacancy_interests" (
	"id" text PRIMARY KEY NOT NULL,
	"vacancy_id" text NOT NULL,
	"tutor_id" text NOT NULL,
	"status" text DEFAULT 'expressed' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"user_id" text,
	"student_profile_id" text,
	"goal" text,
	"transcript_json" text NOT NULL,
	"scratchpad_json" text,
	"status" text DEFAULT 'active' NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"model" text,
	"prompt_version" text,
	"is_demo_seed" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "ai_call_log" (
	"id" text PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"component" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_micros" integer DEFAULT 0 NOT NULL,
	"cache_hit" integer DEFAULT 0 NOT NULL,
	"failed_over" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostics" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_session_id" text NOT NULL,
	"student_profile_id" text,
	"subject_id" text,
	"gap_map_json" text NOT NULL,
	"insufficient_info_json" text NOT NULL,
	"matched_tutor_ids_json" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranking_explanations" (
	"id" text PRIMARY KEY NOT NULL,
	"tutor_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"score_hash" text NOT NULL,
	"breakdown_json" text NOT NULL,
	"narration" text NOT NULL,
	"lang" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"diagnostic_id" text NOT NULL,
	"student_profile_id" text,
	"level_id" text,
	"target_date" text,
	"plan_json" text NOT NULL,
	"prereq_validated" integer DEFAULT 0 NOT NULL,
	"model" text,
	"prompt_version" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_session_id" text NOT NULL,
	"tutor_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"items_json" text NOT NULL,
	"responses_json" text NOT NULL,
	"verdict" text NOT NULL,
	"score" real,
	"reasoning" text,
	"is_appeal" integer DEFAULT 0 NOT NULL,
	"admin_override" integer DEFAULT 0 NOT NULL,
	"override_reason" text,
	"model" text,
	"prompt_version" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" text NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	"replaced_by_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_slot_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"tutor_id" text NOT NULL,
	"slot_start" text NOT NULL,
	"slot_end" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "booking_slot_reservations_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"tutor_id" text NOT NULL,
	"student_profile_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"engagement_type" text NOT NULL,
	"session_purpose" text,
	"package_sessions_total" integer,
	"package_sessions_used" integer DEFAULT 0 NOT NULL,
	"subject_id" text NOT NULL,
	"level_id" text NOT NULL,
	"board_id" text NOT NULL,
	"topic_ids_json" text NOT NULL,
	"service_type_id" text,
	"mode" text NOT NULL,
	"area_id" text,
	"address_encrypted" text,
	"slot_start" text,
	"slot_end" text,
	"agreed_rate" integer,
	"rate_type" text,
	"travel_charge_agreed" integer DEFAULT 0 NOT NULL,
	"agreed_rate_snapshot_json" text,
	"is_trial" integer DEFAULT 0 NOT NULL,
	"guardian_presence_required" integer DEFAULT 0 NOT NULL,
	"group_id" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"status_changed_by" text,
	"status_changed_at" text,
	"requested_at" text NOT NULL,
	"responded_at" text,
	"confirmed_at" text,
	"completed_at" text,
	"cancelled_at" text,
	"cancel_reason" text,
	"decline_under_safety_constraint" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"tutor_id" text NOT NULL,
	"topics_covered_json" text NOT NULL,
	"mastery_ratings_json" text NOT NULL,
	"note" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_fit_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"submitted_by" text NOT NULL,
	"communication" integer NOT NULL,
	"punctuality" integer NOT NULL,
	"engagement" integer NOT NULL,
	"pace" integer NOT NULL,
	"continue_decision" integer NOT NULL,
	"note" text,
	"created_at" text NOT NULL,
	CONSTRAINT "trial_fit_checks_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "rate_benchmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"level_id" text NOT NULL,
	"area_id" text NOT NULL,
	"mode" text NOT NULL,
	"median_hourly" integer NOT NULL,
	"p25_hourly" integer,
	"p75_hourly" integer,
	"cohort_size" integer NOT NULL,
	"published" integer DEFAULT 0 NOT NULL,
	"verified_count" integer DEFAULT 0 NOT NULL,
	"computed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_reliability" (
	"tutor_id" text PRIMARY KEY NOT NULL,
	"median_response_mins" integer,
	"confirmation_rate" real,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"no_show_count" integer DEFAULT 0 NOT NULL,
	"cancellation_rate" real,
	"on_time_rate" real,
	"completion_rate" real,
	"safety_declines_excluded" integer DEFAULT 0 NOT NULL,
	"booking_basis" integer DEFAULT 0 NOT NULL,
	"computed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_scores" (
	"tutor_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"composite_score" real NOT NULL,
	"dimension_scores_json" text NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"weighted_review_count" real DEFAULT 0 NOT NULL,
	"competency_verified" integer DEFAULT 0 NOT NULL,
	"expires_on" text,
	"score_hash" text NOT NULL,
	"computed_at" text NOT NULL,
	CONSTRAINT "tutor_scores_tutor_id_topic_id_pk" PRIMARY KEY("tutor_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "tutor_search_signals" (
	"tutor_id" text PRIMARY KEY NOT NULL,
	"overall_score" real DEFAULT 0 NOT NULL,
	"best_topic_score" real DEFAULT 0 NOT NULL,
	"artefacts_checked_count" integer DEFAULT 0 NOT NULL,
	"verified_topic_count" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"weighted_review_count" real DEFAULT 0 NOT NULL,
	"last_active_at" text,
	"recency_score" real DEFAULT 0 NOT NULL,
	"min_normalised_hourly" integer,
	"computed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"dimensions_json" text NOT NULL,
	"credibility_json" text NOT NULL,
	"topics_mentioned_json" text NOT NULL,
	"safety_concern_flag" integer DEFAULT 0 NOT NULL,
	"safety_concern_reason" text,
	"generic_flag" integer DEFAULT 0 NOT NULL,
	"contradiction_flag" integer DEFAULT 0 NOT NULL,
	"detail_level" real DEFAULT 0 NOT NULL,
	"completed_sessions" integer DEFAULT 0 NOT NULL,
	"credibility_weight" real DEFAULT 1 NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "review_analyses_review_id_unique" UNIQUE("review_id")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"tutor_id" text NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"reviewer_role" text NOT NULL,
	"rating" integer NOT NULL,
	"text" text,
	"analysis_status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "reviews_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "parent_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"city_id" text,
	"area_id" text,
	"address_encrypted" text,
	"created_at" text NOT NULL,
	CONSTRAINT "parent_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_user_id" text,
	"self_user_id" text,
	"name" text NOT NULL,
	"gender" text,
	"level_id" text,
	"board_id" text,
	"school_name" text,
	"date_of_birth" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"display_name" text NOT NULL,
	"gender" text,
	"preferred_lang" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "area_adjacency" (
	"area_id" text NOT NULL,
	"adjacent_area_id" text NOT NULL,
	"travel_minutes" integer NOT NULL,
	CONSTRAINT "area_adjacency_area_id_adjacent_area_id_pk" PRIMARY KEY("area_id","adjacent_area_id")
);
--> statement-breakpoint
CREATE TABLE "areas" (
	"id" text PRIMARY KEY NOT NULL,
	"city_id" text NOT NULL,
	"name" text NOT NULL,
	"name_ur" text
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ur" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" text PRIMARY KEY NOT NULL,
	"province_id" text NOT NULL,
	"name" text NOT NULL,
	"name_ur" text
);
--> statement-breakpoint
CREATE TABLE "i18n_strings" (
	"key" text NOT NULL,
	"lang" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "i18n_strings_key_lang_pk" PRIMARY KEY("key","lang")
);
--> statement-breakpoint
CREATE TABLE "levels" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provinces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ur" text,
	"code" text NOT NULL,
	CONSTRAINT "provinces_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "service_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ur" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ur" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_prerequisites" (
	"topic_id" text NOT NULL,
	"prerequisite_topic_id" text NOT NULL,
	CONSTRAINT "topic_prerequisites_topic_id_prerequisite_topic_id_pk" PRIMARY KEY("topic_id","prerequisite_topic_id")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"level_id" text NOT NULL,
	"board_id" text NOT NULL,
	"name" text NOT NULL,
	"name_ur" text NOT NULL,
	"chapter_ref" text,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_availability" (
	"id" text PRIMARY KEY NOT NULL,
	"tutor_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"mode" text NOT NULL,
	"area_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tutor_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"storage_path" text NOT NULL,
	"uploaded_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"gender" text NOT NULL,
	"city_id" text NOT NULL,
	"bio" text,
	"bio_ur" text,
	"qualifications" text,
	"experience_years" integer DEFAULT 0 NOT NULL,
	"teaches_at_home" integer DEFAULT 0 NOT NULL,
	"teaches_online" integer DEFAULT 0 NOT NULL,
	"teaches_at_own_place" integer DEFAULT 0 NOT NULL,
	"willing_areas_json" text NOT NULL,
	"volunteer_flag" integer DEFAULT 0 NOT NULL,
	"volunteer_weekly_hours" integer,
	"profile_status" text DEFAULT 'draft' NOT NULL,
	"slug" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "tutor_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "tutor_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tutor_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"tutor_id" text NOT NULL,
	"subject_id" text,
	"level_id" text,
	"rate_type" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'PKR' NOT NULL,
	"sessions_per_week" integer,
	"minutes_per_session" integer,
	"mode" text NOT NULL,
	"group_size_max" integer,
	"per_head_amount" integer,
	"negotiable" integer DEFAULT 0 NOT NULL,
	"travel_charge" integer DEFAULT 0 NOT NULL,
	"normalised_hourly_amount" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_safety_constraints" (
	"id" text PRIMARY KEY NOT NULL,
	"tutor_id" text NOT NULL,
	"female_students_only" integer DEFAULT 0 NOT NULL,
	"guardian_presence_required" integer DEFAULT 0 NOT NULL,
	"restricted_area_ids_json" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "tutor_safety_constraints_tutor_id_unique" UNIQUE("tutor_id")
);
--> statement-breakpoint
CREATE TABLE "tutor_subject_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"tutor_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"level_id" text NOT NULL,
	"board_id" text NOT NULL,
	"topic_ids_json" text NOT NULL,
	"claim_status" text DEFAULT 'asserted' NOT NULL,
	"verified_at" text,
	"expires_on" text,
	"verified_score" real,
	"appeal_count" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cnic_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"tutor_id" text NOT NULL,
	"cnic_hash" text NOT NULL,
	"salt_version" text DEFAULT 'v1' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_dedupe" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"sent_at" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_path" text,
	"read_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_appeals" (
	"id" text PRIMARY KEY NOT NULL,
	"tutor_id" text NOT NULL,
	"track" text NOT NULL,
	"against_record_id" text NOT NULL,
	"claim_id" text,
	"tutor_reason" text NOT NULL,
	"eligible_from" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" text,
	"decision_reason" text,
	"decided_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_records" (
	"id" text PRIMARY KEY NOT NULL,
	"tutor_id" text NOT NULL,
	"track" text NOT NULL,
	"decision" text NOT NULL,
	"artefacts_checked_json" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" text NOT NULL,
	"reason" text NOT NULL,
	"expires_on" text,
	"claim_id" text,
	"supersedes_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_record_id" text NOT NULL,
	"raised_by" text NOT NULL,
	"raised_by_party" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolution_reason" text,
	"resolved_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"cycle_label" text NOT NULL,
	"agreed_amount" integer NOT NULL,
	"travel_charge" integer DEFAULT 0 NOT NULL,
	"rate_type" text NOT NULL,
	"engagement_type" text NOT NULL,
	"family_marked_paid_at" text,
	"tutor_confirmed_at" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"proposal_id" text NOT NULL,
	"group_request_id" text NOT NULL,
	"student_profile_id" text NOT NULL,
	"explanation_json" text NOT NULL,
	"booking_id" text,
	"confirmed_at" text,
	"declined_at" text,
	CONSTRAINT "group_members_proposal_id_group_request_id_pk" PRIMARY KEY("proposal_id","group_request_id")
);
--> statement-breakpoint
CREATE TABLE "group_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"tutor_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"level_id" text NOT NULL,
	"board_id" text NOT NULL,
	"area_id" text NOT NULL,
	"topic_ids_json" text NOT NULL,
	"availability_json" text NOT NULL,
	"gender_preference" text DEFAULT 'no_preference' NOT NULL,
	"group_key" text NOT NULL,
	"per_head_rate" integer NOT NULL,
	"proposed_at" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"tutor_accepted_at" text,
	"confirmed_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"student_profile_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"level_id" text NOT NULL,
	"board_id" text NOT NULL,
	"topics_json" text NOT NULL,
	"area_id" text NOT NULL,
	"area_flex" integer DEFAULT 0 NOT NULL,
	"gender_preference" text DEFAULT 'no_preference' NOT NULL,
	"max_group_size" integer NOT NULL,
	"budget_max" integer,
	"availability_json" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unmet_demand" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"topic_ids_json" text NOT NULL,
	"level_id" text,
	"board_id" text,
	"area_id" text,
	"gender_preference" text DEFAULT 'no_preference' NOT NULL,
	"budget_max" integer,
	"reason" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"role" text,
	"category" text NOT NULL,
	"detail" text NOT NULL,
	"satisfaction_rating" integer,
	"page_path" text,
	"locale" text,
	"app_version" text,
	"attachment_path" text,
	"safety_concern_flag" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"disposition_note" text,
	"triaged_by" text,
	"triaged_at" text,
	"mail_dispatch_status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volunteer_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"city_id" text,
	"area_id" text,
	"gender" text,
	"subjects_json" text NOT NULL,
	"levels_json" text NOT NULL,
	"weekly_hours" integer,
	"delivery_modes_json" text NOT NULL,
	"motivation" text,
	"document_path" text,
	"status" text DEFAULT 'received' NOT NULL,
	"mail_dispatch_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"review_note" text,
	"converted_tutor_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_profiles" ADD CONSTRAINT "org_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_profiles" ADD CONSTRAINT "org_profiles_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_profiles" ADD CONSTRAINT "org_profiles_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_profiles" ADD CONSTRAINT "org_profiles_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_org_id_org_profiles_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_interests" ADD CONSTRAINT "vacancy_interests_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_interests" ADD CONSTRAINT "vacancy_interests_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_explanations" ADD CONSTRAINT "ranking_explanations_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_explanations" ADD CONSTRAINT "ranking_explanations_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_diagnostic_id_diagnostics_id_fk" FOREIGN KEY ("diagnostic_id") REFERENCES "public"."diagnostics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slot_reservations" ADD CONSTRAINT "booking_slot_reservations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slot_reservations" ADD CONSTRAINT "booking_slot_reservations_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_fit_checks" ADD CONSTRAINT "trial_fit_checks_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_fit_checks" ADD CONSTRAINT "trial_fit_checks_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_benchmarks" ADD CONSTRAINT "rate_benchmarks_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_benchmarks" ADD CONSTRAINT "rate_benchmarks_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_benchmarks" ADD CONSTRAINT "rate_benchmarks_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_reliability" ADD CONSTRAINT "tutor_reliability_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_scores" ADD CONSTRAINT "tutor_scores_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_scores" ADD CONSTRAINT "tutor_scores_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_search_signals" ADD CONSTRAINT "tutor_search_signals_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_analyses" ADD CONSTRAINT "review_analyses_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_profiles" ADD CONSTRAINT "parent_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_profiles" ADD CONSTRAINT "parent_profiles_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_profiles" ADD CONSTRAINT "parent_profiles_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_self_user_id_users_id_fk" FOREIGN KEY ("self_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_adjacency" ADD CONSTRAINT "area_adjacency_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_adjacency" ADD CONSTRAINT "area_adjacency_adjacent_area_id_areas_id_fk" FOREIGN KEY ("adjacent_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_prerequisites" ADD CONSTRAINT "topic_prerequisites_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_prerequisites" ADD CONSTRAINT "topic_prerequisites_prerequisite_topic_id_topics_id_fk" FOREIGN KEY ("prerequisite_topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_availability" ADD CONSTRAINT "tutor_availability_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_availability" ADD CONSTRAINT "tutor_availability_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_documents" ADD CONSTRAINT "tutor_documents_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_profiles" ADD CONSTRAINT "tutor_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_profiles" ADD CONSTRAINT "tutor_profiles_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_rates" ADD CONSTRAINT "tutor_rates_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_rates" ADD CONSTRAINT "tutor_rates_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_rates" ADD CONSTRAINT "tutor_rates_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_safety_constraints" ADD CONSTRAINT "tutor_safety_constraints_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_subject_claims" ADD CONSTRAINT "tutor_subject_claims_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_subject_claims" ADD CONSTRAINT "tutor_subject_claims_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_subject_claims" ADD CONSTRAINT "tutor_subject_claims_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_subject_claims" ADD CONSTRAINT "tutor_subject_claims_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnic_registrations" ADD CONSTRAINT "cnic_registrations_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_dedupe" ADD CONSTRAINT "notification_dedupe_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_appeals" ADD CONSTRAINT "verification_appeals_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_appeals" ADD CONSTRAINT "verification_appeals_against_record_id_verification_records_id_fk" FOREIGN KEY ("against_record_id") REFERENCES "public"."verification_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_appeals" ADD CONSTRAINT "verification_appeals_claim_id_tutor_subject_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."tutor_subject_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_appeals" ADD CONSTRAINT "verification_appeals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_claim_id_tutor_subject_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."tutor_subject_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_payment_record_id_payment_records_id_fk" FOREIGN KEY ("payment_record_id") REFERENCES "public"."payment_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_proposal_id_group_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."group_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_request_id_group_requests_id_fk" FOREIGN KEY ("group_request_id") REFERENCES "public"."group_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_proposals" ADD CONSTRAINT "group_proposals_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_proposals" ADD CONSTRAINT "group_proposals_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_proposals" ADD CONSTRAINT "group_proposals_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_proposals" ADD CONSTRAINT "group_proposals_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_proposals" ADD CONSTRAINT "group_proposals_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_requests" ADD CONSTRAINT "group_requests_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_requests" ADD CONSTRAINT "group_requests_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_requests" ADD CONSTRAINT "group_requests_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_requests" ADD CONSTRAINT "group_requests_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_requests" ADD CONSTRAINT "group_requests_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmet_demand" ADD CONSTRAINT "unmet_demand_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmet_demand" ADD CONSTRAINT "unmet_demand_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmet_demand" ADD CONSTRAINT "unmet_demand_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmet_demand" ADD CONSTRAINT "unmet_demand_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD CONSTRAINT "platform_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD CONSTRAINT "platform_feedback_triaged_by_users_id_fk" FOREIGN KEY ("triaged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_applications" ADD CONSTRAINT "volunteer_applications_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_applications" ADD CONSTRAINT "volunteer_applications_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_applications" ADD CONSTRAINT "volunteer_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_applications" ADD CONSTRAINT "volunteer_applications_converted_tutor_id_tutor_profiles_id_fk" FOREIGN KEY ("converted_tutor_id") REFERENCES "public"."tutor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_actions_actor" ON "admin_actions" USING btree ("admin_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_admin_actions_target" ON "admin_actions" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_admin_actions_action" ON "admin_actions" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "idx_flags_queue" ON "flags" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_flags_target" ON "flags" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_flags_reporter" ON "flags" USING btree ("reporter_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_org_profiles_user" ON "org_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_org_profiles_approval" ON "org_profiles" USING btree ("approved_at","created_at");--> statement-breakpoint
CREATE INDEX "idx_vacancies_org" ON "vacancies" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "idx_vacancies_browse" ON "vacancies" USING btree ("status","subject_id","level_id","area_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_vacancy_interests_unique" ON "vacancy_interests" USING btree ("vacancy_id","tutor_id");--> statement-breakpoint
CREATE INDEX "idx_vacancy_interests_vacancy" ON "vacancy_interests" USING btree ("vacancy_id","status");--> statement-breakpoint
CREATE INDEX "idx_vacancy_interests_tutor" ON "vacancy_interests" USING btree ("tutor_id");--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_user" ON "agent_sessions" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_type_status" ON "agent_sessions" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_demo" ON "agent_sessions" USING btree ("is_demo_seed","type");--> statement-breakpoint
CREATE INDEX "idx_ai_call_log_day" ON "ai_call_log" USING btree ("day","cache_hit");--> statement-breakpoint
CREATE INDEX "idx_ai_call_log_component" ON "ai_call_log" USING btree ("component","day");--> statement-breakpoint
CREATE INDEX "idx_diagnostics_session" ON "diagnostics" USING btree ("agent_session_id");--> statement-breakpoint
CREATE INDEX "idx_diagnostics_student" ON "diagnostics" USING btree ("student_profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ranking_explanations_cache" ON "ranking_explanations" USING btree ("tutor_id","topic_id","score_hash","lang");--> statement-breakpoint
CREATE INDEX "idx_study_plans_diagnostic" ON "study_plans" USING btree ("diagnostic_id");--> statement-breakpoint
CREATE INDEX "idx_study_plans_student" ON "study_plans" USING btree ("student_profile_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_verification_tutor_topic" ON "verification_attempts" USING btree ("tutor_id","topic_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_verification_session" ON "verification_attempts" USING btree ("agent_session_id");--> statement-breakpoint
CREATE INDEX "idx_verification_appeals" ON "verification_attempts" USING btree ("is_appeal","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_refresh_tokens_hash" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_family" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_slot_reservation_unique" ON "booking_slot_reservations" USING btree ("tutor_id","slot_start");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_slot_reservation_booking" ON "booking_slot_reservations" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "idx_slot_reservation_range" ON "booking_slot_reservations" USING btree ("tutor_id","slot_start","slot_end");--> statement-breakpoint
CREATE INDEX "idx_bookings_tutor_status" ON "bookings" USING btree ("tutor_id","status");--> statement-breakpoint
CREATE INDEX "idx_bookings_requester" ON "bookings" USING btree ("requested_by_user_id","status");--> statement-breakpoint
CREATE INDEX "idx_bookings_student" ON "bookings" USING btree ("student_profile_id","status");--> statement-breakpoint
CREATE INDEX "idx_bookings_slot" ON "bookings" USING btree ("tutor_id","slot_start","slot_end");--> statement-breakpoint
CREATE INDEX "idx_bookings_group" ON "bookings" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_bookings_status_requested" ON "bookings" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "idx_session_notes_booking" ON "session_notes" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "idx_session_notes_tutor" ON "session_notes" USING btree ("tutor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_trial_fit_checks_booking" ON "trial_fit_checks" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "idx_trial_fit_checks_submitter" ON "trial_fit_checks" USING btree ("submitted_by");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rate_benchmarks_cell" ON "rate_benchmarks" USING btree ("subject_id","level_id","area_id","mode");--> statement-breakpoint
CREATE INDEX "idx_rate_benchmarks_cohort" ON "rate_benchmarks" USING btree ("cohort_size");--> statement-breakpoint
CREATE INDEX "idx_tutor_reliability_computed" ON "tutor_reliability" USING btree ("computed_at");--> statement-breakpoint
CREATE INDEX "idx_tutor_scores_ranking" ON "tutor_scores" USING btree ("topic_id","composite_score");--> statement-breakpoint
CREATE INDEX "idx_tutor_scores_hash" ON "tutor_scores" USING btree ("score_hash");--> statement-breakpoint
CREATE INDEX "idx_tutor_scores_topic_verified" ON "tutor_scores" USING btree ("topic_id","competency_verified","composite_score");--> statement-breakpoint
CREATE INDEX "idx_search_signals_overall" ON "tutor_search_signals" USING btree ("overall_score");--> statement-breakpoint
CREATE INDEX "idx_search_signals_price" ON "tutor_search_signals" USING btree ("min_normalised_hourly");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_review_analyses_review" ON "review_analyses" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "idx_review_analyses_hash" ON "review_analyses" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "idx_review_analyses_safety" ON "review_analyses" USING btree ("safety_concern_flag","created_at");--> statement-breakpoint
CREATE INDEX "idx_review_analyses_flags" ON "review_analyses" USING btree ("contradiction_flag","generic_flag");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_reviews_booking" ON "reviews" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "idx_reviews_tutor" ON "reviews" USING btree ("tutor_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_reviews_reviewer" ON "reviews" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_parent_profiles_user" ON "parent_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_parent_profiles_area" ON "parent_profiles" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "idx_student_profiles_parent" ON "student_profiles" USING btree ("parent_user_id");--> statement-breakpoint
CREATE INDEX "idx_student_profiles_self" ON "student_profiles" USING btree ("self_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_role_status" ON "users" USING btree ("role","status");--> statement-breakpoint
CREATE INDEX "idx_area_adjacency_adjacent" ON "area_adjacency" USING btree ("adjacent_area_id");--> statement-breakpoint
CREATE INDEX "idx_areas_city" ON "areas" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "idx_cities_province" ON "cities" USING btree ("province_id");--> statement-breakpoint
CREATE INDEX "idx_i18n_lang" ON "i18n_strings" USING btree ("lang");--> statement-breakpoint
CREATE INDEX "idx_levels_sort" ON "levels" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "idx_topic_prereq_prerequisite" ON "topic_prerequisites" USING btree ("prerequisite_topic_id");--> statement-breakpoint
CREATE INDEX "idx_topics_curriculum" ON "topics" USING btree ("subject_id","level_id","board_id");--> statement-breakpoint
CREATE INDEX "idx_topics_subject" ON "topics" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "idx_availability_tutor" ON "tutor_availability" USING btree ("tutor_id","weekday");--> statement-breakpoint
CREATE INDEX "idx_availability_area" ON "tutor_availability" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "idx_documents_tutor" ON "tutor_documents" USING btree ("tutor_id","doc_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tutor_profiles_user" ON "tutor_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tutor_profiles_slug" ON "tutor_profiles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_tutor_profiles_search" ON "tutor_profiles" USING btree ("profile_status","gender","city_id");--> statement-breakpoint
CREATE INDEX "idx_rates_tutor" ON "tutor_rates" USING btree ("tutor_id");--> statement-breakpoint
CREATE INDEX "idx_rates_normalised" ON "tutor_rates" USING btree ("subject_id","level_id","normalised_hourly_amount");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_safety_tutor" ON "tutor_safety_constraints" USING btree ("tutor_id");--> statement-breakpoint
CREATE INDEX "idx_claims_tutor" ON "tutor_subject_claims" USING btree ("tutor_id");--> statement-breakpoint
CREATE INDEX "idx_claims_curriculum" ON "tutor_subject_claims" USING btree ("subject_id","level_id","board_id","claim_status");--> statement-breakpoint
CREATE INDEX "idx_cnic_registrations_hash" ON "cnic_registrations" USING btree ("cnic_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cnic_registrations_tutor" ON "cnic_registrations" USING btree ("tutor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_notification_dedupe_key" ON "notification_dedupe" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_kind" ON "notifications" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "idx_appeals_queue" ON "verification_appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_appeals_against_record" ON "verification_appeals" USING btree ("against_record_id");--> statement-breakpoint
CREATE INDEX "idx_appeals_tutor" ON "verification_appeals" USING btree ("tutor_id","status");--> statement-breakpoint
CREATE INDEX "idx_verification_records_tutor" ON "verification_records" USING btree ("tutor_id","track","decided_at");--> statement-breakpoint
CREATE INDEX "idx_verification_records_expiry" ON "verification_records" USING btree ("track","decision","expires_on");--> statement-breakpoint
CREATE INDEX "idx_verification_records_admin" ON "verification_records" USING btree ("decided_by","decided_at");--> statement-breakpoint
CREATE INDEX "idx_payment_disputes_record" ON "payment_disputes" USING btree ("payment_record_id");--> statement-breakpoint
CREATE INDEX "idx_payment_disputes_status" ON "payment_disputes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_payment_disputes_raiser" ON "payment_disputes" USING btree ("raised_by","status");--> statement-breakpoint
CREATE INDEX "idx_payment_records_booking" ON "payment_records" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "idx_payment_records_status" ON "payment_records" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_group_members_request" ON "group_members" USING btree ("group_request_id");--> statement-breakpoint
CREATE INDEX "idx_group_members_student" ON "group_members" USING btree ("student_profile_id");--> statement-breakpoint
CREATE INDEX "idx_group_proposals_tutor" ON "group_proposals" USING btree ("tutor_id","status");--> statement-breakpoint
CREATE INDEX "idx_group_proposals_match" ON "group_proposals" USING btree ("subject_id","level_id","area_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_group_proposals_key" ON "group_proposals" USING btree ("tutor_id","group_key");--> statement-breakpoint
CREATE INDEX "idx_group_requests_match" ON "group_requests" USING btree ("subject_id","level_id","board_id","area_id","status");--> statement-breakpoint
CREATE INDEX "idx_group_requests_expiry" ON "group_requests" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_group_requests_student" ON "group_requests" USING btree ("student_profile_id");--> statement-breakpoint
CREATE INDEX "idx_unmet_demand_rollup" ON "unmet_demand" USING btree ("subject_id","area_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_unmet_demand_area" ON "unmet_demand" USING btree ("area_id","level_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_platform_feedback_queue" ON "platform_feedback" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_platform_feedback_safety" ON "platform_feedback" USING btree ("safety_concern_flag","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_platform_feedback_user" ON "platform_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_platform_feedback_category" ON "platform_feedback" USING btree ("category","created_at");--> statement-breakpoint
CREATE INDEX "idx_platform_feedback_dispatch" ON "platform_feedback" USING btree ("mail_dispatch_status");--> statement-breakpoint
CREATE INDEX "idx_volunteer_applications_queue" ON "volunteer_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_volunteer_applications_email" ON "volunteer_applications" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_volunteer_applications_area" ON "volunteer_applications" USING btree ("city_id","area_id","status");--> statement-breakpoint
CREATE INDEX "idx_volunteer_applications_dispatch" ON "volunteer_applications" USING btree ("mail_dispatch_status");