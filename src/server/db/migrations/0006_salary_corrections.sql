DROP INDEX `employee_salaries_effective_idx`;--> statement-breakpoint
CREATE INDEX `employee_salaries_effective_idx` ON `employee_salaries` (`employee_id`,`effective_from`);--> statement-breakpoint
ALTER TABLE `payroll_inputs` ADD `salary_id` integer REFERENCES employee_salaries(id);