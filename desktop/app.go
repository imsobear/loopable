package main

import (
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

// app is everything the window shows. All of it is read and written on
// the main thread: goroutines hand their results over with win.Update.
type app struct {
	win      *mygo.Window
	tray     *mygo.Tray
	router   *ui.Router
	engine   *Engine
	quitting bool

	m         *Manifests
	loops     []LoopView
	readiness *LoopReadiness
	tasks     []TaskView
	runnable  []AgentChoice
	agents    []AgentView
	overview  []ConnectorOverview
	status    *Status

	// The task page, the loop page, and the connector page, each for one id.
	task     taskPage
	loopPage loopPage

	busy      map[string]bool
	toasts    []string
	forms     map[string]*loopForm
	fields    map[string]*fieldValues
	ask       askState
	connect   *connectFlow
	agentEdit map[string]*agentEdit
	confirm   confirmState
	open      map[string]bool
	settings  settingsPage

	// Task states last seen, to notice one finishing.
	seen       map[string]string
	refreshing atomic.Bool
	gen        atomic.Uint64
	lastTick   time.Time
}

type taskPage struct {
	id   string
	task *TaskView
	log  string
}

type loopPage struct {
	id     string
	loop   *LoopView
	tasks  []TaskView
	poll   *LoopPollState
	tab    int
	tryURL string
	dryRun bool
}

type askState struct {
	open    bool
	prompt  string
	agent   string
	running bool
}

type confirmState struct {
	open  bool
	kind  string // "loop" or "connection"
	id    string
	name  string
	title string
	body  string
}

func newApp() *app {
	a := &app{
		router:    ui.NewRouter("/inbox"),
		busy:      map[string]bool{},
		forms:     map[string]*loopForm{},
		fields:    map[string]*fieldValues{},
		agentEdit: map[string]*agentEdit{},
		open:      map[string]bool{},
		seen:      map[string]string{},
	}
	a.loopPage.dryRun = true
	a.engine = newEngine(func() { a.update(func() {}) })
	return a
}

// update runs fn on the main thread and draws a frame. Safe before the
// window exists, when there is nothing to draw.
func (a *app) update(fn func()) {
	if a.win == nil {
		// No window, as in tests: there is no main thread to wait for.
		fn()
		return
	}
	if a.win.IsDestroyed() {
		return
	}
	a.win.Update(fn)
}

func (a *app) toast(message string) {
	a.toasts = append(a.toasts, message)
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return strings.TrimSpace(err.Error())
}

// run does work off the main thread, then says how it went and refreshes.
// key marks what is busy meanwhile, so its buttons can wait.
func (a *app) run(key string, work func() (string, error)) {
	if a.busy[key] {
		return
	}
	a.busy[key] = true
	go func() {
		message, err := work()
		a.update(func() {
			delete(a.busy, key)
			if err != nil {
				a.toast(errText(err))
			} else if message != "" {
				a.toast(message)
			}
			a.refresh()
		})
	}()
}

func (a *app) call(name string, in any, out any) error {
	return a.engine.Call(name, in, out)
}

// refresh loads what the page on screen needs, that page's own data
// first, so a page never waits on another's. Called on the main thread;
// the loading happens elsewhere and lands with update. A newer refresh
// outranks an older one still in flight.
func (a *app) refresh() {
	if a.engine == nil {
		return
	}
	state, _, _, _, _ := a.engine.snapshot()
	if state != "running" {
		return
	}
	a.refreshing.Store(true)
	gen := a.gen.Add(1)
	path := a.router.Path()
	needManifests := a.m == nil
	taskID, loopID := a.task.id, a.loopPage.id
	latest := func() bool { return a.gen.Load() == gen }
	go func() {
		defer func() {
			if latest() {
				a.refreshing.Store(false)
			}
		}()
		if needManifests {
			var got Manifests
			if err := a.call("getManifests", nil, &got); err == nil {
				a.update(func() { a.m = &got })
			}
		}

		switch {
		case path == "/inbox":
			a.loadInbox()
		case strings.HasPrefix(path, "/inbox/") && taskID != "":
			var t TaskView
			if err := a.call("getTaskById", map[string]string{"id": taskID}, &t); err == nil && t.ID != "" {
				var text *string
				log := ""
				if a.call("getTaskLog", map[string]string{"id": taskID}, &text) == nil && text != nil {
					log = *text
				}
				a.update(func() {
					if a.task.id == t.ID {
						a.task.task, a.task.log = &t, log
					}
				})
			}
		case path == "/loops" || path == "/loops/new" || strings.HasPrefix(path, "/loops/new/"):
			a.loadLoops()
			if path != "/loops" {
				a.loadOverview()
			}
		case strings.HasPrefix(path, "/loops/") && loopID != "":
			var l LoopView
			if err := a.call("getLoopById", map[string]string{"id": loopID}, &l); err == nil && l.ID != "" {
				lp := &loopPage{id: loopID, loop: &l}
				_ = a.call("getLoopTasks", map[string]string{"loopId": loopID}, &lp.tasks)
				var poll LoopPollState
				if a.call("getLoopPollState", map[string]string{"id": loopID}, &poll) == nil {
					lp.poll = &poll
				}
				a.update(func() {
					if a.loopPage.id == lp.id {
						a.loopPage.loop, a.loopPage.tasks, a.loopPage.poll = lp.loop, lp.tasks, lp.poll
					}
				})
			}
			a.loadLoops()
		case path == "/connectors":
			a.loadOverview()
		case strings.HasPrefix(path, "/connectors/"):
			a.loadOverview()
			a.loadLoops()
		case path == "/agents":
			var agents struct {
				Agents []AgentView `json:"agents"`
			}
			if a.call("getAgentsPage", nil, &agents) == nil {
				a.update(func() { a.agents = agents.Agents })
			}
		case path == "/settings":
			var s Status
			if a.call("getStatus", nil, &s) == nil {
				a.update(func() { a.status = &s })
			}
		}

		// The inbox feeds the sidebar's count and the notifications, so it
		// is looked at after every page, when nothing newer is on its way.
		if path != "/inbox" && latest() {
			a.loadInbox()
		}
	}()
}

func (a *app) loadInbox() {
	var inbox struct {
		Tasks  []TaskView    `json:"tasks"`
		Agents []AgentChoice `json:"agents"`
	}
	if a.call("getInbox", nil, &inbox) != nil {
		return
	}
	a.update(func() {
		a.noticeFinished(inbox.Tasks)
		a.tasks, a.runnable = inbox.Tasks, inbox.Agents
		if a.ask.agent == "" && len(inbox.Agents) > 0 {
			a.ask.agent = inbox.Agents[0].Name
		}
	})
}

func (a *app) loadLoops() {
	var page struct {
		Loops     []LoopView    `json:"loops"`
		Readiness LoopReadiness `json:"readiness"`
	}
	if a.call("getLoopsPage", nil, &page) != nil {
		return
	}
	a.update(func() { a.loops, a.readiness = page.Loops, &page.Readiness })
}

func (a *app) loadOverview() {
	var overview []ConnectorOverview
	if a.call("getConnectorOverview", nil, &overview) != nil {
		return
	}
	a.update(func() { a.overview = overview })
}

// noticeFinished tells the person about a run that ended while they were
// not looking, once per run.
func (a *app) noticeFinished(tasks []TaskView) {
	first := len(a.seen) == 0
	for i := range tasks {
		t := &tasks[i]
		before, known := a.seen[t.ID]
		a.seen[t.ID] = t.State
		if first || !known || before == t.State || t.Active() {
			continue
		}
		if a.win != nil && a.win.IsVisible() && a.win.IsFocused() {
			continue
		}
		if !mygo.NotificationsSupported() {
			continue
		}
		title := t.Title()
		body := ""
		switch t.State {
		case "done":
			body = "Written: " + a.m.destinationLabel(t.ActionConnectorID, t.ActionID)
		case "failed":
			body = "Failed"
			if t.Error != nil {
				body = "Failed: " + firstLine(*t.Error)
			}
		case "skipped":
			body = "Nothing to write"
		case "prepared":
			body = "Prepared, nothing written"
		default:
			continue
		}
		id := t.ID
		n := mygo.NewNotification(mygo.NotificationOptions{Title: title, Body: body})
		n.OnClick(func() {
			a.update(func() {
				a.show()
				a.goTo("/inbox/" + id)
			})
		})
		_ = n.Show()
	}
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

// goTo opens a page and starts loading what it needs.
func (a *app) goTo(path string) {
	a.enter(path)
	a.router.Push(path)
	a.refresh()
}

// enter notes which record a page is about before it is built.
func (a *app) enter(path string) {
	if rest, ok := strings.CutPrefix(path, "/inbox/"); ok && rest != "" {
		if a.task.id != rest {
			a.task = taskPage{id: rest}
			// What the list already knows, shown at once; the log follows.
			for i := range a.tasks {
				if a.tasks[i].ID == rest {
					t := a.tasks[i]
					a.task.task = &t
				}
			}
		}
	}
	if rest, ok := strings.CutPrefix(path, "/loops/"); ok && rest != "" && rest != "new" && !strings.HasPrefix(rest, "new/") {
		id := rest
		if i := strings.IndexByte(id, '?'); i >= 0 {
			id = id[:i]
		}
		if a.loopPage.id != id {
			a.loopPage = loopPage{id: id, dryRun: true}
			for i := range a.loops {
				if a.loops[i].ID == id {
					l := a.loops[i]
					a.loopPage.loop = &l
				}
			}
		}
	}
}

func (a *app) show() {
	if a.win == nil {
		return
	}
	a.win.Show()
	a.win.Focus()
	a.refresh()
}

func (a *app) ready() {
	a.win = mygo.NewWindow(mygo.WindowOptions{
		Title:     "Loopable",
		Width:     1040,
		Height:    700,
		MinWidth:  760,
		MinHeight: 520,
		StateKey:  "main",
		Hidden:    mygo.App.WasOpenedAtLogin(),
		Content:   ui.View(a.view),
	})
	// Closing the window leaves the app in the menu bar, with the loops running.
	a.win.OnClose(func(e *mygo.CloseEvent) {
		if !a.quitting {
			e.PreventDefault()
			a.win.Hide()
		}
	})
	a.makeMenus()
	a.engine.Start()
	go a.ticker()
}

// ticker refreshes the page every couple of seconds while something runs,
// and every ten otherwise, so the inbox is live without anyone pressing
// anything. Notifications come from the same look.
func (a *app) ticker() {
	for {
		time.Sleep(2 * time.Second)
		a.update(func() {
			active := false
			for i := range a.tasks {
				if a.tasks[i].Active() {
					active = true
					break
				}
			}
			visible := a.win != nil && a.win.IsVisible()
			every := 10 * time.Second
			if active {
				every = 2 * time.Second
			} else if !visible {
				every = 20 * time.Second
			}
			if time.Since(a.lastTick) < every || a.refreshing.Load() {
				return
			}
			a.lastTick = time.Now()
			a.refresh()
		})
	}
}

func (a *app) makeMenus() {
	mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
		{Role: mygo.RoleAppMenu},
		{Label: "File", Submenu: []*mygo.MenuItem{
			{Label: "New Loop", Accelerator: "CmdOrCtrl+N", Click: func(*mygo.MenuItem, *mygo.Window) {
				a.show()
				a.goTo("/loops/new")
			}},
			{Label: "Ask an Agent", Accelerator: "CmdOrCtrl+K", Click: func(*mygo.MenuItem, *mygo.Window) {
				a.show()
				a.goTo("/inbox")
				a.ask.open = true
			}},
			mygo.Separator(),
			{Role: mygo.RoleClose},
		}},
		{Role: mygo.RoleEditMenu},
		{Label: "View", Submenu: []*mygo.MenuItem{
			{Label: "Inbox", Accelerator: "CmdOrCtrl+1", Click: func(*mygo.MenuItem, *mygo.Window) { a.goTo("/inbox") }},
			{Label: "Loops", Accelerator: "CmdOrCtrl+2", Click: func(*mygo.MenuItem, *mygo.Window) { a.goTo("/loops") }},
			{Label: "Connectors", Accelerator: "CmdOrCtrl+3", Click: func(*mygo.MenuItem, *mygo.Window) { a.goTo("/connectors") }},
			{Label: "Agents", Accelerator: "CmdOrCtrl+4", Click: func(*mygo.MenuItem, *mygo.Window) { a.goTo("/agents") }},
			{Label: "Settings", Accelerator: "CmdOrCtrl+,", Click: func(*mygo.MenuItem, *mygo.Window) { a.goTo("/settings") }},
			mygo.Separator(),
			{Label: "Reload", Accelerator: "CmdOrCtrl+R", Click: func(*mygo.MenuItem, *mygo.Window) { a.refresh() }},
		}},
		{Role: mygo.RoleWindowMenu},
	}))

	tray, err := mygo.NewTray(mygo.TrayOptions{
		Icon:           trayIcon(),
		IconIsTemplate: true,
		ToolTip:        "Loopable",
		Menu: mygo.NewMenu([]*mygo.MenuItem{
			{Label: "Open Loopable", Click: func(*mygo.MenuItem, *mygo.Window) { a.show() }},
			{Label: "Inbox", Click: func(*mygo.MenuItem, *mygo.Window) { a.show(); a.goTo("/inbox") }},
			{Label: "Loops", Click: func(*mygo.MenuItem, *mygo.Window) { a.show(); a.goTo("/loops") }},
			mygo.Separator(),
			{Role: mygo.RoleQuit},
		}),
	})
	if err == nil {
		a.tray = tray
	}
}

// ago says how long since an ISO time: "just now", "5m ago", "3h ago", or a date.
func ago(iso string) string {
	t, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil {
		return iso
	}
	seconds := int(time.Since(t).Seconds())
	switch {
	case seconds < 60:
		return "just now"
	case seconds < 3600:
		return fmt.Sprintf("%dm ago", (seconds+30)/60)
	case seconds < 86400:
		return fmt.Sprintf("%dh ago", (seconds+1800)/3600)
	}
	return t.Local().Format("Jan 2, 2006")
}

func localTime(iso string) string {
	t, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil {
		return iso
	}
	return t.Local().Format("Jan 2, 2006 15:04")
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func contains(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}
