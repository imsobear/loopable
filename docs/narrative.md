# Narrative

Loopable is the team’s always-on agent for shared-knowledge work — review, cases, monitors. A lot of work should not depend on one person. People assign work in Slack, GitHub, and on a schedule. Codex and Claude finish it on a shared computer.

## The problem

Today the default is: someone copies the work into their own Codex or Cursor.

That is right when the task needs that person — their context, their laptop, their judgment in the loop.

A lot of team work does not. Code review, digging a case, reading monitors, a morning sweep of stale issues: the knowledge is already in GitHub, Slack, logs. It should not wait on whoever has Codex open.

Those jobs stall the same way: ping in Slack or GitHub, “I’ll look later,” laptop sleeps, nothing ran.

## What Loopable is

Loopable is for that shared work. The team leaves it running. A signal comes in, a loop matches, Codex or Claude runs on a shared machine, the answer is written back. The inbox is the record.

It is not a better personal Codex. One person, one chat, one laptop is already solved.

Loopable + one computer that stays on (a Mac in the office is enough) is a shared agent workflow. Extra runners or a company VM only if that box is not enough.

## How a job runs

```text
Signal → Loop → Task
              → Dispatcher prepares, picks a Runner
              → Runner runs Codex or Claude
              → Dispatcher writes back
```

Slack, GitHub, and the clock are ways to create a signal. The path inside does not change. Connections live on Loopable. Agent login lives on the runner.

Shipped today: GitHub, Gmail, WeChat, the clock, runners, Codex and Cursor Agent. Slack is the intended chat surface; it is not shipped yet.

The words for the parts are in [concepts.md](concepts.md). Extra runners are in [deploy.md](deploy.md).
