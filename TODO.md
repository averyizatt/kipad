# TODO.md — Kipad (KiCad-like PCB editor for iPad, PWA)

Project state file. Update after every iteration. Completed items are checked off with a date.

## Milestones

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
- [x] Schematic editor (Eeschema): symbols, wires, labels, junctions, netlist, .kicad_sch save/open — 2026-08-22
- [x] Update PCB from Schematic (symbol→footprint, netlist→nets) — 2026-08-22
- [x] Launcher / project manager + mode switching (Schematic ↔ PCB) — 2026-08-22
- [x] Plugin and Content Manager (built-in modules + custom .js install hook) — 2026-08-22
- [ ] Net class / clearance settings UI (currently fixed 0.2mm)
- [ ] Copper zones / pours (KiCad zone fills)
- [ ] Silkscreen text editing on board
- [ ] More DRC checks (track-to-pad hole, outline-to-copper, silkscreen overlap)
- [ ] .kicad_pcb round-trip fidelity check against real KiCad files
- [ ] Keyboard: more KiCad shortcuts parity
- [ ] iPad polish: haptics, Apple Pencil tilt/eraser, two-finger tap undo

## Recurring rules (from Avery)

- Diagnose before changing; verify after; least invasive fixes.
- Everything sandboxed in ~/.openclaw/sandbox/kipad; push via ClawLink (no local gh).
- Keep PWA offline-first (sw.js cache list must include new assets).
- "As close to KiCad as you can get in terms of look and functionality."
