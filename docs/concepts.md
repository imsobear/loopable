# Concepts

Loopable is the team’s always-on agent for shared-knowledge work — review, cases, monitors. It watches the services a team already works in and finishes the work with a coding agent: it picks up a signal, does what the loop says, and writes the result back. Every run is recorded.

The usual install is one computer that stays on. Extra runners join the same way. The path a task takes does not change.

```text
Signal → Loop → Task
              → Dispatcher watches, matches a loop, queues the job
              → Runner pulls the job, runs the Agent
              → Dispatcher writes back
              → Task is recorded
```

There is no second path where “the local dispatcher runs the agent.” The agent always runs on a Runner. The runner pulls work over HTTP (`/api/runners/claim`). Loopable does not push jobs into the runner.

## What you configure

**Connector.** A kind of service: GitHub, Slack bot, Feishu / Lark bot, Gmail, WeChat, the clock. It declares what it can watch and what it can write. It is not an account.

**Connection.** One credential of a connector — a GitHub login, a Slack bot, a Feishu bot, a Gmail inbox. Credentials live in Loopable. Agents never see them.

**Workflow.** A whole job a connector already knows how to do, named the way a person would name it: “Review pull requests I am asked to review.” It owns what to watch for, what to ask the agent, and where the answer is written. A loop is one instance of a workflow with its knobs set.

A workflow is not a loop template. Creating a loop copies the prompt onto the loop, and the loop owns that copy from then on. The loop still points at the workflow for the rest: the query, how the answer is parsed, whether the agent gets a checkout. If a connector stops offering a workflow, existing loops remain readable and deletable but not runnable.

The UI does not need to say “workflow.” New loop is choosing a job by the name the connector gave it. In code and in this document the word is workflow, and the column is `workflowId`.

**Loop.** One instance of a workflow: your repositories, your notes, which agent. This is what people edit. Loops run by themselves. A loop names an agent, not a runner. The dispatcher picks an online runner that has that agent signed in. If none does, the loop is saved anyway and the page says it cannot run yet.

**Signal.** One thing a loop noticed. The connector’s key on a signal has to change exactly when there is something new to do. Same signal does not run twice.

The first look never acts. Whatever is already waiting when a loop is created is that loop’s backlog, recorded rather than run.

**Task.** One run of one loop against one signal: fetch the context, let the agent work, write the result back. The inbox is the list of tasks. A task is kept whether it wrote anything or not.

## What does the work

**Agent.** A coding CLI Loopable knows how to invoke: Codex, Cursor Agent (Claude). The list is a catalog in the repo, not discovered from the network. Loopable stores only the choices a person makes: which agent is the default, permission mode, model, timeout. Whether one is installed lives on each runner’s inventory.

**Agent login.** That CLI’s own login on the runner’s host. It is not a Connection. Connection is GitHub, a Slack bot, a Feishu bot, Gmail, or WeChat. Agent login is Codex or Cursor Agent. They live in different places and must not be merged into one “account.”

**Runner.** A process that can run agents. It reports an inventory: which agents are installed and signed in. It heartbeats, pulls a job, runs the agent, and returns output and logs. It does not poll connectors, does not hold Connections, and does not write back to GitHub or Slack. The command is `loopable runner`. The join token lives on the Runners page.

## What you install

**Loopable** is the install on the control host. Two roles, one install:

| Role | Does |
| --- | --- |
| **App** | The UI, the HTTP API, OAuth callbacks, and the interface runners pull from |
| **Dispatcher** | Watches for signals, matches loops, queues jobs, writes back through Connections |

They share one database. They are not two products. They need not be two services. `loopable start` runs App and Dispatcher on the same host so a loop keeps running when nobody has the window open. How to start each is in [deploy.md](deploy.md). Changing this repo is `pnpm dev`, not a deploy.

Do not call this a management platform. The product is Loopable. The console is for writing loops and seeing what ran, not for operating a fleet.

**Runner** is a separate process on every host that should run agents. Start it with the URL and join token from Runners:

```text
Loopable  ──HTTP pull──  Runner  ──  Agent CLI
(App + Dispatcher)
```

The path does not change with how many runners you have. One runner on the same host as Loopable, or several on other hosts: each one joins the same way.

## Three kinds of credential

| | Connection | Runtime auth | Agent login |
| --- | --- | --- | --- |
| What | GitHub, Slack bot, Feishu / Lark bot, Gmail, WeChat | git / `gh` on the runner | Codex, Cursor Agent |
| Where | Loopable’s secret store | That host’s home directory | That host’s home directory |
| Who uses it | App and Dispatcher, to read signals and write back | The agent, via git on that host | Only the agent process |

They stay apart even when two of them are GitHub. The Connection is the bot that watches and writes through the API. Runtime auth is git on that host, used by the agent when the prompt asks it to clone. Loopable does not copy the Connection token onto a runner or into an agent.

The agent’s environment never contains Loopable’s service credentials. When a job needs a repository, the prompt tells the agent to clone it. That uses the machine’s git, not the Connection.

## Names we do not use

| Avoid | Use instead |
| --- | --- |
| Daemon | Dispatcher |
| Engine | Dispatcher |
| Worker | Runner |
| Machine | Runner |
| Management platform / control plane (in UI and README) | Loopable |
| Loop template | Workflow |
| Account (when it could mean either) | Connection or agent login |

“Worker” remains an internal name for the code inside the Dispatcher that claims queued tasks. It is not a product word and not a command.
