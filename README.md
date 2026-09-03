# Loopable

**Build reliable engineering loops across the services and agents you already use.**

Loopable watches the services a team already works in, prepares the work with a coding agent, and holds every result for human approval. Nothing is written back to any service until a person approves it.

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
| `runtime.ts` | Server only | Behaviour: authorizing, reading the account, later polling and applying approved actions |

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
