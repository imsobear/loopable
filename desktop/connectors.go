package main

import (
	"encoding/base64"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

func statusBadge(c *ui.Context, status string) {
	label := map[string]string{
		"connected": "Connected", "needs_reauth": "Reconnect", "error": "Error", "paused": "Paused",
	}[status]
	if label == "" {
		label = status
	}
	ui.Badge(c, label)
}

func (a *app) overviewOf(id string) *ConnectorOverview {
	for i := range a.overview {
		if a.overview[i].ConnectorID == id {
			return &a.overview[i]
		}
	}
	return nil
}

func (a *app) connectorsPage(c *ui.Context) {
	t := c.Theme()
	a.header(c, "", "", "Connectors", "The services loops watch and write to.", "", nil)
	if a.m == nil {
		ui.Spinner(c)
		return
	}
	card(c).Dividers(1, t.Border).Children(func() {
		for i := range a.m.Connectors {
			manifest := &a.m.Connectors[i]
			if !a.m.needsAccount(manifest.ID) {
				continue
			}
			state := a.overviewOf(manifest.ID)
			row := ui.ButtonBase(c).Key(manifest.ID).Row().Gap(12).AlignItems(ui.Center).Padding(12, 16).Label(manifest.Name)
			if row.Hovered() {
				row.Background(t.SurfaceHover)
			}
			row.Children(func() {
				connectorTile(c, manifest.ID, 32, false)
				ui.Column(c).Grow(1).Gap(2).Children(func() {
					ui.Text(c, manifest.Name).FontSize(13).Bold()
					switch {
					case state != nil && !state.Readiness.Ready:
						ui.Text(c, "Not available in this build").FontSize(11).TextColor(t.TextMuted).SingleLine()
					case state != nil && len(state.Connections) > 0:
						ui.Row(c).Gap(10).AlignItems(ui.Center).Wrap().Children(func() {
							for _, connection := range state.Connections {
								ui.Row(c).Gap(5).AlignItems(ui.Center).Children(func() {
									ui.Text(c, connection.AccountLabel).FontSize(11).TextColor(t.TextMuted)
									statusBadge(c, connection.Status)
								})
							}
						})
					default:
						ui.Text(c, "No "+a.m.connectionNoun(manifest.ID)+" yet").FontSize(11).TextColor(t.TextMuted)
					}
				})
				ui.Icon(c, iconChevron).TextColor(t.TextMuted)
			})
			if row.Clicked() {
				a.goTo("/connectors/" + manifest.ID)
			}
		}
	})
}

// connectFlow is a connection being made: a device code, a browser page,
// a QR code, or a token pasted.
type connectFlow struct {
	connectorID string
	kind        string
	loading     bool
	// device
	userCode, verificationURL string
	// device and qr
	attempt any
	hint    string
	expired string
	// qr
	image *ui.Bitmap
	// token
	values map[string]*string
	stop   chan struct{}
}

func (f *connectFlow) end() {
	if f != nil && f.stop != nil {
		close(f.stop)
		f.stop = nil
	}
}

func (a *app) connectorPage(c *ui.Context, id string) {
	t := c.Theme()
	if a.m == nil {
		ui.Spinner(c)
		return
	}
	manifest := a.m.connector(id)
	if manifest == nil {
		a.header(c, "/connectors", "Connectors", "Unknown connector", "", "", nil)
		return
	}
	state := a.overviewOf(id)
	if a.connect != nil && a.connect.connectorID != id {
		a.connect.end()
		a.connect = nil
	}
	var connections []ConnectionView
	ready := false
	if state != nil {
		connections, ready = state.Connections, state.Readiness.Ready
	}
	canAdd := manifest.AllowsMultipleAccounts || len(connections) == 0

	a.header(c, "/connectors", "Connectors", manifest.Name, manifest.Tagline, manifest.ID, func() {
		if !ready || !canAdd {
			return
		}
		if a.connect != nil {
			if ui.Button(c, "Cancel").Clicked() {
				a.connect.end()
				a.connect = nil
			}
			return
		}
		label := "Connect"
		switch manifest.Auth.Kind {
		case "token":
			label = "Add bot"
		case "oauth_redirect":
			if len(connections) > 0 {
				label = "Add account"
			}
		}
		if ui.PrimaryButton(c, label).Clicked() {
			a.beginConnect(manifest)
		}
	})

	if state != nil && !ready {
		// Loopable's own apps are built in, so this is the build's doing,
		// and there is nothing for the person to set up.
		lines := []string{state.Readiness.Reason}
		if manifest.Auth.Kind == "oauth_redirect" {
			lines = []string{"This copy of Loopable was built without its " + manifest.Name + " app, so " + manifest.Name + " cannot be connected yet. A newer version will fix it."}
		} else if state.Readiness.FixHint != "" {
			lines = append(lines, state.Readiness.FixHint)
		}
		alert(c, "Not available", lines, true)
	}

	if a.connect != nil {
		a.connectView(c, manifest)
	}

	if len(connections) > 0 {
		card(c).Dividers(1, t.Border).Children(func() {
			for i := range connections {
				a.connectionRow(c, manifest, &connections[i])
			}
		})
	} else if ready && a.connect == nil {
		empty(c, "No "+a.m.connectionNoun(id)+" connected yet.", func() {
			if manifest.Auth.Kind == "oauth_redirect" && manifest.Auth.Note != "" {
				ui.Text(c, manifest.Auth.Note).FontSize(11).TextColor(t.TextMuted).MaxWidth(480).TextAlign(ui.Center)
			}
		})
	}

	// Loops that watch this connector, or write through it.
	ui.Column(c).Gap(8).Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			ui.Text(c, "Loops").FontSize(13).Bold().Grow(1)
			if len(manifest.Triggers) > 0 {
				if ui.Button(c, "New loop").Clicked() {
					a.goTo("/loops/new")
				}
			}
		})
		var using []*LoopView
		for i := range a.loops {
			if a.loops[i].ConnectorID == id || a.loops[i].ActionConnectorID == id {
				using = append(using, &a.loops[i])
			}
		}
		if len(using) == 0 {
			ui.Text(c, "No loop uses "+manifest.Name+" yet.").FontSize(12).TextColor(t.TextMuted)
			return
		}
		card(c).Dividers(1, t.Border).Children(func() {
			for _, loop := range using {
				loop := loop
				row := ui.ButtonBase(c).Key(loop.ID).Row().Gap(12).AlignItems(ui.Center).Padding(10, 16).Label(loop.Name)
				if row.Hovered() {
					row.Background(t.SurfaceHover)
				}
				row.Children(func() {
					ui.Column(c).Grow(1).Gap(2).Children(func() {
						ui.Text(c, loop.Name).FontSize(13).Bold().SingleLine()
						text := a.m.destinationLabel(loop.ActionConnectorID, loop.ActionID)
						if loop.ConnectorID != id {
							text = "Answers here, from " + a.m.connectorName(loop.ConnectorID)
						}
						ui.Text(c, text).FontSize(11).TextColor(t.TextMuted).SingleLine()
					})
					if !loop.Enabled {
						ui.Badge(c, "Off")
					}
					ui.Icon(c, iconChevron).TextColor(t.TextMuted)
				})
				if row.Clicked() {
					a.goTo("/loops/" + loop.ID)
				}
			}
		})
	})

	ui.Row(c).Gap(24).AlignItems(ui.Start).Children(func() {
		capability := func(title, emptyText string, items [][2]string) {
			ui.Column(c).Grow(1).Basis(0).Gap(8).Children(func() {
				ui.Text(c, title).FontSize(13).Bold()
				if len(items) == 0 {
					ui.Text(c, emptyText).FontSize(12).TextColor(t.TextMuted)
				}
				for _, item := range items {
					ui.Column(c).Gap(1).Children(func() {
						ui.Text(c, item[0]).FontSize(12)
						ui.Text(c, item[1]).FontSize(11).TextColor(t.TextMuted)
					})
				}
			})
		}
		var triggers, workflows, actions [][2]string
		for _, trigger := range manifest.Triggers {
			triggers = append(triggers, [2]string{trigger.When, "When " + trigger.Trigger + "."})
		}
		for _, workflow := range manifest.Workflows {
			workflows = append(workflows, [2]string{workflow.Name, workflow.Summary})
		}
		for _, action := range manifest.Actions {
			actions = append(actions, [2]string{action.Name, action.Summary})
		}
		capability("Starts when", "Nothing. This connector cannot start a loop.", triggers)
		capability("Workflows", "None. Use a custom loop.", workflows)
		capability("Send to", "Nothing. This connector only reads.", actions)
	})
}

