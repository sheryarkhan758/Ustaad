ALTER TABLE `org_profiles` ADD `city_id` text NOT NULL REFERENCES cities(id);--> statement-breakpoint
ALTER TABLE `org_profiles` ADD `area_id` text REFERENCES areas(id);--> statement-breakpoint
ALTER TABLE `org_profiles` ADD `contact_email` text;--> statement-breakpoint
ALTER TABLE `org_profiles` ADD `contact_phone` text;