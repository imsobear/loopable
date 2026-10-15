package main

import (
	"fmt"
	"strings"

	"github.com/egoist/mygo/ui"
)

func (a *app) loopsPage(c *ui.Context) {
	t := c.Theme()
	a.header(c, "", "", "Loops", "When two loops match the same thing, the higher one runs.", "", func() {
		if ui.PrimaryButton(c, "New loop").Clicked() {
			a.goTo("/loops/new")
		}
	})
	if a.readiness != nil {
		if gaps := a.gapsFor(a.readiness, a.loops); len(gaps) > 0 {
			alert(c, "Nothing will run yet", gaps, false)
		}
	}
	if len(a.loops) == 0 {
		empty(c, "No loops yet.", func() {
			if ui.Button(c, "New loop").Clicked() {
				a.goTo("/loops/new")
			}
		})
		return
	}
	card(c).Dividers(1, t.Border).Children(func() {
		for i := range a.loops {
			a.loopRow(c, i)
		}
	})
}

func (a *app) summaryOf(loop *LoopView) string {
	if a.m.workflow(loop.ConnectorID, loop.WorkflowID) == nil {
		return "Workflow no longer offered"
	}
	agent := "Default agent"
	if loop.AgentID != nil {
		agent = a.m.agentName(*loop.AgentID)
	}
	return a.m.destinationLabel(loop.ActionConnectorID, loop.ActionID) + " · " + agent
}

func (a *app) loopRow(c *ui.Context, i int) {
	t := c.Theme()
	loop := &a.loops[i]
	busy := a.busy["loop:"+loop.ID]
	var issues []string
	if a.readiness != nil {
		issues = a.issuesFor(a.readiness, loop)
	}
	ui.Row(c).Key(loop.ID).Gap(12).AlignItems(ui.Center).Padding(10, 16).Children(func() {
		ui.Text(c, itoa(i+1)).FontSize(11).TextColor(t.TextMuted).Width(16).TextAlign(ui.Center).Shrink(0)
		connectorTile(c, loop.ConnectorID, 28, !loop.Enabled)
		link := ui.ButtonBase(c).Grow(1).Column().AlignItems(ui.Start).Gap(2).Label(loop.Name)
		link.Children(func() {
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				ui.Text(c, loop.Name).FontSize(13).Bold().SingleLine()
				if !loop.Enabled {
					ui.Badge(c, "Off")
				}
			})
			if len(issues) > 0 {
				ui.Text(c, issues[0]).FontSize(11).TextColor(t.Warning).SingleLine()
			} else {
				ui.Text(c, a.summaryOf(loop)).FontSize(11).TextColor(t.TextMuted).SingleLine()
			}
		})
		if link.Clicked() {
			a.goTo("/loops/" + loop.ID)
		}
		on := loop.Enabled
		if ui.Switch(c, &on).Disabled(busy).Label("On").Changed() {
			a.toggleLoop(loop, on)
		}
		ui.MenuButton(c, "", func(m *ui.Menu) {
			if m.Item("Move up").Disabled(i == 0).Chosen() {
				a.moveLoop(loop, "up")
			}
			if m.Item("Move down").Disabled(i == len(a.loops)-1).Chosen() {
				a.moveLoop(loop, "down")
			}
			m.Separator()
			if m.Item("Delete…").Chosen() {
				a.askDeleteLoop(loop)
			}
		}).Label("More").Children(func() { ui.Icon(c, iconMore) })
	})
}

func (a *app) toggleLoop(loop *LoopView, on bool) {
	id, name := loop.ID, loop.Name
	loop.Enabled = on
	a.run("loop:"+id, func() (string, error) {
		if err := a.call("toggleLoop", map[string]any{"id": id, "enabled": on}, nil); err != nil {
			return "", err
		}
		if on {
			return name + " is on", nil
		}
		return name + " is off", nil
	})
}

func (a *app) moveLoop(loop *LoopView, direction string) {
	id := loop.ID
	a.run("loop:"+id, func() (string, error) {
		return "", a.call("reorderLoop", map[string]string{"id": id, "direction": direction}, nil)
	})
}

