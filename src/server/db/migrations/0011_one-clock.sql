CREATE TABLE `clock_selections` (
	`employee_id` integer PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`task_category_id` integer NOT NULL,
	`notes` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_category_id`) REFERENCES `task_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `attendance_punches` ADD `starts_break` integer DEFAULT false NOT NULL;