-- Turning a runner off, forgetting one that is still running, and updating it from the console.
ALTER TABLE `runners` ADD `enabled` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `runners` ADD `forgotten_at` integer;
--> statement-breakpoint
ALTER TABLE `runners` ADD `updatable` integer;
--> statement-breakpoint
ALTER TABLE `runners` ADD `update_to` text;
--> statement-breakpoint
ALTER TABLE `runners` ADD `update_requested_at` integer;
--> statement-breakpoint
ALTER TABLE `runners` ADD `update_error` text;
