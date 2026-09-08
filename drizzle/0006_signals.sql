CREATE TABLE `signals` (
	`rule_id` text NOT NULL,
	`key` text NOT NULL,
	`outcome` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_repo` text NOT NULL,
	`source_number` integer NOT NULL,
	`source_title` text NOT NULL,
	`source_url` text NOT NULL,
	`task_id` text,
	`seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`rule_id`, `key`),
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `signals_outcome_idx` ON `signals` (`rule_id`,`outcome`);--> statement-breakpoint
ALTER TABLE `rules` ADD `polled_at` integer;--> statement-breakpoint
ALTER TABLE `rules` ADD `poll_error` text;
