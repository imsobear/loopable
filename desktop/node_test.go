package main

import (
	"testing"
	"time"
)

// The app should find Node in well under a second, however many folders a
// version manager has left behind.
func TestFindNodeIsQuick(t *testing.T) {
	start := time.Now()
	path := enginePath()
	node, err := findNode(path)
	took := time.Since(start)
	if err != nil {
		t.Skip(err)
	}
	t.Logf("found %s (%s) in %s", node.Path, node.Version, took)
	if took > 3*time.Second {
		t.Fatalf("finding Node took %s", took)
	}
}
