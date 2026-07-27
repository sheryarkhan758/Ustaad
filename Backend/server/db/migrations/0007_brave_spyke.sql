CREATE TABLE `booking_slot_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`tutor_id` text NOT NULL,
	`slot_start` text NOT NULL,
	`slot_end` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutor_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_slot_reservations_booking_id_unique` ON `booking_slot_reservations` (`booking_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_slot_reservation_unique` ON `booking_slot_reservations` (`tutor_id`,`slot_start`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_slot_reservation_booking` ON `booking_slot_reservations` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_slot_reservation_range` ON `booking_slot_reservations` (`tutor_id`,`slot_start`,`slot_end`);--> statement-breakpoint
ALTER TABLE `tutor_profiles` ADD `volunteer_weekly_hours` integer;