# The desktop app

Loopable for one Mac: the loops, the inbox, the connectors and the agents in a native window, with no account and nothing hosted. Everything runs on the machine, and the window is the only way in.

It lives in `desktop/`, written in Go with [MyGo](https://mygo.egoist.dev), whose native UI draws the screens on the GPU: no web page, no webview. The engine, everything that is not a screen, is the same TypeScript as the hosted service, bundled into one file and run as a Node process the app starts and stops.

## What runs where

| Part | Where | Does |
| --- | --- | --- |
| App | `desktop/*.go` | The window, the menu bar icon, notifications, open at login, settings |
| Engine | `src/desktop/engine.ts`, built to `desktop/resources/engine/engine.mjs` | The dispatcher (polls connectors, writes answers back), a runner in the same process, and a JSON API on loopback for the screens |

The app starts the engine with a token it makes up at each launch, in the environment, and the engine takes requests only with that token, only on 127.0.0.1. No other program on the machine can ask it anything. When the app's stdin closes, the engine stops.

The engine's data lives in `~/Library/Application Support/Loopable/data`: the SQLite file, and each run's log and scratch files. Credentials go in the keychain under the `loopable-desktop` namespace. The CLI runner's `~/.loopable` and `pnpm dev`'s `~/.loopable-dev` are untouched.

The runner is `src/desktop/local-runner.ts`: the CLI runner with the HTTP taken out. It joins, heartbeats, claims and completes through the same functions the API routes call, so the database sees one runner, this machine, with the agents it finds installed.

## Connecting services

Slack, Feishu and WeChat connect as they do on the web: a pasted bot token, or a scan.

GitHub and Gmail connect through Loopable's own apps, built into the desktop app, so nobody using it registers anything. The desktop app is a public client: it ships client IDs and keeps no secret.

- **GitHub.** An OAuth app with *device flow* turned on, in its settings on GitHub. The app shows a code to enter on github.com and polls until GitHub hands over a token. No callback address and no client secret.
- **Google.** A client of type *Desktop app* in Google Cloud, with the Gmail API enabled. Google calls what it gives a desktop client a secret, but does not treat it as one. The browser comes back to the engine's loopback address, which desktop clients may use on any port.

`scripts/build-engine.mjs` writes them into the engine directory as `oauth-apps.json`, from `LOOPABLE_DESKTOP_GITHUB_CLIENT_ID`, `LOOPABLE_DESKTOP_GMAIL_CLIENT_ID` and `LOOPABLE_DESKTOP_GMAIL_CLIENT_SECRET` when releasing, or from the `desktop` entry of the gitignored `config/oauth-app.json` when developing (see `config/oauth-app.example.json`). Without them the build says which connector it lacks, and the app shows that connector as not available. These are not the hosted service's apps: that GitHub app needs no device flow, and its Google client is a web client.

## Developing

Needs Go 1.27 or later and Node 22 or later. From the repository root:

```bash
pnpm desktop
```

That builds the engine (`scripts/build-engine.mjs`: esbuild, the migrations, and libsql installed flat with npm) into `desktop/resources/engine`, then runs the app with `go tool mygo dev`, which rebuilds it as the Go changes. The engine is built once; run `pnpm build:engine` after changing anything under `src/`. `LOOPABLE_DEBUG=1`, which `pnpm desktop` sets, echoes the engine's log to the terminal.

The screens draw without a window in tests, as pictures and as text, and one test loads them from a real engine in a throwaway folder:

```bash
cd desktop && CGO_ENABLED=0 go test ./...
```

`LOOPABLE_SHOTS=/tmp/shots go test ./...` writes a PNG of every screen there, which is the quickest way to look at a change.

## Packaging

```bash
pnpm build:engine && cd desktop && go tool mygo build
```

That makes `desktop/build/darwin-arm64/Loopable.app` and a disk image, signed ad hoc until `mygo.json` names a Developer ID identity and a notarization profile; see MyGo's [distribution](https://mygo.egoist.dev/docs/distribution) docs. The engine directory ships inside the app's resources, and MyGo signs libsql's native module with the rest.

The app has no updater yet. Adding one is MyGo's `updates` configuration and a release of the built app on GitHub.
