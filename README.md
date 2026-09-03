# Loopable

**Build reliable engineering loops across the services and agents you already use.**

A loop runs from a signal in a service you already use, through an agent that prepares real work, to a result you approve. v1 closes one loop entirely on your Mac: a daemon polls GitHub, prepares work with a local coding agent, and puts the result in a supervised inbox. Nothing is posted until you approve it.

## Run

```bash
# start the local UI (127.0.0.1:8787)
node --experimental-strip-types src/cli.ts start
```

Then open http://127.0.0.1:8787 → **Setup → Authorize GitHub**. That is the whole login: GitHub's authorize page opens, you click Authorize, GitHub redirects back to `127.0.0.1`, and the token lands in Keychain. Authorization code flow with PKCE (代码交换证明) on a loopback redirect — the flow GitHub recommends for apps that run on the user's machine.

There is nothing to register and nothing to paste. Loopable ships with one app registration.

```bash
# insert a fake inbox item without GitHub, then click Poll GitHub now
node --experimental-strip-types src/cli.ts demo
```

`setup` starts the daemon in the background and opens the browser.

## The app registration (maintainer only)

One OAuth App exists for all of Loopable, registered once with callback URL `http://127.0.0.1/oauth/github/callback` — no port. GitHub matches loopback redirects without comparing the port ("the `redirect_uri` does not need to match the port specified in the callback URL"), so one registration covers every `LOOPABLE_PORT`.

Its client ID and secret live in `config/oauth-app.json`, which ships with the app. GitHub's own guidance for public clients: "You cannot secure your client secret. You do have to ship the client secret in the application's code, and you should use PKCE." So that secret is a public credential, PKCE is the real protection, and the registration must never be used to gate access to any other service. `gh` does the same thing.

It is an OAuth App rather than a GitHub App, chosen so that one Authorize click is the entire login: scopes `repo notifications`, no per-repo install step, no token expiry, and the notifications API stays available. The known limit is that an organization can block third-party OAuth Apps, and that the grant covers every repo the user can reach. Moving to a GitHub App later needs no code change here — the authorization code flow is identical, token refresh is already handled, and the poller already falls back to search when notifications are unavailable.

A source checkout has no such file. To point a build at your own registration, in order of precedence:

```bash
export LOOPABLE_GITHUB_CLIENT_ID=Ov23li… LOOPABLE_GITHUB_CLIENT_SECRET=…
node --experimental-strip-types src/cli.ts auth oauth-app Ov23li… SECRET  # Keychain
cp config/oauth-app.example.json config/oauth-app.json                    # shipped default
```

## v1

- GitHub only, ~60s poll, laptop catch-up
- Events: assigned issue, review requested, comments on my PR, CI on my PR
- Actions: plan, review, address comments, investigate CI
- Codex if `codex` is on PATH; otherwise a local stub draft
- Approve/reject in the inbox. The agent process does not receive the GitHub token

See `docs/rfc/0001-v1-local-github-runtime.md`.
