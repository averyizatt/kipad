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
- Pending: sw.js asset list update, manifest, README, integration tests, push.

### Iteration 3 — Drill export + push orchestration
- `js/drill.js` (KipadDrill): Excellon .drl exporter — collects THT pad + via drills, dedupes sizes, tool table, G90/G05/M30. `test/test_drill.js` green.
- Wired into UI: toolbar button (⊚), File menu item, script tag, sw.js cache.
- Push strategy: small file contents passed inline via ClawLink for commits 1-4; the two big generated lib JSONs (footprints.json 266KB, symbols.json 177KB) delegated to a subagent (kipad-push) to avoid blowing session context.

### Iteration 4 — Schematic editor (Eeschema) + launcher + plugin manager + gz libs
- `js/schematic.js` (KipadSchematic): schematic model (symbols/wires/labels/junctions), pin position math from registry, union-find netlist extraction (labels on wire segments, power symbols name nets), `.kicad_sch` KiCad-8 serialize/parse round-trip, `updatePCB()` bridge (symbols → footprints via footprint property + ref-prefix fallback, pad nets from netlist). `test/test_schematic.js` green.
- `render.js`: added `renderSchematic` / `drawSchematicSymbol` — draws symbols from registry graphics (rect/polyline/circle/arc/text), pins with connection dots, wires, junctions, labels, in-progress wire preview, crosshair.
- `app.js`: mode system (launcher | schematic | pcb), launcher screen (Schematic Editor / PCB Editor), schematic tool rail (select/symbol/wire/label/junction), schematic keyboard shortcuts, per-mode menubar (File→Update PCB from Schematic, Tools→Plugin and Content Manager), netlist modal, schematic save/open (.kicad_sch), zoomFit for schematic. Drill export wired (toolbar ⊚ + File menu).
- `index.html`/`style.css`: launcher UI, schematic rail buttons, plugin manager modal styles, `.kicad_sch` file-open accept, script tag.
- Library delivery switched to gzipped bundles: `lib/footprints.json.gz` (20,961 B) + `lib/symbols.json.gz` (15,849 B), fetched with DecompressionStream('gzip') in app.js, plain .json kept as fallback + sw.js cache. Reason: the plain 266KB footprints.json repeatedly blew subagent context when pushing via ClawLink (3 failed attempts); gz is 13× smaller and faster on iPad.

## 2026-08-23 — Iteration: KiCad visual overhaul (real source lift)

- Downloaded 50 official KiCad PNG icons from kicad-source-mirror `resources/bitmaps_png/png/` into `icons/` (toolbar 24px + launcher 128px app icons). Icons are GPL-3.0 (KiCad source), used as assets for this personal project.
- Extracted the real KiCad 8 default color theme from `common/settings/builtin_color_themes.h`:
  - PCB canvas `#001023`, F.Cu `#c83434`, B.Cu `#4d7fc4`, Edge.Cuts `#d0d2cd`, F.SilkS `#f2eda1`, B.SilkS `#e8b2a7`, F.Mask `#d864ff`, B.Mask `#02ffee`, F.CrtYd `#ff26e2`, B.CrtYd `#26e9ff`, F.Fab `#afafaf`, B.Fab `#585d84`, ratsnest `#00f8ff`, select overlay `#04ff43`.
  - Schematic: paper `#f5f4ef`, wires `#009600`, pins `#840000`, ref `#006464`, value `#840084`.
