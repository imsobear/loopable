# Loopable

Your team’s own agent. It runs on your machine, and you decide what it can do.

A lot of team work waits on one person: a review request, a question in #oncall, a morning check. Someone has to copy it into their own Codex, and if they are busy, it stops. Hosted team agents help, but they run in a cloud sandbox that cannot reach your internal network, logs, or services.

Loopable is a shared agent for small and mid-size teams.

- **Shared.** Work comes in from Slack, Lark, GitHub, or a schedule. A loop says what to do. Nobody has to be there. Every run is recorded in the inbox.
- **Yours.** Codex, Claude Code, or Cursor Agent runs on a machine the team owns. It reaches what that machine reaches, uses the MCP servers and skills you install, and keeps data in-house.

The story is in [docs/narrative.md](docs/narrative.md). The words for the parts — loop, workflow, runner, and the rest — are in [docs/concepts.md](docs/concepts.md).

## Loops you can run today

| Comes in from | Loop | Writes back |
| --- | --- | --- |
| Any trigger | Custom loop: pick what starts it, write your own prompt | Anywhere below, or Inbox only |
| Schedule | Do something on a schedule | Inbox, or a Slack, Lark, or GitHub thread |
| GitHub | Review pull requests | A review, as a comment |
| GitHub | Reply to issues | A comment on the issue |
| Slack bot | Do what I ask the Slack bot (@mention or DM) | A reply in the thread |
| Feishu / Lark bot | Do what I ask the Feishu / Lark bot (@mention in a group) | A reply in the thread |
| WeChat | Do what I ask the WeChat bot | A reply in the chat |
| Gmail | Custom loop: “An email arrives” | Anywhere, such as an email back to the same inbox |

A loop’s answer can go to any connector that accepts it, so a scheduled check can post to #oncall. To ask an agent something once, use **Ask an agent** in the inbox.

## Architecture

Three processes. The agent always runs on a Runner, never on the App or Dispatcher.

<p align="center">
  <img src="docs/architecture.svg" alt="Slack bot, GitHub, and Lark bot into Loopable. A runner pulls the job. Loopable writes back to the same three." width="920" />
</p>

Slack bot, GitHub, and Lark bot send work in. Loopable watches, matches a loop, and queues the job. A Runner pulls it, runs Codex, Claude Code, or Cursor Agent, and Loopable writes the result back.

```text
Loopable  ──HTTP pull──  Runner  ──  Agent CLI
(App + Dispatcher)
```

| Process | Does |
| --- | --- |
| **App** | UI, HTTP API, OAuth, the interface runners pull from |
| **Dispatcher** | Watches for signals, matches loops, queues jobs, writes back |
| **Runner** | Pulls a job over HTTP, runs the agent CLI |

App and Dispatcher share one database and stay on the same host. Only one Dispatcher may run against that database. Runners join over HTTP from that host or other machines. Extra runners are in [docs/deploy.md](docs/deploy.md).

## Run it

The usual setup is one computer that stays on — a Mac in the office is enough. App, Dispatcher, and a Runner all live there. It looks like a spare machine on a desk. For a small team, that is the product.

You need Node 22+ and an agent CLI signed in on that machine (Codex, Claude Code, or Cursor Agent).

```bash
npm install -g loopable-cli
loopable start                # App + Dispatcher, bound on all interfaces
```

On the same computer, open `http://127.0.0.1:4321`. Connect GitHub from that address, signed in as the account your team will send work to (see [GitHub: a shared account](docs/connectors.md#github-a-shared-account)). Write a loop. On Runners, copy the join command and start a runner (this machine is fine):

```bash
npm install -g loopable-cli   # on another machine; already done here
loopable runner --url http://<LAN-IP>:4321 --token <from Runners>
```

If the dispatcher is not running, the app says so. If no runner has joined, tasks wait.

State lives in `~/.loopable/`. Credentials stay in the OS keychain.

Another always-on runner, or opening the UI from a second computer, is in [docs/deploy.md](docs/deploy.md). A company VM is optional later, only if this box is not enough.

## Develop

This section is only for working on the code. Running Loopable as a product is the CLI above, not pnpm. Dev uses `~/.loopable-dev/` and a separate keychain namespace, so it does not touch the team database.

TanStack Start (React + Vite), SQLite, Tailwind. Tests are Vitest.

```bash
pnpm install
pnpm dev            # App + Dispatcher + Runner, ~/.loopable-dev, hot reload
pnpm typecheck
pnpm test
pnpm db:generate    # after changing src/server/db/schema.ts
pnpm db:studio
```

`pnpm runner` is only for a second machine while `pnpm dev` is already running.

The public site is `site/` (static HTML, Vite). `pnpm site:dev` to preview. `pnpm site:build` writes `site/dist` for a Cloudflare Worker with assets only. `pnpm site:deploy` when you are ready to publish it.

| Path | Contents |
| --- | --- |
| `src/connectors/` | One folder per connector: `manifest.ts` (browser-safe) and `runtime.ts` (server) |
| `src/agents/` | One folder per agent, same split |
| `src/server/` | Database, secrets, queue, server functions |
| `src/dispatcher/` | Dispatcher process |
| `src/runner/` | Runner process |
| `src/routes/` | Pages and `/api/` |
| `drizzle/` | Migrations |

A new connector is a folder plus one line in `src/connectors/manifests.ts` and `src/connectors/runtimes.ts`. See [docs/connectors.md](docs/connectors.md).
