# Kipad 🐸🔧

KiCad-like PCB layout editor that runs in the browser — built for iPad (and anything with a screen).

Place footprints, draw the board outline, route traces, drop vias, run a clearance DRC, and export Gerbers — all touch-first, offline-capable, installable to your home screen like a native app.

**Live:** https://averyizatt.github.io/kipad/

## Features (v0.1)

- **PCB editing** — 2-layer boards (F.Cu / B.Cu)
- **Footprints** — built-in KiCad-style library (0603/0805/1206 passives, LED, SOT-23, SOIC-8, DIP-8, pin headers); place, move, rotate
- **Board outline** — draw Edge.Cuts polygons
- **Routing** — interactive trace routing with grid snap, net-aware (start on a pad, it routes that net), vias + layer switch mid-route (V)
- **Net highlighting** — tap a pad to highlight its net; nets panel
- **DRC** — basic copper clearance checks (0.2mm default)
- **Files** — open and save `.kicad_pcb` (KiCad 6/7/8 style S-expressions)
- **Gerber export** — RS-274X for F.Cu, B.Cu, Edge.Cuts
- **PWA** — offline via service worker, installable, dark theme, Apple Pencil friendly

## Install on iPad

1. Open https://averyizatt.github.io/kipad/ in Safari
2. Share → **Add to Home Screen**
3. Launch fullscreen, works offline

## Controls

| Tool | Action |
|------|--------|
| ⭣ Select | tap pad/footprint to select (tap pad = highlight net), drag to move |
| ▣ Footprint | pick from left list, tap board to place, R rotates |
| ╱ Route | tap pad to start on its net, tap corners, double-tap/Enter finishes, V = via + layer |
| ◎ Via | tap to place via (on highlighted net) |
| ▢ Outline | tap corners, double-tap/Enter closes (Edge.Cuts) |

Keyboard: `S` select · `F` footprint · `X` route · `V` via · `B` outline · `L` layer · `R` rotate · `W` track width · `Del` delete · `Ctrl+Z/Y` undo/redo

## Architecture

```
index.html / style.css     app shell + KiCad-dark theme
js/sexpr.js                S-expression parser/serializer (KiCad format)
js/kicad_pcb.js            .kicad_pcb parse/serialize → Board model
js/footprints.js           built-in footprint library
js/gerber.js               RS-274X exporter (F.Cu, B.Cu, Edge.Cuts)
js/board.js                board model, nets, geometry, DRC engine
js/render.js               canvas renderer
js/app.js                  editor: tools, gestures, routing, save/open/export
manifest + sw.js            PWA / offline
test/                      node tests (sexpr, kicad_pcb, gerber, footprints)
```

## Roadmap

- Footprint editor + custom footprint import (.kicad_mod)
- Copper pours / zones, filled zones in Gerber
- Silkscreen layer editing
- More DRC rules (annular ring, hole-to-copper, net class clearances)
- Ratsnest after routing (auto-connect remaining pins)
- Multi-layer (4+) and board stackup

MIT License
