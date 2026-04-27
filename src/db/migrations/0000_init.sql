CREATE TABLE `holiday_selections` (
	`user_id` integer NOT NULL,
	`holiday_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `holiday_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`holiday_id`) REFERENCES `holidays`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `holidays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holidays_year_date_idx` ON `holidays` (`year`,`date`);--> statement-breakpoint
CREATE TABLE `leave_policy` (
	`year` integer PRIMARY KEY NOT NULL,
	`casual_per_year` integer DEFAULT 12 NOT NULL,
	`sick_per_year` integer DEFAULT 6 NOT NULL,
	`carry_fwd_max` integer DEFAULT 6 NOT NULL,
	`max_consecutive_days` integer DEFAULT 3 NOT NULL,
	`optional_holidays_allowed` integer DEFAULT 6 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `leaves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`days` real NOT NULL,
	`type` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_year_balance` (
	`user_id` integer NOT NULL,
	`year` integer NOT NULL,
	`carry_forward_cl` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `year`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'employee' NOT NULL,
	`joined_date` text NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);