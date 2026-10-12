# Connectors

A connector is a kind of service: GitHub, Slack bot, Feishu / Lark bot, Gmail, WeChat, the clock. It declares what it can watch and what it can write. It is not an account. A signed-in account (or a pasted Slack or Feishu bot) is a **Connection**, and belongs to one workspace. Credentials are encrypted in the service. Agents never see them.

Each connector is a folder under `src/connectors/`. It exports two halves, and the split is load bearing:

| File | Runs where | Contents |
| --- | --- | --- |
| `manifest.ts` | Browser and server | Pure data: name, icon, how to authorize, which signals it watches, which actions it can propose, which settings a connection has |
| `runtime.ts` | Server only | Behaviour: authorizing, reading the account, resolving work items, carrying out actions |

The pages render entirely from manifests. Adding a connector means adding a folder and one line in `src/connectors/manifests.ts` and `src/connectors/runtimes.ts`. No page changes. The contract lives in `src/connectors/types.ts`.

## GitHub: which account

Signing in to Loopable with GitHub only says who you are. Connecting GitHub is a separate step, and it is the account Loopable watches and writes as:

- **Work arrives the normal way.** Request a review from it, or assign it an issue. The workflows watch `review-requested:@me` and `assignee:@me`, and `@me` is the connected account.
- **What it writes appears under its name.** Reviews and comments come from that account.
- **Its access is what that account can reach.** OAuth asks for the `repo` scope, but the account only reaches repositories it has access to.

Which account to connect:

- **Your own account** is the simplest. Every review requested from you and every issue assigned to you is picked up, and Loopable answers as you.
- **An account made for this**, such as `acme-loopable`, suits a team. Work sent to it is clearly for Loopable, what it writes is clearly from Loopable, and it does not stop working when someone leaves. Create it with an email address the team controls and add it to the repositories it should work in. On paid org plans it takes a seat.

GitHub authorizes whichever account the browser is signed in as, so to connect a different account than your own, use a private window that holds only that session. If jobs clone private repositories, sign the runner's git in as an account that can read them.

A GitHub App was considered and set aside for now. An App cannot be requested as a reviewer or assigned an issue, so the workflows would need labels or mentions instead. Its installation tokens also expire after an hour, which does not suit the runner's git.

## GitHub OAuth

Nobody using Loopable registers an OAuth app. They click Connect.

- **Hosted**, Loopable's own GitHub OAuth app has the callback `https://loop.goodone.si/api/connectors/github/callback`. Signing in with GitHub comes back to the same address, so one registration covers both. Setup is in [hosting.md](hosting.md).
- **Locally** (`pnpm dev`), the app shipped in this repo has a loopback callback, `http://127.0.0.1/api/connectors/github/callback`, registered without a port: GitHub matches loopback on host and path only.

Login is the OAuth 2.0 authorization code flow with PKCE (S256).

**Treat the shipped client secret as public, not as a credential.** GitHub lists `client_secret` as required at the token endpoint and does not distinguish between public and confidential clients, so a browser-redirect login cannot hide one. The GitHub CLI embeds its secret for the same reason.

PKCE is what actually protects a login: an intercepted authorization code cannot be redeemed by anyone else, because the exchange must present the verifier held only by the process that started the flow.

What a copied client id and secret allow is impersonation: a different app can show "Loopable" on GitHub's consent screen. They give no access to any account, mint no token without a person clicking Authorize, and cannot reach tokens already stored.

To use your own registration (GitHub Enterprise, or a private app), set `LOOPABLE_GITHUB_CLIENT_ID` and `LOOPABLE_GITHUB_CLIENT_SECRET`, or put them in gitignored `config/oauth-app.json`.

## WeChat

WeChat is reached through Tencent's iLink bot API. Loopable speaks it directly rather than running a plugin. Tencent [documents the protocol](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md). Nothing needs registering.

Connecting means scanning. The connector hands over what the code should contain and a way to ask how the scan is going; the page renders it and asks every couple of seconds. A code lasts about two minutes. The token never reaches the browser: a confirmed scan is saved server-side.

A loop fires when someone messages the bot, and the answer goes back to whoever asked. WeChat only delivers a reply into a conversation someone started, so it is a place to answer, not a place to send news to.

## Gmail

Gmail is connected by signing in with Google. Hosted, Google sends the browser back to `https://loop.goodone.si/api/connectors/gmail/callback`.

- **Starts when an email arrives.** A custom loop on “An email arrives” checks the inbox every 30 minutes. It can be narrowed with Gmail search terms, skip mail the account sent, and skip mail that needs nothing, after one quick look at what arrived.
- **Email this account.** As an answer, Gmail sends to the connected account itself, the way a bot answers whoever asked. When the run started from an email in the same inbox, the answer joins that thread.

Gmail asks for `gmail.readonly` and `gmail.send`. A connection made before sending was offered has to be reconnected to send.

## Slack bot

The Slack connection is a **bot in a Slack app**, not a Slack user login. For now you create the Slack app yourself, install it in your Slack workspace, and paste the Bot User OAuth Token (`xoxb-…`). That token is not a person's Slack account. Loopable polls, so Slack never has to send it anything. An "Add to Slack" button, with Slack sending events, is planned now that Loopable has a public address.

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

The Feishu connection is a **bot in a custom Feishu or Lark app**, not a Feishu user login. You create a custom app, enable Bot, publish a version, and paste App ID and App Secret. That is not a person's Feishu account. Loopable polls the groups the bot is in, so Feishu never has to send it anything.

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
