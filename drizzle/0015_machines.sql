CREATE TABLE `machines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`hostname` text NOT NULL,
	`kind` text NOT NULL DEFAULT 'joined',
	`status` text NOT NULL DEFAULT 'offline',
	`inventory` text NOT NULL DEFAULT '[]',
	`last_seen_at` integer,
	`created_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
