import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  beat,
  claimSingleInstance,
  releaseSingleInstance,
  runningDaemonPid,
  STALE_MS,
} from "./instance.ts";

let home: string;

/** A pid that exists but is not the daemon, which is the case worth testing. */
const OTHER_LIVE_PID = process.ppid;
/** Above every pid a machine will hand out, so nothing answers for it. */
const DEAD_PID = 4_194_304;

function claimFile(): string {
  return join(home, "daemon.pid");
}

function writeClaim(pid: number, at: number): void {
  writeFileSync(claimFile(), JSON.stringify({ pid, at }), "utf8");
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loopable-instance-"));
  process.env.LOOPABLE_HOME = home;
});

afterEach(() => {
  delete process.env.LOOPABLE_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("claimSingleInstance", () => {
  it("claims when nobody has", () => {
    expect(claimSingleInstance()).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(claimFile(), "utf8")).pid).toBe(process.pid);
  });

  it("stands aside for a daemon that is still saying it is there", () => {
    writeClaim(OTHER_LIVE_PID, Date.now());
    expect(claimSingleInstance()).toEqual({ ok: false, pid: OTHER_LIVE_PID });
  });

  it("takes over from a live pid that stopped saying anything", () => {
    // The pid got reused: something is alive under that number, but it has not
    // called itself the daemon in a long time.
    writeClaim(OTHER_LIVE_PID, Date.now() - STALE_MS - 1);
    expect(claimSingleInstance()).toEqual({ ok: true });
  });

  it("takes over when the process is gone", () => {
    writeClaim(DEAD_PID, Date.now());
    expect(claimSingleInstance()).toEqual({ ok: true });
  });

  it("takes over an unreadable claim", () => {
    writeFileSync(claimFile(), "1234", "utf8");
    expect(claimSingleInstance()).toEqual({ ok: true });
  });

  it("reclaims its own stale file after a restart", () => {
    writeClaim(process.pid, Date.now() - STALE_MS - 1);
    expect(claimSingleInstance()).toEqual({ ok: true });
  });
});

describe("runningDaemonPid", () => {
  it("is nothing when no daemon ever ran", () => {
    expect(runningDaemonPid()).toBeNull();
  });

  it("is the pid of a daemon that just spoke", () => {
    beat();
    expect(runningDaemonPid()).toBe(process.pid);
  });

  it("is nothing once the heartbeat goes quiet, pid alive or not", () => {
    writeClaim(OTHER_LIVE_PID, Date.now() - STALE_MS - 1);
    expect(runningDaemonPid()).toBeNull();
  });

  it("is nothing when the process is gone, however recently it spoke", () => {
    writeClaim(DEAD_PID, Date.now());
    expect(runningDaemonPid()).toBeNull();
  });
});

describe("releaseSingleInstance", () => {
  it("clears its own claim", () => {
    beat();
    releaseSingleInstance();
    expect(runningDaemonPid()).toBeNull();
  });

  it("leaves somebody else's claim alone", () => {
    writeClaim(OTHER_LIVE_PID, Date.now());
    releaseSingleInstance();
    expect(runningDaemonPid()).toBe(OTHER_LIVE_PID);
  });

  it("does not mind being called twice", () => {
    beat();
    releaseSingleInstance();
    expect(() => releaseSingleInstance()).not.toThrow();
  });
});
