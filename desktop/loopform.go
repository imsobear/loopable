package main

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/egoist/mygo/ui"
)

const defaultAgent = "Default agent"

var pollChoices = []struct {
	ms    float64
	label string
}{
	{0, "Every couple of minutes"},
	{60_000, "Every minute"},
	{10 * 60_000, "Every 10 minutes"},
	{30 * 60_000, "Every 30 minutes"},
	{60 * 60_000, "Every hour"},
	{4 * 60 * 60_000, "Every 4 hours"},
}

var runsIn = map[string]string{
	"checkout": "A fresh clone of the repository",
	"folder":   "The folder this loop names",
	"temp":     "A scratch folder with only what it was given",
}

var answers = map[string]string{
	"review": "A summary, plus comments on lines",
	"code":   "A change to the code",
	"text":   "One block of text",
}

// fieldValues holds what a connector's generic fields are being edited to:
// one renderer for connection settings and loop conditions alike.
type fieldValues struct {
	fields []SettingField
	strs   map[string]*string // text, string_list (newline-joined), select (label)
	bools  map[string]*bool
}

func newFieldValues(fields []SettingField, stored map[string]any) *fieldValues {
	v := &fieldValues{fields: fields, strs: map[string]*string{}, bools: map[string]*bool{}}
	for _, f := range fields {
		current := stored[f.Key]
		switch f.Kind {
		case "boolean":
			b, ok := current.(bool)
			if !ok {
				b, _ = f.Default.(bool)
			}
			v.bools[f.Key] = &b
		case "string_list":
			var lines []string
			if list, ok := current.([]any); ok {
				for _, item := range list {
					if s, ok := item.(string); ok {
						lines = append(lines, s)
					}
				}
			}
			s := strings.Join(lines, "\n")
			v.strs[f.Key] = &s
		case "select":
			value, ok := current.(string)
			if !ok {
				value, _ = f.Default.(string)
			}
			label := value
			for _, option := range f.Options {
				if option.Value == value {
					label = option.Label
				}
			}
			v.strs[f.Key] = &label
		default:
			s, _ := current.(string)
			v.strs[f.Key] = &s
		}
	}
	return v
}

func (v *fieldValues) values() map[string]any {
	out := map[string]any{}
	for _, f := range v.fields {
		switch f.Kind {
		case "boolean":
			out[f.Key] = *v.bools[f.Key]
		case "string_list":
			lines := []string{}
			for _, line := range strings.Split(*v.strs[f.Key], "\n") {
				if line = strings.TrimSpace(line); line != "" {
					lines = append(lines, line)
				}
			}
			out[f.Key] = lines
		case "select":
			label := *v.strs[f.Key]
			value := label
			for _, option := range f.Options {
				if option.Label == label {
					value = option.Value
				}
			}
			out[f.Key] = value
		default:
			out[f.Key] = *v.strs[f.Key]
		}
	}
	return out
}

func (v *fieldValues) render(c *ui.Context) {
	for _, f := range v.fields {
		f := f
		field := ui.Field(c, f.Label, func() {
			switch f.Kind {
			case "boolean":
				ui.Switch(c, v.bools[f.Key])
			case "string_list":
				ui.TextArea(c, v.strs[f.Key]).Lines(3, 8).Placeholder(f.Placeholder).MaxWidth(480)
			case "select":
				labels := make([]string, len(f.Options))
				for i, option := range f.Options {
					labels[i] = option.Label
				}
				ui.Select(c, v.strs[f.Key], labels).MaxWidth(320)
			default:
				ui.TextInput(c, v.strs[f.Key]).Placeholder(f.Placeholder).MaxWidth(480)
			}
		})
		if f.Help != "" {
			field.Description(f.Help)
		}
	}
}

type loopForm struct {
	key       string
	edit      *LoopEdit
	fresh     bool
	updatedAt string

	name, prompt, folder, mcp string
	agent                     string
	poll                      string
	settings                  *fieldValues
	actionConnectorID         string
	actionID                  string
	target                    *fieldValues
	writer, action            string
	written                   bool
	saving                    bool
	details                   bool
}

