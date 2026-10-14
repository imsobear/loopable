package main

import (
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo/ui"
)

func ptr[T any](v T) *T { return &v }

// fixture is enough of a workspace to draw every page.
func fixture() *app {
	a := newApp()
	a.engine.state = "running"
	a.engine.port = 1
	a.m = &Manifests{
		Connectors: []Connector{
			{
				ID: "github", Name: "GitHub", Tagline: "Reviews and replies on your repositories.", Icon: "Github",
				Auth:                   AuthDescriptor{Kind: "oauth_redirect", Scopes: []string{"repo"}, Note: "Connect the account Loopable should answer as."},
				ByHand:                 ByHand{Kind: "link", Placeholder: "https://github.com/acme/web/pull/7"},
				AllowsMultipleAccounts: true,
				Settings:               []SettingField{{Key: "repositories", Kind: "string_list", Label: "Repositories", Help: "owner/name, one per line."}},
				Triggers: []Trigger{{ID: "github.review_requested", When: "A review is requested", Trigger: "someone asks for your review", Watches: "is:pr review-requested:@me", RunsIn: "checkout", Answer: "review", ActionID: "github.submit_review",
					Settings: []SettingField{{Key: "drafts", Kind: "boolean", Label: "Include drafts", Default: false}}}},
				Workflows: []Workflow{{ID: "github.review", TriggerID: "github.review_requested", Name: "Review pull requests", Summary: "Review each pull request you are asked to.", Prompt: "Review this pull request.", When: "A review is requested", Trigger: "someone asks for your review", Watches: "is:pr review-requested:@me", RunsIn: "checkout", Answer: "review", ActionID: "github.submit_review",
					Settings: []SettingField{{Key: "drafts", Kind: "boolean", Label: "Include drafts", Default: false}}}},
				Actions: []Action{{ID: "github.submit_review", Name: "Submit a review", Summary: "A review on the pull request.", Accepts: []string{"review", "text"}}},
			},
			{
				ID: "schedule", Name: "Schedule", Tagline: "Run a loop when the time comes round.", Icon: "Clock",
				Auth: AuthDescriptor{Kind: "none"}, ByHand: ByHand{Kind: "now"},
				Triggers: []Trigger{{ID: "schedule.recurring", When: "On a schedule", Trigger: "the time you set comes round", RunsIn: "folder", Answer: "text", ActionID: "schedule.record",
					Settings: []SettingField{{Key: "every", Kind: "select", Label: "How often", Options: []SelectOption{{"hour", "Every hour"}, {"day", "Every day"}}, Default: "day"}, {Key: "at", Kind: "text", Label: "At", Help: "24-hour time, in UTC.", Placeholder: "09:00"}}}},
				Workflows: []Workflow{{ID: "schedule.daily", TriggerID: "schedule.recurring", Name: "Daily check", Summary: "Look over the folder every morning.", Prompt: "Look around.", When: "On a schedule", Trigger: "the time you set comes round", RunsIn: "folder", Answer: "text", ActionID: "schedule.record",
					Settings: []SettingField{{Key: "every", Kind: "select", Label: "How often", Options: []SelectOption{{"hour", "Every hour"}, {"day", "Every day"}}, Default: "day"}, {Key: "at", Kind: "text", Label: "At", Help: "24-hour time, in UTC.", Placeholder: "09:00"}}}},
				Actions: []Action{{ID: "schedule.record", Name: "Keep in Inbox", Summary: "The answer stays here.", Accepts: []string{"text"}}},
			},
			{ID: "slack", Name: "Slack", Tagline: "A bot in your Slack.", Auth: AuthDescriptor{Kind: "token", Fields: []TokenField{{Key: "botToken", Label: "Bot User OAuth Token", Placeholder: "xoxb-…", Secret: true}}, Note: "Paste the bot token.", HelpURL: "https://api.slack.com/apps"},
				Triggers:  []Trigger{{ID: "slack.mention", When: "The bot is mentioned", Trigger: "someone mentions the bot", RunsIn: "folder", Answer: "text", ActionID: "slack.reply"}},
				Workflows: []Workflow{{ID: "slack.answer", TriggerID: "slack.mention", Name: "Answer questions", Summary: "Answer in the thread.", Prompt: "Answer.", When: "The bot is mentioned", Trigger: "someone mentions the bot", RunsIn: "folder", Answer: "text", ActionID: "slack.reply"}},
				Actions:   []Action{{ID: "slack.reply", Name: "Reply in Slack", Summary: "In the thread.", Accepts: []string{"text"}}}},
		},
		Agents: []AgentManifest{
			{ID: "codex", Name: "Codex", InstallHint: "npm install -g @openai/codex", PermissionModes: []string{"read_only", "workspace_write"}, SupportsModel: true, ModelPlaceholder: "gpt-5", Defaults: AgentSettings{PermissionMode: "read_only", TimeoutMs: 600000}},
			{ID: "claude", Name: "Claude Code", InstallHint: "npm install -g @anthropic-ai/claude-code", PermissionModes: []string{"read_only", "workspace_write"}, SupportsModel: true, Defaults: AgentSettings{PermissionMode: "read_only", TimeoutMs: 600000}},
		},
	}
	a.loops = []LoopView{
		{ID: "l1", Name: "Review pull requests", Enabled: true, ConnectorID: "github", WorkflowID: "github.review", Prompt: "Review this pull request.", Settings: map[string]any{"drafts": false}, ActionConnectorID: "github", ActionID: "github.submit_review", ActionTarget: map[string]any{}, UpdatedAt: "2026-10-13T10:00:00Z"},
		{ID: "l2", Name: "Morning look", Enabled: false, ConnectorID: "schedule", WorkflowID: "schedule.daily", Prompt: "Look around.", Settings: map[string]any{"every": "day", "at": "09:00", "folder": "code/web"}, ActionConnectorID: "schedule", ActionID: "schedule.record", ActionTarget: map[string]any{}, AgentID: ptr("claude"), UpdatedAt: "2026-10-13T10:00:00Z"},
	}
	a.readiness = &LoopReadiness{ConnectedConnectorIDs: []string{"github"}, DefaultAgentID: ptr("codex"), AvailableAgentIDs: []string{"codex", "claude"}, HostAgentIDs: []string{"codex", "claude"}, FolderAgentIDs: []string{"codex", "claude"}}
	a.tasks = []TaskView{
		{ID: "t1", LoopID: ptr("l1"), LoopName: "Review pull requests", ConnectorID: "github", State: "awaiting_agent", SourceKind: "pull_request", SourceRef: "acme/web#7", SourceTitle: ptr("Fix checkout totals"), AgentID: ptr("codex"), ActionConnectorID: "github", ActionID: "github.submit_review", CreatedAt: "2026-10-13T12:00:00Z", UpdatedAt: "2026-10-13T12:00:00Z"},
		{ID: "t2", LoopID: ptr("l1"), LoopName: "Review pull requests", ConnectorID: "github", State: "done", SourceKind: "pull_request", SourceRef: "acme/web#6", SourceTitle: ptr("Add retries to the mailer"), AgentID: ptr("codex"), Output: ptr("Looks good overall. Two things to check before merging:\n\n1. The retry loop never backs off.\n2. The test only covers the happy path."), Comments: []Finding{{Path: "src/mailer.ts", Line: 42, Body: "This retries at once, with no wait between tries."}}, ActionConnectorID: "github", ActionID: "github.submit_review", ResultURL: ptr("https://github.com/acme/web/pull/6#pullrequestreview-1"), DurationMs: ptr(83000.0), CreatedAt: "2026-10-13T09:00:00Z", UpdatedAt: "2026-10-13T09:02:00Z"},
		{ID: "t3", LoopName: "", ConnectorID: "", State: "failed", SourceKind: "prompt", SourceRef: "Ask", SourceTitle: ptr("What changed this week?"), Prompt: ptr("What changed this week?"), AgentID: ptr("claude"), Error: ptr("The agent did not finish: timed out after 600s."), ActionConnectorID: "schedule", ActionID: "schedule.record", Attempts: 2, CreatedAt: "2026-10-12T09:00:00Z", UpdatedAt: "2026-10-12T09:12:00Z"},
	}
	a.runnable = []AgentChoice{{"codex", "Codex"}, {"claude", "Claude Code"}}
	a.agents = []AgentView{
		{AgentID: "codex", Installed: true, Version: ptr("0.42.0"), Auth: &AgentAuth{SignedIn: true, Detail: "Logged in using ChatGPT"}, Settings: AgentSettings{PermissionMode: "read_only", TimeoutMs: 600000}, IsDefault: true, CommandPreview: "codex exec --sandbox read-only <prompt>"},
		{AgentID: "claude", Installed: true, Auth: &AgentAuth{SignedIn: false, Detail: "Not signed in"}, Settings: AgentSettings{PermissionMode: "workspace_write", TimeoutMs: 300000}, CommandPreview: "claude -p <prompt>"},
	}
	a.overview = []ConnectorOverview{
		{ConnectorID: "github", Readiness: Readiness{Ready: true}, Connections: []ConnectionView{{ID: "c1", ConnectorID: "github", Status: "connected", AccountLabel: "imsobear", Scopes: []string{"repo", "notifications"}, Settings: map[string]any{"repositories": []any{"acme/web"}}, LastSyncedAt: ptr("2026-10-13T12:00:00Z")}}},
		{ConnectorID: "slack", Readiness: Readiness{Ready: true}},
		{ConnectorID: "schedule", Readiness: Readiness{Ready: true}},
	}
	a.status = &Status{Version: "0.8.1", DataDir: "/Users/me/Library/Application Support/Loopable/data", Alive: true, Runners: []RunnerView{{Name: "mac.local", Inventory: []InventoryEntry{{AgentID: "codex", SignedIn: true}}}}}
	a.task = taskPage{id: "t2", task: &a.tasks[1], log: "codex: reading the diff…\ncodex: 3 files changed\ncodex: done"}
	a.loopPage = loopPage{id: "l2", loop: &a.loops[1], tasks: a.tasks[:1], poll: &LoopPollState{PolledAt: ptr("2026-10-13T12:00:00Z"), Backlog: []BacklogItem{{Key: "b1", SourceRef: "acme/web#3", SourceTitle: "Old one", Hold: ptr("is a draft")}}}, dryRun: true}
	a.settings.loaded = true
	return a
}

