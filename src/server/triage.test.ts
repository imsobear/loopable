import { describe, expect, it, vi } from "vitest";
import type { Signal } from "#/connectors/types.ts";

/** What the agent was asked, and what it will answer. */
let asked = "";
let answer = { ok: true, output: "", aborted: false };

vi.mock("#/agents/runtimes.ts", () => ({
  agentRuntime: () => ({
    run: async (input: { prompt: string }) => {
      asked = input.prompt;
      return { ...answer, durationMs: 1, command: { bin: "x", args: [] } };
    },
  }),
}));

vi.mock("./agents.ts", () => ({
  settingsFor: () => ({ permissionMode: "read_only", model: null, timeoutMs: 1_000 }),
}));

const { parseAnswer, triage } = await import("./triage.ts");

function mail(n: number, title: string, preview?: string): Signal {
  return { key: `mail#${n}`, kind: "email", ref: `mail#${n}`, title, url: "", preview };
}

/** Enough to be worth triaging at all. */
const FOUR = [
  mail(1, "Robinhood: trade confirmations"),
  mail(2, "Meagan Chen: Parent-Teacher Conferences"),
  mail(3, "JavaScript Weekly: issue 700"),
  mail(4, "Mike Franchi: Re: come join the team"),
];

describe("parseAnswer", () => {
  it("reads the numbers as indices", () => {
    expect(parseAnswer('{"needsMe": [2, 4]}', 4)).toEqual(new Set([1, 3]));
  });

  it("reads an answer that came wrapped in a fence or a sentence", () => {
    // Not worth failing a whole poll over, since the numbers are right there.
    expect(parseAnswer('Here you go:\n```json\n{"needsMe":[1]}\n```', 4)).toEqual(new Set([0]));
  });

  it("takes the numbers when they came back as strings", () => {
    expect(parseAnswer('{"needsMe": ["2"]}', 4)).toEqual(new Set([1]));
  });

  it("keeps an empty list, which is a real answer", () => {
    // Distinct from null: nothing needs you is a decision, and it is the whole
    // point of asking.
    expect(parseAnswer('{"needsMe": []}', 4)).toEqual(new Set());
  });

  it("drops numbers that point at nothing", () => {
    // A number past the end would otherwise silently shift which mail is meant.
    expect(parseAnswer('{"needsMe": [0, 3, 9, -1]}', 4)).toEqual(new Set([2]));
  });

  it("gives nothing back when it cannot tell what was meant", () => {
    // Each of these has to be told apart from "none of them", because reading
    // it as none would hold every message.
    expect(parseAnswer("", 4)).toBeNull();
    expect(parseAnswer("no idea, sorry", 4)).toBeNull();
    expect(parseAnswer("{ this is not json }", 4)).toBeNull();
    expect(parseAnswer('{"other": [1]}', 4)).toBeNull();
    expect(parseAnswer('{"needsMe": "all of them"}', 4)).toBeNull();
  });
});

describe("triage", () => {
  const run = (signals: Signal[], guidance: string | null = null) =>
    triage({ signals, agentId: "cursor-agent", guidance, cwd: "/tmp" });

  it("holds the ones nothing was asked of, and leaves the rest to run", async () => {
    answer = { ok: true, output: '{"needsMe": [2, 4]}', aborted: false };

    const held = await run(FOUR);

    expect([...held.keys()]).toEqual(["mail#1", "mail#3"]);
    expect(held.get("mail#1")).toBe("nothing in it was being asked of you");
  });

  it("does not spend a run to save fewer than it costs", async () => {
    asked = "";
    answer = { ok: true, output: '{"needsMe": []}', aborted: false };

    expect(await run(FOUR.slice(0, 2))).toEqual(new Map());
    expect(asked).toBe("");
  });

  /**
   * The three ways of not getting an answer. Each has to mean "run them all",
   * because the alternative is mail that needed you sitting held behind a
   * failure that had nothing to do with it.
   */
  it("runs everything when the agent failed", async () => {
    answer = { ok: false, output: "", aborted: false };
    expect(await run(FOUR)).toEqual(new Map());
  });

  it("runs everything when the agent was stopped", async () => {
    answer = { ok: true, output: '{"needsMe": []}', aborted: true };
    expect(await run(FOUR)).toEqual(new Map());
  });

  it("runs everything when the answer made no sense", async () => {
    answer = { ok: true, output: "they all look important to me", aborted: false };
    expect(await run(FOUR)).toEqual(new Map());
  });

  it("asks about all of them at once, numbered, with what each says", async () => {
    answer = { ok: true, output: '{"needsMe": [1]}', aborted: false };
    await run([
      mail(1, "Meagan Chen: Parent-Teacher Conferences", "15 appointment times remain"),
      ...FOUR.slice(1),
    ]);

    // Numbered, because a subject line cannot be pointed back at reliably.
    expect(asked).toContain("1. Meagan Chen: Parent-Teacher Conferences");
    expect(asked).toContain("15 appointment times remain");
    expect(asked).toContain("4. Mike Franchi: Re: come join the team");
  });

  it("puts what the person cares about above the general rule", async () => {
    answer = { ok: true, output: '{"needsMe": []}', aborted: false };
    await run(FOUR, "Anything from the school always matters.");

    expect(asked).toContain("Anything from the school always matters.");
    expect(asked).toContain("outranks");
  });

  it("leans towards telling you when it cannot tell", async () => {
    answer = { ok: true, output: '{"needsMe": []}', aborted: false };
    await run(FOUR);

    // The instruction that decides which way the mistakes go.
    expect(asked).toContain("treat it as asking something");
  });
});