func (a *app) askDeleteLoop(loop *LoopView) {
	a.confirm = confirmState{
		open: true, kind: "loop", id: loop.ID, name: loop.Name,
		title: "Delete " + loop.Name + "?", body: "Its runs are deleted with it.",
	}
}

// What stands between loops and running, as src/lib/gaps.ts words it.
func (a *app) wantedAgent(loop *LoopView, r *LoopReadiness) string {
	if loop.AgentID != nil {
		return *loop.AgentID
	}
	return deref(r.DefaultAgentID)
}

func (a *app) runnersFor(loop *LoopView) string {
	w := a.m.workflow(loop.ConnectorID, loop.WorkflowID)
	if w == nil || w.RunsIn != "folder" {
		return "any"
	}
	if folder, ok := loop.Settings["folder"].(string); ok && strings.HasPrefix(strings.TrimSpace(folder), "/") {
		return "host"
	}
	return "folder"
}

func (a *app) issuesFor(r *LoopReadiness, loop *LoopView) []string {
	if !loop.Enabled {
		return nil
	}
	var issues []string
	agentID := a.wantedAgent(loop, r)
	needs := a.runnersFor(loop)
	pool := r.AvailableAgentIDs
	switch needs {
	case "host":
		pool = r.HostAgentIDs
	case "folder":
		pool = r.FolderAgentIDs
	}
	if agentID == "" {
		if loop.AgentID != nil {
			issues = append(issues, fmt.Sprintf("%s uses %s, which is not signed in on this Mac.", loop.Name, a.m.agentName(*loop.AgentID)))
		} else {
			issues = append(issues, "No default agent is chosen, so this loop cannot run.")
		}
	} else if !contains(pool, agentID) {
		if needs == "host" {
			issues = append(issues, fmt.Sprintf("%s works in an absolute folder from an older version. Edit it and give the folder relative to your home.", loop.Name))
		} else {
			issues = append(issues, fmt.Sprintf("%s uses %s, which is not signed in on this Mac.", loop.Name, a.m.agentName(agentID)))
		}
	}
	return issues
}

func (a *app) gapsFor(r *LoopReadiness, loops []LoopView) []string {
	var missing []string
	connected := map[string]bool{}
	for _, id := range r.ConnectedConnectorIDs {
		connected[id] = true
	}
	if len(connected) == 0 {
		missing = append(missing, "Nothing is connected yet, so no signal can arrive.")
	}
	if len(r.AvailableAgentIDs) == 0 {
		missing = append(missing, "No coding agent is signed in on this Mac, so nothing can be prepared.")
	} else if r.DefaultAgentID == nil {
		missing = append(missing, "No default agent is chosen, so loops that do not name one cannot run.")
	}
	if len(connected) > 0 {
		for i := range loops {
			loop := &loops[i]
			if !loop.Enabled {
				continue
			}
			if a.m.needsAccount(loop.ConnectorID) && !connected[loop.ConnectorID] {
				missing = append(missing, fmt.Sprintf("%s watches %s, which is not connected.", loop.Name, a.m.connectorName(loop.ConnectorID)))
			}
			if a.m.needsAccount(loop.ActionConnectorID) && !connected[loop.ActionConnectorID] {
				missing = append(missing, fmt.Sprintf("%s answers on %s, which is not connected.", loop.Name, a.m.connectorName(loop.ActionConnectorID)))
			}
		}
	}
	if len(r.AvailableAgentIDs) > 0 {
		for i := range loops {
			for _, issue := range a.issuesFor(r, &loops[i]) {
				if issue == "No default agent is chosen, so this loop cannot run." {
					continue
				}
				missing = append(missing, issue)
			}
		}
	}
	return missing
}

// connected says whether loops can be made on a connector yet.
func (a *app) connected(id string) bool {
	if a.readiness == nil {
		return false
	}
	return contains(a.readiness.ConnectedConnectorIDs, id)
}

func (a *app) usable(connector *Connector) bool {
	return connector.Auth.Kind == "none" || a.connected(connector.ID)
}

