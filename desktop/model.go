package main

// The engine's answers, as src/lib/domain.ts and the connector manifests
// shape them. Tags match the JSON exactly, since some of these go back.

type Finding struct {
	Path      string `json:"path"`
	Line      int    `json:"line"`
	StartLine *int   `json:"startLine,omitempty"`
	Body      string `json:"body"`
}

type TaskView struct {
	ID                string    `json:"id"`
	LoopID            *string   `json:"loopId"`
	LoopName          string    `json:"loopName"`
	ConnectorID       string    `json:"connectorId"`
	State             string    `json:"state"`
	SourceURL         string    `json:"sourceUrl"`
	SourceKind        string    `json:"sourceKind"`
	SourceRef         string    `json:"sourceRef"`
	SourceTitle       *string   `json:"sourceTitle"`
	Prompt            *string   `json:"prompt"`
	DryRun            bool      `json:"dryRun"`
	AgentID           *string   `json:"agentId"`
	RunnerID          *string   `json:"runnerId"`
	AgentCommand      *string   `json:"agentCommand"`
	Output            *string   `json:"output"`
	Comments          []Finding `json:"comments"`
	ActionConnectorID string    `json:"actionConnectorId"`
	ActionID          string    `json:"actionId"`
	ResultURL         *string   `json:"resultUrl"`
	Error             *string   `json:"error"`
	Attempts          int       `json:"attempts"`
	CancelRequested   bool      `json:"cancelRequested"`
	DurationMs        *float64  `json:"durationMs"`
	CreatedAt         string    `json:"createdAt"`
	StartedAt         *string   `json:"startedAt"`
	UpdatedAt         string    `json:"updatedAt"`
}

func (t *TaskView) Title() string {
	if t.SourceTitle != nil && *t.SourceTitle != "" {
		return *t.SourceTitle
	}
	return t.SourceRef
}

func (t *TaskView) Active() bool {
	switch t.State {
	case "queued", "preparing", "awaiting_agent", "applying":
		return true
	}
	return false
}

type LoopView struct {
	ID                string         `json:"id"`
	Name              string         `json:"name"`
	Enabled           bool           `json:"enabled"`
	Priority          int            `json:"priority"`
	ConnectorID       string         `json:"connectorId"`
	WorkflowID        string         `json:"workflowId"`
	Settings          map[string]any `json:"settings"`
	Prompt            string         `json:"prompt"`
	Guidance          *string        `json:"guidance"`
	McpServers        []string       `json:"mcpServers"`
	AgentID           *string        `json:"agentId"`
	ActionConnectorID string         `json:"actionConnectorId"`
	ActionID          string         `json:"actionId"`
	ActionTarget      map[string]any `json:"actionTarget"`
	PollEveryMs       *float64       `json:"pollEveryMs"`
	CreatedAt         string         `json:"createdAt"`
	UpdatedAt         string         `json:"updatedAt"`
}

type LoopEdit struct {
	ID                *string        `json:"id"`
	Name              string         `json:"name"`
	ConnectorID       string         `json:"connectorId"`
	WorkflowID        string         `json:"workflowId"`
	Prompt            string         `json:"prompt"`
	Guidance          *string        `json:"guidance"`
	AgentID           *string        `json:"agentId"`
	McpServers        []string       `json:"mcpServers"`
	Settings          map[string]any `json:"settings"`
	ActionConnectorID string         `json:"actionConnectorId"`
	ActionID          string         `json:"actionId"`
	ActionTarget      map[string]any `json:"actionTarget"`
	PollEveryMs       *float64       `json:"pollEveryMs"`
	Enabled           bool           `json:"enabled"`
}

type LoopReadiness struct {
	ConnectedConnectorIDs []string `json:"connectedConnectorIds"`
	DefaultAgentID        *string  `json:"defaultAgentId"`
	AvailableAgentIDs     []string `json:"availableAgentIds"`
	HostAgentIDs          []string `json:"hostAgentIds"`
	FolderAgentIDs        []string `json:"folderAgentIds"`
}

type BacklogItem struct {
	Key         string  `json:"key"`
	SourceKind  string  `json:"sourceKind"`
	SourceRef   string  `json:"sourceRef"`
	SourceTitle string  `json:"sourceTitle"`
	SourceURL   string  `json:"sourceUrl"`
	Hold        *string `json:"hold"`
	SeenAt      string  `json:"seenAt"`
}

