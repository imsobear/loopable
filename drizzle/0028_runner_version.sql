-- What a runner says it is: its package version, to show, and the protocol it
-- speaks, to decide which jobs it can take. Runners before 0.3 send neither.
ALTER TABLE `runners` ADD `version` text;
--> statement-breakpoint
ALTER TABLE `runners` ADD `protocol` integer;