- `index.html` rebuilt: launcher is now a KiCad **Project Manager** window (menubar File/View/Tools/Help, toolbar with real app icons, "Project Files" tree, app cards, status bar). Editor chrome uses real KiCad toolbar/rail icons instead of emoji.
- **Fixed bug Avery reported**: launcher flashed then jumped to PCB editor — the old `#launcher` was nested inside `#main`, so `setMode('launcher')` immediately hid it. Now launcher is a full-window overlay sibling; menubar/toolbar/statusbar/main are hidden while it's up.
- `style.css`: full rewrite to KiCad light chrome (`#ececec` window, light panels) around the dark PCB canvas; launcher PM styles.
- `render.js`: real KiCad default layer colors + light-paper schematic rendering (green wires, dark red pins, teal refs).
- `app.js`: `setMode` toggles editor chrome in/out of launcher mode; launcher menu branch; PM toolbar/tree/card wiring (`pm-new/pm-open/pm-save/pm-refresh`, `data-open` cards, Gerber/Calculator/Bitmap placeholders, PCM); `#menu-popup` now `position:fixed` positioned from the clicked menu.
- `sw.js`: cache bump `kipad-v2` → `kipad-v3`, 50 icons precached.

### 2026-08-23 — gz-vs-cache-bust fix (commit 15cad007)
- Real-browser evidence: despite correct `.gz` bundles on the server, the app loaded only 400 symbols / 13 footprints — silent fallback to stale plain JSON.
- Root cause: `fetchJSON()` tested `url.endsWith('.gz')`, but URLs are `lib/symbols.json.gz?v=9`; the query string defeated the check, so gzip bytes went to `r.json()`, parse failed, and the catch fell back to plain JSON.
- Fix: `if (url.split('?')[0].endsWith('.gz'))`. Byte-exact push (md5 `02e2e2f1…`); live diff IDENTICAL. Browser verify: `LIB_SYMBOLS=600 LIB_FOOTPRINTS=159 RENDERED_ITEMS=150 ERRORS=[]`, and the request log shows only the `.gz?v=9` URLs — no plain fallback.
- Browser sandbox note: Chromium needed 6 extra noble libs (libharfbuzz0b, libpixman-1-0, libthai0, libxcb-render0, libdatrie1, libgraphite2-3) extracted into `/tmp/kiptest/pb/libs`; `ldd` now shows 0 missing.

### 2026-08-23 — Net Classes & Clearance UI (subagent iteration)
- `js/board.js`: net class model — `board.netClasses[]` (`{id, name, trackWidth, clearance, viaSize, viaDrill}`), Default class is always id 0; `B.ensureNetClasses` (seeds Default on legacy/localStorage/parsed boards), `addNetClass`, `getNetClass`, `netClassOfNet` (Default fallback), `setNetClass` (stores `net.classId` on the net), `renameNetClass`, `removeNetClass` (nets fall back to Default). Persists automatically via the existing localStorage JSON save; kicad_pcb.js untouched (safe option — round-trip tests unaffected).
- DRC (`B.runDRC`): hardcoded 0.2mm replaced with per-net-class clearance — required clearance between two items = **max of the two nets' class clearances** (KiCad rule). Optional explicit clearance param kept for backward compat. Violations now carry `classA`/`classB` names.
- `js/app.js`: Nets tab shows a class pill per net + "Net Classes…" button → KiCad-style "Edit Net Classes" modal: per-class editable Name / Track W / Clearance / Via size / Via drill (live `input` updates), assigned-net chips (tap ✕ → move to Default), "Add net…" dropdown per class, Remove class / + Add Class buttons. Routing: starting a track defaults width to the net's class trackWidth (W cycles from it, updates in-progress route), vias take size/drill from the net's class. DRC panel shows `(min Xmm ClassA↔ClassB)`. PCM entry for netclasses removed (feature is built in). `loadLocal`/`restore`/`doOpen`/`doUpdatePCB` call `B.ensureNetClasses`.
- `style.css`: `.net-class` pill, `.netclass-card`, `.nc-chip`, `.nc-nets`, `.nc-add` styles.
- `test/test_netclasses.js` (new, 11 checks): default class, add/get/set/rename/remove, fallback, per-class DRC (0.4 → violation / 0.05 → clean on 0.1mm gap), max-of-two-classes rule, same-net exemption, clearance override, JSON round-trip persistence, legacy-board seeding. All 11 suites green.