func (a *app) newLoopPage(c *ui.Context, r *ui.Route) {
	t := c.Theme()
	a.header(c, "/loops", "Loops", "New loop", "", "", nil)
	if a.m == nil {
		ui.Spinner(c)
		return
	}
	inUse := func(workflowID string) string {
		n := 0
		for i := range a.loops {
			if a.loops[i].WorkflowID == workflowID {
				n++
			}
		}
		switch n {
		case 0:
			return ""
		case 1:
			return "You have 1 loop like this"
		}
		return fmt.Sprintf("You have %d loops like this", n)
	}
	choice := func(key string, tileID, title, summary, note string, needs *Connector, target string) {
		box := ui.ButtonBase(c).Key(key).Row().Gap(12).AlignItems(ui.Start).Padding(14).Radius(10).Background(t.Surface).Border(1, t.Border).Label(title).Basis(0).Grow(1).MinWidth(300)
		if needs == nil && box.Hovered() {
			box.Background(t.SurfaceHover)
		}
		box.Disabled(needs != nil)
		box.Children(func() {
			if tileID == "" {
				ui.Box(c).Size(32, 32).Radius(8).Background(t.Background).Border(1, t.Border).Center().Shrink(0).Children(func() {
					ui.Icon(c, iconPencil).FontSize(16)
				})
			} else {
				connectorTile(c, tileID, 32, needs != nil)
			}
			ui.Column(c).Grow(1).Gap(4).Children(func() {
				ui.Text(c, title).FontSize(13).Bold()
				ui.Text(c, summary).FontSize(11).TextColor(t.TextMuted)
				if needs != nil {
					ui.Link(c, "Connect "+needs.Name+" first", "/connectors/"+needs.ID).FontSize(11)
				} else if note != "" {
					ui.Text(c, note).FontSize(11).TextColor(t.TextMuted)
				}
			})
		})
		if box.Clicked() && needs == nil {
			a.goTo(target)
		}
	}
	grid := func(fn func()) {
		ui.Row(c).Wrap().Gap(12).AlignItems(ui.Stretch).Children(fn)
	}
	grid(func() {
		choice("custom", "", "Custom loop", "Pick a trigger and write your own prompt.", "", nil, "/loops/new/"+a.firstUsableTrigger()+"?custom=1")
		for _, connector := range a.m.ordered() {
			if connector.ID != "schedule" {
				continue
			}
			for _, w := range connector.Workflows {
				choice(connector.ID+"/"+w.ID, connector.ID, w.Name, w.Summary, inUse(w.ID), nil, "/loops/new/"+connector.ID+"/"+w.ID)
			}
		}
	})
	ui.Text(c, "From a connector").FontSize(13).Bold().TextColor(t.TextMuted)
	grid(func() {
		for _, ready := range []bool{true, false} {
			for _, connector := range a.m.ordered() {
				if connector.ID == "schedule" || a.usable(connector) != ready {
					continue
				}
				var needs *Connector
				if !ready {
					needs = connector
				}
				for _, w := range connector.Workflows {
					choice(connector.ID+"/"+w.ID, connector.ID, w.Name, w.Summary, inUse(w.ID), needs, "/loops/new/"+connector.ID+"/"+w.ID)
				}
			}
		}
	})
	_ = r
}

// firstUsableTrigger is where a custom loop starts: the first trigger that
// can actually run.
func (a *app) firstUsableTrigger() string {
	var first, usable string
	for _, connector := range a.m.ordered() {
		for _, trigger := range connector.Triggers {
			path := connector.ID + "/" + trigger.ID
			if first == "" {
				first = path
			}
			if connector.Auth.Kind != "none" && a.connected(connector.ID) {
				return path
			}
			if usable == "" && a.usable(connector) {
				usable = path
			}
		}
	}
	if usable != "" {
		return usable
	}
	return first
}