func shoot(t *testing.T, a *app, name, path string, w, h int) {
	t.Helper()
	a.router.Push(path)
	a.enter(path)
	tt := ui.NewTester(a.view, w, h)
	for range 40 {
		tt.Frame()
	}
	dir := os.Getenv("LOOPABLE_SHOTS")
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

func encodePNG(f *os.File, img image.Image) error { return png.Encode(f, img) }

func TestPagesRender(t *testing.T) {
	a := fixture()
	pages := []struct{ name, path string }{
		{"inbox", "/inbox"}, {"task", "/inbox/t2"}, {"loops", "/loops"}, {"loop-new", "/loops/new"},
		{"loop-shape", "/loops/new/github/github.review"}, {"loop-custom", "/loops/new/schedule/schedule.recurring?custom=1"},
		{"loop-detail", "/loops/l2"}, {"connectors", "/connectors"}, {"connector", "/connectors/github"},
		{"connector-slack", "/connectors/slack"}, {"agents", "/agents"}, {"settings", "/settings"},
	}
	for _, page := range pages {
		shoot(t, a, page.name, page.path, 1040, 700)
	}
}

func TestInboxOpensATask(t *testing.T) {
	a := fixture()
	tt := ui.NewTester(a.view, 1040, 700)
	if !tt.HasText("Fix checkout totals") {
		t.Fatalf("inbox should list the runs: %q", tt.Texts())
	}
	if err := tt.Click("Add retries to the mailer"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if a.router.Path() != "/inbox/t2" {
		t.Fatalf("clicking a run should open it, got %s", a.router.Path())
	}
	if !tt.HasText("Written") {
		t.Fatalf("the run page should show the result: %q", tt.Texts())
	}
}

func TestLoopFormSaves(t *testing.T) {
	a := fixture()
	a.router.Push("/loops/new/github/github.review")
	tt := ui.NewTester(a.view, 1040, 900)
	if !tt.HasText("Review pull requests") {
		t.Fatalf("the form should be titled after the workflow: %q", tt.Texts())
	}
	form := a.forms["new:github/github.review"]
	if form == nil {
		t.Fatal("no form was made")
	}
	if form.writer != "GitHub" || form.action != "Submit a review" {
		t.Fatalf("the destination should start as the workflow's: %q %q", form.writer, form.action)
	}
}
