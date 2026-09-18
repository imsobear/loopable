# Connectors

A connector is a kind of service: GitHub, Slack bot, Feishu / Lark bot, Gmail, WeChat, the clock. It declares what it can watch and what it can write. It is not an account. A signed-in account (or a pasted Slack or Feishu bot) is a **Connection**. Credentials live in Loopable. Agents never see them.

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

## Slack bot

The Slack connection is a **bot in a Slack app**, not a Slack user login. Loopable does not ship a Slack app, because an office Mac has no public URL for Slack OAuth or Events. The team creates a Slack app, installs it in their workspace, and pastes the Bot User OAuth Token (`xoxb-…`). That token is not a person's Slack account. Loopable polls. Slack never has to reach this machine.

Bot scopes to add before Install to Workspace:

```
channels:history channels:read
groups:history groups:read
im:history im:read
mpim:history mpim:read
chat:write
```

Invite the bot to any channel it should watch. A loop fires on an @mention in those channels, or on a DM to the bot, and replies in the thread.

## Feishu / Lark bot

The Feishu connection is a **bot in a custom Feishu or Lark app**, not a Feishu user login. Loopable does not ship a Feishu app, because an office Mac has no public URL for Feishu events. The team creates a custom app, enables Bot, publishes a version, and pastes App ID and App Secret. That is not a person's Feishu account. Loopable polls groups the bot is in. Feishu never has to reach this machine.

Open platform:

- Feishu (China): `feishu` — [open.feishu.cn/app](https://open.feishu.cn/app)
- Lark (international): `lark` — [open.larksuite.com/app](https://open.larksuite.com/app)

Permissions to add before publishing a version:

```
im:chat:readonly
im:message
im:message.group_msg
im:message:send_as_bot
```

Invite the bot to any group it should watch. A loop fires on an @mention in those groups and replies in the thread. Feishu does not list p2p chats for a bot, so DMs are not polled.
