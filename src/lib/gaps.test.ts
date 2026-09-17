import { describe, expect, it } from "vitest";
import { gapsFor, issuesFor } from "./gaps.ts";
import type { LoopReadiness, LoopView } from "./domain.ts";

const ready: LoopReadiness = {
  connectedConnectorIds: ["github", "wechat"],
  defaultAgentId: "cursor-agent",
  availableAgentIds: ["cursor-agent"],
  hostAgentIds: ["cursor-agent"],
};

function loop(over: Partial<LoopView> = {}): LoopView {
  return {
    id: "loop-1",
    name: "Review my code",
    enabled: true,
    priority: 1,
    connectorId: "github",
    workflowId: "github.review_requested",
    settings: {},
    prompt: "Review it.",
    guidance: null,
    agentId: null,
    actionConnectorId: "github",
    actionId: "github.submit_review",
    actionTarget: {},
    pollEveryMs: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("gapsFor", () => {
  it("finds nothing to say when everything is in place", () => {
    expect(gapsFor(ready, [loop()])).toEqual([]);
  });

  it("names the service a loop answers on, not just the one it watches", () => {
    const gaps = gapsFor({ ...ready, connectedConnectorIds: ["github"] }, [
      loop({ actionConnectorId: "wechat", actionId: "wechat.reply" }),
    ]);
    expect(gaps).toEqual(["Review my code answers on WeChat, which has no account."]);
  });

  it("says both when a loop watches and answers somewhere unconnected", () => {
    const gaps = gapsFor({ ...ready, connectedConnectorIds: ["github"] }, [
      loop({ connectorId: "wechat", actionConnectorId: "wechat", actionId: "wechat.reply" }),
    ]);
    expect(gaps).toEqual([
      "Review my code watches WeChat, which has no account.",
      "Review my code answers on WeChat, which has no account.",
    ]);
  });

  it("does not repeat itself per loop when nothing is connected at all", () => {
    const gaps = gapsFor({ ...ready, connectedConnectorIds: [] }, [loop(), loop({ id: "loop-2" })]);
    expect(gaps).toEqual(["No account is connected yet, so no signal can arrive."]);
  });

  it("separates having no agent from having one but not choosing it", () => {
    expect(gapsFor({ ...ready, availableAgentIds: [], hostAgentIds: [], defaultAgentId: null }, [])).toEqual(
      ["No coding agent is signed in on any runner, so nothing can be prepared."],
    );
    expect(gapsFor({ ...ready, defaultAgentId: null }, [])).toEqual([
      "No default agent is chosen, so loops that do not name one cannot run.",
    ]);
  });

  it("names a loop whose agent is not signed in on any online runner", () => {
    expect(gapsFor(ready, [loop({ agentId: "codex" })])).toEqual([
      "Review my code uses Codex, which no online runner has signed in.",
    ]);
  });
});

describe("issuesFor", () => {
  it("is silent for a loop that can run", () => {
    expect(issuesFor(ready, loop())).toEqual([]);
  });

  it("is silent when the loop is off", () => {
    expect(issuesFor(ready, loop({ enabled: false, agentId: "codex" }))).toEqual([]);
  });

  it("says so when the named agent has no online runner", () => {
    expect(issuesFor(ready, loop({ agentId: "codex" }))).toEqual([
      "Review my code uses Codex, which no online runner has signed in.",
    ]);
  });

  it("lets a GitHub checkout loop run on a runner that is not this host", () => {
    expect(
      issuesFor(
        { ...ready, hostAgentIds: [] },
        loop({
          name: "Implement things",
          workflowId: "github.issue_implement",
          actionId: "github.open_pull_request",
        }),
      ),
    ).toEqual([]);
  });

  it("still pins a folder loop to a runner on this host", () => {
    expect(
      issuesFor(
        { ...ready, hostAgentIds: [] },
        loop({
          name: "Daily look",
          connectorId: "schedule",
          workflowId: "schedule.recurring",
          actionConnectorId: "wechat",
          actionId: "wechat.reply",
        }),
      ),
    ).toEqual(["Daily look needs a runner on this host with Cursor Agent signed in."]);
  });
});
