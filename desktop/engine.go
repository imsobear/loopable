package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// Engine is the Node process that does everything: the dispatcher, the
// runner and the JSON API the screens call. The app starts it, keeps it
// running, and stops it on quit.
type Engine struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	port     int
	token    string
	state    string // starting, running, stopped, failed
	detail   string // why, when failed
	node     nodeInfo
	lines    []string
	stopping bool
	restarts int
	onChange func()
	client   *http.Client
}

// OAuthApps are Loopable's own GitHub and Google apps, built into the app
// by scripts/build-engine.mjs as oauth-apps.json beside the engine. Client
// IDs only, and Google's desktop "secret": the app is a public client.
// oauth.json in the app's data folder can stand in for them while
// developing; nobody using the app sees either.
type OAuthApps struct {
	GitHub struct {
		ClientID string `json:"clientId"`
	} `json:"github"`
	Gmail struct {
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	} `json:"gmail"`
}

func newEngine(onChange func()) *Engine {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return &Engine{
		token:    hex.EncodeToString(b),
		state:    "starting",
		onChange: onChange,
		client:   &http.Client{Timeout: 10 * time.Minute},
	}
}

func userDataDir() string {
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil || dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, "Library", "Application Support", "Loopable")
	}
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func oauthFile() string { return filepath.Join(userDataDir(), "oauth.json") }

func readOAuthApps() OAuthApps {
	var built, local OAuthApps
	if data, err := os.ReadFile(filepath.Join(engineDir(), "oauth-apps.json")); err == nil {
		_ = json.Unmarshal(data, &built)
	}
	if data, err := os.ReadFile(oauthFile()); err == nil {
		_ = json.Unmarshal(data, &local)
	}
	if local.GitHub.ClientID != "" {
		built.GitHub = local.GitHub
	}
	if local.Gmail.ClientID != "" {
		built.Gmail = local.Gmail
	}
	return built
}

// engineDir is where engine.mjs lives: beside the app's resources, or
// wherever LOOPABLE_ENGINE_DIR points while developing.
func engineDir() string {
	if dir := os.Getenv("LOOPABLE_ENGINE_DIR"); dir != "" {
		return dir
	}
	if dir, err := mygo.App.Path(mygo.PathResources); err == nil {
		return filepath.Join(dir, "engine")
	}
	return "resources/engine"
}

func (e *Engine) snapshot() (state, detail string, port int, node nodeInfo, lines []string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.state, e.detail, e.port, e.node, append([]string(nil), e.lines...)
}

func (e *Engine) set(state, detail string) {
	if debug {
		fmt.Fprintln(os.Stderr, "engine state:", state, detail)
	}
	e.mu.Lock()
	e.state, e.detail = state, detail
	e.mu.Unlock()
	if e.onChange != nil {
		e.onChange()
	}
}

func (e *Engine) log(line string) {
	if debug {
		fmt.Fprintln(os.Stderr, "engine:", line)
	}
	e.mu.Lock()
	e.lines = append(e.lines, line)
	if len(e.lines) > 300 {
		e.lines = e.lines[len(e.lines)-300:]
	}
	e.mu.Unlock()
}

// Start runs the engine, and runs it again when it dies, until Stop.
func (e *Engine) Start() {
	go func() {
		for {
			e.mu.Lock()
			stopping := e.stopping
			e.mu.Unlock()
			if stopping {
				return
			}
			err := e.runOnce()
			e.mu.Lock()
			stopping = e.stopping
			e.mu.Unlock()
			if stopping {
				e.set("stopped", "")
				return
			}
			if err != nil {
				var fatal fatalError
				if errors.As(err, &fatal) {
					e.set("failed", err.Error())
					return
				}
				e.log("engine: " + err.Error())
			}
			e.restarts++
			wait := time.Duration(min(e.restarts, 5)) * 2 * time.Second
			e.set("starting", fmt.Sprintf("Starting again in %s…", wait))
			time.Sleep(wait)
		}
	}()
}

type fatalError struct{ error }

