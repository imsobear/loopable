-- Hand-written. The generated version was `ADD COLUMN ... NOT NULL` with no
-- default, four times over, which SQLite refuses outright.
--
-- Rebuilding `loops` is the awkward part, because `tasks` and `signals`
-- reference it with ON DELETE CASCADE and this connection runs with foreign
-- keys on. Two things that look like they would help do not:
--
--   PRAGMA foreign_keys=OFF   does nothing inside a transaction, and every
--                             migration runs inside one.
--   PRAGMA legacy_alter_table does take effect, but with foreign keys on the
--                             rename rewrites referencing tables regardless.
--
-- So the order below is the point. `loops` is moved aside, the new one is
-- built beside it, and then the two children are rebuilt pointing at the new
-- table. Only once nothing refers to the old one is it dropped, and there is
-- nothing left for the cascade to take. Every rename happens while both
-- tables exist, so the schema is never left referring to something absent.
--
-- The prompts are written out in full rather than read from the manifests,
-- because that is what copying means: each loop is given the words its
-- workflow was asking on the day this ran, and a later release rewording a
-- prompt leaves it alone. This text is deliberately frozen. It is a record,
-- not a duplicate to be kept in step.
ALTER TABLE `loops` RENAME TO `__old_loops`;--> statement-breakpoint
CREATE TABLE `loops` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer NOT NULL,
	`connector_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`prompt` text NOT NULL,
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
INSERT INTO `loops` (`id`, `name`, `enabled`, `priority`, `connector_id`, `workflow_id`, `settings`, `prompt`, `guidance`, `agent_id`, `action_connector_id`, `action_id`, `action_target`, `polled_at`, `poll_error`, `poll_cursor`, `created_at`, `updated_at`)
SELECT `id`, `name`, `enabled`, `priority`, `connector_id`, `workflow_id`, `settings`,
	CASE `workflow_id`
		WHEN 'github.review_requested' THEN 'Review this pull request the way an experienced engineer on this team would.

Look for correctness bugs, security problems, races, unhandled errors, and
changes that quietly break existing behaviour. Check whether the change is
tested, and say plainly when it is not.

Point at specific files and lines rather than describing the change back to
its author. Say when something is done well; a review that lists only faults
reads as hostile. Skip anything a linter or formatter already enforces, and
do not restate what the diff obviously does.

Where you cannot see enough of the code to judge something, say so instead of
guessing.'
		WHEN 'github.issue_assigned' THEN 'Write a short implementation plan for this issue.

Say what should change, in which files where you can tell, and what to watch
out for. Stay inside what the issue actually supports: if it is too vague to
plan, say what is missing rather than inventing the requirements.

Do not write the implementation.'
		WHEN 'wechat.ask' THEN 'Someone has sent you a message. Do what it asks, working in this directory,
and then answer them.

You are answering into a chat on a phone. Be brief: a couple of short
paragraphs at most, no headings, no bullet lists unless you are genuinely
listing things. Plain sentences.

If the message asks a question about this code, read enough of it to answer
properly rather than guessing. If it asks for a change, make the change and
say in one line what you did. If the message is too vague to act on, say what
you need to know instead of assuming.'
		ELSE ''
	END,
	`guidance`, `agent_id`,
	`connector_id`,
	CASE `workflow_id`
		WHEN 'github.review_requested' THEN 'github.submit_review'
		WHEN 'github.issue_assigned' THEN 'github.post_issue_comment'
		WHEN 'wechat.ask' THEN 'wechat.reply'
		ELSE ''
	END,
	'{}',
	`polled_at`, `poll_error`, `poll_cursor`, `created_at`, `updated_at` FROM `__old_loops`;--> statement-breakpoint
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
SELECT `loop_id`, `key`, `outcome`, `source_kind`, `source_ref`, `source_payload`, `source_title`, `source_url`, `hold`, `task_id`, `seen_at` FROM `signals`;--> statement-breakpoint
DROP TABLE `signals`;--> statement-breakpoint
ALTER TABLE `__new_signals` RENAME TO `signals`;--> statement-breakpoint
CREATE INDEX `signals_outcome_idx` ON `signals` (`loop_id`,`outcome`);--> statement-breakpoint
DROP TABLE `__old_loops`;--> statement-breakpoint
-- Last, because an index belongs to its table and this one followed `loops`
-- when it was renamed aside. The name is only free again once that is gone.
CREATE INDEX `loops_priority_idx` ON `loops` (`priority`);
