import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, CornerDownRight, Inbox } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { LoopableMark } from "@/components/brand";
import { ConnectorIcon } from "@/components/connector-icon";
import { signInHref } from "@/components/sign-in";
import { Button } from "@/components/ui/button";

const TITLE = "Loopable — put your coding agent on a loop";
const DESCRIPTION =
  "Set up workflows in the browser. They run on your machine with Codex or Claude Code, and the answer goes back where it was asked.";
const ORIGIN = "https://loop.goodone.si";
const REPO = "https://github.com/imsobear/loopable";

/** What the front page puts in <head>: how it looks when shared. */
export const landingHead = () => ({
  meta: [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${ORIGIN}/` },
    { property: "og:image", content: `${ORIGIN}/og.png` },
    { property: "og:image:width", content: "2400" },
    { property: "og:image:height", content: "1260" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESCRIPTION },
    { name: "twitter:image", content: `${ORIGIN}/og.png` },
  ],
});

type Props = { signedIn: boolean; next?: string; error?: string };

/**
 * The front page, in the console's own type, colours and parts, so arriving
 * in the app after signing in feels like the same product. Signed in, it is
 * still here to read, with a way back into the app instead of sign-in buttons.
 */
export function Landing({ signedIn, next, error }: Props) {
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav signedIn={signedIn} />
      <main>
        <Hero signedIn={signedIn} next={next} />
        <Problem />
        <HowItWorks />
        <Workflows />
        <OnYourMachine />
        <GetStarted signedIn={signedIn} next={next} />
      </main>
      <Footer />
    </div>
  );
}

function Section({
  id,
  kicker,
  title,
  lead,
  children,
}: {
  id?: string;
  kicker: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-16 border-t">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <p className="text-sm font-medium text-muted-foreground">{kicker}</p>
        <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-balance">{title}</h2>
        {lead ? <p className="mt-3 max-w-2xl text-muted-foreground text-pretty">{lead}</p> : null}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

export function Nav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
        <a href="/" className="flex items-center gap-2 font-medium">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LoopableMark className="size-4.5" />
          </span>
          Loopable
        </a>
        <nav className="hidden items-center gap-5 text-sm text-muted-foreground sm:flex">
          <a href="/#how" className="hover:text-foreground">
            How it works
          </a>
          <a href="/#workflows" className="hover:text-foreground">
            Workflows
          </a>
          <a href="/#start" className="hover:text-foreground">
            Get started
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" nativeButton={false} render={<a href={REPO} aria-label="GitHub" />}>
            <GithubMark />
          </Button>
          {signedIn ? (
            <Button nativeButton={false} render={<Link to="/inbox" />}>
              Open Loopable
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <Button variant="outline" nativeButton={false} render={<a href="/#start" />}>
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function SignInButtons({ next }: { next?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="lg" nativeButton={false} render={<a href={signInHref(next)} />}>
        <GithubMark />
        Sign in with GitHub
      </Button>
      <Button size="lg" variant="outline" nativeButton={false} render={<a href={signInHref(next, "google")} />}>
        <GoogleMark />
        Sign in with Google
      </Button>
    </div>
  );
}

function Hero({ signedIn, next }: { signedIn: boolean; next?: string }) {
  return (
    <section className="mx-auto grid max-w-5xl items-center gap-12 px-6 py-20 md:grid-cols-[1.1fr_1fr] md:py-28">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Workflows for your coding agent</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance md:text-5xl">
          Put your coding agent on a loop.
        </h1>
        <p className="mt-5 text-lg text-muted-foreground text-pretty">{DESCRIPTION}</p>
        <div className="mt-8">
          {signedIn ? (
            <Button size="lg" nativeButton={false} render={<Link to="/inbox" />}>
              Open Loopable
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <SignInButtons next={next} />
          )}
        </div>
      </div>
      <RunCard />
    </section>
  );
}

/** One run, drawn the way the Inbox shows it: what came in, where it ran, what went back. */
function RunCard() {
  return (
    <div className="rounded-xl border bg-card p-1.5 shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Inbox className="size-3.5" />
        Inbox
      </div>
      <div className="flex flex-col gap-1.5">
        <Step icon={<ConnectorIcon icon="Slack" className="size-8" />} label="Slack bot · #oncall">
          <span className="text-muted-foreground">Maya:</span> @loopable checkout 5xx since 4pm?
        </Step>
        <Step icon={<ConnectorIcon icon="Codex" className="size-8" />} label="Codex · on Maya's laptop">
          Read the service logs and the last deploy. Found it in the cart service.
        </Step>
        <Step icon={<ConnectorIcon icon="Slack" className="size-8" />} label="Replied in the thread" done>
          Cause: redis timeouts on cart since the 15:52 deploy. Rolling back fixes it.
        </Step>
      </div>
    </div>
  );
}

function Step({
  icon,
  label,
  done,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-lg bg-muted/50 p-3">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {label}
          {done ? (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="size-3" />
              Written
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm">{children}</p>
      </div>
    </div>
  );
}

function Problem() {
  const items = [
    {
      title: "It waits for you",
      body: "A review request, a question in #oncall, a morning check. Nothing happens until you copy it into your agent, and when you are busy or away, it stops.",
    },
    {
      title: "Your setup is scattered",
      body: "Prompts in chat history, skills on one laptop, steps you repeat by hand. Nothing is reused, and nothing is recorded.",
    },
    {
      title: "Hosted agents can't reach in",
      body: "A cloud sandbox can't see your internal network, logs, or services. You get one vendor, and usually one chat tool.",
    },
  ];
  return (
    <Section kicker="The problem" title="Your agent only works while you are watching it.">
      <div className="grid gap-4 md:grid-cols-3">
        {items.map((item) => (
          <div key={item.title} className="rounded-xl border p-5">
            <h3 className="font-medium">{item.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: "Something happens",
      body: "A review is requested, a chat bot is mentioned, or the time comes round.",
      icons: ["Github", "Slack", "Feishu", "Gmail", "Clock"],
    },
    {
      title: "Your agent does the work",
      body: "A runner on your machine picks up the job and runs your agent there, with your code, tools and logins.",
      icons: ["Codex", "ClaudeCode"],
    },
    {
      title: "The answer goes back",
      body: "A review, a reply in the thread. Every run is kept in the Inbox.",
      icons: [],
    },
  ];
  return (
    <Section
      id="how"
      kicker="How it works"
      title="Set it up once. It runs on its own."
      lead="A loop is what starts it, what to ask, and where to answer. Start from a ready-made workflow, or write your own."
    >
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex flex-col rounded-xl border p-5">
            <span className="text-sm text-muted-foreground">{index + 1}</span>
            <h3 className="mt-1 font-medium">{step.title}</h3>
            <p className="mt-2 flex-1 text-sm text-muted-foreground">{step.body}</p>
            {step.icons.length > 0 ? (
              <div className="mt-4 flex gap-1.5">
                {step.icons.map((icon) => (
                  <ConnectorIcon key={icon} icon={icon} className="size-8" />
                ))}
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-1.5 text-sm">
                <CornerDownRight className="size-4 text-muted-foreground" />
                Written back, and on the record
              </div>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

const WORKFLOWS: Array<{ icon: string; from: string; name: string; answer: string }> = [
  { icon: "Github", from: "GitHub", name: "Review pull requests", answer: "A review, as a comment" },
  { icon: "Github", from: "GitHub", name: "Reply to issues", answer: "A comment on the issue" },
  { icon: "Slack", from: "Slack bot", name: "Do what I ask the Slack bot", answer: "A reply in the thread" },
  { icon: "Feishu", from: "Lark bot", name: "Do what I ask the Lark bot", answer: "A reply in the thread" },
  { icon: "Wechat", from: "WeChat", name: "Do what I ask the WeChat bot", answer: "A reply in the chat" },
  { icon: "Gmail", from: "Gmail", name: "When an email arrives", answer: "An email back" },
  { icon: "Clock", from: "Schedule", name: "Do something on a schedule", answer: "The Inbox, or any thread" },
];

function Workflows() {
  return (
    <Section
      id="workflows"
      kicker="Workflows"
      title="Ready to turn on today."
      lead="Or write your own loop on any of these, and send the answer anywhere."
    >
      <div className="divide-y rounded-xl border">
        {WORKFLOWS.map((flow) => (
          <div key={flow.name} className="flex items-center gap-4 px-4 py-3">
            <ConnectorIcon icon={flow.icon} className="size-8" />
            <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
              <div className="min-w-0 sm:flex-1">
                <div className="text-sm font-medium">{flow.name}</div>
                <div className="text-xs text-muted-foreground">{flow.from}</div>
              </div>
              <div className="mt-1 text-sm text-muted-foreground sm:mt-0 sm:w-64 sm:text-right">{flow.answer}</div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function OnYourMachine() {
  const items = [
    {
      title: "Reach",
      body: "Whatever your machine can reach: the internal network, logs, databases, internal services.",
      hosted: "an allowlist out of a cloud sandbox",
    },
    {
      title: "Extend",
      body: "Any MCP server, CLI, skill, or login you set up there.",
      hosted: "the connectors the platform ships",
    },
    {
      title: "Choose",
      body: "Codex or Claude Code, with the model you want, on the plan you already pay for.",
      hosted: "one vendor",
    },
    {
      title: "Keep local",
      body: "Your code and logs stay on your machine. Connection tokens stay encrypted in Loopable; the agent never sees them.",
      hosted: "your work runs in their cloud",
    },
  ];
  return (
    <Section
      kicker="On your machine"
      title="Loopable is hosted. The agent runs on your machine."
      lead="The one thing you install is a runner. It pulls jobs over HTTPS, so nothing on the internet has to reach your machine."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.title} className="rounded-xl border p-5">
            <h3 className="font-medium">{item.title}</h3>
            <p className="mt-2 text-sm">{item.body}</p>
            <p className="mt-3 text-xs text-muted-foreground">Hosted agents: {item.hosted}.</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function GetStarted({ signedIn, next }: { signedIn: boolean; next?: string }) {
  return (
    <Section
      id="start"
      kicker="Get started"
      title="Sign in, connect your machine, turn on a loop."
      lead="Your machine needs Node 22+ and Codex or Claude Code signed in."
    >
      <ol className="grid gap-4 md:grid-cols-3">
        <li className="rounded-xl border p-5">
          <span className="text-sm text-muted-foreground">1</span>
          <h3 className="mt-1 font-medium">Sign in</h3>
          <div className="mt-4">
            {signedIn ? (
              <Button nativeButton={false} render={<Link to="/inbox" />}>
                Open Loopable
                <ArrowRight data-icon="inline-end" />
              </Button>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <SignInButtons next={next} />
              </div>
            )}
          </div>
        </li>
        <li className="rounded-xl border p-5">
          <span className="text-sm text-muted-foreground">2</span>
          <h3 className="mt-1 font-medium">Connect your machine</h3>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed">
            npm install -g loopable-cli{"\n"}loopable runner --token …
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">The token is on your Runners page.</p>
        </li>
        <li className="rounded-xl border p-5">
          <span className="text-sm text-muted-foreground">3</span>
          <h3 className="mt-1 font-medium">Turn on a loop</h3>
          <p className="mt-4 text-sm text-muted-foreground">
            Connect GitHub or a chat bot, and pick a workflow.
          </p>
        </li>
      </ol>
    </Section>
  );
}

export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-sm text-muted-foreground">
        <span className="flex items-center gap-2 text-foreground">
          <LoopableMark className="size-4" />
          Loopable
        </span>
        <span>Put your coding agent on a loop</span>
        <span className="ml-auto flex gap-5">
          <a href={REPO} className="hover:text-foreground">
            GitHub
          </a>
          <a href={`${REPO}/tree/main/docs`} className="hover:text-foreground">
            Docs
          </a>
          <a href="/privacy" className="hover:text-foreground">
            Privacy
          </a>
          <a href="/terms" className="hover:text-foreground">
            Terms
          </a>
          <span>MIT licensed</span>
        </span>
      </div>
    </footer>
  );
}

function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95h-4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.27 6.6l4 3.1C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}