func (e *Engine) runOnce() error {
	dir := engineDir()
	script := filepath.Join(dir, "engine.mjs")
	if _, err := os.Stat(script); err != nil {
		return fatalError{fmt.Errorf("The engine is missing at %s.", script)}
	}
	path := enginePath()
	node, err := findNode(path)
	if err != nil {
		return fatalError{err}
	}
	e.mu.Lock()
	e.node = node
	e.mu.Unlock()

	apps := readOAuthApps()
	env := []string{
		"PATH=" + path,
		"HOME=" + os.Getenv("HOME"),
		"USER=" + os.Getenv("USER"),
		"SHELL=" + os.Getenv("SHELL"),
		"LANG=" + os.Getenv("LANG"),
		"TMPDIR=" + os.Getenv("TMPDIR"),
		"LOOPABLE_DESKTOP=1",
		"LOOPABLE_DESKTOP_TOKEN=" + e.token,
		"LOOPABLE_HOME=" + filepath.Join(userDataDir(), "data"),
		"LOOPABLE_SECRET_PREFIX=loopable-desktop",
		"LOOPABLE_GITHUB_CLIENT_ID=" + apps.GitHub.ClientID,
		"LOOPABLE_GMAIL_CLIENT_ID=" + apps.Gmail.ClientID,
		"LOOPABLE_GMAIL_CLIENT_SECRET=" + apps.Gmail.ClientSecret,
	}
	cmd := exec.Command(node.Path, script)
	cmd.Dir = dir
	cmd.Env = env
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fatalError{fmt.Errorf("Node could not start: %v", err)}
	}
	e.mu.Lock()
	e.cmd, e.stdin, e.port = cmd, stdin, 0
	e.mu.Unlock()
	e.set("starting", "Starting the engine…")

	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
		for scanner.Scan() {
			e.log(scanner.Text())
		}
	}()
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		var event struct {
			Event string `json:"event"`
			Port  int    `json:"port"`
			Owner string `json:"owner"`
		}
		if json.Unmarshal(scanner.Bytes(), &event) != nil {
			continue
		}
		switch event.Event {
		case "listening":
			e.mu.Lock()
			e.port = event.Port
			e.restarts = 0
			e.mu.Unlock()
			e.set("running", "")
		case "busy":
			e.log("another Loopable is using this data folder: " + event.Owner)
		}
	}
	err = cmd.Wait()
	e.mu.Lock()
	e.cmd, e.stdin, e.port = nil, nil, 0
	e.mu.Unlock()
	if err != nil {
		return fmt.Errorf("the engine stopped: %v", err)
	}
	return errors.New("the engine stopped")
}

// Stop ends the engine, for quitting; Restart ends it and lets Start's
// loop bring it back.
func (e *Engine) Stop() {
	e.mu.Lock()
	e.stopping = true
	cmd, stdin := e.cmd, e.stdin
	e.mu.Unlock()
	e.kill(cmd, stdin)
}

func (e *Engine) Restart() {
	e.mu.Lock()
	cmd, stdin := e.cmd, e.stdin
	e.restarts = 0
	e.mu.Unlock()
	e.set("starting", "Restarting…")
	e.kill(cmd, stdin)
}

func (e *Engine) kill(cmd *exec.Cmd, stdin io.WriteCloser) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	if stdin != nil {
		_ = stdin.Close()
	}
	_ = cmd.Process.Signal(os.Interrupt)
	done := make(chan struct{})
	go func() {
		_, _ = cmd.Process.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(8 * time.Second):
		_ = cmd.Process.Kill()
	}
}

// debug echoes the engine to this process's stderr, for a terminal run.
var debug = os.Getenv("LOOPABLE_DEBUG") == "1"

var errNotRunning = errors.New("The engine is not running yet.")

// Call asks the engine for one thing, by the name it is known by in
// src/desktop/api.ts, and reads the answer into out.
func (e *Engine) Call(name string, in any, out any) error {
	return e.CallContext(context.Background(), name, in, out)
}

func (e *Engine) CallContext(ctx context.Context, name string, in any, out any) error {
	e.mu.Lock()
	port, token := e.port, e.token
	e.mu.Unlock()
	if port == 0 {
		return errNotRunning
	}
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	if in == nil {
		body = []byte("null")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/rpc/%s", port, name), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := e.client.Do(req)
	if err != nil {
		return errors.New("The engine did not answer: " + err.Error())
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode != http.StatusOK {
		var failure struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(data, &failure) == nil && failure.Error != "" {
			return errors.New(failure.Error)
		}
		return fmt.Errorf("%s: %s", name, strings.TrimSpace(string(data)))
	}
	if out == nil || string(data) == "null" {
		return nil
	}
	return json.Unmarshal(data, out)
}
