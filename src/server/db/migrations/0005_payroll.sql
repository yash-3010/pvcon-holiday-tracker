CREATE TABLE `employee_salaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`effective_from` text NOT NULL,
	`annual_ctc` integer NOT NULL,
	`structure_id` integer NOT NULL,
	`overrides` text NOT NULL,
	`reason` text,
	`created_by` integer,
	`approved_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`structure_id`) REFERENCES `salary_structures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_salaries_effective_idx` ON `employee_salaries` (`employee_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `expense_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`category` text NOT NULL,
	`claim_date` text NOT NULL,
	`amount` integer NOT NULL,
	`description` text NOT NULL,
	`receipt_file_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` text,
	`approver_id` integer,
	`approved_at` text,
	`decision_note` text,
	`finance_by` integer,
	`paid_run_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receipt_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`finance_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`paid_run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `expense_claims_employee_idx` ON `expense_claims` (`employee_id`,`status`);--> statement-breakpoint
CREATE INDEX `expense_claims_status_idx` ON `expense_claims` (`status`);--> statement-breakpoint
CREATE TABLE `loan_repayments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`payslip_id` integer,
	`period` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `loan_repayments_loan_idx` ON `loan_repayments` (`loan_id`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`type` text DEFAULT 'loan' NOT NULL,
	`principal` integer NOT NULL,
	`emi` integer NOT NULL,
	`start_period` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`note` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `loans_employee_idx` ON `loans` (`employee_id`,`status`);--> statement-breakpoint
CREATE TABLE `payroll_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`component_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`label` text NOT NULL,
	`note` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_id` integer,
	`created_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_id`) REFERENCES `salary_components`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `payroll_inputs_run_idx` ON `payroll_inputs` (`run_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `payroll_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`period` text NOT NULL,
	`type` text DEFAULT 'regular' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text,
	`warnings` text DEFAULT '[]' NOT NULL,
	`created_by` integer,
	`computed_by` integer,
	`computed_at` text,
	`approved_by` integer,
	`approved_at` text,
	`released_at` text,
	`paid_at` text,
	`paid_on` text,
	`payment_ref` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`computed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payroll_runs_regular_period_idx` ON `payroll_runs` (`period`) WHERE "payroll_runs"."type" = 'regular' and "payroll_runs"."status" != 'cancelled';--> statement-breakpoint
CREATE TABLE `payslip_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payslip_id` integer NOT NULL,
	`component_code` text NOT NULL,
	`component_name` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`rate_amount` integer,
	`explanation` text,
	`source` text DEFAULT 'component' NOT NULL,
	`show_on_payslip` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payslip_lines_payslip_idx` ON `payslip_lines` (`payslip_id`);--> statement-breakpoint
CREATE TABLE `payslip_verifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payslip_id` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`amount_checked` integer DEFAULT false NOT NULL,
	`matched` integer,
	`at` text NOT NULL,
	FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payslip_verifications_payslip_idx` ON `payslip_verifications` (`payslip_id`);--> statement-breakpoint
CREATE TABLE `payslips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`salary_id` integer,
	`paid_basis_salary_id` integer,
	`snapshot` text NOT NULL,
	`variables` text NOT NULL,
	`total_days` real DEFAULT 0 NOT NULL,
	`working_days` real DEFAULT 0 NOT NULL,
	`paid_days` real DEFAULT 0 NOT NULL,
	`lop_days` real DEFAULT 0 NOT NULL,
	`gross_earnings` integer DEFAULT 0 NOT NULL,
	`total_deductions` integer DEFAULT 0 NOT NULL,
	`employer_contributions` integer DEFAULT 0 NOT NULL,
	`reimbursements` integer DEFAULT 0 NOT NULL,
	`net_pay` integer DEFAULT 0 NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL,
	`error` text,
	`released_at` text,
	`emailed_at` text,
	`pdf_file_id` integer,
	`pdf_sha256` text,
	`verification_code` text,
	`signed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`salary_id`) REFERENCES `employee_salaries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`paid_basis_salary_id`) REFERENCES `employee_salaries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`pdf_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payslips_verification_code_unique` ON `payslips` (`verification_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `payslips_run_employee_idx` ON `payslips` (`run_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `payslips_employee_idx` ON `payslips` (`employee_id`);--> statement-breakpoint
CREATE TABLE `salary_components` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`calc` text NOT NULL,
	`default_value` integer,
	`percent_of` text,
	`percent` integer,
	`formula` text,
	`prorate` integer DEFAULT true NOT NULL,
	`round` text DEFAULT 'nearest' NOT NULL,
	`show_on_payslip` integer DEFAULT true NOT NULL,
	`taxable_label` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`system` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `salary_components_code_unique` ON `salary_components` (`code`);--> statement-breakpoint
CREATE TABLE `salary_structure_components` (
	`structure_id` integer NOT NULL,
	`component_id` integer NOT NULL,
	`value` integer,
	`percent` integer,
	`formula` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`structure_id`, `component_id`),
	FOREIGN KEY (`structure_id`) REFERENCES `salary_structures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_id`) REFERENCES `salary_components`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `salary_structures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `salary_structures_name_unique` ON `salary_structures` (`name`);--> statement-breakpoint
ALTER TABLE `comp_off_claims` ADD `paid_run_id` integer;