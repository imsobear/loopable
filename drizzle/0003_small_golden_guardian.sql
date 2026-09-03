CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`source_url` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_repo` text NOT NULL,
	`source_number` integer NOT NULL,
	`source_title` text NOT NULL,
	`dry_run` integer DEFAULT false NOT NULL,
	`agent_id` text,
	`agent_command` text,
	`output` text,
	`action_id` text NOT NULL,
	`result_url` text,
	`error` text,
	`duration_ms` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_rule_idx` ON `tasks` (`rule_id`);--> statement-breakpoint
CREATE INDEX `tasks_created_idx` ON `tasks` (`created_at`);