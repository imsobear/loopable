-- Where to go after signing in, so a link that needed a session lands there.
ALTER TABLE `sign_in_attempts` ADD `return_to` text;
