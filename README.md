# Loopable

**Build reliable engineering loops across the services and agents you already use.**

Loopable watches the services a team already works in and finishes the work with a coding agent: it picks up a signal, does what the rule says, and writes the result back. Rules run on their own, and every run is recorded so you can see what happened.

Everything runs on your own machine: the app, the database, and the credentials.

## Run it

```bash
pnpm install
pnpm dev            # http://127.0.0.1:4321
pnpm daemon         # the engine: runs the queued work
```

Two processes, on purpose. The app is the windows and the buttons; the daemon does the work, so a rule keeps running when nobody has the app open. They talk only through SQLite: the app queues a task and the daemon picks it up. If the daemon is not running, the app says so rather than letting work pile up in silence.

Other commands:

```bash
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest
pnpm db:generate    # write a migration after changing the schema
pnpm db:studio      # browse the local database
```

State lives in `~/.loopable/loopable.sqlite` (override with `LOOPABLE_HOME` or `LOOPABLE_DB`). Migrations run automatically when the app first touches the database. Credentials never go in the database: on macOS they go in the keychain, elsewhere in a `0600` file under the data directory.

## Connectors

A connector is a folder under `src/connectors/`. It exports two halves, and the split is load bearing:

| File | Runs where | Contents |
| --- | --- | --- |
| `manifest.ts` | Browser and server | Pure data: name, icon, how to authorize, which signals it watches, which actions it can propose, which settings a connection has |
| `runtime.ts` | Server only | Behaviour: authorizing, reading the account, resolving work items, carrying out actions |

The pages render entirely from manifests, so adding a connector means adding a folder and one line in `src/connectors/manifests.ts` and `src/connectors/runtimes.ts`. No page changes. The contract lives in `src/connectors/types.ts`.

Connections are rows rather than a single slot per connector, so the storage side already holds several accounts. The product exposes one account per connector for now, which each manifest states through `allowsMultipleAccounts`: a browser redirect authorizes whichever account the provider is already signed in as, so a second account cannot be reached without signing out there first.

### The GitHub app registration (maintainer only)

End users never register anything; they click Connect. One OAuth App ships with Loopable, configured either through the environment:

```bash
export LOOPABLE_GITHUB_CLIENT_ID=...
export LOOPABLE_GITHUB_CLIENT_SECRET=...
```

or through `config/oauth-app.json`, which is gitignored:

```json
{ "clientId": "Ov23...", "clientSecret": "..." }
```

Register the callback URL without a port, because loopback redirects match on host and path only:

```
http://127.0.0.1/api/connectors/github/callback
```

Login is the OAuth 2.0 authorization code flow with PKCE (S256) over a loopback redirect.

**Treat the client secret as public, not as a credential.** GitHub lists `client_secret` as required at the token endpoint and does not distinguish between public and confidential clients, so a browser-redirect login cannot avoid shipping it, and anything running on a user's machine can be read. The GitHub CLI embeds its secret for the same reason.

PKCE is what actually protects a login: an intercepted authorization code cannot be redeemed by anyone else, because the exchange must present the verifier held only by the process that started the flow. That matters most for a loopback redirect, where another local process might race for the code.

What a copied client id and secret allow is impersonation: a different app can show "Loopable" on GitHub's consent screen. They give no access to any account, mint no token without a person clicking Authorize, and cannot reach tokens already stored on a user's machine. Anyone who wants their own registration, or who is on GitHub Enterprise, can set the environment variables above instead.

## Rules

A connector declares **workflows**: whole jobs, named the way a person would name them. "Review pull requests I am asked to review" is one. A workflow owns what to watch for, what to ask the agent, and where the answer is written; a **rule** is one instance of a workflow with its few knobs set. Rules run by themselves and nobody has to click anything; a per-rule "check this before it goes out" switch is a door left open for later.