func (a *app) shapeLoopPage(c *ui.Context, connectorID, workflowID string, custom bool) {
	t := c.Theme()
	if a.m == nil {
		ui.Spinner(c)
		return
	}
	w := a.m.workflow(connectorID, workflowID)
	if w == nil {
		a.header(c, "/loops/new", "New loop", "Unknown workflow", "", "", nil)
		return
	}
	key := "new:" + connectorID + "/" + workflowID
	if custom {
		key = "custom:" + connectorID + "/" + workflowID
	}
	form := a.forms[key]
	if form == nil {
		draft := a.m.draftFor(connectorID, workflowID)
		if custom {
			draft.Name, draft.Prompt = "Custom loop", ""
		}
		form = a.newLoopForm(key, draft)
		a.forms[key] = form
	}
	if custom {
		a.header(c, "/loops/new", "New loop", "Custom loop", "Pick what starts it, then say what the agent should do.", "", nil)
		// The trigger: changing it starts the form over, since each has its
		// own fields and its own place to answer.
		var labels []string
		var paths []string
		current := ""
		for _, connector := range a.m.ordered() {
			for _, trigger := range connector.Triggers {
				label := trigger.When
				if !a.usable(connector) {
					label += "  (connect " + connector.Name + " first)"
				}
				labels = append(labels, label)
				paths = append(paths, connector.ID+"/"+trigger.ID)
				if connector.ID == connectorID && trigger.ID == workflowID {
					current = label
				}
			}
		}
		ui.Field(c, "Starts when", func() {
			if ui.Select(c, &current, labels).MaxWidth(420).Changed() {
				for i, label := range labels {
					if label == current && paths[i] != connectorID+"/"+workflowID {
						a.goTo("/loops/new/" + paths[i] + "?custom=1")
					}
				}
			}
		})
		_ = t
	} else {
		a.header(c, "/loops/new", "New loop", w.Name, w.Summary, connectorID, nil)
	}
	a.loopFormView(c, form)
}

