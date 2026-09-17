# Loopable

Build reliable engineering loops across the services and agents you already use.

## 背景

小团队用编码 agent，主路径仍是本地：

```text
开发者 → 自己的电脑 -> Claude Code / Codex
```

这很适合每天对着代码工作。仓库、环境、凭证、上下文都在那台电脑上，人也在。

但有一类活不适合绑在「谁的笔记本正好开着」上：

- Slack 里冒出来的 case，每个人都可以直接调用 bot 去处理，而不是依赖某个人用 agent 去查
- 统一处理的任务不需要个人参与：比如 Code Review
- 每天固定的检查或报告：比如每天跑一次监控日志分析出问题并提 issue

这些事今天常见的两个做法都不合适。

一个是继续靠个人电脑。电脑睡了、人出门了，活就停。共享能力也落不下来：不能要求同事去登你的机器。

一个是再做一个工作台——agent 聊天室、派活看板、把人请进去点「开始」（比如 Multica/Raft）。小团队已经有 GitHub 和 Slack。再多一个每天要去的地方，比漏掉几个 review 更重。

要解决的问题因此是：

**人还在原来的地方说话；不在场、要定时、要共享的那部分工程活，也能可靠地做完，并写回原处。**

这不是要替代本机 Claude Code / Codex。交互式开发仍在本机。缺的是后半段：一条可以自己转的回路。

## 目标

Loopable 接住 GitHub / Slack / 定时里的信号，用机器上已经安装、已经登录的 agent 做完，把结果写回 PR、issue 或线程。每次运行留记录。

配好之后，日常不必打开它。打开是为了写 loop、接账号、看某次跑坏了什么。

几个场景：

- Slack 里直接 @ bot 查 case、快速修个 bug、查数据等
- GitHub 开 PR assign 给 bot 执行 Code Review
- 建一个定时任务分析每天的监控报告或业务数据，提 issue 或发回到 Slack 里

## 架构

人仍在 GitHub / Slack 里工作。Loopable 接信号、跑 loop、写回原处。Agent 在各自的机器上跑，拿不到写回用的账号。

```text
                         团队成员
                            │
             ┌──────────────┼──────────────┐
             │              │              │
          GitHub          Slack          定时
             │              │              │
             └──────────────┼──────────────┘
                            │
                         信号进来
                            ▼
        ┌───────────────────────────────────────┐
        │              Loopable                 │
        │                                       │
        │   App                 Engine          │
        │   写 loop             匹配 loop        │
        │   看 inbox            准备上下文       │
        │                       选机器          │
        │                       写回原处        │
        │                       留下 task       │
        │                                       │
        │   Connection：GitHub / Slack 账号     │
        │   Loop：用哪种 agent                  │
        └───────────────────────────────────────┘
                            │
              只下发「跑这次 agent」
              不带 Connection
             ┌──────────────┼──────────────┐
             ▼                             ▼
      ┌─────────────┐               ┌─────────────┐
      │   机器 A    │               │   机器 B    │
      │   Runner    │               │   Runner    │
      │   Codex     │               │   Claude    │
      │   （已登录） │               │   （已登录） │
      └─────────────┘               └─────────────┘
             │                             │
             └──────────────┬──────────────┘
                            │
                      结果和日志回来
                            ▼
                         Loopable
                            │
                          写回
                            ▼
                  GitHub PR / Slack 线程
```

一次运行：

```text
信号 → Loop → Task
            → Engine 准备上下文、选 Runner
            → Runner 跑 Agent
            → Engine 用 Connection 写回
            → Inbox 留下这次
```

个人和团队是同一张图。一个人时，Loopable 和 Runner 在同一台电脑上。团队时，Loopable 一份，Runner 在几台常开电脑上。多的是 Runner。