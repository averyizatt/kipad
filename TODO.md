# TODO.md — Kipad (KiCad-like PCB editor for iPad, PWA)

Project state file. Update after every iteration. Completed items are checked off with a date.

## Milestones

- [x] ERC (Electrical Rules Check) for the schematic editor — 2026-08-23
  - [x] Model: `js/erc.js` (KipadErc) — 7 checks: UNCONNECTED_PIN, SINGLE_PIN_NET, DUPLICATE_REF, MISSING_REF, MISSING_VALUE, LABEL_CONFLICT, DANGLING_WIRE; power-pin (GND/VCC) + no_connect exemptions; topology shared with netlist via `KipadSchematic.connectivity()` — 2026-08-23
  - [x] UI: Inspect → Electrical Rules Check… + toolbar ERC button, floating panel grouped by severity with counts, tap row to locate (centre + select symbol), status-bar "ERC: N errors, M warnings" indicator in schematic mode — 2026-08-23
  - [x] test/test_erc.js (clean case + every check + exemptions + counts) — 2026-08-23
  - [x] PCM "erc" plugin entry removed (feature is built in) — 2026-08-23

- [x] Project structure (PWA: index.html, style.css, js/*, manifest, service worker) — 2026-08-22
- [x] Zoomable/panable PCB canvas (pinch zoom, drag pan, wheel) — 2026-08-22
- [x] Board data model (nets, footprints, pads, tracks, vias, outline) — 2026-08-22
- [x] Board outline rendering (Edge.Cuts) + drawing tools (line/rect/circle/arc) — 2026-08-22
- [x] Footprint rendering (courtyard, fab, silk, pads, ref text) — 2026-08-22
- [x] Footprint placement, selection, dragging, rotation — 2026-08-22
- [x] Basic .kicad_pcb parsing + serialization (sexpr + kicad_pcb modules) — 2026-08-22
- [x] Copper trace rendering + interactive routing (net-aware, grid snap) — 2026-08-22
- [x] Vias + layer switching mid-route — 2026-08-22
- [x] Undo / redo — 2026-08-22
- [x] Save modified boards (.kicad_pcb) + validation that saved files reopen — 2026-08-22
- [x] Gerber export (F.Cu, B.Cu, Edge.Cuts) — 2026-08-22
- [x] Clearance DRC — 2026-08-22
- [x] Real KiCad footprint library (lib/footprints.json, ~170 parts) — 2026-08-22
- [x] Real KiCad symbol library (lib/symbols.json) + browser/preview — 2026-08-22
- [x] KiCad-style UI: menubar, toolbar, left tool rail, right panel tabs, status bar — 2026-08-22
- [x] Import .kicad_mod / .kicad_sym files at runtime — 2026-08-22
- [x] KiCad 10 .kicad_pcb support (named nets, wildcard layers) — 2026-08-22
- [x] Drill/position file export (.drl, Excellon) — 2026-08-22
- [x] Net class / clearance settings UI (Nets panel → Net Classes…, per-class DRC) — 2026-08-23
- [x] Copper zones / pours (KiCad zone fills) — 2026-08-23
  - [x] Model: `board.zones[]` `{id, net (name), layer 'F.Cu'|'B.Cu', outline [{x,y}] closed ring, clearance? override, minArea?}` + `B.addZone/removeZone/zonesOn`; persists via the existing localStorage JSON save; kicad_pcb.js sexpr serialization untouched — 2026-08-23
  - [x] Engine: `js/zones.js` (KipadZones, UMD, pure) — raster flood fill at configurable resolution (default 0.25 mm): cells inside outline, blocked within class clearance of opposite-net copper (pads/track segments/vias/other zones), flooded from cells touching same-net copper → disconnected islands stay unfilled (KiCad behaviour); returns run-length geometry for render + area
  - [x] Render: fills under tracks/pads at layer color alpha 0.6 + subtle outline, inactive-layer zones skipped, dashed draft preview while placing, KiCad-green highlight when selected — 2026-08-23
  - [x] UI: left-rail zone tool (`tool-zone`, real KiCad add_zone_24.png icon), polygon placement (tap points, tap near first-point ring / double-tap / Enter to close, Esc cancels, Z shortcut), net assignment same flow as routing (pad under start point → highlighted net); zone selection + Del/Properties delete, clearance override + Refill button in Properties, status-bar "Zones: N", debounced auto-refill after any copper edit (undo/redo/open/update included), Place menu + help/shortcuts text updated — 2026-08-23
  - [x] test/test_zones.js (point-in-polygon, track↔pad connectivity, island unfilled, clearance bands incl. override + vias + foreign zones, layer coexistence, removeZone, JSON round-trip, refill determinism, board-level end-to-end) — 2026-08-23
- [x] Silkscreen text editing on board — 2026-08-23
  - [x] Place editable F.SilkS/B.SilkS text with T shortcut / KiCad text tool; live preview, selection, drag, rotate and delete — 2026-08-23
  - [x] Properties editing for content, layer, height, thickness, rotation and alignment — 2026-08-23
  - [x] KiCad `gr_text` parse/serialize round-trip + test/test_text.js — 2026-08-23
- [ ] More DRC checks (track-to-pad hole, outline-to-copper, silkscreen overlap)
- [ ] More ERC checks: no-connect flag placement tool, cross-sheet global label conflicts, power-pin conflicts, missing footprint
- [ ] ERC violation markers drawn on the schematic canvas (KiCad-style arrows)
- [ ] .kicad_pcb round-trip fidelity check against real KiCad files
- [ ] Keyboard: more KiCad shortcuts parity
- [ ] iPad polish: haptics, Apple Pencil tilt/eraser, two-finger tap undo

## Recurring rules (from Avery)

- Diagnose before changing; verify after; least invasive fixes.
- Everything sandboxed in ~/.openclaw/sandbox/kipad; push via ClawLink (no local gh).
- Keep PWA offline-first (sw.js cache list must include new assets).
- "As close to KiCad as you can get in terms of look and functionality."

## Visual overhaul (2026-08-23)

- [x] Real KiCad icons (50 PNGs from KiCad source) in editor + launcher — 2026-08-23
- [x] KiCad light chrome theme (window/panels) + dark PCB canvas — 2026-08-23
- [x] Launcher rebuilt as KiCad Project Manager (menubar, toolbar, file tree, app cards) — 2026-08-23
- [x] Fix: launcher must stay as landing screen (was auto-hiding) — 2026-08-23
- [x] Real KiCad default layer colors in renderer (from builtin_color_themes.h) — 2026-08-23
- [x] Schematic light-paper theme (green wires, red pins, teal refs) — 2026-08-23
- [ ] Schematic canvas grid/labels to match KiCad precisely (labels are currently black, KiCad uses dark red global labels)
- [ ] Gerber viewer launcher card (placeholder now)
- [ ] PCB Calculator launcher card (placeholder now)

## Session 2026-08-23 (evening) — library load fix + net classes
- [x] Fix fetchJSON `.gz` detection with `?v=N` cache-busted URLs — `url.split('?')[0].endsWith('.gz')` — pushed 15cad007, live-verified in real Chromium: 600 symbols / 159 footprints / zero errors (was silently falling back to stale plain JSON: 400/13)
- [x] index.html local copy synced to live (Symbols (600) / Footprints (159) labels)
- [ ] Net classes & clearance UI (PCB side) — DELEGATED to subagent
  - [x] Board model: `board.netClasses` (id/name/trackWidth/clearance/viaSize/viaDrill, Default = id 0) + `B.ensureNetClasses/addNetClass/getNetClass/netClassOfNet/setNetClass/renameNetClass/removeNetClass` — 2026-08-23
  - [x] DRC uses per-net-class clearance (max of the two classes), class names in violations — 2026-08-23
  - [x] Nets panel: class column + "Net Classes…" modal editor (KiCad Edit Net Classes dialog: editable fields, add/remove class, net chips + Add net dropdown, touch-friendly) — 2026-08-23
  - [x] Routing: new track width defaults to net's class width (W cycles from it), vias use class via size/drill — 2026-08-23
  - [x] test/test_netclasses.js (11 checks) — 2026-08-23
