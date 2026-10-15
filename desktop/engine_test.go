package main

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

// A real engine in a throwaway data folder, for the screens to load from.
// Skipped where there is no Node or no built engine.
func startTestEngine(t *testing.T) *Engine {
	t.Helper()
	dir, _ := filepath.Abs("resources/engine")
	if _, err := os.Stat(filepath.Join(dir, "engine.mjs")); err != nil {
		t.Skip("no engine built; run node scripts/build-engine.mjs")
	}
	node, err := findNode(enginePath())
	if err != nil {
		t.Skip(err)
	}
	e := newEngine(nil)
	home := t.TempDir()
	cmd := exec.Command(node.Path, filepath.Join(dir, "engine.mjs"))
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"LOOPABLE_DESKTOP=1", "LOOPABLE_DESKTOP_TOKEN="+e.token, "LOOPABLE_HOME="+home,
		"LOOPABLE_KEYCHAIN=0", "LOOPABLE_SECRET_PREFIX=loopable-desktop-test",
	)
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = stdin.Close()
		_ = cmd.Process.Signal(os.Interrupt)
		_, _ = cmd.Process.Wait()
	})
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		var event struct {
			Event string `json:"event"`
			Port  int    `json:"port"`
		}
		if json.Unmarshal(scanner.Bytes(), &event) == nil && event.Event == "listening" {
			e.port = event.Port
			e.state = "running"
			break
		}
	}
	if e.port == 0 {
		t.Fatal("the engine did not start")
	}
	// The runner joins a moment after the engine listens, once it has
	// looked for the agents; the pages are about what it found.
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		var s Status
		if e.Call("getStatus", nil, &s) == nil && len(s.Runners) == 1 {
			return e
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatal("the runner did not join")
	return nil
}

func TestScreensWithARealEngine(t *testing.T) {
	a := newApp()
	a.engine = startTestEngine(t)
	a.settings.loaded = true

	load := func(path string) {
		a.router.Push(path)
		a.enter(path)
		a.refresh()
		deadline := time.Now().Add(30 * time.Second)
		for a.refreshing.Load() && time.Now().Before(deadline) {
			time.Sleep(20 * time.Millisecond)
		}
	}
	load("/inbox")
	if a.m == nil {
		t.Fatal("the manifests did not load")
	}
	if len(a.m.Connectors) < 5 || len(a.m.Agents) < 3 {
		t.Fatalf("manifests: %d connectors, %d agents", len(a.m.Connectors), len(a.m.Agents))
	}
	if a.m.workflow("github", "github.review") == nil && len(a.m.connector("github").Workflows) == 0 {
		t.Fatalf("GitHub should offer workflows")
	}

	// Make a loop through the form, as a person would, on the clock, which
	// needs no account.
	load("/loops/new")
	tt := ui.NewTester(a.view, 1040, 800)
	shots := os.Getenv("LOOPABLE_SHOTS")
	if !tt.HasText("Custom loop") {
		t.Fatalf("the new loop page should offer a custom loop: %q", tt.Texts())
	}
	schedule := a.m.connector("schedule")
	if schedule == nil || len(schedule.Workflows) == 0 {
		t.Fatal("the clock should offer a workflow")
	}
	workflow := schedule.Workflows[0]
	load("/loops/new/schedule/" + workflow.ID)
	tt = ui.NewTester(a.view, 1040, 900)
	form := a.forms["new:schedule/"+workflow.ID]
	if form == nil {
		t.Fatal("no form")
	}
	form.name = "Test loop from the desktop"
	form.folder = "code/web"
	a.saveLoop(form, a.m.workflow("schedule", workflow.ID))
	deadline := time.Now().Add(20 * time.Second)
	for form.saving && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if form.saving {
		t.Fatal("saving did not finish")
	}
	load(a.router.Path())
	if a.loopPage.loop == nil || a.loopPage.loop.Name != "Test loop from the desktop" {
		t.Fatalf("the saved loop should be open: %+v at %s (toasts %q)", a.loopPage.loop, a.router.Path(), a.toasts)
	}
	tt = ui.NewTester(a.view, 1040, 800)
	for range 40 {
		tt.Frame()
	}
	if !tt.HasText("Test loop from the desktop") {
		t.Fatalf("the loop page should show the loop: %q", tt.Texts())
	}
	save(t, tt, shots, "live-loop")

	load("/loops")
	tt = ui.NewTester(a.view, 1040, 700)
	for range 40 {
		tt.Frame()
	}
	if !tt.HasText("Test loop from the desktop") {
		t.Fatalf("the loops page should list the loop: %q", tt.Texts())
	}
	save(t, tt, shots, "live-loops")

	load("/agents")
	tt = ui.NewTester(a.view, 1040, 700)
	for range 40 {
		tt.Frame()
	}
	if len(a.agents) < 3 {
		t.Fatalf("agents: %d", len(a.agents))
	}
	save(t, tt, shots, "live-agents")

	load("/connectors")
	tt = ui.NewTester(a.view, 1040, 700)
	for range 40 {
		tt.Frame()
	}
	if !tt.HasText("GitHub") || !tt.HasText("Slack") {
		t.Fatalf("connectors: %q", tt.Texts())
	}
	save(t, tt, shots, "live-connectors")

	load("/settings")
	tt = ui.NewTester(a.view, 1040, 760)
	for range 40 {
		tt.Frame()
	}
	if a.status == nil || len(a.status.Runners) != 1 {
		t.Fatalf("status: %+v", a.status)
	}
	save(t, tt, shots, "live-settings")
}

func save(t *testing.T, tt *ui.Tester, dir, name string) {
	t.Helper()
	if dir == "" {
		return
	}
	_ = os.MkdirAll(dir, 0o755)
	f, err := os.Create(filepath.Join(dir, name+".png"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := encodePNG(f, tt.Image()); err != nil {
		t.Fatal(err)
	}
}
