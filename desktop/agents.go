package main

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/egoist/mygo/ui"
)

var modeLabels = map[string]string{
	"read_only":       "Read only",
	"workspace_write": "Can write in the workspace",
}

type agentEdit struct {
	open       bool
	mode       string
	model      string
	seconds    string
	testOutput string
	from       string // settings this was made from, to start over on a change elsewhere
}

func (a *app) agentsPage(c *ui.Context) {
	t := c.Theme()
	a.header(c, "", "", "Agents", "The coding CLIs on this Mac. Loops run with one of them.", "", nil)
	if a.m == nil {
		ui.Spinner(c)
		return
	}
	if len(a.agents) == 0 {
		ui.Spinner(c)
		return
	}
	card(c).Dividers(1, t.Border).Children(func() {
		for _, manifest := range a.m.Agents {
			for i := range a.agents {
				if a.agents[i].AgentID == manifest.ID {
					a.agentRow(c, &manifest, &a.agents[i])
				}
			}
		}
	})
}

func presence(view *AgentView) string {
	if view.Auth != nil && view.Auth.SignedIn {
		if view.Auth.Detail != "" {
			return "Signed in · " + view.Auth.Detail
		}
		return "Signed in"
	}
	if view.Installed {
		if view.Auth != nil && view.Auth.Detail != "" {
			return "Installed, not signed in · " + view.Auth.Detail
		}
		return "Installed, not signed in"
	}
	return "Not installed"
}

func (a *app) agentRow(c *ui.Context, manifest *AgentManifest, view *AgentView) {
	t := c.Theme()
	edit := a.agentEdit[manifest.ID]
	signature := fmt.Sprintf("%s|%s|%v", view.Settings.PermissionMode, deref(view.Settings.Model), view.Settings.TimeoutMs)
	if edit == nil {
		edit = &agentEdit{open: view.IsDefault && !view.DefaultIsImplicit}
		a.agentEdit[manifest.ID] = edit
	}
	if edit.from != signature {
		edit.from = signature
		edit.mode = modeLabels[view.Settings.PermissionMode]
		edit.model = deref(view.Settings.Model)
		edit.seconds = itoa(int(view.Settings.TimeoutMs/1000 + 0.5))
	}
	online := view.Auth != nil && view.Auth.SignedIn
	busy := a.busy["agent:"+manifest.ID]

	ui.Column(c).Key(manifest.ID).Children(func() {
		ui.Row(c).Gap(12).AlignItems(ui.Center).Padding(12, 16).Children(func() {
			connectorTile(c, manifest.ID, 32, !online)
			head := ui.ButtonBase(c).Grow(1).Column().AlignItems(ui.Start).Gap(2).Label(manifest.Name)
			head.Children(func() {
				ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
					ui.Text(c, manifest.Name).FontSize(13).Bold()
					if view.IsDefault {
						ui.Badge(c, "Default")
					}
				})
				ui.Text(c, presence(view)).FontSize(11).TextColor(t.TextMuted).SingleLine()
			})
			if head.Clicked() {
				edit.open = !edit.open
			}
			if !view.IsDefault {
				if ui.Button(c, "Make default").Disabled(busy).Clicked() {
					id, name := manifest.ID, manifest.Name
					a.run("agent:"+id, func() (string, error) {
						if err := a.call("chooseDefaultAgent", map[string]string{"agentId": id}, nil); err != nil {
							return "", err
						}
						return name + " will run the loops", nil
					})
				}
			}
			label := "Settings"
			if edit.open {
				label = "Hide"
			}
			if ui.Button(c, label).Clicked() {
				edit.open = !edit.open
			}
		})
		if !edit.open {
			return
		}
		ui.Column(c).Gap(12).Padding(14, 16, 16, 60).BorderWidth(1, 0, 0, 0).BorderColor(t.Border).Background(t.Background).Children(func() {
			if !online {
				ui.Text(c, manifest.InstallHint).FontSize(12).TextColor(t.TextMuted)
			}
			ui.Row(c).Gap(16).AlignItems(ui.Start).Wrap().Children(func() {
				ui.Field(c, "Permission", func() {
					labels := make([]string, len(manifest.PermissionModes))
					for i, mode := range manifest.PermissionModes {
						labels[i] = modeLabels[mode]
					}
					ui.Select(c, &edit.mode, labels).Width(260)
				})
				if manifest.SupportsModel {
					ui.Field(c, "Model", func() {
						ui.TextInput(c, &edit.model).Placeholder(manifest.ModelPlaceholder).Width(220)
					})
				}
				ui.Field(c, "Timeout (seconds)", func() {
					ui.TextInput(c, &edit.seconds).Width(120)
				})
			})
			mono(c, view.CommandPreview)
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				saveLabel := "Save"
				if busy {
					saveLabel = "Working…"
				}
				if ui.PrimaryButton(c, saveLabel).Disabled(busy).Clicked() {
					mode := view.Settings.PermissionMode
					for value, label := range modeLabels {
						if label == edit.mode {
							mode = value
						}
					}
					seconds, _ := strconv.Atoi(strings.TrimSpace(edit.seconds))
					var model *string
					if m := strings.TrimSpace(edit.model); m != "" {
						model = &m
					}
					id, name := manifest.ID, manifest.Name
					body := map[string]any{"agentId": id, "permissionMode": mode, "model": model, "timeoutMs": seconds * 1000}
					a.run("agent:"+id, func() (string, error) {
						if err := a.call("saveAgent", body, nil); err != nil {
							return "", err
						}
						return "Saved " + name + " settings", nil
					})
				}
				if view.Installed {
					if ui.Button(c, "Test").Disabled(busy).Clicked() {
						edit.testOutput = ""
						id, name := manifest.ID, manifest.Name
						a.run("agent:"+id, func() (string, error) {
							var result AgentTest
							if err := a.call("runAgentTest", map[string]string{"agentId": id}, &result); err != nil {
								return "", err
							}
							text := fmt.Sprintf("Answered correctly in %.1fs.", result.DurationMs/1000)
							if !result.Passed {
								detail := "The agent did not answer as expected."
								if result.Detail != nil {
									detail = *result.Detail
								}
								text = strings.TrimSpace(detail + "\n" + result.Output)
							}
							a.update(func() { edit.testOutput = text })
							if result.Passed {
								return name + " is working", nil
							}
							return "", fmt.Errorf("%s did not pass", name)
						})
					}
				}
			})
			if edit.testOutput != "" {
				ui.Text(c, edit.testOutput).FontSize(12).TextColor(t.TextMuted).Selectable()
			}
		})
	})
}
