// Loopable for the desktop: the loops, the inbox, the connectors and the
// agents in a native window, with the engine (dispatcher, runner and API)
// running beside it in Node. See ../docs/desktop.md.
package main

import (
	"log"

	"github.com/egoist/mygo"
)

func main() {
	mygo.App.SetName("Loopable")
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	a := newApp()
	mygo.App.OnSecondInstance(func([]string, string) { a.show() })
	mygo.App.WhenReady(a.ready)
	// The window closing leaves the app in the menu bar; the Dock icon
	// brings the window back.
	mygo.App.OnWindowAllClosed(func() {})
	mygo.App.OnActivate(func(hasVisibleWindows bool) {
		if !hasVisibleWindows {
			a.show()
		}
	})
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { a.quitting = true })
	mygo.App.OnWillQuit(func(*mygo.QuitEvent) {
		a.engine.Stop()
		if a.tray != nil {
			a.tray.Destroy()
		}
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
