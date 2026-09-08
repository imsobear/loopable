ALTER TABLE `rules` RENAME COLUMN `event_id` TO `workflow_id`;--> statement-breakpoint
ALTER TABLE `rules` RENAME COLUMN `conditions` TO `settings`;--> statement-breakpoint
ALTER TABLE `rules` ADD `guidance` text;--> statement-breakpoint
UPDATE `rules` SET `workflow_id` = CASE `workflow_id` WHEN 'pull_request.review_requested_of_me' THEN 'github.review_requested' WHEN 'issue.assigned_to_me' THEN 'github.issue_assigned' ELSE `workflow_id` END;--> statement-breakpoint
UPDATE `rules` SET `guidance` = CASE WHEN `instruction` IN ('Review this pull request. Focus on correctness, security and missing tests. Point at specific lines, and say plainly when something looks fine.', 'Write a short implementation plan for this issue: what to change, in which files, and what to watch out for. Do not write the code.', 'Read the review comments and draft a reply. Say what you would change and why, and push back politely where the comment is mistaken.', 'Work out why the checks failed. Explain the cause in a few sentences and suggest the smallest fix. Quote the part of the log that matters.') THEN NULL ELSE `instruction` END;--> statement-breakpoint
ALTER TABLE `rules` DROP COLUMN `instruction`;--> statement-breakpoint
ALTER TABLE `rules` DROP COLUMN `action_id`;
