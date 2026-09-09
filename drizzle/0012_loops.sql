PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `rules` RENAME TO `loops`;--> statement-breakpoint
DROP INDEX IF EXISTS `rules_priority_idx`;--> statement-breakpoint
CREATE INDEX `loops_priority_idx` ON `loops` (`priority`);--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`loop_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`source_url` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_ref` text NOT NULL,
	`source_payload` text,
	`source_title` text,
	`dry_run` integer DEFAULT false NOT NULL,
	`agent_id` text,
	`agent_command` text,
	`output` text,
	`comments` text,
	`action_id` text NOT NULL,
	`result_url` text,
	`error` text,
	`log_path` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`lease_until` integer,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`dedupe_key` text,
	`duration_ms` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`loop_id`) REFERENCES `loops`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_tasks` (`id`, `loop_id`, `connector_id`, `state`, `source_url`, `source_kind`, `source_ref`, `source_payload`, `source_title`, `dry_run`, `agent_id`, `agent_command`, `output`, `comments`, `action_id`, `result_url`, `error`, `log_path`, `attempts`, `run_after`, `lease_until`, `cancel_requested`, `dedupe_key`, `duration_ms`, `created_at`, `started_at`, `updated_at`)
SELECT `id`, `rule_id`, `connector_id`, `state`, `source_url`, `source_kind`, `source_ref`, `source_payload`, `source_title`, `dry_run`, `agent_id`, `agent_command`, `output`, `comments`, `action_id`, `result_url`, `error`, `log_path`, `attempts`, `run_after`, `lease_until`, `cancel_requested`, `dedupe_key`, `duration_ms`, `created_at`, `started_at`, `updated_at` FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE INDEX `tasks_loop_idx` ON `tasks` (`loop_id`);--> statement-breakpoint
CREATE INDEX `tasks_created_idx` ON `tasks` (`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_claim_idx` ON `tasks` (`state`,`run_after`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_dedupe_idx` ON `tasks` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `__new_signals` (
	`loop_id` text NOT NULL,
	`key` text NOT NULL,
	`outcome` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_ref` text NOT NULL,
	`source_payload` text,
	`source_title` text NOT NULL,
	`source_url` text NOT NULL,
	`hold` text,
	`task_id` text,
	`seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`loop_id`, `key`),
	FOREIGN KEY (`loop_id`) REFERENCES `loops`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_signals` (`loop_id`, `key`, `outcome`, `source_kind`, `source_ref`, `source_payload`, `source_title`, `source_url`, `hold`, `task_id`, `seen_at`)
SELECT `rule_id`, `key`, `outcome`, `source_kind`, `source_ref`, `source_payload`, `source_title`, `source_url`, `hold`, `task_id`, `seen_at` FROM `signals`;--> statement-breakpoint
DROP TABLE `signals`;--> statement-breakpoint
ALTER TABLE `__new_signals` RENAME TO `signals`;--> statement-breakpoint
CREATE INDEX `signals_outcome_idx` ON `signals` (`loop_id`,`outcome`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
