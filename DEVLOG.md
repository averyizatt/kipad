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
