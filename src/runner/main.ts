import { runRemoteLoop } from "./client.ts";

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

const url = process.env.LOOPABLE_URL;
const joinToken = process.env.LOOPABLE_RUNNER_TOKEN;
if (!url || !joinToken) {
  log("Set LOOPABLE_URL and LOOPABLE_RUNNER_TOKEN, then start again.");
  process.exitCode = 1;
} else {
  await runRemoteLoop({ url, joinToken, log });
}
