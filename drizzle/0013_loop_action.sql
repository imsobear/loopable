-- Hand-written: the generated version was three `ADD COLUMN ... NOT NULL` with
-- no default, which SQLite refuses outright. Both tables are rebuilt instead,
-- and the action every row already had is written into the new columns: every
-- loop so far wrote back to the connector it watched, which is exactly what
-- `action_connector_id = connector_id` says. `legacy_alter_table` is on for the
-- rename because `tasks` and `signals` point at `loops`, and without it SQLite
-- reads their definitions mid-rename and objects to a table that is, for that
-- moment, not there.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
PRAGMA legacy_alter_table=ON;--> statement-breakpoint
CREATE TABLE `__new_loops` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer NOT NULL,
	`connector_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`guidance` text,
	`agent_id` text,
	`action_connector_id` text NOT NULL,
	`action_id` text NOT NULL,
	`action_target` text DEFAULT '{}' NOT NULL,
	`polled_at` integer,
	`poll_error` text,
	`poll_cursor` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_loops` (`id`, `name`, `enabled`, `priority`, `connector_id`, `workflow_id`, `settings`, `guidance`, `agent_id`, `action_connector_id`, `action_id`, `action_target`, `polled_at`, `poll_error`, `poll_cursor`, `created_at`, `updated_at`)
SELECT `id`, `name`, `enabled`, `priority`, `connector_id`, `workflow_id`, `settings`, `guidance`, `agent_id`,
	`connector_id`,
	CASE `workflow_id`
		WHEN 'github.review_requested' THEN 'github.submit_review'
		WHEN 'github.issue_assigned' THEN 'github.post_issue_comment'
		WHEN 'wechat.ask' THEN 'wechat.reply'
		ELSE ''
	END,
	'{}',
	`polled_at`, `poll_error`, `poll_cursor`, `created_at`, `updated_at` FROM `loops`;--> statement-breakpoint
DROP TABLE `loops`;--> statement-breakpoint
ALTER TABLE `__new_loops` RENAME TO `loops`;--> statement-breakpoint
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
	`action_connector_id` text NOT NULL,
	`action_id` text NOT NULL,
	`action_target` text DEFAULT '{}' NOT NULL,
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
INSERT INTO `__new_tasks` (`id`, `loop_id`, `connector_id`, `state`, `source_url`, `source_kind`, `source_ref`, `source_payload`, `source_title`, `dry_run`, `agent_id`, `agent_command`, `output`, `comments`, `action_connector_id`, `action_id`, `action_target`, `result_url`, `error`, `log_path`, `attempts`, `run_after`, `lease_until`, `cancel_requested`, `dedupe_key`, `duration_ms`, `created_at`, `started_at`, `updated_at`)
SELECT `id`, `loop_id`, `connector_id`, `state`, `source_url`, `source_kind`, `source_ref`, `source_payload`, `source_title`, `dry_run`, `agent_id`, `agent_command`, `output`, `comments`, `connector_id`, `action_id`, '{}', `result_url`, `error`, `log_path`, `attempts`, `run_after`, `lease_until`, `cancel_requested`, `dedupe_key`, `duration_ms`, `created_at`, `started_at`, `updated_at` FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE INDEX `tasks_loop_idx` ON `tasks` (`loop_id`);--> statement-breakpoint
CREATE INDEX `tasks_created_idx` ON `tasks` (`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_claim_idx` ON `tasks` (`state`,`run_after`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_dedupe_idx` ON `tasks` (`dedupe_key`);--> statement-breakpoint
PRAGMA legacy_alter_table=OFF;--> statement-breakpoint
PRAGMA foreign_keys=ON;