The prompt belongs to the workflow rather than to the rule. Reviewing a pull request is a well-understood job, and a connector that knows how to do it should get it right once instead of leaving every person to rediscover it in an empty box. A rule may add guidance — what is true of your team rather than of the job — and that guidance is appended to the workflow's prompt, never substituted for it, so a rule cannot quietly turn a review into something else. Timeouts and models are deliberately absent, because those belong to the agent and would only drift if restated here.

Knobs are the interesting part. "Repositories" and "drafts" are GitHub's words, so they are not columns: each workflow declares the settings a rule can narrow it by, using the same field type as connection settings, and the rule stores whatever those fields produce as JSON. The rules table therefore knows nothing about GitHub, and the rule form renders knobs it has never seen. A stored setting a connector no longer offers is discarded rather than left narrowing invisibly.

The first rule that matches something is the one that runs, so rules are ordered and the order is editable. Creating a rule is choosing a workflow: every workflow already defaults everything it needs, so the form is for changing one afterwards rather than for filling one in. A workflow that stops being offered leaves its rules readable and deletable but not runnable, said plainly rather than failing later.

Rules can be written before anything is connected or installed. The page says what is still missing instead of refusing to save.

## Tasks and the inbox

A task is one run of one rule against one thing: fetch the context, let the agent work, write the result back. It is kept whether it wrote anything or not, because a rule that runs on its own is only worth having if you can see afterwards what it did. The inbox is every task in the order it happened; a rule's own page shows the same records filtered to that rule, next to the settings that produced them.

A task usually starts on its own, from a poll. A rule can also be pointed at a link on its own page, which is how one gets shaped without waiting for a real signal to turn up; dry run prepares the result and shows it without writing, so shaping leaves no marks on a real repository.

## Watching

Nothing calls Loopable back. It runs on a laptop, which has no address for GitHub to reach and no business having one, so the daemon asks instead: every two minutes it asks each rule's connector what matches right now. A connector answers with the present state rather than with what changed, because working out what is new needs to know what has already been acted on, and only Loopable knows that.

What stops a rule acting twice is the key the connector puts on each signal, which has to change exactly when there is something new to do and not otherwise. A pull request is keyed by its head commit: a new push is worth reviewing again, another comment on it is not. An assigned issue is keyed by the issue alone, since being assigned it twice is not a reason to write a second plan.

**The first look never acts.** Whatever is already waiting when a rule is created is that rule's backlog, and turning on a rule is not a request to run an agent over a review queue that has been piling up for a month. It is recorded rather than discarded, so the rule's page can offer to run it on purpose. A look that fails does not spend that first look, or a token that expired overnight would swallow the backlog silently.

When two rules want the same pull request, the one that comes first in the list gets it and the other records that it was taken. Order already decides which rule runs; this is the same rule applied to the only case where it could be ambiguous.

A run passes through `preparing` and, if it has something to say, `applying`, ending at `done` with a link to what was written. Two other endings matter as much. `skipped` is the agent answering `NOTHING_TO_DO`, which the prompt asks for explicitly: a rule that runs by itself must be able to stay quiet, or it posts filler. `prepared` is output with nothing written, which today means a dry run and later will mean a rule that asked to be checked first.

## The queue

Pressing Run does not run anything. It checks the link, writes a `queued` task, and returns; the daemon claims it a moment later. The queue is the tasks table itself, which is what lets a run survive both processes being restarted.

A claim is a lease, renewed while the work goes on. That is what tells a run still in progress apart from one whose worker died: nothing else can, once the process holding it is gone. A lapsed lease is picked up again, and attempts are counted so a task that kills its worker cannot do so forever. Renewal is also when a stop request is noticed, since the person asking is in the other process and the database is where they leave the message.

Retries are deliberately lopsided, because the phases cost wildly different amounts. Fetching and writing are milliseconds and fail for reasons that pass, so a connector marks those as transient and they are tried again with a growing wait. The agent is minutes of compute and real money, and a prompt that failed will fail the same way, so it is never repeated. Once output is stored it stays stored: a write that fails because GitHub returned 502 resumes at the write, and nobody pays for the review twice.

