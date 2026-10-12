# Runners

Loopable is hosted at [loop.goodone.si](https://loop.goodone.si). The one thing you run yourself is a runner: it takes your workspace's jobs and runs your coding agent on your machine, with your code, your tools, and your logins.

## Connect a machine

You need Node 22+ and a coding agent signed in on that machine: Codex, Claude Code, or Cursor Agent.

```bash
npm install -g loopable-cli
loopable login
loopable runner
```

`loopable login` shows a code and opens the browser. Check the code matches and approve it, signed in. The machine is then connected to your workspace; it remembers this in `~/.loopable/runner.json`, which only you can read. `loopable runner` runs until you stop it, so leave it running in a terminal or under a service manager.

A machine with no browser can join with the token on the Runners page instead:

```bash
loopable runner --url https://loop.goodone.si --token <from Runners>
```

`loopable logout` forgets the workspace.

## Folders

Loops that read your code, such as chat bots and scheduled checks, work in a folder you name on the loop. It is relative to the runner's home, such as `code/web`, so every runner finds its own copy there. Check the repository out at the same path on each machine that should take those jobs. A runner without the folder fails the job with a message saying so.

GitHub reviews and replies clone the repository with the machine's git, so sign git (or `gh`) in as an account that can read those repositories.

## More than one machine

Run `loopable login` and `loopable runner` on each. Every job goes to an online runner that has the loop's agent signed in, preferring one that is idle. A workspace can have up to 5 runners.

## Upgrading

```bash
npm install -g loopable-cli
```

Then restart `loopable runner`. The Runners page shows each runner's version and flags any that are older than the service. An older runner keeps working, but does not take jobs that need something newer, such as loops that work in a folder.
