CREATE TABLE `auth_attempts` (
	`state` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`verifier` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`return_to` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`account_id` text NOT NULL,
	`account_label` text NOT NULL,
	`account_url` text,
	`avatar_url` text,
	`scopes` text,
	`settings` text DEFAULT '{}' NOT NULL,
	`cursor` text,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_account_unique` ON `connections` (`connector_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `connections_connector_idx` ON `connections` (`connector_id`);