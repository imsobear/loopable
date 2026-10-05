-- A loop's folder is relative to the runner's home now. Paths under a home
-- folder become the part after it; anything else is left as it was.
UPDATE `loops` SET `settings` = json_set(`settings`, '$.folder', substr(json_extract(`settings`, '$.folder'), 8 + instr(substr(json_extract(`settings`, '$.folder'), 8), '/'))) WHERE json_extract(`settings`, '$.folder') LIKE '/Users/%/%';
--> statement-breakpoint
UPDATE `loops` SET `settings` = json_set(`settings`, '$.folder', substr(json_extract(`settings`, '$.folder'), 7 + instr(substr(json_extract(`settings`, '$.folder'), 7), '/'))) WHERE json_extract(`settings`, '$.folder') LIKE '/home/%/%';
