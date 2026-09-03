CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer NOT NULL,
	`connector_id` text NOT NULL,
	`event_id` text NOT NULL,
	`conditions` text DEFAULT '{}' NOT NULL,
	`instruction` text NOT NULL,
	`agent_id` text,
	`action_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rules_priority_idx` ON `rules` (`priority`);