type LoopPollState struct {
	PolledAt  *string       `json:"polledAt"`
	PollError *string       `json:"pollError"`
	Backlog   []BacklogItem `json:"backlog"`
}

type LookReport struct {
	LoopName string `json:"loopName"`
	Found    int    `json:"found"`
	Queued   int    `json:"queued"`
	Error    string `json:"error"`
}

type ConnectionView struct {
	ID           string         `json:"id"`
	ConnectorID  string         `json:"connectorId"`
	Status       string         `json:"status"`
	AccountLabel string         `json:"accountLabel"`
	AccountURL   *string        `json:"accountUrl"`
	AvatarURL    *string        `json:"avatarUrl"`
	Scopes       []string       `json:"scopes"`
	Settings     map[string]any `json:"settings"`
	LastSyncedAt *string        `json:"lastSyncedAt"`
	LastError    *string        `json:"lastError"`
	CreatedAt    string         `json:"createdAt"`
}

type Readiness struct {
	Ready   bool   `json:"ready"`
	Reason  string `json:"reason"`
	FixHint string `json:"fixHint"`
}

type ConnectorOverview struct {
	ConnectorID string           `json:"connectorId"`
	Readiness   Readiness        `json:"readiness"`
	Connections []ConnectionView `json:"connections"`
}

type AgentOnRunner struct {
	RunnerID string  `json:"runnerId"`
	Name     string  `json:"name"`
	Status   string  `json:"status"`
	SignedIn bool    `json:"signedIn"`
	Version  *string `json:"version"`
}

type AgentSettings struct {
	PermissionMode string  `json:"permissionMode"`
	Model          *string `json:"model"`
	TimeoutMs      float64 `json:"timeoutMs"`
}

type AgentAuth struct {
	SignedIn bool   `json:"signedIn"`
	Detail   string `json:"detail"`
}

type AgentView struct {
	AgentID           string          `json:"agentId"`
	Installed         bool            `json:"installed"`
	BinaryPath        *string         `json:"binaryPath"`
	Version           *string         `json:"version"`
	Auth              *AgentAuth      `json:"auth"`
	Settings          AgentSettings   `json:"settings"`
	IsDefault         bool            `json:"isDefault"`
	DefaultIsImplicit bool            `json:"defaultIsImplicit"`
	CommandPreview    string          `json:"commandPreview"`
	OnRunners         []AgentOnRunner `json:"onRunners"`
}

type AgentChoice struct {
	AgentID string `json:"agentId"`
	Name    string `json:"name"`
}

type AgentTest struct {
	Passed     bool    `json:"passed"`
	Output     string  `json:"output"`
	Detail     *string `json:"detail"`
	DurationMs float64 `json:"durationMs"`
	Command    string  `json:"command"`
}

type InventoryEntry struct {
	AgentID   string  `json:"agentId"`
	Installed bool    `json:"installed"`
	Version   *string `json:"version"`
	SignedIn  bool    `json:"signedIn"`
	Detail    string  `json:"detail"`
}

type RunnerView struct {
	ID         string           `json:"id"`
	Name       string           `json:"name"`
	Hostname   string           `json:"hostname"`
	Status     string           `json:"status"`
	Inventory  []InventoryEntry `json:"inventory"`
	LastSeenAt *string          `json:"lastSeenAt"`
	Version    *string          `json:"version"`
	Enabled    bool             `json:"enabled"`
}

type Status struct {
	Version           string       `json:"version"`
	PID               int          `json:"pid"`
	DataDir           string       `json:"dataDir"`
	Node              string       `json:"node"`
	Alive             bool         `json:"alive"`
	Runners           []RunnerView `json:"runners"`
	Paused            bool         `json:"paused"`
	MaxConcurrentRuns int          `json:"maxConcurrentRuns"`
}

type SelectOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type SettingField struct {
	Key         string         `json:"key"`
	Kind        string         `json:"kind"`
	Label       string         `json:"label"`
	Help        string         `json:"help"`
	Placeholder string         `json:"placeholder"`
	Default     any            `json:"default"`
	Options     []SelectOption `json:"options"`
}

type TokenField struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Placeholder string `json:"placeholder"`
	Secret      bool   `json:"secret"`
	Optional    bool   `json:"optional"`
}

