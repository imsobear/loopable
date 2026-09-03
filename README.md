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

Connections are rows, not a single slot per connector, so the same connector can hold several accounts.

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

Login is the OAuth 2.0 authorization code flow with PKCE over a loopback redirect. GitHub still requires the client secret at the token endpoint, and a client running on a user's machine cannot hide it; PKCE is what actually secures the exchange. This is the same trade-off the GitHub CLI makes.

## Layout

| Path | Contents |
| --- | --- |
| `src/connectors/` | The connector contract and one folder per connector |
| `src/server/` | Database, secret store, connection service, server functions |
| `src/routes/` | Pages, plus the OAuth endpoints under `api/` |
| `src/components/` | Shell, shared pieces, and shadcn/ui in `ui/` |
| `drizzle/` | Generated migrations |
| `legacy/` | The proof of concept: polling, rules, agent runs, publishing. Being ported feature by feature |