### 2026-08-23 — ERC: Electrical Rules Check for the schematic editor (subagent iteration)
- `js/schematic.js`: extracted `KipadSchematic.connectivity(sch, getSymbol)` — the union-find + label-to-wire merging topology used by the netlist — into its own exported function (groups now carry `pins`, `labels` with id/position, `powerName`, `wired`). `extractNets()` is now a thin wrapper over it. Additive refactor; test_schematic + integration still green. Rationale: ERC and the schematic→PCB netlist now share one topology, so they can never disagree about what is connected.
- `js/erc.js` (new, KipadErc UMD, mirrors the B.runDRC pattern): `runERC(sch, getSymbol)` → violations `{severity, code, message, symbolId?, pinId?, labelId?, wireId?, netName?, x, y}` (world mm coords for locating). Seven checks:
  - `UNCONNECTED_PIN` (warning) — pin whose node has nothing else on it; exempt: `no_connect` pins and power_in/power_out pins whose value (or pin name) names a power net (GND/VCC/3V3… — same derivation as extractNets).
  - `SINGLE_PIN_NET` (warning) — net with exactly one pin and no label (auto net name follows extractNets numbering); suppressed when the pin is already reported unconnected.
  - `DUPLICATE_REF` (error) — one violation per extra symbol sharing a ref.
  - `MISSING_REF` (error) / `MISSING_VALUE` (warning).
  - `LABEL_CONFLICT` (error) — two different labels on one electrical node; same-name duplicates on one node are fine.
  - `DANGLING_WIRE` (warning) — wire end touching no pin/label/junction/other-wire vertex; closed loops and label-terminated ends are not dangling.
  - Plus `counts()` helper (errors/warnings).
- `js/app.js`: ERC cached in `ercViolations` + `ercDirty` flag (set in `schPushUndo`/undo/redo/new/open/`setMode('schematic')`); recomputed on next schematic render only, so pan/zoom frames don't re-run the check. Inspect menu → "Electrical Rules Check…" + toolbar ERC button (erc.png, sch-only). Floating `#erc-panel` like the DRC panel: "N errors, M warnings" summary, grouped Errors/Warnings, tap a row → locate (selects the symbol + centres the view on the violation, status shows code+message). Status-bar indicator `#st-erc` "ERC: N errors, M warnings" (green when clean, red when dirty) in schematic mode. Panel auto-hides in PCB mode. PCM "erc" entry removed (built in). Schematic help text updated.
- `index.html`/`style.css`/`sw.js`: erc.js script tag (v=10 cache-bust), `#btn-erc`, `#erc-panel`, `#st-erc`; `.erc-item`/`.erc-group-title`/`.erc-summary`/`.erc-close` styles (severity colour bars, 30px touch targets); sw cache → kipad-v5 with js/erc.js.
- `test/test_erc.js` (new, 15 checks): clean fully-wired labeled circuit → 0 violations; isolated R → 2 UNCONNECTED_PIN (and no double SINGLE_PIN_NET); lone GND / synthetic power_out / no_connect symbols → 0; duplicate refs (2 and 3 copies); missing ref/value severities; label conflict + same-name-label tolerance; single-pin stub net + its dangling end; bare wire → 2 dangling; label-at-end and closed-loop not dangling; severity counts; determinism + locate fields. All 12 suites green (11 existing + ERC).
- UI smoke-tested in jsdom (real app.js, mocked fetch/canvas): place R via Symbols panel search → ERC toolbar opens panel "0 errors, 2 warnings" → row tap locates (status: `UNCONNECTED_PIN: Pin 1 of R1 not connected`) → status-bar indicator dirty → Inspect menu entry present → close button → panel + indicator hidden in PCB mode.