func (a *app) beginConnect(manifest *Connector) {
	flow := &connectFlow{connectorID: manifest.ID, stop: make(chan struct{})}
	a.connect = flow
	switch manifest.Auth.Kind {
	case "token":
		flow.kind = "token"
		flow.values = map[string]*string{}
		for _, field := range manifest.Auth.Fields {
			s := ""
			flow.values[field.Key] = &s
		}
	case "qr_scan":
		flow.kind = "qr"
		a.startQr(flow)
	default:
		flow.loading = true
		go func() {
			var started struct {
				Kind            string `json:"kind"`
				URL             string `json:"url"`
				Attempt         any    `json:"attempt"`
				UserCode        string `json:"userCode"`
				VerificationURL string `json:"verificationUrl"`
				IntervalMs      int    `json:"intervalMs"`
			}
			err := a.call("beginConnect", map[string]string{"connectorId": manifest.ID}, &started)
			a.update(func() {
				if a.connect != flow {
					return
				}
				flow.loading = false
				if err != nil {
					a.toast(errText(err))
					a.connect = nil
					return
				}
				flow.kind = started.Kind
				if started.Kind == "browser" {
					_ = mygo.Shell.OpenExternal(started.URL)
					flow.hint = "Finish in your browser. This page updates when the account is connected."
					go a.watchConnections(flow, manifest.ID)
					return
				}
				flow.userCode, flow.verificationURL, flow.attempt = started.UserCode, started.VerificationURL, started.Attempt
				interval := time.Duration(started.IntervalMs) * time.Millisecond
				if interval < time.Second {
					interval = 5 * time.Second
				}
				_ = mygo.Shell.OpenExternal(started.VerificationURL)
				go a.pollConnect(flow, "continueDeviceLogin", manifest.ID, interval)
			})
		}()
	}
}

