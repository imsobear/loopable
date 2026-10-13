import { homedir } from "node:os";
import { runRemoteLoop } from "./client.ts";

// Wherever it was started from may not last: updating replaces the package it
// was started in, and every agent it starts from a folder that is gone fails
// before it can say whether it is signed in. Home is still there afterwards.
process.chdir(homedir());

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

const url = process.env.LOOPABLE_URL;
const joinToken = process.env.LOOPABLE_RUNNER_TOKEN;
if (!url || !joinToken) {
  log("Set LOOPABLE_URL and LOOPABLE_RUNNER_TOKEN, then start again.");
  process.exitCode = 1;
} else {
  try {
    await runRemoteLoop({ url, joinToken, log });
  } catch (error) {
    // Said plainly: whoever reads this is reading a log, not debugging.
    log(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
