# Loopable

Loopable is your team’s own agent. It runs on a machine the team owns, and the team decides what it can do.

Work comes in from Slack, Lark, GitHub, or a schedule. A loop says what to do. Codex, Claude Code, or Cursor Agent does it on a runner, and the answer is written back where it was asked. Every run is recorded. The story is in `docs/narrative.md`.

## Stack

- TanStack Start (React + Vite) for the app, server routes and server functions
- pnpm
- Tailwind CSS with shadcn/ui
- SQLite for state, OS keychain for credentials

## Working agreement

Commit as soon as a feature is finished, one feature per commit.