func (a *app) newLoopForm(key string, edit *LoopEdit) *loopForm {
	w := a.m.workflow(edit.ConnectorID, edit.WorkflowID)
	f := &loopForm{key: key, edit: edit, fresh: edit.ID == nil, name: edit.Name, prompt: edit.Prompt}
	if folder, ok := edit.Settings["folder"].(string); ok {
		f.folder = strings.TrimPrefix(folder, "~/")
	}
	f.agent = defaultAgent
	if edit.AgentID != nil {
		f.agent = a.m.agentName(*edit.AgentID)
	}
	f.mcp = strings.Join(edit.McpServers, ", ")
	var settings []SettingField
	if w != nil {
		settings = w.Settings
	}
	f.settings = newFieldValues(settings, edit.Settings)
	ms := 0.0
	if edit.PollEveryMs != nil {
		ms = *edit.PollEveryMs
	}
	f.poll = pollLabel(ms)
	f.actionConnectorID, f.actionID = edit.ActionConnectorID, edit.ActionID
	f.writer = a.m.writerName(edit.ActionConnectorID)
	if action := a.m.action(edit.ActionConnectorID, edit.ActionID); action != nil {
		f.action = action.Name
		f.target = newFieldValues(action.Target, edit.ActionTarget)
	} else {
		f.target = newFieldValues(nil, nil)
	}
	f.written = strings.TrimSpace(edit.Prompt) != ""
	return f
}

func pollLabel(ms float64) string {
	for _, choice := range pollChoices {
		if choice.ms == ms {
			return choice.label
		}
	}
	return fmt.Sprintf("Every %d minutes", int(ms/60_000+0.5))
}

func (a *app) chooseDestination(f *loopForm, connectorID, actionID string) {
	f.actionConnectorID, f.actionID = connectorID, actionID
	f.writer = a.m.writerName(connectorID)
	if action := a.m.action(connectorID, actionID); action != nil {
		f.action = action.Name
		f.target = newFieldValues(action.Target, nil)
	} else {
		f.action = ""
		f.target = newFieldValues(nil, nil)
	}
}

func (a *app) loopFormView(c *ui.Context, f *loopForm) {
	t := c.Theme()
	edit := f.edit
	w := a.m.workflow(edit.ConnectorID, edit.WorkflowID)
	sourceName := a.m.connectorName(edit.ConnectorID)
	if w == nil {
		alert(c, "This workflow is no longer offered", []string{
			fmt.Sprintf("%s no longer has %s, so this loop cannot run or be edited. You can still delete it.", sourceName, edit.WorkflowID),
		}, true)
		return
	}
	action := a.m.action(f.actionConnectorID, f.actionID)

	section(c, "When", "When "+w.Trigger+".", func() {
		ui.Form(c, func() {
			ui.Field(c, "Name", func() { ui.TextInput(c, &f.name).MaxWidth(480) })
			f.settings.render(c)
			if edit.ConnectorID != "schedule" {
				labels := make([]string, len(pollChoices))
				for i, choice := range pollChoices {
					labels[i] = choice.label
				}
				if !contains(labels, f.poll) {
					labels = append(labels, f.poll)
				}
				ui.Field(c, "Check", func() { ui.Select(c, &f.poll, labels).MaxWidth(320) })
			}
		})
		ui.Collapsible(c, "Fixed by the trigger", &f.details, func() {
			ui.Column(c).Gap(6).Padding(10).Radius(8).Background(t.Surface).Children(func() {
				row := func(label, value string) {
					ui.Row(c).Gap(10).Children(func() {
						ui.Text(c, label).FontSize(12).TextColor(t.TextMuted).Width(90).Shrink(0)
						ui.Text(c, value).FontSize(12).Selectable()
					})
				}
				if w.Watches != "" {
					row("Looks for", w.Watches)
				}
				runs := w.RunsIn
				if runs == "" {
					runs = "temp"
				}
				row("Runs in", runsIn[runs])
				row("Answer", answers[w.Answer])
			})
		})
	})

	section(c, "Agent", "", func() {
		ui.Form(c, func() {
			names := []string{defaultAgent}
			for _, agent := range a.m.Agents {
				names = append(names, agent.Name)
			}
			ui.Field(c, "Run with", func() { ui.Select(c, &f.agent, names).MaxWidth(320) })
			ui.Field(c, "MCP servers", func() {
				ui.TextInput(c, &f.mcp).Placeholder("None").Font("monospace").MaxWidth(420)
			}).Description("Servers the agent may call without asking, named as on this Mac, such as sentry. Others are refused.")
			if w.RunsIn == "folder" {
				ui.Field(c, "Folder", func() {
					ui.Row(c).Gap(4).AlignItems(ui.Center).MaxWidth(420).Children(func() {
						ui.Text(c, "~/").Font("monospace").FontSize(13).TextColor(t.TextMuted)
						ui.TextInput(c, &f.folder).Placeholder("code/web").Font("monospace").Grow(1)
					})
				}).Description("Inside your home folder. The agent works here.")
			}
			field := ui.Field(c, "Prompt", func() {
				ui.TextArea(c, &f.prompt).Lines(8, 24).Font("monospace").FontSize(12).Placeholder("What should the agent do?")
			})
			if f.written {
				field.Description(fmt.Sprintf("Starts as “%s”. Changes stay on this loop.", w.Name))
			}
		})
	})

	section(c, "Answer", "", func() {
		ui.Form(c, func() {
			var writerNames []string
			writers := a.m.writers()
			for _, writer := range writers {
				writerNames = append(writerNames, a.m.writerName(writer.ID))
			}
			ui.Field(c, "Send to", func() {
				if ui.Select(c, &f.writer, writerNames).MaxWidth(320).Changed() {
					for _, writer := range writers {
						if a.m.writerName(writer.ID) == f.writer && writer.ID != f.actionConnectorID && len(writer.Actions) > 0 {
							a.chooseDestination(f, writer.ID, writer.Actions[0].ID)
						}
					}
				}
			})
			if !isInboxOnly(f.actionConnectorID, f.actionID) {
				var actionNames []string
				if connector := a.m.connector(f.actionConnectorID); connector != nil {
					for _, entry := range connector.Actions {
						actionNames = append(actionNames, entry.Name)
					}
				}
				ui.Field(c, "As", func() {
					if ui.Select(c, &f.action, actionNames).MaxWidth(320).Changed() {
						if connector := a.m.connector(f.actionConnectorID); connector != nil {
							for _, entry := range connector.Actions {
								if entry.Name == f.action && entry.ID != f.actionID {
									a.chooseDestination(f, f.actionConnectorID, entry.ID)
								}
							}
						}
					}
				})
			}
			f.target.render(c)
		})
		crosses := action != nil && f.actionConnectorID != edit.ConnectorID
		flattens := action != nil && w.Answer == "review" && !contains(action.Accepts, "review")
		if crosses && !isInboxOnly(f.actionConnectorID, f.actionID) {
			ui.Text(c, sourceName+" and "+a.m.writerName(f.actionConnectorID)+" both need a connection.").FontSize(11).TextColor(t.TextMuted)
		} else if flattens {
			ui.Text(c, "Line comments arrive as text, with file and line written in.").FontSize(11).TextColor(t.TextMuted)
		}
	})

	ui.Row(c).Gap(8).PaddingY(8).BorderWidth(1, 0, 0, 0).BorderColor(t.Border).Children(func() {
		label := "Save changes"
		if f.fresh {
			label = "Add loop"
		}
		if f.saving {
			label = "Saving…"
		}
		if ui.PrimaryButton(c, label).Disabled(f.saving).Clicked() {
			a.saveLoop(f, w)
		}
		if ui.Button(c, "Cancel").Disabled(f.saving).Clicked() {
			delete(a.forms, f.key)
			if f.fresh {
				a.goTo("/loops/new")
			} else {
				a.refresh()
			}
		}
	})
}

