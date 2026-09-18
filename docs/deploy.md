# Deploy

Loopable is three processes. This is local deploy: one machine you control, plus runners that can reach it. Changing the code is `pnpm dev`, not this page.

| Process | Does | Command |
| --- | --- | --- |
| **App** | UI, HTTP API, OAuth, the interface runners pull from | `loopable start` |
| **Dispatcher** | Watches for signals, matches loops, queues jobs, writes back | (started with the App) |
| **Runner** | Pulls a job over HTTP, runs the agent CLI | `loopable runner` |

The Dispatcher is always a single instance. Two of them on one database would fight over every task. Agents always run on a Runner. The runner claims work from `/api/runners/claim`. Loopable does not push jobs into the runner. Connections never leave the App and Dispatcher.

Names for the parts are in [concepts.md](concepts.md).

## App and Dispatcher

App and Dispatcher share a SQLite file, so they run on the same host. Runners talk to the App over HTTP, so they can be that host or other machines.

Install the CLI once. Node 22+ is required.

```bash
npm install -g loopable-cli
loopable start                # bound on 0.0.0.0:4321; open http://127.0.0.1:4321
```

`start` runs App and Dispatcher together. State lives in `~/.loopable/loopable.sqlite` (override with `LOOPABLE_HOME` or `LOOPABLE_DB`). Credentials stay in the OS keychain. If a second dispatcher is started against the same database, it exits. `pnpm dev` uses `~/.loopable-dev/` instead, so developing the repo does not share this database.

## Runners

Open the App, go to Runners, copy the join command. It uses this machine's LAN IP. On this machine or another host:

```bash
loopable runner --url http://<LAN-IP>:4321 --token <from Runners>
```

`start` already binds `0.0.0.0` so other machines can reach `/api/runners`. GitHub and Gmail login still happen on this laptop at `http://127.0.0.1:4321` — do not point OAuth at the LAN IP. If you open the UI from another machine, set a token so it is not open to the network:

```bash
export LOOPABLE_APP_TOKEN=<long random string>
export LOOPABLE_BASE_URL=http://192.168.1.10:4321   # join URL for runners only
loopable start
```

Then on each runner host, install the CLI once and join:

```bash
loopable runner --url http://192.168.1.10:4321 --token <from Runners>
```

Open the UI as `http://192.168.1.10:4321/?token=<LOOPABLE_APP_TOKEN>` to copy the join command. Connect GitHub or Gmail from `http://127.0.0.1:4321` on this laptop. A Slack bot or Feishu / Lark bot is a pasted app credential, so it can be added from the LAN UI; it is not a Slack or Feishu login.

Each runner needs the agent CLI signed in, and git / `gh` if jobs clone. Google will not accept a private IP as an OAuth redirect, so Gmail login from another machine on the LAN will not work. GitHub is the same unless you click Connect on this laptop.
