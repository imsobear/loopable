# Loopable

Loopable watches the tools a team already uses and finishes the work with a coding agent. It picks up a signal, does what the loop says, and writes the result back. Loops run on their own. Every run is recorded.

Connect GitHub or Gmail, write a loop, leave a runner on. Pull requests get reviewed, mail gets triaged, assigned issues get a draft. You see what happened in the inbox.

The words for the parts — loop, workflow, runner, and the rest — are in [docs/concepts.md](docs/concepts.md).

## Architecture

Three processes. The agent always runs on a Runner, never on the App or Dispatcher.

```text
Signal → Loop → Task
              → Dispatcher prepares context, picks a Runner
              → Runner runs the Agent
              → Dispatcher writes back
```

```text
Loopable  ──HTTP──  Runner  ──  Agent CLI
(App + Dispatcher)
```

| Process | Does |
| --- | --- |
| **App** | UI, HTTP API, OAuth, the interface runners pull from |
| **Dispatcher** | Watches for signals, prepares tasks, writes back |
| **Runner** | Runs the agent CLI |

App and Dispatcher share one database and stay on the same host. Only one Dispatcher may run against that database. Runners join over HTTP: this machine, or others. Extra machines are in [docs/deploy.md](docs/deploy.md).

## Use it locally

You need Node 22+ and an agent CLI signed in on the runner host (Codex or Cursor Agent).

```bash
npm install -g loopable-cli
loopable start                # App + Dispatcher at http://127.0.0.1:4321
```

Open the app. Connect an account. Write a loop. On Runners, copy the join command:

```bash
loopable runner --url http://127.0.0.1:4321 --token <from Runners>
```

If the dispatcher is not running, the app says so. If no runner has joined, tasks wait.

Connect GitHub from `http://127.0.0.1:4321` on this machine. Extra runners on other machines are in [docs/deploy.md](docs/deploy.md).

State lives in `~/.loopable/`. Credentials stay in the OS keychain.

## Develop

This section is only for working on the code. Running Loopable as a product is the CLI above, not pnpm. Dev uses `~/.loopable-dev/` and a separate keychain namespace, so it does not touch the local deploy database.

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
