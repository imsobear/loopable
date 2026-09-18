-- Inbox prompt runs have no loop. SQLite cannot drop NOT NULL, so rebuild.
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`loop_id` text,
	`connector_id` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`source_url` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_ref` text NOT NULL,
	`source_payload` text,
	`source_title` text,
	`prompt` text,
	`dry_run` integer DEFAULT false NOT NULL,
	`agent_id` text,
	`runner_id` text,
	`agent_command` text,
	`output` text,
	`comments` text,
	`action_connector_id` text NOT NULL,
	`action_id` text NOT NULL,
	`action_target` text DEFAULT '{}' NOT NULL,
	`result_url` text,
	`error` text,
	`log_path` text,
	`log_text` text DEFAULT '' NOT NULL,
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
INSERT INTO `__new_tasks` (`id`, `loop_id`, `connector_id`, `state`, `source_url`, `source_kind`, `source_ref`, `source_payload`, `source_title`, `dry_run`, `agent_id`, `runner_id`, `agent_command`, `output`, `comments`, `action_connector_id`, `action_id`, `action_target`, `result_url`, `error`, `log_path`, `log_text`, `attempts`, `run_after`, `lease_until`, `cancel_requested`, `dedupe_key`, `duration_ms`, `created_at`, `started_at`, `updated_at`)
SELECT `id`, `loop_id`, `connector_id`, `state`, `source_url`, `source_kind`, `source_ref`, `source_payload`, `source_title`, `dry_run`, `agent_id`, `runner_id`, `agent_command`, `output`, `comments`, `action_connector_id`, `action_id`, `action_target`, `result_url`, `error`, `log_path`, `log_text`, `attempts`, `run_after`, `lease_until`, `cancel_requested`, `dedupe_key`, `duration_ms`, `created_at`, `started_at`, `updated_at` FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE INDEX `tasks_loop_idx` ON `tasks` (`loop_id`);--> statement-breakpoint
CREATE INDEX `tasks_created_idx` ON `tasks` (`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_claim_idx` ON `tasks` (`state`,`run_after`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_dedupe_idx` ON `tasks` (`dedupe_key`);
