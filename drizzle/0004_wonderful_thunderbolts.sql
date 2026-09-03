PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`source_url` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_repo` text NOT NULL,
	`source_number` integer NOT NULL,
	`source_title` text,
	`dry_run` integer DEFAULT false NOT NULL,
	`agent_id` text,
	`agent_command` text,
	`output` text,
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
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "rule_id", "connector_id", "state", "source_url", "source_kind", "source_repo", "source_number", "source_title", "dry_run", "agent_id", "agent_command", "output", "action_id", "result_url", "error", "log_path", "attempts", "run_after", "lease_until", "cancel_requested", "dedupe_key", "duration_ms", "created_at", "started_at", "updated_at") SELECT "id", "rule_id", "connector_id", "state", "source_url", "source_kind", "source_repo", "source_number", "source_title", "dry_run", "agent_id", "agent_command", "output", "action_id", "result_url", "error", NULL, 0, "created_at", NULL, 0, NULL, "duration_ms", "created_at", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tasks_rule_idx` ON `tasks` (`rule_id`);--> statement-breakpoint
CREATE INDEX `tasks_created_idx` ON `tasks` (`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_claim_idx` ON `tasks` (`state`,`run_after`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_dedupe_idx` ON `tasks` (`dedupe_key`);