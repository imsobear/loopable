# Loopable

Prompt it when you're there; loop it when you're not. Loopable turns the work that keeps coming back into agent workflows, set up in the browser at loop.goodone.si. They run on the user's own machine with Codex or Claude Code, and answer where they were asked.

Work comes in from GitHub, Slack, Lark, email, or the clock. A loop says what to do. Codex, Claude Code, or Cursor Agent does it on a runner on the user's machine, and the answer is written back where it was asked. Every run is recorded. The story is in `docs/narrative.md`.

## Stack

- TanStack Start (React + Vite) for the app, server routes and server functions
- pnpm
- Tailwind CSS with shadcn/ui
- SQLite for state (libSQL when hosted), encrypted secrets when hosted, the macOS keychain (or a file elsewhere) in `pnpm dev`
- Hosted on Cloudflare: the app as a Worker, the dispatcher as a Container; see `docs/hosting.md`
- A desktop app in `desktop/`, native UI in Go with MyGo, running the same engine (dispatcher, runner, API) as a Node process beside it; see `docs/desktop.md`

## Workspaces

Everything a user sets up belongs to a workspace, and every query is filtered by the one in scope (`src/server/workspace.ts`). The scope is set at the edge: a signed-in request, a runner's token, the row the dispatcher picked up. A new query on a workspace's table filters by `workspaceId()`; a new edge sets the scope with `withWorkspace`. Locally there is one workspace, "local".

## Working agreement

Commit as soon as a feature is finished, one feature per commit, on a branch off the latest `main`. Then push and open the pull request straight away, without asking first. Changes reach `main` through that pull request once CI passes; merging deploys. Migrations run before the new code is live, so they only ever add. See `docs/release.md`.
