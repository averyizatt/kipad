# DEVLOG.md — Kipad development log

Chronological log of iterations. Newest at the bottom.

## 2026-08-22 — Session: full KiCad-style rebuild + real KiCad libraries

### Iteration 1 — Real KiCad data pipelines (spawned 2 subagents)
- `kipad-footprintlib`: downloads ~170 real `.kicad_mod` files from the KiCad GitHub mirror, converts via a new `js/kicad_mod.js` (KipadKicadMod.parseKicadMod), writes `lib/footprints.json`. Includes `test/test_kicad_mod.js`.
- `kipad-symbollib`: clones GitLab kicad-symbols, converts via `js/kicad_sym.js` (KipadKicadSym.parseKicadSym), writes `lib/symbols.json` + `js/symbols.js` registry + tests.
- Verified: sexpr parser handles real `.kicad_mod` (module atoms unquoted) and `.kicad_sym` (quoted strings) correctly.

### Iteration 2 — KiCad 8-style UI (done locally, in progress)
- `index.html`: KiCad layout — menubar (File/Edit/View/Place/Route/Inspect/Help), toolbar (new/open/save/undo/redo/zoom/grid/rats/gerber/drc/import), left tool rail (select/highlight/footprint/track/via/line/rect/circle/arc/measure), right panel with 5 tabs (Layers/Library/Symbols/Nets/Properties), bottom status bar.
- `style.css`: KiCad 8 dark theme (#1e1e1e canvas, #2b2b2b panels, blue accent), touch-first.
- `render.js`: KiCad colors (F.Cu red, B.Cu blue, Edge.Cuts yellow, silk/fab/courtyard), dot grid, crosshair, layer visibility + active-layer dimming, measure overlay.
- `app.js`: all 10 tools, layer panel with visibility toggles + active layer, library panel (search/place/import .kicad_mod), symbols panel (search/preview/import .kicad_sym), nets panel (highlight/add), properties panel (edit ref/value/pos/rot/layer, track width, via size), menus, keyboard shortcuts.
- `footprints.js`: added `addFootprint`, `loadLibrary`, `searchFootprints` + normalization; builtins kept as fallback.
- `kicad_pcb.js`: added KiCad 10 named-net support (no (nets) block, (net "NAME"), *.Cu wildcard layers) — verified against real 643KB KiCad 10 demo board (63 footprints, 370 tracks, 6 vias, 112 nets).
- `gerber.js`: fixed format header %FSLAX44Y44*% (coordinates are 1e-4 mm integers) for real-parser interop.
- Tests: 7 suites green (sexpr/kicadpcb, gerber, footprints, kicad_sym, kicad_mod, kicad10, integration).
- Pending: push to GitHub, verify Pages, continue with next TODO items.