type AuthDescriptor struct {
	Kind                 string       `json:"kind"`
	Scopes               []string     `json:"scopes"`
	NeedsAppRegistration bool         `json:"needsAppRegistration"`
	Note                 string       `json:"note"`
	Fields               []TokenField `json:"fields"`
	HelpURL              string       `json:"helpUrl"`
}

type ByHand struct {
	Kind        string `json:"kind"`
	Placeholder string `json:"placeholder"`
}

type Trigger struct {
	ID                string         `json:"id"`
	When              string         `json:"when"`
	Trigger           string         `json:"trigger"`
	Watches           string         `json:"watches"`
	RunsIn            string         `json:"runsIn"`
	Settings          []SettingField `json:"settings"`
	Answer            string         `json:"answer"`
	ActionID          string         `json:"actionId"`
	ActionConnectorID *string        `json:"actionConnectorId"`
	ActionTarget      map[string]any `json:"actionTarget"`
	PollEveryMs       *float64       `json:"pollEveryMs"`
}

// Workflow is a trigger with a workflow merged on, as connectorWorkflow
// returns it: what a loop runs, by the id it stores.
type Workflow struct {
	ID                string         `json:"id"`
	TriggerID         string         `json:"triggerId"`
	Name              string         `json:"name"`
	Summary           string         `json:"summary"`
	Prompt            string         `json:"prompt"`
	Custom            bool           `json:"custom"`
	When              string         `json:"when"`
	Trigger           string         `json:"trigger"`
	Watches           string         `json:"watches"`
	RunsIn            string         `json:"runsIn"`
	Settings          []SettingField `json:"settings"`
	Answer            string         `json:"answer"`
	ActionID          string         `json:"actionId"`
	ActionConnectorID *string        `json:"actionConnectorId"`
	ActionTarget      map[string]any `json:"actionTarget"`
	PollEveryMs       *float64       `json:"pollEveryMs"`
}

type Action struct {
	ID      string         `json:"id"`
	Name    string         `json:"name"`
	Summary string         `json:"summary"`
	Target  []SettingField `json:"target"`
	Accepts []string       `json:"accepts"`
}

type Connector struct {
	ID                     string         `json:"id"`
	Name                   string         `json:"name"`
	Tagline                string         `json:"tagline"`
	DocsURL                *string        `json:"docsUrl"`
	Icon                   string         `json:"icon"`
	Auth                   AuthDescriptor `json:"auth"`
	ByHand                 ByHand         `json:"byHand"`
	Settings               []SettingField `json:"settings"`
	AllowsMultipleAccounts bool           `json:"allowsMultipleAccounts"`
	Triggers               []Trigger      `json:"triggers"`
	Workflows              []Workflow     `json:"workflows"`
	Actions                []Action       `json:"actions"`
}

type AgentManifest struct {
	ID               string        `json:"id"`
	Name             string        `json:"name"`
	Tagline          string        `json:"tagline"`
	DocsURL          *string       `json:"docsUrl"`
	Icon             string        `json:"icon"`
	Binaries         []string      `json:"binaries"`
	InstallHint      string        `json:"installHint"`
	PermissionModes  []string      `json:"permissionModes"`
	SupportsModel    bool          `json:"supportsModel"`
	ModelPlaceholder string        `json:"modelPlaceholder"`
	Defaults         AgentSettings `json:"defaults"`
}

type Manifests struct {
	Connectors []Connector     `json:"connectors"`
	Agents     []AgentManifest `json:"agents"`
}

const inboxConnector, inboxAction = "schedule", "schedule.record"

func (m *Manifests) connector(id string) *Connector {
	if m == nil {
		return nil
	}
	for i := range m.Connectors {
		if m.Connectors[i].ID == id {
			return &m.Connectors[i]
		}
	}
	return nil
}

func (m *Manifests) agent(id string) *AgentManifest {
	if m == nil {
		return nil
	}
	for i := range m.Agents {
		if m.Agents[i].ID == id {
			return &m.Agents[i]
		}
	}
	return nil
}

func (m *Manifests) agentName(id string) string {
	if a := m.agent(id); a != nil {
		return a.Name
	}
	return id
}

func (m *Manifests) connectorName(id string) string {
	if c := m.connector(id); c != nil {
		return c.Name
	}
	return id
}

// workflow is what a loop runs: a workflow, or a trigger alone for a custom loop.
func (m *Manifests) workflow(connectorID, workflowID string) *Workflow {
	c := m.connector(connectorID)
	if c == nil {
		return nil
	}
	for i := range c.Workflows {
		if c.Workflows[i].ID == workflowID {
			return &c.Workflows[i]
		}
	}
	for _, t := range c.Triggers {
		if t.ID == workflowID {
			w := customOn(t)
			return &w
		}
	}
	return nil
}

