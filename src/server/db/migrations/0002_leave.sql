CREATE TABLE `holiday_selections` (
	`employee_id` integer NOT NULL,
	`holiday_id` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`employee_id`, `holiday_id`),
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`holiday_id`) REFERENCES `holidays`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `holiday_year_config` (
	`year` integer PRIMARY KEY NOT NULL,
	`optional_allowed` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holidays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holidays_year_date_idx` ON `holidays` (`year`,`date`);--> statement-breakpoint
CREATE TABLE `leave_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`leave_type_id` integer NOT NULL,
	`year` integer NOT NULL,
	`date` text NOT NULL,
	`delta` real NOT NULL,
	`kind` text NOT NULL,
	`ref_type` text,
	`ref_id` integer,
	`note` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `leave_ledger_balance_idx` ON `leave_ledger` (`employee_id`,`leave_type_id`,`year`);--> statement-breakpoint
CREATE INDEX `leave_ledger_ref_idx` ON `leave_ledger` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `leave_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`leave_type_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`start_half` text DEFAULT 'full' NOT NULL,
	`end_half` text DEFAULT 'full' NOT NULL,
	`days` real NOT NULL,
	`reason` text,
	`attachment_file_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`approver_id` integer,
	`decided_at` text,
	`decision_note` text,
	`applied_by` integer,
	`cancelled_by` integer,
	`cancelled_at` text,
	`cancel_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`applied_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `leave_requests_employee_idx` ON `leave_requests` (`employee_id`,`status`);--> statement-breakpoint
CREATE INDEX `leave_requests_status_idx` ON `leave_requests` (`status`,`start_date`);--> statement-breakpoint
CREATE TABLE `leave_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`paid` integer DEFAULT true NOT NULL,
	`is_lop` integer DEFAULT false NOT NULL,
	`accrual` text DEFAULT 'upfront' NOT NULL,
	`annual_quota` real DEFAULT 0 NOT NULL,
	`carry_forward_max` real DEFAULT 0 NOT NULL,
	`encashable` integer DEFAULT false NOT NULL,
	`allow_half_day` integer DEFAULT true NOT NULL,
	`allow_negative` integer DEFAULT false NOT NULL,
	`max_consecutive_days` integer,
	`min_notice_days` integer DEFAULT 0 NOT NULL,
	`attachment_after_days` real,
	`count_weekends` integer DEFAULT false NOT NULL,
	`applicable_employment_types` text,
	`is_comp_off` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leave_types_code_unique` ON `leave_types` (`code`);