# Runners

Loopable is hosted at [loop.goodone.si](https://loop.goodone.si). The one thing you run yourself is a runner: it takes your workspace's jobs and runs your coding agent on your machine, with your code, your tools, and your logins.

## Connect a machine

You need Node 22+ and a coding agent signed in on that machine: Codex, Claude Code, or Cursor Agent.

Copy the two lines from the Runners page, which has your workspace's token in them:

```bash
npm install -g loopable-cli
loopable runner --token <from Runners>
```

The first `loopable runner --token` connects the machine to your workspace and remembers it in `~/.loopable/runner.json`, which only you can read. After that it is just `loopable runner`.

The runner starts in the background and keeps running after you close the terminal. `loopable runner` waits until it has joined, so a wrong token is said straight away.

| Command | Does |
| --- | --- |
| `loopable status` | Whether it is running, and where its log is |
| `loopable logs` | The log; `-f` keeps following it |
| `loopable stop` | Stops it |

It does not start again by itself after the machine restarts; run `loopable runner` again. On a server or in a container, run `loopable runner --foreground` under the service manager instead, and set `LOOPABLE_RUNNER_TOKEN` rather than passing `--token`: a token from the environment is not written to disk.

Anyone with the token can add a runner to your workspace. If it gets out, rotate it on the Runners page: runners that already joined keep working.

`loopable logout` stops the runner and forgets the workspace.

## From the Runners page

- **On / off.** A runner that is off stays connected but takes no new jobs; jobs waiting for it go to another runner.
- **Update.** When a newer `loopable-cli` is out, a runner installed from npm shows **Update to vX**. It finishes the job it is on, installs the new version, and restarts itself. If npm cannot install it, for example for lack of permission, the page says why; update it by hand then.
- **Forget.** Stops the runner and removes it. It finishes the job it is on first. Running `loopable runner` on that machine again joins it again.

## Folders

Loops that read your code, such as chat bots and scheduled checks, work in a folder you name on the loop. It is relative to the runner's home, such as `code/web`, so every runner finds its own copy there. Check the repository out at the same path on each machine that should take those jobs. A runner without the folder fails the job with a message saying so.

GitHub reviews and replies clone the repository with the machine's git, so sign git (or `gh`) in as an account that can read those repositories.

## More than one machine

Run the same `loopable runner --token` on each. Every job goes to an online runner that has the loop's agent signed in, preferring one that is idle. A workspace can have up to 5 runners.

## Upgrading

```bash
npm install -g loopable-cli
```

Then `loopable stop` and `loopable runner` to restart it on the new version. The Runners page shows each runner's version and flags any that are older than the service. An older runner keeps working, but does not take jobs that need something newer, such as loops that work in a folder.
