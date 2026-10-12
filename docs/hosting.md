# Hosting

How the hosted service at loop.goodone.si is set up and deployed. This is for whoever runs the service; people using Loopable only need [runners.md](runners.md).

## What runs where

| Part | Where | What it does |
| --- | --- | --- |
| App Worker | Cloudflare Worker `loopable`, at loop.goodone.si | Front page, the app, sign-in, the API runners call |
| Dispatcher | Cloudflare Container beside the Worker | Watches services, queues jobs, writes answers back; applies migrations on start |
| Database | A libSQL server, such as Turso | Every workspace's loops, tasks, connections, encrypted secrets |
| Runners | People's own machines | Run the agent; installed with `npm install -g loopable-cli` |

The Worker wakes the dispatcher on every request and once a minute from a cron trigger. There is one dispatcher for everyone.

## One-time setup

1. **Database.** Create a libSQL database, such as `turso db create loopable`, and an auth token for it.
2. **GitHub OAuth app.** On GitHub, under Settings → Developer settings → OAuth Apps, create an app with:
   - Homepage URL: `https://loop.goodone.si`
   - Authorization callback URL: `https://loop.goodone.si/api/connectors/github/callback`

   That one callback covers both signing in and connecting GitHub. The callback tells them apart by the `state` it gets back.
3. **Google OAuth client** (for signing in with Google, and for Gmail). In Google Cloud, create a client of type *Web application* with the authorized redirect URI `https://loop.goodone.si/api/connectors/gmail/callback`. It covers both signing in with Google and connecting Gmail.

   Enable the Gmail API. On the OAuth consent screen, add the scopes `openid`, `email` and `profile` beside the Gmail ones, and publish the app; while it is in *Testing*, only the test users listed there can sign in.
4. **Secrets on the Worker.** From a checkout, signed in to wrangler:

   ```bash
   ./scripts/hosting-secrets.sh
   ```

   It asks for each value and generates `LOOPABLE_MASTER_KEY`. Keep a copy of the master key: every stored credential is encrypted with it.
5. **Deploy secrets for GitHub Actions.** In the repository settings, add `CLOUDFLARE_API_TOKEN` (with Workers, Containers and DNS edit) and `CLOUDFLARE_ACCOUNT_ID`.

## Deploying

Run the **Deploy** workflow from the Actions tab. It runs typecheck and tests, builds the Worker and the dispatcher's container image (which needs Docker, so it is built there), and deploys both. Database migrations run when the dispatcher starts.

## Moving loop.goodone.si to the app

loop.goodone.si used to point at the old site Worker, `loopable-web`. To hand it to the app:

1. In the Cloudflare dashboard, under Workers & Pages → `loopable-web` → Settings → Domains & Routes, remove `loop.goodone.si`.
2. Run the **Deploy** workflow with **Also deploy the old site address as a redirect** ticked. The app takes loop.goodone.si, and `loopable-web.sobear-me.workers.dev` starts redirecting there.
3. Check `https://loop.goodone.si` shows the front page, and that signing in works.

## Limits

Each workspace can have up to 20 loops and 5 runners, and a loop is looked at no more than once a minute. Change them with the Worker variables `LOOPABLE_LIMIT_LOOPS`, `LOOPABLE_LIMIT_RUNNERS` and `LOOPABLE_LIMIT_MIN_POLL_MS`.

## Trying hosted mode locally

```bash
LOOPABLE_HOSTED=1 LOOPABLE_MASTER_KEY=local LOOPABLE_HOME=$PWD/.hosted PORT=4321 pnpm dev
```

This runs the app, sign-in and workspaces on a local file database. Signing in uses the shipped GitHub app, whose callback is registered on port 4321, and the shipped Google client. Open the app at `http://127.0.0.1:4321`, not `localhost`, and stop `pnpm dev` first since it uses the same port. Connect a runner with `node --experimental-strip-types src/cli.ts login --url http://127.0.0.1:4321`.