### 2026-08-23 — Copper zones / pours v1 (subagent iteration)
- `js/zones.js` (new, KipadZones UMD, pure logic, no DOM): KiCad-style solid zone fill via raster flood. Grid over the outline bbox (default 0.25 mm, per-zone/opts override); a cell is a candidate when its centre is inside `zone.outline` (even-odd point-in-polygon, edge-inclusive) and not BLOCKED — blocked = within the zone's clearance of opposite-net copper (pad rects, track segments, vias, other zones' outlines on the same layer). Clearance = `zone.clearance` override, else the net's class clearance via `ctx.netClassOf(netName)` (0.2 mm fallback). Flood is 4-neighbour from candidate cells touching same-net copper (≤1 grid step), so pours merge with their own pads/tracks/vias and disconnected islands stay unfilled exactly like KiCad. Returns `{cellSize, ox, oy, cols, rows, runs:[[row,c0,c1]...], area, filled}` — run-length spans, enough for rendering and area math; deterministic across refills.
- `js/board.js`: `board.zones[]` model `{id, net (name), layer 'F.Cu'|'B.Cu', outline [{x,y}] closed ring, clearance?, minArea?}`, plus `addZone` (normalizes [x,y] → {x,y}, lazy array), `removeZone`, `zonesOn`. Zones ride the existing whole-board JSON localStorage save; kicad_pcb.js sexpr serialization deliberately untouched this iteration.
- `js/render.js`: zone fills drawn between board outline and footprints (i.e. under tracks/pads/vias) at layer color alpha 0.6 + subtle same-color outline, one batched path per zone; zones on the inactive copper layer are skipped; selected zone gets the SEL green outline (2px); dashed draft polyline with first-point close ring while placing.
- `js/app.js`: `tool-zone` rail button (real KiCad `icons/add_zone.png`, fetched from kicad-source-mirror `png/add_zone_24.png`), Z shortcut, Place → Zone menu entry. Placement: tap points (grid-snapped), close by tapping near the start ring / double-tap / Enter; Esc cancels; net assignment mirrors routing (pad under the first tap wins, else highlighted net). Zone selection via point-in-outline on the active layer; Del or Properties Delete removes it (undo-integrated). Properties panel shows net/layer/filled area with clearance override + Refill. Auto-refill: any `pushUndo`/restore/open/update marks zones dirty and a 150 ms debounce refills all zones (fill cache lives in a Map keyed by zone id, never serialized). Status bar "Zones: N" (`#st-zones`). PCM "zones" plugin entry removed (built in).
- `index.html`: zones.js script tag; style.css needed no changes. Cache-bust: every `?v=11` → **`?v=12`** (17 refs in index.html incl. manifest/style/icons/scripts + the 4 lib URLs in app.js); sw.js CACHE → **`kipad-v6`**, added `./js/zones.js` + `./icons/add_zone.png`.
- `test/test_zones.js` (new): point-in-polygon (in/out/edge/corner), fill connects pad→track→far end, island without same-net copper unfilled (incl. seed outside the outline), clearance band vs foreign wall at class 0.2 / class 0.9 / zone override 0.05, foreign via + foreign-zone blocking, addZone/zonesOn/two-layer coexistence, removeZone idempotence, JSON round-trip identity, refill determinism (byte-equal JSON), resolution scaling 0.5/0.125, degenerate outline safety, board-level end-to-end (pads+track+via+foreign VCC wall through KipadBoard). All **13 suites** green (12 existing + zones).

### 2026-08-23 — Silkscreen board text
- Added the KiCad text tool (T): prompt for content, live cursor preview, place on F.SilkS/B.SilkS according to the active copper side, select/drag/rotate/delete, and edit content, layer, height, thickness, angle and alignment in Properties.
- `board.texts[]` is part of the board model and local persistence. `.kicad_pcb` import/export now round-trips F/B silkscreen `gr_text` entries with position, angle, font size/thickness and left/center/right justification.
- Renderer uses KiCad silkscreen colors with a selected-text bounding box. Added official KiCad `text_24.png`, cache-bust v13 / offline cache kipad-v7, and `test/test_text.js`. All 14 suites pass; jsdom startup/launcher smoke test passes.
