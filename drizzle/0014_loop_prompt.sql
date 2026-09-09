-- Hand-written: the generated version was `ADD COLUMN ... NOT NULL` with no
-- default, which SQLite refuses.
--
-- The prompts are written out in full here rather than read from the manifests,
-- because that is what copying means. Every loop that already exists is given
-- the words its workflow was asking on the day this ran, and a later release
-- rewording a prompt leaves them alone. So this text is deliberately frozen:
-- it is a record, not a duplicate to be kept in step with the manifests.
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
INSERT INTO `__new_loops` (`id`, `name`, `enabled`, `priority`, `connector_id`, `workflow_id`, `settings`, `prompt`, `guidance`, `agent_id`, `action_connector_id`, `action_id`, `action_target`, `polled_at`, `poll_error`, `poll_cursor`, `created_at`, `updated_at`)
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
	`guidance`, `agent_id`, `action_connector_id`, `action_id`, `action_target`, `polled_at`, `poll_error`, `poll_cursor`, `created_at`, `updated_at` FROM `loops`;--> statement-breakpoint
DROP TABLE `loops`;--> statement-breakpoint
ALTER TABLE `__new_loops` RENAME TO `loops`;--> statement-breakpoint
CREATE INDEX `loops_priority_idx` ON `loops` (`priority`);--> statement-breakpoint
PRAGMA legacy_alter_table=OFF;--> statement-breakpoint
PRAGMA foreign_keys=ON;
