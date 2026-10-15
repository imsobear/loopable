package main

import (
	"fmt"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

var kindLabel = map[string]string{
	"pull_request": "Pull request", "issue": "Issue", "message": "Message",
	"email": "Email", "occurrence": "Scheduled run", "prompt": "Test run",
}

type stateMeta struct {
	label string
	icon  *ui.SVG
	tone  string // muted, success, danger
	spins bool
}

var states = map[string]stateMeta{
	"queued":         {"Queued", iconClock, "muted", false},
	"preparing":      {"Working", nil, "muted", true},
	"awaiting_agent": {"Running", nil, "muted", true},
	"applying":       {"Writing", nil, "muted", true},
	"prepared":       {"Prepared", iconFile, "muted", false},
	"done":           {"Written", iconCheck, "success", false},
	"skipped":        {"Nothing to say", iconMinus, "muted", false},
	"failed":         {"Failed", iconX, "danger", false},
	"cancelled":      {"Stopped", iconStop, "muted", false},
}

func stateLabel(c *ui.Context, state string) {
	t := c.Theme()
	meta, ok := states[state]
	if !ok {
		meta = stateMeta{label: state, tone: "muted"}
	}
	color := t.TextMuted
	switch meta.tone {
	case "success":
		color = t.Success
	case "danger":
		color = t.Danger
	}
	ui.Row(c).Gap(5).AlignItems(ui.Center).Shrink(0).Children(func() {
		if meta.spins {
			ui.Spinner(c).FontSize(12).TextColor(color)
		} else if meta.icon != nil {
			ui.Icon(c, meta.icon).FontSize(13).TextColor(color)
		}
		ui.Text(c, meta.label).FontSize(12).TextColor(color)
	})
}

func (a *app) inboxPage(c *ui.Context) {
	a.header(c, "", "", "Inbox", "Every run, newest first.", "", func() {
		if ui.Button(c, "Ask an agent").Clicked() {
			a.ask.open = true
		}
	})
	a.taskList(c, a.tasks, true, "Nothing has run yet.")
	a.askDialog(c)
}

func (a *app) taskList(c *ui.Context, tasks []TaskView, showLoop bool, emptyText string) {
	t := c.Theme()
	if len(tasks) == 0 {
		empty(c, emptyText, nil)
		return
	}
	card(c).Dividers(1, t.Border).Children(func() {
		for i := range tasks {
			task := &tasks[i]
			row := ui.ButtonBase(c).Key(task.ID).Row().Gap(12).AlignItems(ui.Start).Padding(12, 16).Label(task.Title())
			if row.Hovered() {
				row.Background(t.SurfaceHover)
			}
			row.Children(func() {
				if task.SourceKind == "prompt" {
					ui.Box(c).Size(28, 28).Radius(7).Background(t.Background).Border(1, t.Border).Center().Shrink(0).Children(func() {
						ui.Icon(c, iconBot).FontSize(15).TextColor(t.TextMuted)
					})
				} else {
					connectorTile(c, task.ConnectorID, 28, false)
				}
				ui.Column(c).Grow(1).Gap(2).Children(func() {
					ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
						ui.Text(c, task.Title()).FontSize(13).Bold().Grow(1).SingleLine()
						if task.DryRun {
							ui.Badge(c, "Dry run")
						}
						stateLabel(c, task.State)
					})
					ui.Text(c, a.taskMeta(task, showLoop)).FontSize(11).TextColor(t.TextMuted).SingleLine()
					if task.Output != nil && *task.Output != "" {
						ui.Text(c, firstLine(*task.Output)).FontSize(11).TextColor(t.TextMuted).SingleLine()
					} else if task.Error != nil && *task.Error != "" {
						ui.Text(c, firstLine(*task.Error)).FontSize(11).TextColor(t.Danger).SingleLine()
					}
				})
			})
			if row.Clicked() {
				a.goTo("/inbox/" + task.ID)
			}
		}
	})
}

