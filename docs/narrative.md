# Narrative

Put your coding agent on a loop. You set up workflows in the browser at loop.goodone.si; they run on your machine with Codex or Claude Code, and the answer goes back where it was asked.

It is for developers first, and the teams they work in. Work comes in from GitHub, Slack, Lark, email, or the clock. Codex, Claude Code, or Cursor Agent does it on your machine. The answer goes back where it was asked, and every run is recorded.

## The problem

**Your agent only works while you are watching it.** A review request. “Why is checkout failing?” in #oncall. A morning look at stale issues. Each one waits until you copy it into your agent, and when you are busy, asleep, or on leave, it stops. Most of these jobs do not need you; they need your agent, your access, and a prompt that already works.

**Your setup is scattered.** Prompts live in chat history, skills on one laptop, steps you repeat by hand. The same question gets a different answer each time. Nothing is reused, and nothing is recorded.

**Hosted agents cannot reach where the work is.** A cloud sandbox does not see your internal network, your logs, your database, or your internal services. It can be extended only as far as the platform allows. It comes with one agent vendor and usually one chat tool.

## Workflows that run on their own

A signal comes in, a loop matches, your agent runs, and the answer is written back.

- **Nobody has to be there.** A loop runs when a review is requested, when a chat bot is mentioned, when an email arrives, or when the clock says so.
- **One way to do each job.** A loop is what starts it, what to ask, and where to answer. Start from a ready-made workflow, or write a custom loop on any trigger.
- **Know-how in the repo.** A loop works in a checkout of your repository. The `AGENTS.md` and skills there are what the agent knows.
- **Every run is recorded.** The inbox shows what came in, what the agent did, and what it wrote back, whether or not it wrote anything.
- **Good for a team too.** A loop that answers in a team channel, or on a shared GitHub account, works for everyone who asks it.

## It runs on your machine

Loopable is hosted, so there is nothing to keep running but the runner. The runner is the one thing you install, and the agent runs there.

- **Reach.** Whatever your machine can reach, the agent can reach: the internal network, logs, databases, internal services.
- **Extend.** Any MCP server, CLI, or login you set up on that machine. No platform decides what is allowed.
- **Choose.** Codex, Claude Code, or Cursor Agent, and the model you want.
- **Keep local.** Your code, logs, and network access stay on your machine. The agent uses the plan you already pay for.

What does pass through the service: connection tokens, which are encrypted and never handed to the agent, and the prompts and answers of each run, which make up the inbox.

## Safe to leave on

An agent that runs with nobody watching has to be boring by default.

- Agents start read-only in your folders. GitHub jobs work in a fresh checkout, never in your working copy.
- A review is posted as a comment, never an approval, and nothing is merged or pushed for you.
- A new loop records what is already waiting. It does not run it.
- Everything you set up belongs to your workspace. Nothing reads across workspaces.

## Who it is for

Developers who already use a coding agent and want it to take work on its own: reviews, replies, checks, and questions that arrive while they are doing something else. Teams follow when those loops answer somewhere shared.

Someone who needs nothing inside their network, lives in one chat tool, and is happy with one vendor may be better served by a hosted agent. That is fine.

## How a job runs

```text
Signal → Loop → Task
              → Dispatcher (hosted) watches, matches a loop, queues the job
              → Runner (your machine) pulls the job, runs Codex, Claude Code, or Cursor Agent
              → Dispatcher writes back
```

The runner pulls work over HTTPS. Nothing on the internet has to reach your machine. Connections live in the service; your agent's login lives on your machine.

The words for the parts are in [concepts.md](concepts.md). Connecting machines is in [runners.md](runners.md).
