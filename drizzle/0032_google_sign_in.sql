-- Signing in with Google as well as GitHub: a user has either id, or both.
-- SQLite cannot relax NOT NULL in place, so users is rebuilt. Dropping it may
-- cascade to members and sessions, so they are kept aside and put back.
CREATE TABLE `_members_keep` AS SELECT * FROM `members`;
--> statement-breakpoint
CREATE TABLE `_sessions_keep` AS SELECT * FROM `sessions`;
--> statement-breakpoint
CREATE TABLE `users_new` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` text,
	`google_id` text,
	`email` text,
	`login` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `users_new` (`id`, `github_id`, `login`, `name`, `avatar_url`, `created_at`)
	SELECT `id`, `github_id`, `login`, `name`, `avatar_url`, `created_at` FROM `users`;
--> statement-breakpoint
DROP TABLE `users`;
--> statement-breakpoint
ALTER TABLE `users_new` RENAME TO `users`;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_id_unique` ON `users` (`github_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_id_unique` ON `users` (`google_id`);
--> statement-breakpoint
DELETE FROM `members`;
--> statement-breakpoint
INSERT INTO `members` SELECT * FROM `_members_keep`;
--> statement-breakpoint
DELETE FROM `sessions`;
--> statement-breakpoint
INSERT INTO `sessions` SELECT * FROM `_sessions_keep`;
--> statement-breakpoint
DROP TABLE `_members_keep`;
--> statement-breakpoint
DROP TABLE `_sessions_keep`;
--> statement-breakpoint
ALTER TABLE `sign_in_attempts` ADD `provider` text DEFAULT 'github' NOT NULL;
