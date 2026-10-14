package main

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"runtime"

	"github.com/egoist/mygo/ui"
)

// Line icons in the style of Lucide, drawn with the text color.
func icon(paths string) *ui.SVG {
	return ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` + paths + `</svg>`))
}

var (
	iconInbox      = icon(`<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>`)
	iconLoops      = icon(`<path d="M17 2.1l4 4-4 4"/><path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8"/><path d="M7 21.9l-4-4 4-4"/><path d="M21 11.8v2a4 4 0 0 1-4 4H4.2"/>`)
	iconConnectors = icon(`<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>`)
	iconAgents     = icon(`<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>`)
	iconSettings   = icon(`<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`)
	iconPlay       = icon(`<polygon points="6 3 20 12 6 21 6 3"/>`)
	iconMore       = icon(`<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>`)
	iconCheck      = icon(`<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`)
	iconX          = icon(`<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>`)
	iconMinus      = icon(`<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>`)
	iconClock      = icon(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`)
	iconFile       = icon(`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>`)
	iconBot        = iconAgents
	iconAlert      = icon(`<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>`)
	iconPencil     = icon(`<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>`)
	iconRefresh    = icon(`<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>`)
	iconStop       = icon(`<circle cx="12" cy="12" r="10"/><rect width="6" height="6" x="9" y="9"/>`)
	iconOpen       = icon(`<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`)
	iconPlus       = icon(`<path d="M5 12h14"/><path d="M12 5v14"/>`)
	iconChevron    = icon(`<path d="m9 18 6-6-6-6"/>`)
)

// A connector shows as a tile with a letter or two in its color, since the
// web app's icons are a font the window has not got.
type tile struct {
	text string
	hue  ui.Color
}

var tiles = map[string]tile{
	"github":   {"GH", ui.Hex("#24292f")},
	"slack":    {"Sl", ui.Hex("#4a154b")},
	"feishu":   {"Fs", ui.Hex("#3370ff")},
	"gmail":    {"Gm", ui.Hex("#c5221f")},
	"wechat":   {"Wx", ui.Hex("#07c160")},
	"schedule": {"Sc", ui.Hex("#334155")},
	"codex":    {"Cx", ui.Hex("#0f172a")},
	"claude":   {"Cl", ui.Hex("#d97757")},
}

func tileFor(id string) tile {
	if t, ok := tiles[id]; ok {
		return t
	}
	label := id
	if len(label) > 2 {
		label = label[:2]
	}
	return tile{label, ui.Hex("#64748b")}
}

// connectorTile draws the tile, size DIPs square.
func connectorTile(c *ui.Context, id string, size float32, dim bool) ui.Element {
	t := tileFor(id)
	box := ui.Box(c).Size(size, size).Radius(size / 4).Background(t.hue).Center().Shrink(0)
	if dim {
		box.Opacity(0.5)
	}
	box.Children(func() {
		ui.Text(c, t.text).FontSize(size * 0.4).Bold().TextColor(ui.Hex("#ffffff"))
	})
	return box
}

// trayIcon draws a loop: black on transparent, which macOS tints.
func trayIcon() []byte {
	img := image.NewNRGBA(image.Rect(0, 0, 44, 44))
	ink := color.NRGBA{R: 79, G: 124, B: 255, A: 255}
	if runtime.GOOS == "darwin" {
		ink = color.NRGBA{A: 255}
	}
	// A ring with a gap, and an arrow head: a loop.
	for y := 0; y < 44; y++ {
		for x := 0; x < 44; x++ {
			dx, dy := float64(x)-22, float64(y)-22
			d := dx*dx + dy*dy
			if d > 11*11 && d < 17*17 && !(dx > 0 && dy < 0 && dy > -8) {
				img.Set(x, y, ink)
			}
		}
	}
	draw.Draw(img, image.Rect(28, 6, 40, 10), image.NewUniform(ink), image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(36, 6, 40, 18), image.NewUniform(ink), image.Point{}, draw.Src)
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}
