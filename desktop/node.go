package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// A GUI app on macOS starts with almost no PATH, while Node and the agent
// CLIs live wherever a shell put them. The login shell knows; it is asked
// once, and the usual places are tried without it.

const minNode = 22

func homeDirs() []string {
	home, _ := os.UserHomeDir()
	dirs := []string{
		"/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
		filepath.Join(home, ".local/bin"), filepath.Join(home, ".bun/bin"),
		filepath.Join(home, ".cargo/bin"), filepath.Join(home, ".volta/bin"),
		filepath.Join(home, ".deno/bin"), filepath.Join(home, "n/bin"),
	}
	// Version managers keep every Node apart; the newest of each is enough.
	for _, pattern := range []string{
		filepath.Join(home, ".nvm/versions/node/*/bin"),
		filepath.Join(home, ".local/share/fnm/node-versions/*/installation/bin"),
		filepath.Join(home, "Library/Application Support/fnm/node-versions/*/installation/bin"),
		filepath.Join(home, ".local/state/fnm_multishells/*/bin"),
		filepath.Join(home, ".asdf/installs/nodejs/*/bin"),
		"/opt/homebrew/opt/node@*/bin",
	} {
		matches, _ := filepath.Glob(pattern)
		sort.Sort(sort.Reverse(sort.StringSlice(matches)))
		dirs = append(dirs, matches...)
	}
	return dirs
}

// loginPath asks the login shell for its PATH, with a short patience.
func loginPath() string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, shell, "-lc", `printf %s "$PATH"`).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// enginePath is the PATH the engine runs with: the login shell's, then the
// usual places, then whatever this process had.
func enginePath() string {
	seen := map[string]bool{}
	var dirs []string
	add := func(list []string) {
		for _, d := range list {
			if d == "" || seen[d] {
				continue
			}
			seen[d] = true
			dirs = append(dirs, d)
		}
	}
	add(strings.Split(loginPath(), ":"))
	add(homeDirs())
	add(strings.Split(os.Getenv("PATH"), ":"))
	return strings.Join(dirs, ":")
}

type nodeInfo struct {
	Path    string
	Version string
	Major   int
}

// findNode looks along path for a Node new enough for the engine.
func findNode(path string) (nodeInfo, error) {
	var best nodeInfo
	var firstErr error
	for _, dir := range strings.Split(path, ":") {
		candidate := filepath.Join(dir, "node")
		if _, err := os.Stat(candidate); err != nil {
			continue
		}
		version, err := nodeVersion(candidate)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		major := majorOf(version)
		if major >= minNode && major > best.Major {
			best = nodeInfo{Path: candidate, Version: version, Major: major}
		}
	}
	if best.Path != "" {
		return best, nil
	}
	if firstErr != nil {
		return best, firstErr
	}
	return best, errNoNode
}

type nodeError string

func (e nodeError) Error() string { return string(e) }

const errNoNode = nodeError("Node.js 22 or newer was not found. Install it from nodejs.org or with Homebrew, then restart Loopable.")

func nodeVersion(bin string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, "--version").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func majorOf(version string) int {
	v := strings.TrimPrefix(version, "v")
	if i := strings.Index(v, "."); i > 0 {
		v = v[:i]
	}
	n, _ := strconv.Atoi(v)
	return n
}