func customOn(t Trigger) Workflow {
	return Workflow{
		ID: t.ID, TriggerID: t.ID, Name: t.When, Summary: "When " + t.Trigger + ".", Custom: true,
		When: t.When, Trigger: t.Trigger, Watches: t.Watches, RunsIn: t.RunsIn, Settings: t.Settings,
		Answer: t.Answer, ActionID: t.ActionID, ActionConnectorID: t.ActionConnectorID,
		ActionTarget: t.ActionTarget, PollEveryMs: t.PollEveryMs,
	}
}

func (m *Manifests) action(connectorID, actionID string) *Action {
	c := m.connector(connectorID)
	if c == nil {
		return nil
	}
	for i := range c.Actions {
		if c.Actions[i].ID == actionID {
			return &c.Actions[i]
		}
	}
	return nil
}

func isInboxOnly(connectorID, actionID string) bool {
	return connectorID == inboxConnector && actionID == inboxAction
}

func (m *Manifests) writerName(connectorID string) string {
	if connectorID == inboxConnector {
		return "Inbox"
	}
	return m.connectorName(connectorID)
}

func (m *Manifests) destinationLabel(connectorID, actionID string) string {
	if isInboxOnly(connectorID, actionID) {
		return "Inbox only"
	}
	if a := m.action(connectorID, actionID); a != nil {
		return m.writerName(connectorID) + " · " + a.Name
	}
	return "No destination"
}

// writers are the connectors that can write, Inbox first.
func (m *Manifests) writers() []*Connector {
	var out []*Connector
	for i := range m.Connectors {
		if m.Connectors[i].ID == inboxConnector && len(m.Connectors[i].Actions) > 0 {
			out = append(out, &m.Connectors[i])
		}
	}
	for i := range m.Connectors {
		if m.Connectors[i].ID != inboxConnector && len(m.Connectors[i].Actions) > 0 {
			out = append(out, &m.Connectors[i])
		}
	}
	return out
}

func (m *Manifests) needsAccount(id string) bool {
	c := m.connector(id)
	return c != nil && c.Auth.Kind != "none"
}

func (m *Manifests) connectionNoun(id string) string {
	if c := m.connector(id); c != nil && c.Auth.Kind == "token" {
		return "bot"
	}
	return "account"
}

// ordered lists the connectors the clock first, as the new loop page does.
func (m *Manifests) ordered() []*Connector {
	var out []*Connector
	for i := range m.Connectors {
		if m.Connectors[i].ID == "schedule" {
			out = append(out, &m.Connectors[i])
		}
	}
	for i := range m.Connectors {
		if m.Connectors[i].ID != "schedule" {
			out = append(out, &m.Connectors[i])
		}
	}
	return out
}

// draftFor is draftForWorkflow: one of a connector's workflows as a loop
// nobody has saved yet.
func (m *Manifests) draftFor(connectorID, workflowID string) *LoopEdit {
	w := m.workflow(connectorID, workflowID)
	if w == nil {
		return nil
	}
	actionConnector := connectorID
	if w.ActionConnectorID != nil {
		actionConnector = *w.ActionConnectorID
	}
	target := w.ActionTarget
	if target == nil {
		target = map[string]any{}
	}
	return &LoopEdit{
		Name: w.Name, ConnectorID: connectorID, WorkflowID: workflowID, Prompt: w.Prompt,
		McpServers: []string{}, Settings: map[string]any{}, ActionConnectorID: actionConnector,
		ActionID: w.ActionID, ActionTarget: target, PollEveryMs: w.PollEveryMs, Enabled: true,
	}
}

func editOf(l *LoopView) *LoopEdit {
	id := l.ID
	return &LoopEdit{
		ID: &id, Name: l.Name, ConnectorID: l.ConnectorID, WorkflowID: l.WorkflowID, Prompt: l.Prompt,
		Guidance: l.Guidance, AgentID: l.AgentID, McpServers: l.McpServers, Settings: l.Settings,
		ActionConnectorID: l.ActionConnectorID, ActionID: l.ActionID, ActionTarget: l.ActionTarget,
		PollEveryMs: l.PollEveryMs, Enabled: l.Enabled,
	}
}