func (a *app) taskMeta(task *TaskView, showLoop bool) string {
	var parts []string
	if (task.SourceKind == "pull_request" || task.SourceKind == "issue") && task.SourceTitle != nil {
		parts = append(parts, task.SourceRef)
	}
	if showLoop && task.LoopName != "" {
		parts = append(parts, task.LoopName)
	}
	if task.AgentID != nil {
		parts = append(parts, a.m.agentName(*task.AgentID))
	}
	parts = append(parts, ago(task.CreatedAt))
	return strings.Join(parts, " · ")
}

// askDialog asks an agent something once. The reply stays in Inbox.
func (a *app) askDialog(c *ui.Context) {
	t := c.Theme()
	ui.Modal(c, &a.ask.open, func() {
		ui.Column(c).Gap(12).Width(520).Children(func() {
			ui.Text(c, "Ask an agent").FontSize(16).Bold()
			ui.Text(c, "Runs once. The reply stays in Inbox.").FontSize(12).TextColor(t.TextMuted)
			ui.TextArea(c, &a.ask.prompt).Lines(5, 12).Placeholder("What should the agent do?").Label("Prompt").AutoFocus()
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				if len(a.runnable) == 0 {
					ui.Text(c, "No agent is signed in.").FontSize(12).TextColor(t.TextMuted)
				} else {
					names := make([]string, len(a.runnable))
					for i, agent := range a.runnable {
						names[i] = agent.Name
					}
					if !contains(names, a.ask.agent) {
						a.ask.agent = names[0]
					}
					ui.Select(c, &a.ask.agent, names).Label("Agent")
				}
				ui.Spacer(c)
				if ui.Button(c, "Cancel").Clicked() {
					a.ask.open = false
				}
				can := strings.TrimSpace(a.ask.prompt) != "" && len(a.runnable) > 0 && !a.ask.running
				if ui.PrimaryButton(c, "Run").Disabled(!can).Clicked() || (can && c.Shortcut(ui.Cmd, ui.KeyEnter)) {
					a.askRun()
				}
			})
		})
	})
}

func (a *app) askRun() {
	agentID := ""
	for _, agent := range a.runnable {
		if agent.Name == a.ask.agent {
			agentID = agent.AgentID
		}
	}
	prompt := a.ask.prompt
	a.ask.running = true
	go func() {
		err := a.call("runPrompt", map[string]string{"prompt": prompt, "agentId": agentID}, nil)
		a.update(func() {
			a.ask.running = false
			if err != nil {
				a.toast(errText(err))
				return
			}
			a.ask.prompt = ""
			a.ask.open = false
			a.toast("Queued")
			a.refresh()
		})
	}()
}

