-- Loops no longer have separate team notes. Keep what was written by moving it
-- onto the end of the prompt, where it was sent anyway.
UPDATE `loops` SET `prompt` = `prompt` || char(10) || char(10) || trim(`guidance`), `guidance` = NULL WHERE `guidance` IS NOT NULL AND trim(`guidance`) <> '';