func (a *app) loopDetailPage(c *ui.Context, r *ui.Route) {
	t := c.Theme()
	id := r.Param("id")
	page := &a.loopPage
	loop := page.loop
	if loop == nil || loop.ID != id || a.m == nil {
		a.header(c, "/loops", "Loops", "Loop", "", "", nil)
		ui.Spinner(c)
		return
	}
	connector := a.m.connector(loop.ConnectorID)
	byHand := "none"
	if connector != nil {
		byHand = connector.ByHand.Kind
	}
	busy := a.busy["loop:"+loop.ID]

	summary := []string{a.m.destinationLabel(loop.ActionConnectorID, loop.ActionID)}
	if loop.AgentID != nil {
		summary = append(summary, a.m.agentName(*loop.AgentID))
	} else {
		summary = append(summary, "Default agent")
	}
	if loop.Enabled && page.poll != nil {
		if page.poll.PolledAt != nil {
			summary = append(summary, "Checked "+ago(*page.poll.PolledAt))
		} else {
			summary = append(summary, "Not checked yet")
		}
	}
	a.header(c, "/loops", "Loops", loop.Name, strings.Join(summary, " · "), loop.ConnectorID, func() {
		if byHand == "now" {
			if ui.Button(c, "Run now").Disabled(busy).Clicked() {
				a.run("loop:"+loop.ID, func() (string, error) {
					if err := a.call("runLoopNow", map[string]any{"loopId": loop.ID, "url": "", "dryRun": false}, nil); err != nil {
						return "", err
					}
					return "Queued", nil
				})
			}
		} else {
			if ui.Button(c, "Check now").Disabled(busy || !loop.Enabled).Clicked() {
				a.run("loop:"+loop.ID, func() (string, error) {
					var report LookReport
					if err := a.call("lookLoopNow", map[string]string{"id": loop.ID}, &report); err != nil {
						return "", err
					}
					if report.Error != "" {
						return "", fmt.Errorf("%s", report.Error)
					}
					return "Checked", nil
				})
			}
		}
		on := loop.Enabled
		if ui.Switch(c, &on).Disabled(busy).Label("On").Changed() {
			a.toggleLoop(loop, on)
		}
		label := "Off"
		if loop.Enabled {
			label = "On"
		}
		ui.Text(c, label).FontSize(12)
	})

	if a.readiness != nil {
		if issues := a.issuesFor(a.readiness, loop); len(issues) > 0 {
			alert(c, "Cannot run yet", issues, false)
		}
	}
	if loop.Enabled && page.poll != nil && page.poll.PollError != nil && *page.poll.PollError != "" {
		alert(c, "The last check failed", []string{*page.poll.PollError}, true)
	}

	tasksLabel := "Tasks"
	if len(page.tasks) > 0 {
		tasksLabel = fmt.Sprintf("Tasks  %d", len(page.tasks))
	}
	ui.Tabs(c, &page.tab, "Settings", tasksLabel)

	if page.tab == 0 {
		key := "edit:" + loop.ID
		form := a.forms[key]
		if form == nil || form.updatedAt != loop.UpdatedAt {
			form = a.newLoopForm(key, editOf(loop))
			form.updatedAt = loop.UpdatedAt
			a.forms[key] = form
		}
		a.loopFormView(c, form)
		section(c, "Delete", "", func() {
			ui.Row(c).Gap(12).AlignItems(ui.Center).Children(func() {
				ui.Text(c, "Its runs are deleted with it.").FontSize(12).TextColor(t.TextMuted).Grow(1)
				if ui.Button(c, "Delete loop").TextColor(t.Danger).Clicked() {
					a.askDeleteLoop(loop)
				}
			})
		})
		return
	}

	// Try the loop on one link, by hand.
	if connector != nil && connector.ByHand.Kind == "link" {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			ui.TextInput(c, &page.tryURL).Placeholder("Try on a link: " + connector.ByHand.Placeholder).Label(connector.Name + " link").Grow(1)
			ui.Switch(c, &page.dryRun).Label("Dry run")
			ui.Text(c, "Dry run").FontSize(12).TextColor(t.TextMuted)
			if ui.PrimaryButton(c, "Run").Disabled(busy || strings.TrimSpace(page.tryURL) == "").Clicked() {
				url, dry := strings.TrimSpace(page.tryURL), page.dryRun
				a.run("loop:"+loop.ID, func() (string, error) {
					if err := a.call("runLoopNow", map[string]any{"loopId": loop.ID, "url": url, "dryRun": dry}, nil); err != nil {
						return "", err
					}
					if dry {
						return "Queued as a dry run", nil
					}
					return "Queued", nil
				})
				page.tryURL = ""
			}
		})
	}
	if page.poll != nil && len(page.poll.Backlog) > 0 {
		held := 0
		for _, item := range page.poll.Backlog {
			if item.Hold != nil {
				held++
			}
		}
		before := len(page.poll.Backlog) - held
		var reasons []string
		if before > 0 {
			verb := "were"
			if before == 1 {
				verb = "was"
			}
			reasons = append(reasons, fmt.Sprintf("%d %s open before this loop", before, verb))
		}
		if held > 0 {
			reasons = append(reasons, fmt.Sprintf("%d held back by a rule", held))
		}
		open := a.open["backlog:"+loop.ID]
		ui.Collapsible(c, fmt.Sprintf("%d not run · %s", len(page.poll.Backlog), strings.Join(reasons, ", ")), &open, func() {
			card(c).Dividers(1, t.Border).Children(func() {
				for _, item := range page.poll.Backlog {
					item := item
					ui.Row(c).Key(item.Key).Gap(12).AlignItems(ui.Center).Padding(8, 16).Children(func() {
						ui.Column(c).Grow(1).Children(func() {
							ui.Text(c, item.SourceRef+"  "+item.SourceTitle).FontSize(12).SingleLine()
							if item.Hold != nil {
								ui.Text(c, *item.Hold).FontSize(11).TextColor(t.Warning).SingleLine()
							}
						})
						if ui.Button(c, "Run").Disabled(busy).Clicked() {
							a.run("loop:"+loop.ID, func() (string, error) {
								if err := a.call("runLoopBacklog", map[string]string{"id": loop.ID, "key": item.Key}, nil); err != nil {
									return "", err
								}
								return "Queued", nil
							})
						}
					})
				}
			})
		})
		a.open["backlog:"+loop.ID] = open
	}
	a.taskList(c, page.tasks, false, "No runs yet.")
}
