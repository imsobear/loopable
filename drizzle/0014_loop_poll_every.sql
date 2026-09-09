-- Nullable and with no default, so this is the one shape of ADD COLUMN SQLite
-- takes without rebuilding the table. Null keeps every existing loop looking
-- as often as the engine does, which is what they all did before.
ALTER TABLE `loops` ADD `poll_every_ms` integer;
