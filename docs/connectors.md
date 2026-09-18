# Connectors

A connector is a kind of service: GitHub, Gmail, WeChat, the clock. It declares what it can watch and what it can write. It is not an account. A signed-in account is a **Connection**. Credentials live in Loopable. Agents never see them.

Each connector is a folder under `src/connectors/`. It exports two halves, and the split is load bearing:

| File | Runs where | Contents |
| --- | --- | --- |
| `manifest.ts` | Browser and server | Pure data: name, icon, how to authorize, which signals it watches, which actions it can propose, which settings a connection has |
| `runtime.ts` | Server only | Behaviour: authorizing, reading the account, resolving work items, carrying out actions |

The pages render entirely from manifests. Adding a connector means adding a folder and one line in `src/connectors/manifests.ts` and `src/connectors/runtimes.ts`. No page changes. The contract lives in `src/connectors/types.ts`.

## GitHub OAuth

End users never register an OAuth app. They click Connect. Loopable ships one GitHub app (and one Google app) whose callback is loopback:

```
http://127.0.0.1/api/connectors/github/callback
```

Register that URL without a port: GitHub matches loopback on host and path only.

Login is the OAuth 2.0 authorization code flow with PKCE (S256) over a loopback redirect. A LAN `LOOPABLE_BASE_URL` is only the address runners join; Connect GitHub still uses `127.0.0.1` on this machine.

**Treat the shipped client secret as public, not as a credential.** GitHub lists `client_secret` as required at the token endpoint and does not distinguish between public and confidential clients, so a browser-redirect login cannot hide one. The GitHub CLI embeds its secret for the same reason.

PKCE is what actually protects a login: an intercepted authorization code cannot be redeemed by anyone else, because the exchange must present the verifier held only by the process that started the flow.

What a copied client id and secret allow is impersonation: a different app can show "Loopable" on GitHub's consent screen. They give no access to any account, mint no token without a person clicking Authorize, and cannot reach tokens already stored on a user's computer.

To use your own registration (GitHub Enterprise, or a private app), set `LOOPABLE_GITHUB_CLIENT_ID` and `LOOPABLE_GITHUB_CLIENT_SECRET`, or put them in gitignored `config/oauth-app.json`.

## WeChat

WeChat is reached through Tencent's iLink bot API. Loopable speaks it directly rather than running a plugin. Tencent [documents the protocol](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md). Nothing needs registering.

Connecting means scanning. The connector hands over what the code should contain and a way to ask how the scan is going; the page renders it and asks every couple of seconds. A code lasts about two minutes. The token never reaches the browser: a confirmed scan is saved server-side.

There are no WeChat workflows yet. Binding an account is worth having on its own.
