-- An inbox prompt has nothing to write, so a finished one is done, not prepared.
UPDATE `tasks` SET `state` = 'done' WHERE `source_kind` = 'prompt' AND `state` = 'prepared' AND `dry_run` = 0;