func (a *app) taskPage(c *ui.Context, id string) {
	t := c.Theme()
	task := a.task.task
	if task == nil || task.ID != id {
		a.header(c, "/inbox", "Inbox", "Run", "", "", nil)
		ui.Spinner(c)
		return
	}
	live := task.Active()
	a.header(c, "/inbox", "Inbox", task.Title(), a.taskMeta(task, true), "", func() {
		if task.DryRun {
			ui.Badge(c, "Dry run")
		}
		stateLabel(c, task.State)
		if live {
			asked := task.CancelRequested || a.busy["stop:"+task.ID]
			label := "Stop"
			if asked {
				label = "Stopping"
			}
			if ui.Button(c, label).Disabled(asked).Clicked() {
				a.run("stop:"+task.ID, func() (string, error) {
					return "", a.call("stopTask", map[string]string{"id": task.ID}, nil)
				})
			}
		}
	})
	if task.SourceURL != "" && task.SourceKind != "prompt" {
		ui.Link(c, task.SourceRef, task.SourceURL).FontSize(12)
	}
	if task.LoopID != nil {
		ui.Link(c, task.LoopName, "/loops/"+*task.LoopID).FontSize(12)
	}

	if task.Error != nil && *task.Error != "" {
		title := "Will try again"
		switch task.State {
		case "failed":
			title = "Failed"
		case "cancelled":
			title = "Stopped"
		}
		alert(c, title, []string{*task.Error}, task.State == "failed")
	}

	if task.Output != nil && *task.Output != "" {
		card(c).Padding(16).Gap(12).Children(func() {
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				title := "Result"
				switch task.State {
				case "done":
					title = "Written"
				case "skipped":
					title = "Nothing to write"
				}
				ui.Text(c, title).FontSize(14).Bold().Grow(1)
				if task.ResultURL != nil && *task.ResultURL != "" {
					if ui.Button(c, "Open in "+a.m.writerName(task.ActionConnectorID)).Clicked() {
						_ = mygo.Shell.OpenExternal(*task.ResultURL)
					}
				}
			})
			ui.Text(c, *task.Output).FontSize(13).LineHeight(1.5).Selectable()
			if len(task.Comments) > 0 {
				ui.Divider(c)
				ui.Textf(c, "%d line comments", len(task.Comments)).FontSize(11).TextColor(t.TextMuted)
				for _, comment := range task.Comments {
					where := fmt.Sprintf("%s:%d", comment.Path, comment.Line)
					if comment.StartLine != nil {
						where = fmt.Sprintf("%s:%d-%d", comment.Path, *comment.StartLine, comment.Line)
					}
					ui.Column(c).Gap(4).Children(func() {
						ui.Text(c, where).Font("monospace").FontSize(11).TextColor(t.TextMuted)
						ui.Text(c, comment.Body).FontSize(13).Selectable().Padding(0, 0, 0, 10).BorderWidth(0, 0, 0, 2).BorderColor(t.Border)
					})
				}
			}
		})
	} else if task.State == "skipped" {
		ui.Text(c, "The agent had nothing to say, so nothing was written.").FontSize(13).TextColor(t.TextMuted)
	}

	if a.task.log != "" || live {
		key := "log:" + task.ID
		if _, set := a.open[key]; !set {
			a.open[key] = live || task.State == "failed"
		}
		open := a.open[key]
		ui.Collapsible(c, "Agent log", &open, func() {
			ui.Scroll(c).MaxHeight(360).Radius(8).Background(t.Surface).Border(1, t.Border).Children(func() {
				text := a.task.log
				if text == "" {
					text = "Waiting for the agent…"
				}
				ui.Text(c, text).Font("monospace").FontSize(11).LineHeight(1.4).Selectable().Padding(10)
			})
		})
		a.open[key] = open
	}

	details := a.open["details:"+task.ID]
	ui.Collapsible(c, "Details", &details, func() {
		ui.Column(c).Gap(8).Padding(8, 0, 0).Children(func() {
			row := func(label, value string) {
				ui.Row(c).Gap(12).AlignItems(ui.Start).Children(func() {
					ui.Text(c, label).FontSize(12).TextColor(t.TextMuted).Width(90).Shrink(0)
					ui.Text(c, value).FontSize(12).Selectable().Grow(1)
				})
			}
			if task.SourceKind != "prompt" {
				row("Writes", a.m.destinationLabel(task.ActionConnectorID, task.ActionID))
			}
			row("Queued", localTime(task.CreatedAt))
			if task.DurationMs != nil && *task.DurationMs > 0 {
				row("Took", fmt.Sprintf("%.1fs", *task.DurationMs/1000))
			}
			if task.Attempts > 1 {
				row("Attempts", itoa(task.Attempts))
			}
			if task.Prompt != nil && *task.Prompt != "" {
				ui.Text(c, "Prompt").FontSize(12).TextColor(t.TextMuted)
				ui.Scroll(c).MaxHeight(260).Children(func() { mono(c, *task.Prompt) })
			}
			if task.AgentCommand != nil && *task.AgentCommand != "" {
				ui.Text(c, "Command").FontSize(12).TextColor(t.TextMuted)
				mono(c, *task.AgentCommand)
			}
		})
	})
	a.open["details:"+task.ID] = details
}