func (a *app) startQr(flow *connectFlow) {
	flow.loading = true
	flow.expired, flow.hint, flow.image = "", "", nil
	go func() {
		var started struct {
			Attempt any    `json:"attempt"`
			Image   string `json:"image"`
		}
		err := a.call("beginQrLogin", map[string]string{"connectorId": flow.connectorID}, &started)
		var bitmap *ui.Bitmap
		if err == nil {
			if data, decodeErr := base64.StdEncoding.DecodeString(started.Image); decodeErr == nil {
				bitmap, _ = ui.DecodeBitmap(data)
			}
		}
		a.update(func() {
			if a.connect != flow {
				return
			}
			flow.loading = false
			if err != nil {
				flow.expired = errText(err)
				return
			}
			flow.attempt, flow.image = started.Attempt, bitmap
			go a.pollConnect(flow, "continueQrLogin", flow.connectorID, 2*time.Second)
		})
	}()
}

// pollConnect asks every so often whether the code was used, until it
// was, it expired, or the flow was cancelled.
func (a *app) pollConnect(flow *connectFlow, method, connectorID string, every time.Duration) {
	stop := flow.stop
	for {
		select {
		case <-stop:
			return
		case <-time.After(every):
		}
		var attempt any
		done := make(chan bool, 1)
		a.update(func() {
			attempt = flow.attempt
			done <- a.connect == flow && flow.expired == ""
		})
		if !<-done {
			return
		}
		var outcome struct {
			State        string `json:"state"`
			Attempt      any    `json:"attempt"`
			Hint         string `json:"hint"`
			Reason       string `json:"reason"`
			AccountLabel string `json:"accountLabel"`
		}
		err := a.call(method, map[string]any{"connectorId": connectorID, "attempt": attempt}, &outcome)
		finished := false
		a.update(func() {
			if a.connect != flow {
				finished = true
				return
			}
			if err != nil {
				flow.hint = errText(err)
				return
			}
			switch outcome.State {
			case "connected":
				a.toast("Connected " + outcome.AccountLabel)
				a.connect = nil
				finished = true
				a.refresh()
			case "expired":
				flow.expired = outcome.Reason
				if flow.expired == "" {
					flow.expired = "The code expired before it was used."
				}
				finished = true
			default:
				flow.attempt, flow.hint = outcome.Attempt, outcome.Hint
			}
		})
		if finished {
			return
		}
	}
}

