#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runDaemon } from "./daemon.ts";
import { setOAuthApp } from "./credentials.ts";
import { openDb } from "./db.ts";
import { dataDir, dbPath } from "./paths.ts";
import { ingestEvent } from "./engine/ingest.ts";
import { defaultRules } from "./engine/default-rules.ts";

const cmd = process.argv[2] ?? "help";

if (cmd === "start" || cmd === "serve") {
  runDaemon();
} else if (cmd === "setup") {
  const port = process.env.LOOPABLE_PORT ?? "8787";
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1], "start"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const url = `http://127.0.0.1:${port}`;
  spawn("open", [url], { stdio: "ignore" });
  console.log(`Opened ${url}`);
} else if (cmd === "auth" && process.argv[3] === "oauth-app") {
  const clientId = process.argv[4];
  const clientSecret = process.argv[5];
  if (!clientId || !clientSecret) {
    console.error("usage: loopable auth oauth-app <client_id> <client_secret>");
    process.exit(1);
  }
  setOAuthApp({ clientId, clientSecret });
  console.log("OAuth app saved. Open Setup and click Authorize GitHub.");
} else if (cmd === "auth" && process.argv[3] === "github") {
  const port = process.env.LOOPABLE_PORT ?? "8787";
  console.log(`Open Setup and click Authorize GitHub: http://127.0.0.1:${port}/`);
} else if (cmd === "demo") {
  const db = openDb(dbPath());
  ingestEvent(
    db,
    {
      id: `github:demo/web:pr:1:review_requested:${Date.now()}`,
      connector: "github",
      type: "pull_request.review_requested_of_me",
      occurredAt: new Date().toISOString(),
      workItemId: "github/demo/web/pull/1/reviewer",
      wakeRef: { notificationId: "demo" },
      payload: {
        repository: "demo/web",
        number: 1,
        title: "Demo: add rate limit",
        subjectType: "PullRequest",
        reason: "review_requested",
        url: "https://github.com/demo/web/pull/1",
        draft: false,
      },
    },
    defaultRules(),
  );
  console.log("Inserted a demo review request. Start the daemon and open the inbox.");
} else if (cmd === "install-launchd") {
  const plistDir = join(homedir(), "Library", "LaunchAgents");
  mkdirSync(plistDir, { recursive: true });
  const dest = join(plistDir, "com.loopable.daemon.plist");
  const node = process.execPath;
  const script = process.argv[1];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.loopable.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>--experimental-strip-types</string>
    <string>${script}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(dataDir(), "daemon.log")}</string>
  <key>StandardErrorPath</key><string>${join(dataDir(), "daemon.err")}</string>
</dict>
</plist>
`;
  writeFileSync(dest, plist);
  console.log(`Wrote ${dest}`);
  console.log("Load with: launchctl load " + dest);
} else {
  console.log(`Loopable — build reliable engineering loops across the services and agents you already use.

  loopable setup             Start daemon and open the local UI
  loopable start             Run the daemon in the foreground
  loopable auth github       Print the Setup URL (authorize in the browser)
  loopable auth oauth-app ID SECRET
                             Developer only: override the app registration
  loopable demo              Insert a fake inbox item
  loopable install-launchd   Write a LaunchAgent plist
`);
}
