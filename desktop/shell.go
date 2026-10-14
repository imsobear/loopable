package main

import (
	"strings"

	"github.com/egoist/mygo/ui"
)

const pageWidth = 820

func (a *app) view(c *ui.Context) {
	for _, message := range a.toasts {
		c.Toast(message)
	}
	a.toasts = nil
	t := c.Theme()

	ui.Row(c).Fill().AlignItems(ui.Stretch).Children(func() {
		a.sidebar(c)
		ui.Column(c).Grow(1).Background(t.Background).Children(func() {
			a.router.View(c, func(r *ui.Route) {
				a.enter(r.Path())
				ui.Scroll(c).Fill().Children(func() {
					ui.Column(c).Padding(28, 32, 40).Gap(20).MaxWidth(pageWidth).Children(func() {
						state, detail, _, _, _ := a.engine.snapshot()
						if state != "running" && r.Path() != "/settings" {
							a.engineBanner(c, state, detail)
						}
						switch {
						case r.Match("/inbox"):
							r.Title("Inbox")
							a.inboxPage(c)
						case r.Match("/inbox/{id}"):
							r.Title("Run")
							a.taskPage(c, r.Param("id"))
						case r.Match("/loops"):
							r.Title("Loops")
							a.loopsPage(c)
						case r.Match("/loops/new"):
							r.Title("New loop")
							a.newLoopPage(c, r)
						case r.Match("/loops/new/{connector}/{workflow}"):
							r.Title("New loop")
							a.shapeLoopPage(c, r.Param("connector"), r.Param("workflow"), r.Query("custom") == "1")
						case r.Match("/loops/{id}"):
							r.Title("Loop")
							a.loopDetailPage(c, r)
						case r.Match("/connectors"):
							r.Title("Connectors")
							a.connectorsPage(c)
						case r.Match("/connectors/{id}"):
							r.Title("Connector")
							a.connectorPage(c, r.Param("id"))
						case r.Match("/agents"):
							r.Title("Agents")
							a.agentsPage(c)
						case r.Match("/settings"):
							r.Title("Settings")
							a.settingsPage(c)
						default:
							ui.Text(c, "Not found")
						}
					})
				})
			})
		})
	})
	a.confirmDialog(c)
}

func (a *app) sidebar(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Width(196).Background(t.Surface).Shrink(0).BorderWidth(0, 1, 0, 0).BorderColor(t.Border).Children(func() {
		ui.Row(c).Padding(18, 20, 10).Gap(8).AlignItems(ui.Center).Children(func() {
			ui.Icon(c, iconLoops).FontSize(16)
			ui.Text(c, "Loopable").FontSize(15).Bold()
		})
		path := a.router.Path()
		page := "/" + strings.SplitN(strings.TrimPrefix(path, "/"), "/", 2)[0]
		ui.Sidebar(c, &page, func() {
			ui.SidebarItem(c, "/inbox", iconInbox, "Inbox").Children(func() {
				active := 0
				for i := range a.tasks {
					if a.tasks[i].Active() {
						active++
					}
				}
				if active > 0 {
					ui.Badge(c, itoa(active))
				}
			})
			ui.SidebarItem(c, "/loops", iconLoops, "Loops")
			ui.SidebarItem(c, "/connectors", iconConnectors, "Connectors")
			ui.SidebarItem(c, "/agents", iconAgents, "Agents")
			ui.SidebarItem(c, "/settings", iconSettings, "Settings")
		}).Grow(1).Label("Pages").OnChange(func() {
			a.goTo(page)
		})
		a.engineLine(c)
	})
}

// engineLine is the one line at the bottom of the sidebar that says whether
// loops are running.
func (a *app) engineLine(c *ui.Context) {
	t := c.Theme()
	state, detail, _, _, _ := a.engine.snapshot()
	label, color := "Engine starting…", t.TextMuted
	switch state {
	case "running":
		label, color = "Running", t.Success
		if a.status != nil && a.status.Paused {
			label, color = "Paused", t.Warning
		}
	case "failed":
		label, color = "Engine failed", t.Danger
	case "stopped":
		label, color = "Engine stopped", t.TextMuted
	}
	row := ui.ButtonBase(c).Padding(10, 20, 14).Gap(8).Row().AlignItems(ui.Center).Label("Engine: " + label).Tooltip(detail)
	row.Children(func() {
		ui.Box(c).Size(8, 8).Radius(4).Background(color)
		ui.Text(c, label).FontSize(12).TextColor(t.TextMuted).SingleLine()
	})
	if row.Clicked() {
		a.goTo("/settings")
	}
}