// watchConnections waits for a browser authorization to land, for a few
// minutes, by looking at the connections.
func (a *app) watchConnections(flow *connectFlow, connectorID string) {
	stop := flow.stop
	before := -1
	deadline := time.Now().Add(5 * time.Minute)
	for time.Now().Before(deadline) {
		select {
		case <-stop:
			return
		case <-time.After(2 * time.Second):
		}
		var overview []ConnectorOverview
		if a.call("getConnectorOverview", nil, &overview) != nil {
			continue
		}
		count := 0
		for _, entry := range overview {
			if entry.ConnectorID == connectorID {
				count = len(entry.Connections)
			}
		}
		if before < 0 {
			before = count
			continue
		}
		if count > before {
			a.update(func() {
				if a.connect == flow {
					a.connect = nil
					a.toast("Connected")
					a.refresh()
				}
			})
			return
		}
	}
}

func (a *app) connectView(c *ui.Context, manifest *Connector) {
	t := c.Theme()
	flow := a.connect
	card(c).Padding(16).Gap(12).Children(func() {
		switch flow.kind {
		case "token":
			if manifest.Auth.Note != "" {
				ui.Text(c, manifest.Auth.Note).FontSize(12).TextColor(t.TextMuted)
			}
			if manifest.Auth.HelpURL != "" {
				ui.Link(c, "Open the app dashboard", manifest.Auth.HelpURL).FontSize(12)
			}
			ui.Form(c, func() {
				for _, field := range manifest.Auth.Fields {
					field := field
					label := field.Label
					if !field.Optional {
						label += " *"
					}
					ui.Field(c, label, func() {
						input := ui.TextInput(c, flow.values[field.Key]).Placeholder(field.Placeholder).MaxWidth(480)
						if field.Secret {
							input.Password()
						}
					})
				}
			})
			ui.Row(c).Children(func() {
				label := "Connect"
				if flow.loading {
					label = "Connecting…"
				}
				if ui.PrimaryButton(c, label).Disabled(flow.loading).Clicked() {
					fields := map[string]string{}
					for key, value := range flow.values {
						fields[key] = strings.TrimSpace(*value)
					}
					flow.loading = true
					go func() {
						var result struct {
							AccountLabel string `json:"accountLabel"`
						}
						err := a.call("connectWithToken", map[string]any{"connectorId": manifest.ID, "fields": fields}, &result)
						a.update(func() {
							flow.loading = false
							if err != nil {
								a.toast(errText(err))
								return
							}
							a.toast("Connected " + result.AccountLabel)
							if a.connect == flow {
								a.connect = nil
							}
							a.refresh()
						})
					}()
				}
			})
		case "device":
			ui.Text(c, "Enter this code on GitHub to connect the account Loopable should watch and answer as.").FontSize(12).TextColor(t.TextMuted)
			ui.Row(c).Gap(12).AlignItems(ui.Center).Children(func() {
				ui.Text(c, flow.userCode).Font("monospace").FontSize(26).Bold().Selectable().Padding(8, 14).Radius(8).Background(t.Background).Border(1, t.Border)
				if ui.Button(c, "Copy code").Clicked() {
					mygo.Clipboard.WriteText(flow.userCode)
					c.Toast("Copied")
				}
				if ui.PrimaryButton(c, "Open GitHub").Clicked() {
					_ = mygo.Shell.OpenExternal(flow.verificationURL)
				}
			})
			a.connectStatus(c, flow)
		case "qr":
			if manifest.Auth.Note != "" {
				ui.Text(c, manifest.Auth.Note).FontSize(12).TextColor(t.TextMuted)
			}
			ui.Box(c).Size(240, 240).Radius(8).Background(ui.Hex("#ffffff")).Border(1, t.Border).Center().AlignSelf(ui.Center).Children(func() {
				if flow.image != nil && flow.expired == "" {
					ui.Image(c, flow.image).Size(232, 232)
				} else if flow.expired == "" {
					ui.Spinner(c)
				}
			})
			a.connectStatus(c, flow)
			ui.Row(c).Justify(ui.Center).Children(func() {
				label := "Start over"
				if flow.expired != "" {
					label = "New code"
				}
				if ui.Button(c, label).Disabled(flow.loading).Clicked() {
					a.startQr(flow)
				}
			})
		default:
			ui.Row(c).Gap(10).AlignItems(ui.Center).Children(func() {
				ui.Spinner(c)
				text := flow.hint
				if text == "" {
					text = "Starting…"
				}
				ui.Text(c, text).FontSize(12).TextColor(t.TextMuted)
			})
		}
	})
}

