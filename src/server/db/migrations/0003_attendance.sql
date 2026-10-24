CREATE TABLE `comp_off_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`worked_date` text NOT NULL,
	`worked_minutes` integer NOT NULL,
	`days_requested` real NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`approver_id` integer,
	`decided_at` text,
	`decision_note` text,
	`resolution` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comp_off_claims_active_idx` ON `comp_off_claims` (`employee_id`,`worked_date`) WHERE "comp_off_claims"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE TABLE `comp_off_consumptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lot_id` integer NOT NULL,
	`leave_request_id` integer NOT NULL,
	`days` real NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `comp_off_lots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comp_off_consumptions_request_idx` ON `comp_off_consumptions` (`leave_request_id`);--> statement-breakpoint
CREATE TABLE `comp_off_lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`claim_id` integer,
	`days` real NOT NULL,
	`remaining` real NOT NULL,
	`earned_on` text NOT NULL,
	`expires_on` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`note` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `comp_off_claims`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `comp_off_lots_employee_idx` ON `comp_off_lots` (`employee_id`,`status`,`expires_on`);--> statement-breakpoint
CREATE TABLE `attendance_days` (
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`first_in` integer,
	`last_out` integer,
	`worked_minutes` integer DEFAULT 0 NOT NULL,
	`late_minutes` integer DEFAULT 0 NOT NULL,
	`early_minutes` integer DEFAULT 0 NOT NULL,
	`overtime_minutes` integer DEFAULT 0 NOT NULL,
	`off_day_worked` integer DEFAULT false NOT NULL,
	`leave_request_id` integer,
	`locked` integer DEFAULT false NOT NULL,
	`computed_at` text NOT NULL,
	`override_status` text,
	`override_by` integer,
	`override_note` text,
	`override_at` text,
	PRIMARY KEY(`employee_id`, `date`),
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`override_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `attendance_days_date_idx` ON `attendance_days` (`date`,`status`);--> statement-breakpoint
CREATE TABLE `attendance_punches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`at` text NOT NULL,
	`date` text NOT NULL,
	`direction` text NOT NULL,
	`work_mode` text DEFAULT 'office' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`ip` text,
	`note` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `attendance_punches_employee_date_idx` ON `attendance_punches` (`employee_id`,`date`);--> statement-breakpoint
CREATE TABLE `regularization_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`requested_in` integer NOT NULL,
	`requested_out` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`approver_id` integer,
	`decided_at` text,
	`decision_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `regularization_requests_employee_idx` ON `regularization_requests` (`employee_id`,`status`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`break_minutes` integer DEFAULT 60 NOT NULL,
	`grace_minutes` integer DEFAULT 15 NOT NULL,
	`half_day_minutes` integer DEFAULT 240 NOT NULL,
	`full_day_minutes` integer DEFAULT 480 NOT NULL,
	`weekly_offs` text NOT NULL,
	`attendance_mode` text DEFAULT 'punch' NOT NULL,
	`auto_clock_out_time` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_name_unique` ON `shifts` (`name`);--> statement-breakpoint
ALTER TABLE `employees` ADD `shift_id` integer REFERENCES shifts(id);