export type Beat = {
  source: "slack" | "github" | "clock" | "monitor";
  sourceLabel: string;
  line: string;
  detail: string;
  loop: string;
  agent: string;
  writeback: string;
};

export const beats: Beat[] = [
  {
    source: "slack",
    sourceLabel: "Slack",
    line: "@loopable in #eng",
    detail: "Review the auth PR before it merges",
    loop: "Review pull requests I am asked to review",
    agent: "Codex",
    writeback: "Then writes a review comment back",
  },
  {
    source: "github",
    sourceLabel: "GitHub",
    line: "Assigned you for code review",
    detail: "acme/api#412 · pull request review",
    loop: "Review pull requests I am asked to review",
    agent: "Claude",
    writeback: "Then leaves the review on the PR",
  },
  {
    source: "monitor",
    sourceLabel: "Monitor",
    line: "p95 latency · checkout",
    detail: "Spike 420ms → 2.1s in the last 10 minutes",
    loop: "Dig the checkout latency case",
    agent: "Codex",
    writeback: "Then posts findings in #oncall",
  },
  {
    source: "clock",
    sourceLabel: "Clock",
    line: "09:00 weekday",
    detail: "Sweep issues with no comment for a week",
    loop: "Morning sweep of stale issues",
    agent: "Codex",
    writeback: "Then writes a status note on each issue",
  },
];

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function setText(id: string, value: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function paint(beat: Beat) {
  const source = document.getElementById("signal-source");
  if (source) {
    source.dataset.source = beat.source;
    source.textContent = beat.sourceLabel;
  }
  setText("signal-line", beat.line);
  setText("signal-detail", beat.detail);
  setText("loop-line", beat.loop);
  setText("runner-state", beat.agent);
  setText("runner-detail", beat.writeback);
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

      hot("signal", true);
      hot("loop", false);
      hot("runner", false);
      setText("loop-state", "matching");
      ride("packet");
      await wait(480);
      if (token !== run) return;
      hot("loop", true);
      setText("loop-state", "matched");
      ride("packet-2");
      await wait(480);
      if (token !== run) return;
      hot("runner", true);
      setText("runner-line", "Agent running on the shared host");
      await wait(2400);
      if (token !== run) return;

      index = (index + 1) % beats.length;
      root.dataset.index = String(index);
      document.querySelector('[data-role="signal"]')?.classList.add("is-swap");
      await wait(220);
      if (token !== run) return;
      paint(beats[index]!);
      setText("runner-line", "Runs on the office machine");
      setText("loop-state", "matching");
      hot("signal", false);
      hot("loop", false);
      hot("runner", false);
      document.querySelector('[data-role="signal"]')?.classList.remove("is-swap");
      await wait(700);
    }
  };

  run += 1;
  void cycle(run);
}