The agent never gets a clone or a credential. The pull request body and its patches come down through the API and are written into `~/.loopable/runs/<task>/` as files for the agent to read, which is enough for review and comment work and keeps the read-only default honest. Where a diff is too large to include, the omission is stated in the file rather than silently truncated, because an agent that cannot tell it is missing code will hedge every finding or, worse, guess. What the agent replied is kept alongside them, because when a reply cannot be made sense of, the reply is the only thing worth looking at.

Written work is signed, so nobody has to wonder whether a person or a rule wrote it.

## Reviews that point at lines

A review that describes a change back to the person who wrote it is worth little. A workflow therefore says what shape its answer takes: prose to post, or a summary plus findings that get attached to particular lines.

Anchoring is the whole difficulty, because GitHub refuses an entire review if one comment names a line outside the diff. One wrong number would lose everything the agent had to say, so every anchor is checked against the diff first and a finding that cannot be placed is moved into the body with its location written out: losing the point is worse than losing its position. Where there is nothing to check against, nothing is anchored rather than anchored on a guess.

The diff the agent reads carries its own line numbers, written into each line, and removed lines are deliberately left unnumbered so they cannot be aimed at. An agent can work the numbers out from the `@@` headers and gets them wrong often enough to point a few lines off, which in a review is worse than useless.

The reply is read leniently at the edges and strictly inside. An agent that answered in prose is taken at its word and gets a review with no anchors. Several blocks may look like the answer — a streamed reply can arrive twice, once in pieces and once whole — so each is tried and the first that parses wins. An agent that plainly meant to answer in JSON and produced nothing readable is an error, because the alternative is posting the wreckage to somebody's pull request.

## Agents

An agent is a coding agent CLI already installed on the machine. Agents live under `src/agents/` and follow the same manifest and runtime split as connectors, but they are discovered rather than connected: every page load looks for the binary, reads its version, and asks the tool whether it is signed in. Installing or removing a CLI shows up without any setup step.

Because they are discovered, no agent is stored. The only things kept are the choices a person makes: which agent runs the loops, and per agent a permission mode, an optional model, and a timeout.

Two agents ship today, both with a verified non-interactive invocation:

| Agent | Read-only invocation |
| --- | --- |
| Codex | `codex exec --sandbox read-only ...` |
| Cursor Agent | `cursor-agent -p --output-format stream-json --mode ask --trust ...` |

Four details are load bearing. Agents default to read-only, because preparing a draft never needs to change files. Standard input is closed and the timeout is enforced by Loopable, so an agent that stops to ask a question fails instead of hanging a loop forever. An agent process never receives Loopable's credentials: `GITHUB_*`, `GH_*` and `LOOPABLE_*` are stripped from its environment, while its own model credentials are left alone. And each agent runs in its own process group, because these tools start helpers of their own and signalling just the process we launched leaves those behind, reparented to init and still working.

Everything an agent prints is written to `agent.log` in its run directory while it prints it, and the task page tails it. Cursor Agent is asked for a stream of events rather than one block at the end, which is what makes that log arrive during the run instead of after it; the events are turned into ordinary lines, and the final answer is read from the field that carries it rather than from whatever reached standard output. Run directories are kept afterwards, since they are the first place to look when a run goes wrong, and swept after a week.

Detection looks at `PATH`, then at the usual install directories, then asks the login shell where its tools are. That last step matters once Loopable is started by launchd or as a packaged app, where the inherited `PATH` is too small to find anything.

## Layout

| Path | Contents |
| --- | --- |
| `src/connectors/` | The connector contract and one folder per connector |
| `src/agents/` | The agent contract and one folder per agent |
| `src/server/` | Database, secret store, connections, the queue and the worker, server functions |
| `src/daemon/` | The engine process: single instance, signals, its own logging |
| `src/routes/` | Pages, plus the OAuth endpoints under `api/` |
| `src/components/` | Shell, shared pieces, and shadcn/ui in `ui/` |
| `drizzle/` | Generated migrations |
