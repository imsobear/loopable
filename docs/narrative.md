# Narrative

Loopable is your team’s own agent. It runs on a machine the team owns, and the team decides what it can do.

It is for small and mid-size teams. Work comes in from Slack, Lark, GitHub, or a schedule. Codex or Cursor Agent does it on that machine. The answer goes back where it was asked, and every run is recorded.

## The problem

**Shared work waits on one person.** A review request. “Why is checkout failing?” in #oncall. A morning look at stale issues. Today someone copies it into their own Codex or Cursor. If that person is busy, asleep, or on leave, the work stops. Most of these jobs do not need that person. The knowledge is already in GitHub, Slack, and the logs.

**What the team knows lives in personal setups.** Each person has their own prompts, skills, and agent config. The same question gets a different answer depending on who ran it. Nothing is reused, and nothing is recorded.

**Hosted team agents cannot reach where the work is.** A cloud sandbox does not see the internal network, the logs, the database, or the internal services. It can be extended only as far as the platform allows. It comes with one agent vendor and usually one chat tool.

## Layer one: a shared agent for the team

The team leaves Loopable running. A signal comes in, a loop matches, the agent runs, the answer is written back.

- **No one has to be there.** A loop runs when the review is requested, when the bot is mentioned, or when the clock says so.
- **The process is shared.** A loop is one job done one way: what to watch, what to ask, where to answer. Anyone on the team can read it and change it.
- **The knowledge is shared.** A loop works in a folder or a checkout of your repository. The `AGENTS.md` and skills there are what the agent knows, and they live in the team’s repository, not on someone’s laptop.
- **Every run is recorded.** The inbox shows what came in, what the agent did, and what it wrote back, whether or not it wrote anything.

It is not a better personal Codex. One person, one chat, one laptop is already solved.

## Layer two: it runs on your machine

The agent runs on a Runner the team owns. The usual install is one computer that stays on. A Mac in the office is enough.

- **Reach.** Whatever that machine can reach, the agent can reach: the internal network, logs, databases, internal services.
- **Extend.** Add any MCP server, CLI, or login to an internal service on that machine. No platform decides what is allowed.
- **Choose.** Pick the agent and the model. Codex and Cursor Agent today.
- **Keep local.** Data and credentials stay on the team’s machines. The agent uses the CLI subscription the team already pays for.

## Safe to leave on

An agent that runs with nobody watching has to be boring by default.

- Agents start read-only in your folders. GitHub jobs work in a fresh checkout, never in someone’s working copy.
- Service credentials stay in Loopable. The agent never sees them.
- A review is posted as a comment, never an approval. Code goes into a draft pull request, never a merge.
- A new loop records what is already waiting. It does not run it.
- Loopable needs no public URL. It polls Slack, Lark, and GitHub. Nothing on the internet has to reach the office Mac.

## Who it is for

Small and mid-size teams whose work needs something a hosted agent does not have: the internal network, a chat tool other than Slack, or data that stays in-house.

A team that lives only in Slack, uses only one vendor, and needs nothing inside its network may be better served by a hosted agent. That is fine.

## How a job runs

```text
Signal → Loop → Task
              → Dispatcher watches, matches a loop, queues the job
              → Runner pulls the job, runs Codex or Cursor Agent
              → Dispatcher writes back
```

The runner claims work over HTTP. Loopable does not push into the runner. A Slack bot, a Lark bot, GitHub, and the clock are ways to create a signal. The path inside does not change. Connections live on Loopable. Agent login lives on the runner.

Shipped today: GitHub, Slack bot, Feishu / Lark bot, Gmail, WeChat, the clock, runners, Codex and Cursor Agent.

The words for the parts are in [concepts.md](concepts.md). Extra runners are in [deploy.md](deploy.md).