func (a *app) engineBanner(c *ui.Context, state, detail string) {
	t := c.Theme()
	title := "The engine is starting"
	if state == "failed" {
		title = "The engine could not start"
	} else if state == "stopped" {
		title = "The engine is stopped"
	}
	ui.Row(c).Gap(12).AlignItems(ui.Center).Padding(12, 16).Radius(10).Background(t.Surface).Border(1, t.Border).Children(func() {
		if state == "starting" {
			ui.Spinner(c)
		} else {
			ui.Icon(c, iconAlert).TextColor(t.Danger)
		}
		ui.Column(c).Grow(1).Gap(2).Children(func() {
			ui.Text(c, title).FontSize(13).Bold()
			if detail != "" {
				ui.Text(c, detail).FontSize(12).TextColor(t.TextMuted)
			}
		})
		if ui.Button(c, "Settings").Clicked() {
			a.goTo("/settings")
		}
	})
}

// header is the top of a page: a way back, a title, what it is, and what
// can be done to it.
func (a *app) header(c *ui.Context, back, backLabel, title, description string, tileID string, actions func()) {
	t := c.Theme()
	ui.Column(c).Gap(6).Children(func() {
		if back != "" {
			link := ui.ButtonBase(c).Row().Gap(2).AlignItems(ui.Center).Label("Back to " + backLabel).AlignSelf(ui.Start)
			link.Children(func() {
				ui.Text(c, "‹ "+backLabel).FontSize(12).TextColor(t.TextMuted)
			})
			if link.Clicked() {
				a.goTo(back)
			}
		}
		ui.Row(c).Gap(12).AlignItems(ui.Center).Children(func() {
			if tileID != "" {
				connectorTile(c, tileID, 36, false)
			}
			ui.Column(c).Grow(1).Gap(2).Children(func() {
				ui.Text(c, title).FontSize(22).Bold()
				if description != "" {
					ui.Text(c, description).FontSize(13).TextColor(t.TextMuted)
				}
			})
			if actions != nil {
				ui.Row(c).Gap(8).AlignItems(ui.Center).Children(actions)
			}
		})
	})
}

// card is a bordered block, as the web app's List and Card.
func card(c *ui.Context) ui.Element {
	t := c.Theme()
	return ui.Column(c).Radius(10).Background(t.Surface).Border(1, t.Border).Clip()
}

// alert is a notice: a line or two that call for attention.
func alert(c *ui.Context, title string, lines []string, danger bool) {
	t := c.Theme()
	color := t.Border
	if danger {
		color = t.Danger
	}
	ui.Row(c).Gap(10).AlignItems(ui.Start).Padding(12, 14).Radius(10).Border(1, color).Children(func() {
		ui.Icon(c, iconAlert).FontSize(16).TextColor(color).Padding(1, 0, 0)
		ui.Column(c).Grow(1).Gap(2).Children(func() {
			ui.Text(c, title).FontSize(13).Bold()
			for _, line := range lines {
				ui.Text(c, line).FontSize(12).TextColor(t.TextMuted).Selectable()
			}
		})
	})
}

// section is a titled group of a form, with a description under the title.
func section(c *ui.Context, title, description string, body func()) {
	t := c.Theme()
	ui.Column(c).Gap(12).PaddingY(8).Children(func() {
		ui.Column(c).Gap(2).Children(func() {
			ui.Text(c, title).FontSize(15).Bold()
			if description != "" {
				ui.Text(c, description).FontSize(12).TextColor(t.TextMuted)
			}
		})
		body()
	})
}

func empty(c *ui.Context, text string, action func()) {
	t := c.Theme()
	ui.Column(c).Gap(10).Center().Padding(32).Radius(10).Border(1, t.Border).BorderStyle(ui.BorderDashed).Children(func() {
		ui.Text(c, text).FontSize(13).TextColor(t.TextMuted)
		if action != nil {
			action()
		}
	})
}

func mono(c *ui.Context, text string) ui.Element {
	t := c.Theme()
	return ui.Text(c, text).Font("monospace").FontSize(11).Selectable().Padding(10).Radius(8).Background(t.Background).Border(1, t.Border)
}

func (a *app) confirmDialog(c *ui.Context) {
	if !a.confirm.open {
		return
	}
	switch ui.AlertDialog(c, &a.confirm.open, a.confirm.title, a.confirm.body, "Cancel", "Delete") {
	case 1:
		kind, id, name := a.confirm.kind, a.confirm.id, a.confirm.name
		switch kind {
		case "loop":
			a.run("delete:"+id, func() (string, error) {
				if err := a.call("removeLoop", map[string]string{"id": id}, nil); err != nil {
					return "", err
				}
				return "Deleted " + name, nil
			})
			if strings.HasPrefix(a.router.Path(), "/loops/"+id) {
				a.goTo("/loops")
			}
		case "connection":
			a.run("disconnect:"+id, func() (string, error) {
				if err := a.call("disconnectConnection", map[string]string{"id": id}, nil); err != nil {
					return "", err
				}
				return "Disconnected " + name, nil
			})
		}
	}
}

func itoa(n int) string {
	return strings.TrimSpace(strings.Repeat(" ", 0) + fmtInt(n))
}

func fmtInt(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		b = append([]byte{'-'}, b...)
	}
	return string(b)
}
