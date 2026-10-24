ALTER TABLE `users` ADD `email_mode` text DEFAULT 'instant' NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `email_status` text DEFAULT 'skipped' NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `email_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `emailed_at` text;--> statement-breakpoint
CREATE INDEX `notifications_email_idx` ON `notifications` (`email_status`,`created_at`);