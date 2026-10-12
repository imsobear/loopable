-- 0023 put this after another statement with no breakpoint, so it never ran.
-- Hosted Loopable keeps every credential here, encrypted.
CREATE TABLE IF NOT EXISTS `secrets` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
