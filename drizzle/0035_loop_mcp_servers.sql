-- MCP servers a loop's agent may call without asking.
ALTER TABLE `loops` ADD `mcp_servers` text DEFAULT '[]' NOT NULL;
