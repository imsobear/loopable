-- Workspaces. Everything made before this belongs to "local", which is also
-- the only workspace of a local install.
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`join_token_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_join_token_hash_unique` ON `workspaces` (`join_token_hash`);
--> statement-breakpoint
INSERT INTO `workspaces` (`id`, `name`) VALUES ('local', 'Local');
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` text NOT NULL,
	`login` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_id_unique` ON `users` (`github_id`);
--> statement-breakpoint
CREATE TABLE `members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);
--> statement-breakpoint
CREATE TABLE `sign_in_attempts` (
	`state` text PRIMARY KEY NOT NULL,
	`verifier` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runner_logins` (
	`code` text PRIMARY KEY NOT NULL,
	`poll_secret_hash` text NOT NULL,
	`workspace_id` text,
	`approved_at` integer,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `connections` ADD `workspace_id` text DEFAULT 'local' NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS `connections_account_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_account_unique` ON `connections` (`workspace_id`, `connector_id`, `account_id`);
--> statement-breakpoint
DROP INDEX IF EXISTS `connections_connector_idx`;
--> statement-breakpoint
CREATE INDEX `connections_connector_idx` ON `connections` (`workspace_id`, `connector_id`);
--> statement-breakpoint
ALTER TABLE `auth_attempts` ADD `workspace_id` text DEFAULT 'local' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `workspace_id` text DEFAULT 'local' NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS `tasks_created_idx`;
--> statement-breakpoint
CREATE INDEX `tasks_created_idx` ON `tasks` (`workspace_id`, `created_at`);
--> statement-breakpoint
ALTER TABLE `loops` ADD `workspace_id` text DEFAULT 'local' NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS `loops_priority_idx`;
--> statement-breakpoint
CREATE INDEX `loops_priority_idx` ON `loops` (`workspace_id`, `priority`);
--> statement-breakpoint
ALTER TABLE `runners` ADD `workspace_id` text DEFAULT 'local' NOT NULL;
--> statement-breakpoint
ALTER TABLE `runners` ADD `token_hash` text;
--> statement-breakpoint
CREATE INDEX `runners_token_hash_idx` ON `runners` (`token_hash`);
--> statement-breakpoint
CREATE TABLE `__new_agent_settings` (
	`workspace_id` text DEFAULT 'local' NOT NULL,
	`agent_id` text NOT NULL,
	`permission_mode` text NOT NULL,
	`model` text,
	`timeout_ms` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`workspace_id`, `agent_id`)
);
--> statement-breakpoint
INSERT INTO `__new_agent_settings` (`workspace_id`, `agent_id`, `permission_mode`, `model`, `timeout_ms`, `updated_at`) SELECT 'local', `agent_id`, `permission_mode`, `model`, `timeout_ms`, `updated_at` FROM `agent_settings`;
--> statement-breakpoint
DROP TABLE `agent_settings`;
--> statement-breakpoint
ALTER TABLE `__new_agent_settings` RENAME TO `agent_settings`;
--> statement-breakpoint
CREATE TABLE `__new_app_settings` (
	`workspace_id` text DEFAULT 'local' NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`)
);
--> statement-breakpoint
-- The dispatcher's own settings (its lease, its pause) are nobody's workspace.
INSERT INTO `__new_app_settings` (`workspace_id`, `key`, `value`, `updated_at`) SELECT CASE WHEN `key` LIKE 'dispatcher.%' OR `key` LIKE 'engine.%' THEN '_system' ELSE 'local' END, `key`, `value`, `updated_at` FROM `app_settings`;
--> statement-breakpoint
DROP TABLE `app_settings`;
--> statement-breakpoint
ALTER TABLE `__new_app_settings` RENAME TO `app_settings`;