func (a *app) saveLoop(f *loopForm, w *Workflow) {
	edit := *f.edit
	edit.Name = strings.TrimSpace(f.name)
	edit.Prompt = f.prompt
	edit.Guidance = nil
	edit.AgentID = nil
	if f.agent != defaultAgent {
		for _, agent := range a.m.Agents {
			if agent.Name == f.agent {
				id := agent.ID
				edit.AgentID = &id
			}
		}
	}
	edit.McpServers = []string{}
	for _, server := range strings.FieldsFunc(f.mcp, func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == '\t' }) {
		if server != "" {
			edit.McpServers = append(edit.McpServers, server)
		}
	}
	edit.Settings = f.settings.values()
	if w.RunsIn == "folder" {
		edit.Settings["folder"] = strings.TrimSpace(f.folder)
	}
	edit.ActionConnectorID, edit.ActionID = f.actionConnectorID, f.actionID
	edit.ActionTarget = f.target.values()
	edit.PollEveryMs = nil
	for _, choice := range pollChoices {
		if choice.label == f.poll && choice.ms > 0 {
			ms := choice.ms
			edit.PollEveryMs = &ms
		}
	}
	if edit.PollEveryMs == nil && strings.HasPrefix(f.poll, "Every ") && strings.HasSuffix(f.poll, " minutes") {
		if n, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(f.poll, "Every "), " minutes")); err == nil && n > 0 {
			ms := float64(n) * 60_000
			edit.PollEveryMs = &ms
		}
	}
	f.saving = true
	fresh := f.fresh
	key := f.key
	go func() {
		var saved LoopView
		err := a.call("saveLoop", edit, &saved)
		a.update(func() {
			f.saving = false
			if err != nil {
				a.toast(errText(err))
				return
			}
			delete(a.forms, key)
			if fresh {
				a.toast("Added " + saved.Name)
			} else {
				a.toast("Saved " + saved.Name)
			}
			a.goTo("/loops/" + saved.ID)
		})
	}()
}
