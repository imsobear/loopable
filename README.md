# Loopable

**Build reliable engineering loops across the services and agents you already use.**

Loopable watches the services a team already works in and finishes the work with a coding agent: it picks up a signal, does what the rule says, and writes the result back. Rules run on their own, and every run is recorded so you can see what happened.

Everything runs on your own machine: the app, the database, and the credentials.

## Run it

```bash
pnpm install
pnpm dev            # http://127.0.0.1:4321
```

Other commands:

```bash
pnpm typecheck      # tsc --noEmit
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

A rule says: when this service reports this signal, ask an agent to do this, and write the result back through this action. A rule runs by itself and nobody has to click anything; a per-rule "check this before it goes out" switch is a door left open for later.

The first rule that matches an event is the one that runs, so rules are ordered and the order is editable. Everything else about a rule is a single choice: a name, the trigger event, an instruction for the agent, which agent runs it (the default unless one is pinned), and which action it may propose. Timeouts and models are deliberately absent, because those belong to the agent and would only drift if restated here.

Conditions are the interesting part. "Repositories" and "drafts" are GitHub's words, so they are not columns: each event in a manifest declares the conditions a rule can narrow it by, using the same field type as connection settings, and the rule stores whatever those fields produce as JSON. The rules table therefore knows nothing about GitHub, and the rule form renders conditions it has never seen. Switching a rule to a different event drops conditions that event does not declare, and a stored condition a connector no longer offers is discarded rather than left filtering invisibly.

Connectors may also suggest rules through `ruleTemplates`. Templates are offered on the page and create an ordinary rule when chosen; nothing is ever seeded on a person's behalf.

Rules can be written before anything is connected or installed. The page says what is still missing instead of refusing to save.

## Tasks and the inbox

A task is one run of one rule against one thing: fetch the context, let the agent work, write the result back. It is kept whether it wrote anything or not, because a rule that runs on its own is only worth having if you can see afterwards what it did. The inbox is every task in the order it happened; a rule's own page shows the same records filtered to that rule, next to the settings that produced them.

Signals do not arrive on their own yet, so a task starts by pasting a link on the rule's page. Dry run prepares the result and shows it without writing, which is how a rule gets shaped without leaving marks on a real repository.

A run passes through `preparing` and, if it has something to say, `applying`, ending at `done` with a link to what was written. Two other endings matter as much. `skipped` is the agent answering `NOTHING_TO_DO`, which the prompt asks for explicitly: a rule that runs by itself must be able to stay quiet, or it posts filler. `prepared` is output with nothing written, which today means a dry run and later will mean a rule that asked to be checked first.

The agent never gets a clone or a credential. The pull request body and its patches come down through the API and are written into a scratch directory as files for the agent to read, which is enough for review and comment work and keeps the read-only default honest. Where a diff is too large to include, the omission is stated in the file rather than silently truncated, because an agent that cannot tell it is missing code will hedge every finding or, worse, guess.

Written work is signed, so nobody has to wonder whether a person or a rule wrote it.

## Agents

An agent is a coding agent CLI already installed on the machine. Agents live under `src/agents/` and follow the same manifest and runtime split as connectors, but they are discovered rather than connected: every page load looks for the binary, reads its version, and asks the tool whether it is signed in. Installing or removing a CLI shows up without any setup step.

Because they are discovered, no agent is stored. The only things kept are the choices a person makes: which agent runs the loops, and per agent a permission mode, an optional model, and a timeout.

Two agents ship today, both with a verified non-interactive invocation:

| Agent | Read-only invocation |
| --- | --- |
| Codex | `codex exec --sandbox read-only ...` |
| Cursor Agent | `cursor-agent -p --mode ask --trust ...` |

Three details are load bearing. Agents default to read-only, because preparing a draft never needs to change files. Standard input is closed and the timeout is enforced by Loopable, so an agent that stops to ask a question fails instead of hanging a loop forever. And an agent process never receives Loopable's credentials: `GITHUB_*`, `GH_*` and `LOOPABLE_*` are stripped from its environment, while its own model credentials are left alone.

Detection looks at `PATH`, then at the usual install directories, then asks the login shell where its tools are. That last step matters once Loopable is started by launchd or as a packaged app, where the inherited `PATH` is too small to find anything.

## Layout

| Path | Contents |
| --- | --- |
| `src/connectors/` | The connector contract and one folder per connector |
| `src/agents/` | The agent contract and one folder per agent |
| `src/server/` | Database, secret store, connection service, server functions |
| `src/routes/` | Pages, plus the OAuth endpoints under `api/` |
| `src/components/` | Shell, shared pieces, and shadcn/ui in `ui/` |
| `drizzle/` | Generated migrations |
