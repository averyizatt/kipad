# TODO.md — Kipad (KiCad-like PCB editor for iPad, PWA)

Project state file. Update after every iteration. Completed items are checked off with a date.

## Milestones

- [x] Collapsible side panel (schematic + PCB editors) — 2026-08-24
  - [x] Edge handle hides the right panel, floating ‹ restore tab brings it back; state remembered per mode via localStorage (`kipad.panel.hidden.<mode>`) — 2026-08-24
  - [x] View → Show/Hide Side Panel toggle in both editors' menus — 2026-08-24
- [x] Library separation: dedicated Symbol Editor + Footprint Editor — 2026-08-24
  - [x] Serializers: `serializeKicadSym` (js/kicad_sym.js) + `serializeKicadMod` (js/kicad_mod.js) — model → KiCad sexpr text, round-trippable through the existing parsers — 2026-08-24
  - [x] `js/editors.js`: full-screen overlay editor shared by both kinds — filterable item list, interactive canvas (mm grid, pan / pinch / wheel zoom, tap-select pin/pad, drag-move snapped 1.27 mm for pins / 0.5 mm for pads), property tables: pins (number/name/X/Y/dir/length/electrical type) and pads (number/X/Y/W/H/drill/type smd-tht-npth/shape) with layer presets + drill↔type coupling, Auto-courtyard (pads+silk bounds + 0.25 mm), New / Import / Export — 2026-08-24
  - [x] Custom library persistence: Save upserts the live registry AND localStorage (`kipad.lib.custom.symbols.v1` / `.footprints.v1`, replace-by-name, rename-safe); customs merged over built-ins at boot (`leMergeCustomLibs` in loadLibraries) so edited parts shadow their stock versions everywhere — 2026-08-24
  - [x] Launch points: project-manager tiles (Symbols / Footprints), launcher Tools menu, schematic Tools → Open Symbol Editor…, PCB Tools → Open Footprint Editor… — 2026-08-24
  - [x] Distinction polish: PCB side tab renamed "Library" → "Footprints"; PCB/schematic help text updated — 2026-08-24
  - [x] test/test_editors.js (10 checks: symbol props/pins/graphics round trip, second-cycle stability, empty symbol, footprint header/pads/silk/courtyard round trip, oval+npth mappings) · cache-bust v39→v40 / sw kipad-v34 — 2026-08-24
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
- [x] Gerber export — full fabrication layer set (9 layers) — 2026-08-22, extended 2026-08-24
  - [x] Copper + Edge.Cuts RS-274X (F.Cu, B.Cu, outline polylines) — 2026-08-22
  - [x] F/B.Mask (pads only, vias tented, 0.05 mm expansion, side from copper membership so bare [F.Cu]-style lists work), F/B.Paste (SMD only, copper-size apertures), F/B.SilkS (footprint art as fixed 0.12 mm strokes: lines / rects / 32-chord circles; art mapped to the part's actual side since the flip tool relayers pads but not stored art labels; `getFootprint` resolver param like erc.js; text items skipped until vector stroking exists) — 2026-08-24
  - [x] Wiring follow-up: `doGerber` + Gerber viewer pass `FPs.getFootprint` into `exportAll` (library silk art in exports and preview), status/help strings updated to the nine-layer set, viewer palette extended 6 → 9 colours; cache-bust ?v=41 / sw kipad-v35 — 2026-08-24
- [x] Clearance DRC — 2026-08-22
- [x] Real KiCad footprint library (lib/footprints.json, ~170 parts) — 2026-08-22
- [x] Real KiCad symbol library (lib/symbols.json) + browser/preview — 2026-08-22
- [x] KiCad-style UI: menubar, toolbar, left tool rail, right panel tabs, status bar — 2026-08-22
- [x] Import .kicad_mod / .kicad_sym files at runtime — 2026-08-22
- [x] KiCad 10 .kicad_pcb support (named nets, wildcard layers) — 2026-08-22
- [x] Drill/position file export (.drl, Excellon) — 2026-08-22
- [x] BOM export (KiCad Tools → Generate BOM) — 2026-08-24
  - [x] `js/bom.js` (KipadBom, UMD pure): non-power symbols grouped by Value + Footprint with refs + qty; power symbols excluded via `KipadSchematic.isPower` (same rule as ERC/netlist), `#`-prefixed annotation refs excluded too; natural sort (R2 < R10, groups ordered by first ref); RFC-4180 CSV quoting only where needed — 2026-08-24
  - [x] UI: Schematic File menu → Export BOM (.csv) downloads kipad-bom.csv with part-line/component count in the status bar; cache-bust ?v=39 / sw kipad-v33 — 2026-08-24
  - [x] test/test_bom.js (11 checks incl. serialize→parse round-trip smoke: grouping survives a file save/reopen) — 2026-08-24
- [x] Netlist export (.net, KiCad `export version "D"`) — 2026-08-24
  - [x] `js/netlist.js` (KipadNetlist, UMD pure): design header + components + libparts + nets; topology via `KipadSchematic.extractNets` so netlist/ERC/BOM agree; power symbols + `#`-refs excluded as components AND as nodes; nets keep schematic names (label / GND·VCC / auto N-n), natural sort R2<R10 with sequential codes; libparts deduped per lib+part carrying registry pin num/name/type; all strings quoted+escaped
  - [x] UI: Schematic File menu → Export Netlist (.net) downloads kipad.net with net/component count status; cache-bust ?v=42 / sw kipad-v36
  - [x] test/test_netlist_export.js (12 checks incl. serialize→parse round-trip)
  - [x] Fidelity fix found by this work: `.kicad_sch` serializer/parser now round-trip the symbol Footprint property (`(property "Footprint" …)`), previously dropped on save/reopen
- [x] Pick-and-place export (.pos, KiCad component placement) — 2026-08-24
  - [x] `js/pos.js` (KipadPos, UMD pure): per-side tables (front/back from footprint layer), Ref/Val/Package/PosX/PosY/Rot/Side columns matching KiCad's format; only footprints with pads listed (pad-less logo/art excluded); rotation normalised to [0,360); coordinates straight from board frame (mm, Y-down passthrough) — 2026-08-24
  - [x] UI: File → Export component placement (.pos) downloads kipad-top.pos / kipad-bottom.pos (skips empty sides); cache-bust ?v=38 / sw kipad-v32 — 2026-08-24
  - [x] test/test_pos.js (12 checks incl. real-board smoke: every padded footprint appears exactly once across both files) — 2026-08-24
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
- [x] More DRC checks — 2026-08-24
  - [x] Hole-to-copper: THT pad drills + via drills vs other-net copper on all layers, 0.25mm hole clearance; own-pad annulus and same-net exempt — `hole-*` errors — 2026-08-24
  - [x] Copper-to-edge: outline polygon vs copper items, 0.5mm edge clearance — `edge-*` errors — 2026-08-24
  - [x] Silkscreen-over-pad: board text + foreign-footprint silk art reaching a pad's central core → `silk-*` warnings (rotation-aware bbox, Liang–Barsky seg/rect test) — 2026-08-24
  - [x] Courtyard overlap: same-side footprints whose courtyards intersect → `courtyard` error; instance-or-library courtyard rect rotated to world space, AABB prefilter + separating-axis test with 0.01mm touch tolerance; opposite-face parts and missing/unresolvable courtyards exempt (KiCad default severity for missing is ignore); real-board cost ~0ms added (47.9 ms total runDRC) — test/test_courtyard.js (12 checks) — 2026-08-24
  - [x] DRC panel: error/warning counts + colouring, tap row to centre canvas on the violation; test/test_drc2.js (15 suites green) — 2026-08-24
  - [x] Through-hole `*.Cu` pads participate in clearance and edge DRC on both copper layers, independent of footprint side — 2026-08-24
- [x] ERC violation markers drawn on the schematic canvas — 2026-08-24
  - [x] KiCad-style X-in-circle markers at each violation's world coords; red `#cc0000` errors / amber `#b8860b` warnings, deduped per location, radius clamped to 5–16 screen px — 2026-08-24
  - [x] Pure geometry helper `KipadErc.markers()` (unit-tested); render.js just draws the precomputed list — 2026-08-24
  - [x] Tap a marker (select tool) → selects the owning symbol + status bar shows code/message; View menu toggle "ERC markers: on/off" — 2026-08-24
- [x] More ERC checks: cross-sheet global label conflicts, power-pin conflicts, missing footprint
  - [x] No-connect flag placement tool (Q): KiCad-style X marker on a pin tip — `sch.noConnects[]` model + `(no_connect …)` sexpr round-trip; flagged pins exempt from UNCONNECTED_PIN / SINGLE_PIN_NET and flag terminates wires (no DANGLING_WIRE); pin-tip snapping, select/⌫ delete, dark-blue X rendering (#000084 from builtin_color_themes.h), official `noconn_24.png` icon — 2026-08-24
  - [x] Power-pin conflicts: two different power nets shorted on one node (GND symbol wired to VCC) → POWERPIN_CONFLICT error naming both nets; same-name repeats fine; shows in panel + canvas markers with no UI change — 2026-08-24
  - Cross-sheet global label conflicts + missing footprint deferred: single-sheet model / no UI to assign footprints yet
  - [x] Missing-footprint ERC closed without a footprint picker (2026-08-24): symbols already carry a `footprint` field and Update PCB silently substitutes ref-prefix defaults, so `runERC(sch, getSymbol, getFootprint?)` gained `MISSING_FOOTPRINT` (warning, no assignment) + `FOOTPRINT_NOT_FOUND` (error, assigned but unresolvable in the registry — user intent would be overridden); power symbols and KiCad `#`-refs (#PWR/#FLG) exempt; app passes `FPs.getFootprint` so ERC agrees with updatePCB's exact lib-prefix strip — test/test_footprint_erc.js
  - Cross-sheet global label conflicts remain deferred: single-sheet model
- [x] .kicad_pcb round-trip fidelity check against real KiCad files — 2026-08-24
  - [x] Zones: `(zone (net) (net_name) (layer) (polygon|filled_polygon (pts)))` parse + serialize, name-first net mapping, degenerate outlines dropped; test/test_zone_rt.js — 2026-08-24
  - [x] Real-file smoke: lib-build/real-board.kicad_pcb (63 fp / 370 tracks / B.Cu GND zone) → parse → serialize → re-parse stable (~62 ms) — 2026-08-24
  - [x] Compare more element types field-by-field against additional real exports (pads with custom shapes, arcs in tracks, groups) — 2026-08-24 (test_roundtrip2.js: custom pads w/ primitives, arc tracks, groups; see DEVLOG ~06:16)
- [x] Zone-fill connectivity in ratsnest + DRC — 2026-08-24
  - [x] `netAirwires()` treats same-net zone outlines as copper (KiCad: a filled pour joins all same-net pads/tracks/vias it touches): outline-polygon contact tests with layer rules, AABB prefilter, first-corner fallback anchor so an untouched pour attracts its own stitching airwire + `unconnected` DRC error — 2026-08-24
  - [x] Perf: real-board.kicad_pcb 1.85 ms/frame baseline → 2.74 ms with a pathological board-wide pour; GND pour drops airwires 59→45 on the real file — 2026-08-24
  - [x] test/test_ratsnest_zones.js (pour joins pads, net-specificity, F.Cu/B.Cu layer rule + stitching vias, track crossing edge, edge-reach vs far pad, DRC unconnected pass, foreign/degenerate/other-layer pours) — 2026-08-24

- [x] Keyboard: more KiCad shortcuts parity — 2026-08-24
  - [x] Pure resolver `js/keys.js` (KipadKeys.resolve) runs before legacy single-key switches so modifier combos never leak into tools; test/test_keys.js (27 checks) — 2026-08-24
  - [x] Ctrl/Cmd+S save · Ctrl/Cmd+O open · Ctrl/Cmd+Z / +Shift+Z / +Y undo-redo (mode-aware); +/-/= zoom, Home zoom-fit; E opens Properties on PCB selection; A = Add Footprint (PCB, Library tab) / Add Symbol (schematic); arrow keys nudge footprint/text/symbol selection by one grid step — 2026-08-24
- [ ] iPad polish: haptics, Apple Pencil tilt/eraser, two-finger tap undo
  - [x] Two-finger tap = Undo on both canvases (iPadOS gesture): pure `KipadGestures.twoFingerTap()` recognizer (`js/gestures.js`) wired into the shared pointer handlers via the same undo path as Ctrl+Z; pinch/drag/3-finger/cancel all disambiguated — 2026-08-24
  - [x] Schematic multi-touch guard: second+ fingers no longer fire `schPointerDown` (pinching no longer places symbols / adds wire points) — 2026-08-24
  - [x] Apple Pencil tilt/eraser: live altitude in HUD (native altitude/azimuth with tilt fallback); standard eraser-end Pointer Events delete the item under the tip in PCB and schematic modes through normal undoable delete paths — 2026-08-24
  - [ ] Haptics: iPadOS Safari does not expose `navigator.vibrate`; retain as pending until a viable web API or native wrapper exists

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
- [x] Schematic canvas grid/labels to match KiCad precisely — 2026-08-24
  - [x] Grid: 1px dots in LAYER_SCHEMATIC_GRID grey rgb(181,181,181) + dark-blue grid-axes cross through world origin rgb(0,0,132) (both from builtin_color_themes.h Kicad-2007 light theme); dot size scales at high zoom, same visibility threshold as before
  - [x] Labels typed local|global: local keeps LAYER_LOCLABEL #0F0F0F text; global renders the KiCad flag/banner (paper-filled, #840000 LAYER_GLOBLABEL outline+text, pointed end docked on the anchor, ~1.9 mm world height clamped to screen px); placement tool + Ctrl+H shortcut (KiCad legacy Add Global Label), official add_label_24.png icon for the label button, glabel.png now only on the global-label button
  - [x] Model/IO: Sch.addLabel(…, type), serializer emits (global_label … (shape input)), parser maps tag → type both ways, round-trip stable; test/test_sch_labels.js
- [x] Gerber viewer launcher card: real RS-274X import, layer tabs, fit-to-view rendering, generated-board preview — 2026-08-24
- [x] PCB Calculator launcher card (was track-width-only placeholder; expanded 2026-08-24)
  - [x] Pure math module `js/calculators.js` (KipadCalc UMD): IPC-2221 track width (k = 0.048 ext / 0.024 int — fixes old dialog's swapped constant), via barrel ampacity + R/drop/loss, IPC-2221A Table 6-1 electrical spacing, resistor colour code both directions (4/5-band, gold/silver multipliers), loaded/unloaded voltage divider, nearest E12/E24/E96 value; test/test_calc.js (52 checks) — 2026-08-24
  - [x] Dialog rebuilt as tabbed calculator (Track Width · Via Size · Spacing · Resistor Code · Divider · E-series), live recalc, coloured band chips; cache-bust v27 / sw kipad-v21 — 2026-08-24
  - [x] Antenna-length calculator: full/half/quarter wavelength from frequency and velocity factor, with validation and live UI — 2026-08-24
  - [x] Adjustable-regulator calculator: sizes the adjust-to-ground resistor from Vref/target/Rset/Iadj, rounds to E12/E24/E96, and reports actual output/error — 2026-08-24
  - [x] Microstrip transmission-line calculator: analyse impedance/effective permittivity/delay/electrical length or synthesize trace width for a target impedance — 2026-08-24
  - [x] Board-thickness calculator: pure `boardThickness()` stackup sum + `ozToUm()` (copper weight ↔ foil µm), live tabbed UI with editable per-layer rows (kind + µm), add/remove layer, and 2-layer/4-layer 1.6 mm FR-4 presets — 2026-08-24

## Session 2026-08-23 (evening) — library load fix + net classes
- [x] Fix fetchJSON `.gz` detection with `?v=N` cache-busted URLs — `url.split('?')[0].endsWith('.gz')` — pushed 15cad007, live-verified in real Chromium: 600 symbols / 159 footprints / zero errors (was silently falling back to stale plain JSON: 400/13)
- [x] index.html local copy synced to live (Symbols (600) / Footprints (159) labels)
- [x] Net classes & clearance UI (PCB side) — DELEGATED to subagent
  - [x] Board model: `board.netClasses` (id/name/trackWidth/clearance/viaSize/viaDrill, Default = id 0) + `B.ensureNetClasses/addNetClass/getNetClass/netClassOfNet/setNetClass/renameNetClass/removeNetClass` — 2026-08-23
  - [x] DRC uses per-net-class clearance (max of the two classes), class names in violations — 2026-08-23
  - [x] Nets panel: class column + "Net Classes…" modal editor (KiCad Edit Net Classes dialog: editable fields, add/remove class, net chips + Add net dropdown, touch-friendly) — 2026-08-23
  - [x] Routing: new track width defaults to net's class width (W cycles from it), vias use class via size/drill — 2026-08-23
  - [x] test/test_netclasses.js (11 checks) — 2026-08-23

## Session 2026-08-24 (~00:30 UTC) — polish & bug-fix pass (refine existing, no new features)
Per Avery: keep iterating autonomously until polished; refine/bug-fix only.
- [x] Fix schematic pan jump — dragging empty schematic canvas jumped the view (`lastPan` seeded from never-assigned `lastPointerX/Y`); pointer event now passed into `schPointerDown` and seeds pan correctly — 2026-08-24
- [x] Grid rendering hardening — dots batched into two canvas paths per frame (minor + major) instead of thousands of beginPath/fill calls, plus hard 40k-dot cap on top of sub-pixel culling; PCB entry stays smooth on huge windows / low zoom — 2026-08-24
- [x] Zoom-aware selection tolerance — pad/footprint/track/via/text hit tests use screen-constant ~4 px tolerance (0.2 mm floor) via new `pickTol()` instead of fixed mm values; used by route-start, zone-start, highlight and select — 2026-08-24
- [x] Zone draft safety — switching copper layer mid-draw (toolbar or Layers panel) cancels the draft instead of letting it finish on the wrong layer — 2026-08-24

## Session 2026-08-24 (~04:05 UTC) — branch convergence (merge of two parallel iterations)
- [x] Merged the two diverged working copies into one canonical tree: expanded-DRC iteration (board.js checks + new DRC panel + test_drc2.js, lived in sandbox) + polish pass (pan fix, grid batching, pickTol, zone-draft cancel, textPlace cleanup, lived in workspace copy) — 2026-08-24
- [x] Polish fixes re-applied onto the app.part1–4 split structure; render.js grid batching ported; verified merged app differs from each parent only by that parent's missing changes — 2026-08-24
- [x] Unified cache-bust back to ?v=17 across all index.html refs + lib URLs; sw.js CACHE kipad-v11 — 2026-08-24
- [x] All 15 test suites green on the merged tree; node --check clean; static `$('id')` ↔ index.html wiring check passes (dynamic IDs all built in JS) — 2026-08-24

- [x] Connectivity-aware ratsnest + DRC unconnected-items check — 2026-08-24
  - [x] `ratsnest()` rewritten: union-find copper clustering per net (pads/tracks/arcs/vias, T-junctions, layer-aware contact, '*.Cu' wildcards, via F/B bridging) + Prim-MST airwires between disconnected clusters — partially-routed nets now show only their real unrouted connections — 2026-08-24
  - [x] runDRC: `unconnected` error per remaining airwire (net + R1.2-style pad labels, tap-to-centre works); clearance violations got their missing `msg` (panel showed "undefined") — 2026-08-24
  - [x] test/test_ratsnest.js (26 checks); AABB prefilter keeps per-frame ratsnest ~1.8 ms on the real board; all 26 suites green — 2026-08-24
  - [x] Follow-up: zone fills count as connectivity (KiCad joins same-net pads through filled zones) — 2026-08-24
- [x] Mirror sync to origin — DONE 2026-08-24: added repo-scoped SSH deploy key `homeops@thefrogbrain (kipad deploy, write)` (GitHub key id 161160200, ~/.ssh/kipad_deploy, ssh alias `github-kipad`); origin now = merge of API-era commits + canonical workspace history (464124f), content byte-matches local incl. lib/*.json; future syncs are plain `git push` — see DEVLOG ~13:16

## Session 2026-08-24 (~04:35 UTC) — zone round-trip + PCB-view fidelity fixes
- [x] Zone sexpr round-trip (parse + serialize + real-board smoke) — see DEVLOG; first sub-item of round-trip fidelity milestone — 2026-08-24
- [x] Footprint side flip now swaps all layers properly (Paste/Mask/Fab/CrtYd/SilkS), THT pads untouched — 2026-08-24
- [x] Placed-footprint silk/fab art fallback to fp.silk when library graphics absent (imported .kicad_mod, logo images); silk rect rendering in canvas + preview — 2026-08-24
- [x] Via annulus stroke radius (size+drill)/4; pads dim on inactive copper side like tracks — 2026-08-24
- [x] Image-converter logos: auto-numbered refs, string F<n> ids — 2026-08-24
- [x] FileReader.onerror status messages for open/import/image flows — 2026-08-24


## CURRENT AUTONOMOUS QUEUE

- [x] Add safe-save validation and automatic backup before overwriting KiCad files — 2026-08-24
  - [x] `js/safesave.js` (KipadSafeSave, UMD pure): `validate(text, parse[, reserialize])` — parse-back with the real parser gates every save (parse failure aborts the download; unstable second cycle reported as `stable:false` but allowed) + rotating backup ring (`pushBackup`/`listBackups`/`getBackup`, newest-first under `<key>.bak.v1`, default keep 3, injectable store, quota errors drop oldest and retry, storage failure degrades to "no backup" without ever breaking a save) — 2026-08-24
  - [x] Wiring: PCB `doSave` / schematic `schSave` validate before download; last opened/saved text (`doOpen`/`schOpen` baselines) is pushed to localStorage backups (`kipad.backup.pcb.v1` / `.sch.v1`) before a changed version overwrites it; File → Restore previous save… in both editors loads the newest backup through the normal undoable open path; cache-bust v44→v45 / sw kipad-v38→v39 + ASSETS entry — 2026-08-24
  - [x] test/test_safesave.js (14 checks incl. real-board validate smoke on lib-build/raw/custom_pads.kicad_pcb) · all 35 suites green — 2026-08-24
- [x] Build real-project .kicad_pcb round-trip regression fixtures — 2026-08-24
  - [x] Fixture boards tracked in git for the first time: lib-build/raw/{custom_pads,groups_load_save,tracks_arcs_vias,pic_programmer,video}.kicad_pcb + lib-build/real-board.kicad_pcb — previously untracked, five existing suites depended on files a fresh clone would not have
  - [x] test/test_roundtrip_fixtures.js sweeps all six real exports: ground-truth element counts scanned from the raw sexpr must match the parsed model (footprints incl. legacy `(module`, segments, arcs, vias, zones, groups); parse→serialize→re-parse structural snapshot stability (nets, per-fp ref/side/angle/pad-shape fingerprint, track kinds, via geometry+netId, silk texts, zone net/layer/outline length, outline segs, groups); second serialization cycle byte-stable — 43 checks
  - [x] Precision finding: serializer emits r4str 4-decimal coords, so cycle-2 geometry sits ≤5e-5 off raw-source floats (video.kicad_pcb vias, e.g. 108.45799 → 108.458); snapshots compare at output precision (q4), same tolerance as the arc field tests
- [x] Preserve unsupported KiCad S-expression nodes during round trip — 2026-08-24
  - [x] `board.extra[]` / `fp.extra[]` hold raw parsed subtrees verbatim (JSON-safe): top-level dimension/setup/title_block/paper/images/targets/gr_curve, non-silk gr_text, non-edge gr_line/rect/arc/poly/circle; footprint-level fp_line/fp_text/graphics, model, attr, descr/tags, custom properties — 2026-08-24
  - [x] `generator` modeled (`board.generator`), synthesized `(general (thickness 1.6))` suppressed when extras carry one; cycle-2 output byte-stable; test/test_extra_rt.js incl. video.kicad_pcb real-file gate (2 dimensions / 175 models) — 38/38 suites green; cache v=47 / kipad-v41 — 2026-08-24
- [x] Improve interactive trace routing with 45-degree routing and route cleanup — 2026-08-24
  - [x] `js/route.js` (KipadRoute, UMD pure): `elbow()` bends every route into H/V/45 segments (posture 'diag' default / 'straight', `/` toggles live), `cleanup()` drops duplicate + collinear points before commit, Backspace during routing removes the last placed point; dashed preview renders the real constrained elbow path — test/test_route.js (38 checks) · cache v=48 / sw kipad-v42
- [ ] Add trace width and via-size controls
- [ ] Add route layer switching that automatically inserts a via
- [ ] Add multi-select and group move/rotate/delete
- [ ] Audit undo/redo so every PCB editing operation is reversible
- [ ] Add board setup + net-class editor
- [x] Add fabrication ZIP export containing Gerber, drill, .pos, and BOM — done as PCB File > Export fabrication package (.zip) — 2026-08-24


## Session 2026-08-24 (~16:50 UTC) — fabrication ZIP export
- [x] js/zip.js (KipadZip UMD): table-driven CRC32, UTF-8 toBytes, store-mode zipStore (local headers + central directory + EOCD), deterministic given fixed timestamp — 2026-08-24
- [x] PCB File > Export fabrication package (.zip) — doFabZip bundles gerbers/ (9-layer set), drill/kipad.drl, placement/kipad-top|bottom.pos, plus bom/kipad-bom.csv when a schematic is loaded; binary download via new downloadBytes(); status reports file count + KB — 2026-08-24
- [x] test/test_zip.js: 59 checks (CRC vectors 0xCBF43926 + fox vector, multibyte UTF-8, full structure walk with CD↔local-header cross-checks, DOS datetime encoding, byte-determinism); archive also validated externally with python zipfile (testzip clean, names + readback OK) — 2026-08-24
- [x] Cache discipline: index.html ?v=45→v46 (32 refs incl. new zip.js tag), sw ASSETS += ./js/zip.js, CACHE kipad-v39→v40 · **35/35 test suites green** — 2026-08-24