func (a *app) connectStatus(c *ui.Context, flow *connectFlow) {
	t := c.Theme()
	if flow.expired != "" {
		alert(c, "Not connected", []string{flow.expired}, true)
		return
	}
	ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
		ui.Spinner(c)
		text := flow.hint
		if text == "" {
			text = "Waiting…"
		}
		ui.Text(c, text).FontSize(12).TextColor(t.TextMuted)
	})
}

func (a *app) connectionRow(c *ui.Context, manifest *Connector, connection *ConnectionView) {
	t := c.Theme()
	busy := a.busy["connection:"+connection.ID]
	broken := connection.Status == "needs_reauth" || connection.Status == "error"
	ui.Column(c).Key(connection.ID).Gap(12).Padding(12, 16).Children(func() {
		ui.Row(c).Gap(12).AlignItems(ui.Center).Children(func() {
			ui.Avatar(c, connection.AccountLabel, nil).Size(32, 32)
			ui.Column(c).Grow(1).Gap(2).Children(func() {
				ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
					ui.Text(c, connection.AccountLabel).FontSize(13).Bold().SingleLine()
					statusBadge(c, connection.Status)
				})
				parts := []string{"Not checked yet"}
				if connection.LastSyncedAt != nil {
					parts[0] = "Checked " + ago(*connection.LastSyncedAt)
				}
				if len(connection.Scopes) > 0 {
					parts = append(parts, strings.Join(connection.Scopes, ", "))
				}
				ui.Text(c, strings.Join(parts, " · ")).FontSize(11).TextColor(t.TextMuted).SingleLine()
			})
			if broken && manifest.Auth.Kind == "oauth_redirect" {
				if ui.PrimaryButton(c, "Reconnect").Disabled(busy || a.connect != nil).Clicked() {
					a.beginConnect(manifest)
				}
			}
			if ui.Button(c, "Verify").Disabled(busy).Clicked() {
				id := connection.ID
				a.run("connection:"+id, func() (string, error) {
					var updated ConnectionView
					if err := a.call("verifyConnection", map[string]string{"id": id}, &updated); err != nil {
						return "", err
					}
					if updated.Status == "connected" {
						return updated.AccountLabel + " is reachable", nil
					}
					if updated.LastError != nil {
						return "", errorString(*updated.LastError)
					}
					return "", errorString("This connection is not usable")
				})
			}
			if ui.Button(c, "Disconnect").Disabled(busy).Clicked() {
				a.confirm = confirmState{
					open: true, kind: "connection", id: connection.ID, name: connection.AccountLabel,
					title: "Disconnect " + connection.AccountLabel + "?", body: "Loops that use it stop until another is connected.",
				}
			}
		})
		if connection.LastError != nil && *connection.LastError != "" {
			ui.Text(c, *connection.LastError).FontSize(11).TextColor(t.Danger).Selectable()
		}
		if len(manifest.Settings) > 0 {
			key := "connection:" + connection.ID
			values := a.fields[key]
			if values == nil {
				values = newFieldValues(manifest.Settings, connection.Settings)
				a.fields[key] = values
			}
			ui.Form(c, func() { values.render(c) })
			ui.Row(c).Children(func() {
				if ui.Button(c, "Save settings").Disabled(busy).Clicked() {
					id := connection.ID
					settings := values.values()
					a.run("connection:"+id, func() (string, error) {
						if err := a.call("saveConnectionSettings", map[string]any{"id": id, "settings": settings}, nil); err != nil {
							return "", err
						}
						return "Settings saved", nil
					})
				}
			})
		}
	})
}

type errorString string

func (e errorString) Error() string { return string(e) }
