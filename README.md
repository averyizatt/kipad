# Kipad — KiCad-style PCB Layout Editor for iPad

A KiCad-like PCB layout editor that runs in the browser as an installable PWA. Designed for iPad (Safari → Share → **Add to Home Screen**), touch-first, works offline.

**Live: https://averyizatt.github.io/kipad/**

## Features

- **Real KiCad libraries** — ~160 footprints (`lib/footprints.json`) and 2,000 symbols (`lib/symbols.json`) converted from the official KiCad repositories (kicad-footprints, kicad-symbols)
- **Import your own parts** — open `.kicad_mod` and `.kicad_sym` files directly in the app
- **2-layer boards** (F.Cu / B.Cu) with Edge.Cuts board outline
- **KiCad-style UI**: menu bar, toolbar, left tool rail, right panel (Layers / Library / Symbols / Nets / Properties), bottom status bar, dark KiCad 8 theme
- **Tools**: select/move, net highlight, place footprint, route track, via, draw line / rectangle / circle / arc (outline), measure
- **Interactive routing** — net-aware (start on a pad → routes that net), grid snap, vias + layer switch mid-route (V)
- **Net highlighting**, ratsnest preview
- **Clearance DRC** (0.2 mm default)
- **Open + save `.kicad_pcb`** (KiCad 6/7/8 S-expressions, KiCad 10 named-net format supported on open)
- **Gerber export** (RS-274X for F.Cu, B.Cu, Edge.Cuts)
- **Undo / redo**, autosave (localStorage)

## Architecture

```
index.html            KiCad-style shell (menubar, toolbar, rail, panels, status bar)
style.css             KiCad 8 dark theme
js/sexpr.js           KiCad s-expression parser/serializer (KipadSexpr)
js/kicad_pcb.js       .kicad_pcb parse/serialize (KipadPcb)
js/kicad_mod.js       .kicad_mod import (KipadKicadMod)
js/kicad_sym.js       .kicad_sym import (KipadKicadSym)
js/footprints.js      footprint library + loader (KipadFootprints)
js/symbols.js         symbol library registry (KipadSymbols)
js/board.js           board model, nets, geometry, DRC (KipadBoard)
js/render.js          KiCad-style canvas renderer (KipadRender)
js/gerber.js          Gerber RS-274X exporter (KipadGerber)
js/app.js             editor UI, tools, gestures
lib/footprints.json   real KiCad footprints (generated)
lib/symbols.json      real KiCad symbols (generated)
test/                 Node test suite (all green)
```

All modules are UMD — they work as browser globals and as CommonJS modules in Node.

## Development

```bash
cd ~/.openclaw/sandbox/kipad
node test/test_sexpr_kicadpcb.js   # file format round-trip
node test/test_gerber.js           # Gerber exporter
node test/test_footprints.js       # builtin library
node test/test_kicad_sym.js        # symbol converter + library
node test/test_kicad_mod.js        # footprint converter + library
node test/test_kicad10.js          # KiCad 10 named-net format
node test/test_integration.js      # full-module smoke test
# regenerate libraries:
node lib-build/build-symbols.js
node lib-build/build-footprints.js
```

## Roadmap

Net classes / clearance settings, copper zones, silkscreen text, more DRC checks, drill files, deeper KiCad shortcut parity.

MIT
