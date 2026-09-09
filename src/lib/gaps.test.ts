import { describe, expect, it } from "vitest";
import { gapsFor } from "./gaps.ts";
import type { LoopReadiness, LoopView } from "./domain.ts";

const ready: LoopReadiness = {
  connectedConnectorIds: ["github", "wechat"],
  defaultAgentId: "cursor-agent",
  installedAgentIds: ["cursor-agent"],
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

  // Otherwise the first run of the app lists every loop twice under a heading
  // that has already said the only thing worth saying.
  it("does not repeat itself per loop when nothing is connected at all", () => {
    const gaps = gapsFor({ ...ready, connectedConnectorIds: [] }, [loop(), loop({ id: "loop-2" })]);
    expect(gaps).toEqual(["No account is connected yet, so no signal can arrive."]);
  });

  it("separates having no agent from having one but not choosing it", () => {
    expect(gapsFor({ ...ready, installedAgentIds: [], defaultAgentId: null }, [])).toEqual([
      "No coding agent was found on this machine, so nothing can be prepared.",
    ]);
    expect(gapsFor({ ...ready, defaultAgentId: null }, [])).toEqual([
      "No default agent is chosen, so loops that do not name one cannot run.",
    ]);
  });
});
