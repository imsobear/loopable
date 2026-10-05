type Kind = "slack" | "lark" | "github" | "clock";

export type Beat = {
  kind: Kind;
  askPlace: string;
  askVia: string;
  askWho: string;
  askMsg: string;
  agent: string;
  runLine: string;
  backKind: Kind;
  backPlace: string;
  backVia: string;
  backWho: string;
  backMsg: string;
};

export const beats: Beat[] = [
  {
    kind: "slack",
    askPlace: "#oncall",
    askVia: "Slack bot",
    askWho: "Maya",
    askMsg: "@loopable checkout 5xx since 4pm?",
    agent: "Codex",
    runLine: "Reading logs on prod-api-2",
    backKind: "slack",
    backPlace: "#oncall",
    backVia: "Slack bot",
    backWho: "Loopable",
    backMsg: "Cause: redis timeout on cart",
  },
  {
    kind: "github",
    askPlace: "acme/api#412",
    askVia: "GitHub",
    askWho: "Review requested",
    askMsg: "Add retry to the payments client",
    agent: "Cursor Agent",
    runLine: "Walking the diff",
    backKind: "github",
    backPlace: "acme/api#412",
    backVia: "GitHub",
    backWho: "Review comment",
    backMsg: "Looks right, two notes on timeouts",
  },
  {
    kind: "lark",
    askPlace: "payments-oncall",
    askVia: "Lark bot",
    askWho: "Wei",
    askMsg: "@Loopable why did last night’s refund job fail?",
    agent: "Codex",
    runLine: "Querying the ledger service",
    backKind: "lark",
    backPlace: "payments-oncall",
    backVia: "Lark bot",
    backWho: "Loopable",
    backMsg: "Token for the ledger API expired at 02:10",
  },
  {
    kind: "github",
    askPlace: "acme/web#88",
    askVia: "GitHub",
    askWho: "Assigned",
    askMsg: "Why does an empty cart show a blank page?",
    agent: "Codex",
    runLine: "Reading the cart page",
    backKind: "github",
    backPlace: "acme/web#88",
    backVia: "GitHub",
    backWho: "Comment",
    backMsg: "CartList returns null when empty. Fix in cart.tsx:42",
  },
  {
    kind: "clock",
    askPlace: "09:00 weekdays",
    askVia: "Schedule",
    askWho: "Clock",
    askMsg: "Check overnight error rates",
    agent: "Codex",
    runLine: "Reading last night’s metrics",
    backKind: "slack",
    backPlace: "#oncall",
    backVia: "Slack bot",
    backWho: "Loopable",
    backMsg: "All normal. 2 slow queries on search",
  },
];

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function setText(id: string, value: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function iconHref(kind: string) {
  return `#i-${kind === "lark" ? "feishu" : kind}`;
}

function setIcon(root: Element | null, kind: string) {
  const node = root?.querySelector("use");
  if (!node) return;
  const href = iconHref(kind);
  node.setAttribute("href", href);
  node.setAttribute("xlink:href", href);
}

function setSource(id: string, kind: Kind, label: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.dataset.source = kind;
  setIcon(el, kind);
  const text = el.querySelector("b");
  if (text) text.textContent = label;
}

function agentKind(name: string) {
  return name.toLowerCase().includes("cursor") ? "cursor" : "codex";
}

function paintAsk(beat: Beat) {
  const ask = document.getElementById("ask");
  if (ask) ask.dataset.kind = beat.kind;
  setText("ask-place", beat.askPlace);
  setSource("ask-via", beat.kind, beat.askVia);
  setText("ask-who", beat.askWho);
  setText("ask-msg", beat.askMsg);
}

function paintBack(beat: Beat, filled: boolean) {
  const back = document.getElementById("back");
  if (back) back.dataset.kind = beat.backKind;
  setText("back-place", beat.backPlace);
  setSource("back-via", beat.backKind, beat.backVia);
  setText("back-who", filled ? beat.backWho : "…");
  setText("back-msg", filled ? beat.backMsg : "Waiting");
}

function paintRun(beat: Beat, state: "idle" | "running" | "done") {
  setText("run-agent", beat.agent);
  setIcon(document.getElementById("run-agent-wrap"), agentKind(beat.agent));
  const badge = document.getElementById("run-state");
  if (badge) {
    badge.classList.toggle("idle", state !== "running");
    badge.textContent = state === "running" ? "Running" : state === "done" ? "Done" : "Idle";
  }
  document.querySelector('[data-role="run"]')?.classList.toggle("is-running", state === "running");
  setText(
    "run-line",
    state === "running" ? beat.runLine : state === "done" ? "Done" : "Waiting",
  );
}

function hot(role: string, on: boolean) {
  document.querySelector(`[data-role="${role}"]`)?.classList.toggle("is-hot", on);
}

function ride(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("is-run");
  void el.offsetWidth;
  el.classList.add("is-run");
}

export function startFlow(root: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let index = 0;
  let run = 0;

  const cycle = async (token: number) => {
    while (token === run) {
      if (document.hidden) {
        await wait(400);
        continue;
      }

      const beat = beats[index]!;
      paintAsk(beat);
      paintRun(beat, "idle");
      paintBack(beat, false);
      hot("ask", true);
      hot("run", false);
      hot("back", false);
      ride("packet");
      await wait(520);
      if (token !== run) return;

      hot("ask", false);
      hot("run", true);
      paintRun(beat, "running");
      ride("packet-2");
      await wait(1600);
      if (token !== run) return;

      hot("run", false);
      hot("back", true);
      paintRun(beat, "done");
      paintBack(beat, true);
      await wait(2200);
      if (token !== run) return;

      index = (index + 1) % beats.length;
      root.dataset.index = String(index);
      root.classList.add("is-swap");
      await wait(240);
      if (token !== run) return;
      paintAsk(beats[index]!);
      paintRun(beats[index]!, "idle");
      paintBack(beats[index]!, false);
      hot("ask", false);
      hot("run", false);
      hot("back", false);
      root.classList.remove("is-swap");
      await wait(500);
    }
  };

  run += 1;
  void cycle(run);
}
