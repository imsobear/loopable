package main

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

type settingsPage struct {
	loaded       bool
	openAtLogin  bool
	github       string
	gmailID      string
	gmailSecret  string
	oauthChanged bool
}

func (a *app) settingsPage(c *ui.Context) {
	t := c.Theme()
	s := &a.settings
	if !s.loaded {
		s.loaded = true
		s.openAtLogin = mygo.App.OpenAtLogin()
		apps := readOAuthApps()
		s.github, s.gmailID, s.gmailSecret = apps.GitHub.ClientID, apps.Gmail.ClientID, apps.Gmail.ClientSecret
	}
	a.header(c, "", "", "Settings", "This Mac runs the loops. Nothing leaves it but what the loops answer.", "", nil)

	state, detail, port, node, lines := a.engine.snapshot()
	section(c, "Engine", "The dispatcher and the runner, in Node, started by the app.", func() {
		card(c).Padding(14, 16).Gap(10).Children(func() {
			row := func(label, value string) {
				ui.Row(c).Gap(12).AlignItems(ui.Start).Children(func() {
					ui.Text(c, label).FontSize(12).TextColor(t.TextMuted).Width(110).Shrink(0)
					ui.Text(c, value).FontSize(12).Selectable().Grow(1)
				})
			}
			status := state
			switch state {
			case "running":
				status = "Running"
				if a.status != nil && a.status.Paused {
					status = "Paused: no new runs start"
				}
			case "starting":
				status = "Starting"
			case "failed":
				status = "Failed"
			case "stopped":
				status = "Stopped"
			}
			if detail != "" {
				status += " · " + detail
			}
			row("Status", status)
			if node.Path != "" {
				row("Node", fmt.Sprintf("%s (%s)", node.Version, node.Path))
			}
			if port != 0 {
				row("Port", fmt.Sprintf("127.0.0.1:%d, this app only", port))
			}
			if a.status != nil {
				row("Version", "engine "+a.status.Version+", app "+mygo.App.Version())
				row("Data", a.status.DataDir)
				for _, runner := range a.status.Runners {
					var agents []string
					for _, entry := range runner.Inventory {
						if entry.SignedIn {
							agents = append(agents, a.m.agentName(entry.AgentID))
						}
					}
					if len(agents) == 0 {
						agents = []string{"no agent signed in"}
					}
					row("Runner", runner.Name+" · "+strings.Join(agents, ", "))
				}
			}
			ui.Row(c).Gap(8).Children(func() {
				if a.status != nil {
					paused := a.status.Paused
					if ui.Switch(c, &paused).Label("Paused").Changed() {
						a.status.Paused = paused
						a.run("pause", func() (string, error) {
							if err := a.call("pauseDispatcher", map[string]bool{"paused": paused}, nil); err != nil {
								return "", err
							}
							if paused {
								return "Paused. Loops are watched, but no run starts.", nil
							}
							return "Running again", nil
						})
					}
					ui.Text(c, "Pause: watch, but start no runs").FontSize(12).TextColor(t.TextMuted).Grow(1)
				} else {
					ui.Spacer(c)
				}
				if ui.Button(c, "Restart engine").Clicked() {
					a.engine.Restart()
				}
				if ui.Button(c, "Open data folder").Clicked() {
					_ = mygo.Shell.OpenPath(filepath.Join(userDataDir(), "data"))
				}
			})
		})
	})

	section(c, "This Mac", "", func() {
		ui.Row(c).Gap(10).AlignItems(ui.Center).Children(func() {
			if ui.Switch(c, &s.openAtLogin).Label("Open at login").Changed() {
				if err := mygo.App.SetOpenAtLogin(s.openAtLogin); err != nil {
					a.toast(errText(err))
					s.openAtLogin = mygo.App.OpenAtLogin()
				}
			}
			ui.Column(c).Gap(1).Children(func() {
				ui.Text(c, "Open at login").FontSize(13)
				ui.Text(c, "Starts in the menu bar, so loops run from the moment you sign in.").FontSize(11).TextColor(t.TextMuted)
			})
		})
	})

	section(c, "GitHub and Google apps", "The desktop app is a public client: it needs only client IDs. GitHub connects with a device code (turn on device flow in the OAuth app). Google needs a client of type Desktop app with the Gmail API enabled.", func() {
		ui.Form(c, func() {
			ui.Field(c, "GitHub client ID", func() {
				if ui.TextInput(c, &s.github).Font("monospace").MaxWidth(420).Changed() {
					s.oauthChanged = true
				}
			})
			ui.Field(c, "Google client ID", func() {
				if ui.TextInput(c, &s.gmailID).Font("monospace").MaxWidth(420).Changed() {
					s.oauthChanged = true
				}
			})
			ui.Field(c, "Google client secret", func() {
				if ui.TextInput(c, &s.gmailSecret).Font("monospace").Password().MaxWidth(420).Changed() {
					s.oauthChanged = true
				}
			}).Description("Google calls it a secret, but a desktop client's is not treated as one.")
		})
		ui.Row(c).Gap(8).Children(func() {
			if ui.PrimaryButton(c, "Save and restart engine").Disabled(!s.oauthChanged).Clicked() {
				var apps OAuthApps
				apps.GitHub.ClientID = strings.TrimSpace(s.github)
				apps.Gmail.ClientID = strings.TrimSpace(s.gmailID)
				apps.Gmail.ClientSecret = strings.TrimSpace(s.gmailSecret)
				if err := writeOAuthApps(apps); err != nil {
					a.toast(errText(err))
					return
				}
				s.oauthChanged = false
				a.toast("Saved")
				a.engine.Restart()
			}
		})
	})

	section(c, "Engine log", "", func() {
		text := strings.Join(lines, "\n")
		if text == "" {
			text = "Nothing yet."
		}
		ui.Scroll(c).MaxHeight(300).Radius(8).Background(t.Surface).Border(1, t.Border).Children(func() {
			ui.Text(c, text).Font("monospace").FontSize(11).LineHeight(1.4).Selectable().Padding(10)
		})
	})
}
