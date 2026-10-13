import { Check, Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import { LoopableMark } from "@/components/brand";
import { ConnectorIcon } from "@/components/connector-icon";
import { cn } from "@/lib/utils";

/**
 * The hero's picture: one job going round. A signal comes in from GitHub, a
 * chat bot or the clock, a loop matches it, an agent runs it on someone's
 * machine, and the answer goes back where it came from. Then the next one.
 * Each source brings a different kind of work, so the five together tell the
 * story: a review, an incident, a question in a group, a quick ask from the
 * phone, and a morning chore.
 */
type Job = {
  source: string;
  from: string;
  signal: string;
  loop: string;
  rules: string[];
  agent: string;
  agentName: string;
  work: string[];
  answer: string;
};

const JOBS: Job[] = [
  {
    source: "Github",
    from: "GitHub · acme/shop",
    signal: "Review requested on #482",
    loop: "Review pull requests",
    rules: ["review requested", "acme/shop"],
    agent: "ClaudeCode",
    agentName: "Claude Code",
    work: ["Reading the diff", "Running the tests"],
    answer: "Review posted as a comment on #482",
  },
  {
    source: "Slack",
    from: "Slack · #oncall",
    signal: "@loopable checkout 5xx since 4pm?",
    loop: "Do what I ask the Slack bot",
    rules: ["bot mentioned", "#oncall"],
    agent: "Codex",
    agentName: "Codex",
    work: ["Reading the service logs", "Checking the 15:52 deploy"],
    answer: "Replied in the thread: redis timeouts since the 15:52 deploy",
  },
  {
    source: "Feishu",
    from: "Lark · Release group",
    signal: "@loopable what's going out in 2.4 this week?",
    loop: "Do what I ask the Feishu / Lark bot",
    rules: ["bot mentioned", "Release group"],
    agent: "Codex",
    agentName: "Codex",
    work: ["Reading 14 PRs merged since 2.3", "Writing the notes, grouped by area"],
    answer: "Replied in the thread: draft release notes for 2.4",
  },
  {
    source: "Wechat",
    from: "WeChat · direct message",
    signal: "Pricing page still says $19, it should be $29. Fix it?",
    loop: "Do what I ask the WeChat bot",
    rules: ["bot messaged", "from Maya"],
    agent: "Cursor",
    agentName: "Cursor Agent",
    work: ["Finding the price in pricing.tsx", "Opening #491 with the change"],
    answer: "Replied in the chat with a link to #491",
  },
  {
    source: "Clock",
    from: "Schedule · weekdays 9:00",
    signal: "Monday, 9:00",
    loop: "Triage new issues",
    rules: ["weekdays 9:00", "acme/shop"],
    agent: "ClaudeCode",
    agentName: "Claude Code",
    work: ["Reading 6 new issues", "Labelling, and linking duplicates"],
    answer: "Posted the triage to #team",
  },
];

const SOURCES = ["Github", "Slack", "Feishu", "Wechat", "Clock"];

/** How long each step is held: signal, matched, running, written, back, and a fade before the next. */
const HOLD = [1300, 1300, 2200, 1400, 1600, 450];
const BACK = 4;
const FADE = 5;

export function HeroFlow() {
  const [job, setJob] = useState(0);
  const [step, setStep] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(reduce.matches);
    if (reduce.matches) setStep(BACK);
  }, []);

  useEffect(() => {
    if (still) return;
    const timer = setTimeout(() => {
      if (step < FADE) setStep(step + 1);
      else {
        setStep(0);
        setJob((job + 1) % JOBS.length);
      }
    }, HOLD[step]);
    return () => clearTimeout(timer);
  }, [step, job, still]);

  const current = JOBS[job]!;
  const at = (n: number) => step >= n;

  return (
    <div className="relative rounded-2xl border bg-card p-4 shadow-sm">
      {/* The way back, from the answer up to where the signal came from. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-9 right-2 bottom-12 w-3 rounded-r-lg border-y border-r border-dashed transition-colors duration-500",
          step >= BACK ? "border-emerald-500/60" : "border-border",
        )}
      >
        {step === BACK && !still ? (
          <span className="absolute -right-[4.5px] size-2 rounded-full bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500 [animation:flow-up_900ms_ease-in-out_forwards]" />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-6">
        {SOURCES.map((source) => {
          const active = source === current.source;
          return (
            <span key={source} className="relative">
              <ConnectorIcon
                icon={source}
                className={cn(
                  "size-9 transition-all duration-500",
                  active ? "opacity-100 ring-2 ring-primary/70" : "opacity-35 grayscale",
                )}
              />
              {active && step >= BACK ? (
                <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white animate-in zoom-in">
                  <Check className="size-3" />
                </span>
              ) : null}
            </span>
          );
        })}
        <span className="ml-auto text-right text-xs text-muted-foreground">{current.from}</span>
      </div>
      <div className={cn("transition-opacity duration-400", step === FADE ? "opacity-0" : "opacity-100")}>
      <p
        key={`signal-${job}`}
        className="mt-3 mr-6 rounded-lg bg-muted/60 px-3 py-2 text-sm animate-in fade-in slide-in-from-top-1 duration-500"
      >
        {current.signal}
      </p>

      <Pipe live={step === 1} />

      <Stage on={at(1)} reset={step === 0}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex size-5 items-center justify-center rounded bg-primary text-primary-foreground">
            <LoopableMark className="size-3" />
          </span>
          Loopable · loop matched
        </div>
        <div className="mt-1.5 text-sm font-medium">{current.loop}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {current.rules.map((rule) => (
            <span key={rule} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
              {rule}
            </span>
          ))}
        </div>
      </Stage>

      <Pipe live={step === 2} />

      <Stage on={at(2)} reset={step === 0}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Cpu className="size-3.5" />
          Runner · Maya&rsquo;s laptop
        </div>
        <div className="mt-2 flex items-start gap-2.5">
          <ConnectorIcon icon={current.agent} className="size-8" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{current.agentName}</div>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {current.work.map((line, index) => (
                <li
                  key={`${job}-${line}`}
                  className={cn(
                    "flex items-center gap-1.5 transition-opacity duration-300",
                    step > 2 || (step === 2 && !still) ? "opacity-100" : "opacity-0",
                  )}
                  style={{ transitionDelay: step === 2 ? `${300 + index * 700}ms` : "0ms" }}
                >
                  <span className={cn("size-1 rounded-full", step > 2 ? "bg-emerald-500" : "bg-primary animate-pulse")} />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Stage>

      <Pipe live={step === 3} />

      <Stage on={at(3)} reset={step === 0}>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Written back
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="size-3" />
            Done
          </span>
        </div>
        <div className="mt-1.5 text-sm">{current.answer}</div>
      </Stage>
      </div>
    </div>
  );
}

/** One stage of the job, lit once the job reaches it. A new job starts dark at once, not by fading. */
function Stage({ on, reset, children }: { on: boolean; reset: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "mr-6 rounded-lg border p-3 transition-all",
        reset ? "duration-0" : "duration-500",
        on ? "border-border bg-background opacity-100" : "border-transparent bg-muted/30 opacity-40",
      )}
    >
      {children}
    </div>
  );
}

/** The line between two stages, with a signal travelling down it while it is live. */
function Pipe({ live }: { live: boolean }) {
  return (
    <div className="relative ml-6 h-5 w-px bg-border">
      {live ? (
        <span className="absolute -left-[3.5px] size-2 rounded-full bg-primary shadow-[0_0_8px] shadow-primary [animation:flow-down_600ms_ease-in_forwards]" />
      ) : null}
    </div>
  );
}
