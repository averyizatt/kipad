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
- Live Chromium smoke testing exposed a render stall when entering PCB mode: the default 0.25 mm grid at 3 px/mm attempted more than one million canvas arcs per frame. Grid rendering now increases only the visual dot interval until dots are at least 4 px apart (snap precision is unchanged). Cache-bust v14 / offline cache kipad-v8.

## 2026-08-24 ~02:40 UTC — Expanded DRC shipped
- board.js: three new checks folded into runDRC (all violations now carry severity):
  - hole-to-copper (error): THT pad drills + via drills vs other-net copper on both layers; 0.25mm hole clearance (KiCad default); own-annulus (ownerPad) and same-net exempt. New copperItemsExt() tolerates *.Cu wildcard pad layers.
  - copper-to-edge (error): outline polygon vs every copper item, 0.5mm edge clearance (KiCad default); skipped when no outline.
  - silkscreen-over-pad (warning): user board text vs exposed pads on matching side (rotation-aware bbox), foreign-footprint F.SilkS art vs pads via Liang-Barsky seg/rect test; only flags silk reaching the central 50% of a pad so real-footprint corner clipping stays quiet; own-library art exempt.
- app.js: DRC panel rewritten — "N error(s), M warning(s)" header, warn-coloured rows, tap-to-locate centres canvas on violation coordinates; help text updated.
- style.css: .drc-item.warn + hover styles.
- test/test_drc2.js added (hole/edge/silk/exemptions/regression); all 15 suites green, node --check clean.
- Cache-bust ?v=15, service worker kipad-v9.

## 2026-08-24 ~04:05 UTC — Convergence: merged two diverged parallel iterations
Discovery: two autonomous sessions had worked in parallel from the same ancestor (post silkscreen-text, cache v14) and diverged:
- Sandbox copy: **expanded DRC** (hole-to-copper, copper-to-edge, silk-over-pad + severity/tap-locate DRC panel + test_drc2.js) and had split `js/app.js` into `app.part1–4.js` (index.html loads the four scripts; monolithic app.js left as an "Unused" stub).
- Workspace copy: **polish & bug-fix pass** (schematic pan-jump fix, grid batching + 40k cap, zoom-aware `pickTol()`, zone-draft layer-switch cancel, textPlace duplicate cleanup) still as a single `js/app.js`.
Both claimed the same cache versions (v15 / kipad-v9), so neither was a superset.

Merge (canonical = sandbox):
1. Re-applied all five polish deltas onto the part files: `pickTol()` helper in part1 (+ Layers-panel zone-draft cancel), `switchLayer()` cancel + startTextTool cleanup + route/zone start tolerance in part2, `schPointerDown(wx,wy,pe)` event seeding + select-tool tolerances + dead `lastPointerX/Y` removal in part4.
2. Ported grid batching (two batched canvas paths minor/major + 40k-dot hard cap) into sandbox `js/render.js`.
3. Kept sandbox's expanded-DRC board.js/DRC panel/help text/style.css additions verbatim.
4. Verified: concatenated parts diff against each parent shows ONLY that parent's missing changes (plus structural IIFE/header lines) — nothing lost either direction.
5. Cache-bust unified: every index.html ref + lib URLs → `?v=17`, sw.js CACHE → `kipad-v11`.
6. Tests: all 15 suites green on the merged tree; `node --check` clean on every touched file; static cross-check that every `$('…')` id used by the app exists in index.html or is built dynamically in JS.
Workspace mirror copy synced from the merged sandbox tree so future sessions start from one state.

## 2026-08-24 ~04:25 UTC — ERC violation markers on the schematic canvas
Next unchecked milestone item. KiCad draws ERC violations as X-in-circle markers right on the sheet, so the panel no longer has to be the only way to see problems.

- `js/erc.js`: new pure helper `KipadErc.markers(violations, zoom)` → drawable marker list: dedupes violations sharing a location (rounded to 0.05 mm, first wins), skips non-finite coords, severity colour (error `#cc0000`, warning `#b8860b`), world radius 0.9 mm × zoom clamped to 5–16 screen px (tappable when zoomed out, not dwarfing symbols when zoomed in). No DOM/canvas — unit-testable.
- `js/render.js`: `renderSchematic` draws `state.ercMarkers` after labels/before the placement preview: 18%-alpha fill + solid ring + X through the circle, per marker. Renderer stays dumb — geometry is precomputed by the app.
- `js/app.part3.js`: `renderSchematicView` passes `ercMarkers: Erc.markers(ercViolations, view.zoom)` when enabled; new `showErcMarkers` flag (declared in part1 next to `ercViolations`) + `toggleErcMarkers()`.
- `js/app.part4.js`: schematic View menu gains "ERC markers: on/off" toggle; select-tool tap now hit-tests markers first (~10 px screen tolerance) → selects the owning symbol and reports "ERC <CODE>: <message>" in the status bar before falling through to symbol picking; schematic help text mentions the markers.
- Cache-bust `?v=17` → `?v=18` everywhere (21 index.html refs + 4 lib URLs in part4); sw.js CACHE `kipad-v11` → `kipad-v12`. No new assets to precache.
- Tests: `test/test_erc_markers.js` (13 checks: empty/null input, dedupe, colours, field pass-through, world coords preserved, radius scaling + both clamps + default zoom, determinism). All **16 suites green**; `node --check` clean on all touched files; node render smoke test (stubbed ctx Proxy) exercises `renderSchematic` with and without markers.

## 2026-08-24 ~04:35 UTC — Zone .kicad_pcb round-trip + board-view fidelity fixes
Zone sexpr support (first sub-item of the round-trip-fidelity milestone) plus a batch of PCB-view correctness fixes found during real-library testing.

- `js/kicad_pcb.js`: zones are no longer ignored. Parse: `(zone (net N) (net_name "X") (layer "F.Cu") (polygon|filled_polygon (pts (xy …))))` → `board.zones[]` (`id: 'Z<n>'`, net resolved by name first then net-id map, layer clamped to F.Cu/B.Cu, degenerate outlines <3 pts dropped). Serialize: each zone emits `(zone (net N) (net_name "…") (layer "…") (polygon (pts …)))` with net id looked up from the nets table (0 when absent).
- `test/test_zone_rt.js` (new): model→sexpr→model round-trip incl. B.Cu zone + clearance-bearing zone, degenerate-zone drop, double round-trip stability, zone with only `net_name` (no nets table). All **17 suites green**; `node --check` clean.
- Real-file fidelity smoke: `lib-build/real-board.kicad_pcb` (real KiCad export, 63 footprints / 370 tracks) parses in ~62 ms, its B.Cu GND zone extracts with all 8 outline points, re-serializes and re-parses with net/layer/outline stable.
- Footprint side flip fixed (`app.part1` Properties layer switch): full KiCad-style layer map swap (Cu/Paste/Mask/Fab/CrtYd/SilkS ↔ B-side) instead of rewriting only copper; through-hole pads span both sides and are left untouched.
- Placed-footprint art fallback (`render.js`): library graphics win when present, else graphics stored directly on the footprint draw — imported `.kicad_mod` parts and bitmap-converter logos keep their silk/fab art. Silk `rect` items now render in both canvas paths (`render.js` + footprint-preview painter in `app.part2`).
- Pad dimming rule aligned with tracks (`render.js`): pads on the inactive copper side dim instead of always drawing at full colour (previous condition never dimmed B footprints).
- Via annulus stroke radius corrected (`render.js`): mid-radius circle at `(size+drill)/4` so the ring's outer edge hits size/2 and inner edge hits drill/2 (was size/4 → annulus too thin).
- Image-converter logos (`app.part3`): refs auto-number (LOGO, LOGO2, …) so repeated imports don't collide, footprint ids use the string `F<n>` scheme consistent with the rest of the board, base layer F.Cu (silk art rides the fp.silk fallback above).
- `FileReader.onerror` handlers added to Open/Import/image flows (`app.part2`/`app.part3`) → status message instead of silent failure.
- Cache-bust `?v=18` → `?v=19` (index.html script refs); sw.js CACHE `kipad-v12` → `kipad-v13`. No new assets.
- Workspace mirror synced from sandbox after tests went green.

## 2026-08-24 ~05:16 UTC — No-connect flag placement tool (ERC milestone)
Next ERC item: KiCad's no-connect flag — an X placed on a pin to state "intentionally unconnected", suppressing the pin's ERC warning without wiring anything.

- `js/schematic.js`: `sch.noConnects[]` (`{id, at}`) + `addNoConnect` / `removeNoConnect` (lazy array creation so legacy saved schematics keep working); `(no_connect (at x y) (uuid …))` serialize + parse in the .kicad_sch paths.
- `js/erc.js`: `pinHasNoConnect()` — a pin tip within 0.635 mm of a flag (half the common 1.27 mm pitch) is exempt from UNCONNECTED_PIN and SINGLE_PIN_NET; a flag also legitimately terminates a wire, so wire ends at flags are no longer DANGLING_WIRE. Flags create no connectivity (netlist unchanged). Exported `pinHasNoConnect` + `NC_RADIUS`.
- `js/render.js`: dark-blue (#000084, `LAYER_NOCONNECT` from KiCad builtin_color_themes.h) X after junctions; world half-diagonal 0.635 mm with 4 px screen floor.
- App: `sch-noconn` rail button (official `icons/noconn.png`, fetched from kicad-source-mirror), Q shortcut, Place → No-connect flag menu entry, status names ("No Connect"); placement snaps to the nearest pin tip within 0.635 mm else grid point, duplicate-flag guard; select tool hit-tests flags (~10 px tolerance) before symbols → ⌫ deletes via `removeNoConnect`; Escape clears selection; help text updated.
- Cache-bust all index.html refs → `?v=20` (21 refs); sw.js CACHE → `kipad-v14` + precache `./icons/noconn.png`.
- Tests: `test/test_noconnect.js` (model add/remove/idempotence/lazy-array, ERC suppression incl. radius boundary both sides, flag-terminated wires not dangling, netlist invariance, sexpr round-trip + uuid-file parse + double round-trip). All **18 suites green**; `node --check` clean on every touched file; static `$('…')` ↔ index.html check passes for all six sch tools.
- Workspace mirror synced from sandbox.

## 2026-08-24 ~06:05 UTC — ERC power-pin conflict check
Next unchecked ERC item: two different power nets shorted together on one node — e.g. a GND symbol wired to a VCC symbol. KiCad reports this class of mistake as an error; until now Kipad's ERC silently accepted it (extractNets just named the net after the first power_in pin).

- `js/erc.js`: new POWERPIN_CONFLICT check. For each connectivity group, pins are resolved to their symValue-stamped records (`stamped` map keyed `symId|number`, built alongside the existing pinGroup map) and run through the existing `powerNetName()` helper; every distinct power name beyond the first on the same node adds one error naming both nets, located at the offending pin (so panel tap-locate and canvas markers work with no UI change). Same-name repeats (two GND symbols tied together) stay clean; a no-connect flag does not excuse a wired short. Deterministic: insertion-ordered scan, one violation per extra net.
- Deliberately NOT added this round: cross-sheet global label conflicts (model is single-sheet) and missing-footprint warnings (symbol properties UI has no footprint field editor yet — would produce unfixable noise). TODO notes both as deferred.
- Cache-bust `?v=20` → `?v=21` (21 refs in index.html); sw.js CACHE `kipad-v14` → `kipad-v15`. No new assets.
- Tests: `test/test_powerconflict.js` (8 suites: GND↔VCC short = exactly one error naming both nets + coordinates/netName fields; two GNDs fine; unwired different powers fine; three-way short reports each extra net once; ordinary passive pins on the node don't mask it; power_out+power_in of the same name no false positive; flag can't excuse a wired short; determinism). Fixture gotcha worth remembering: connectivity merges pins only at wire *vertices* (EPS), not mid-segment — a 3-point wire is needed for a 3-pin short. All **19 suites green**; `node --check` clean.

## 2026-08-24 ~06:16 UTC — Round-trip fidelity vs real exports: arc tracks, custom pads, groups
Completed the last open sub-item of the round-trip-fidelity milestone using REAL KiCad exports pulled from kicad-source-mirror qa/data/pcbnew into lib-build/raw/ (tracks_arcs_vias.kicad_pcb v20210126, custom_pads.kicad_pcb v20200829, groups_load_save.kicad_pcb v20231231, plus demos/video.kicad_pcb as a big smoke file).

- js/kicad_pcb.js:
  - Arc tracks: new `parseArc` + top-level `arc` case → tracks with `{kind:'arc', mid}`; serializer emits `(arc …)` for any track carrying `mid`. Straight segments unchanged.
  - Custom pads: `SHAPES` now includes `custom` (was silently coerced to rect); `parsePad` reads `(options (anchor))` → `pad.anchor` and `(primitives …)` via new `parsePrimitives` (gr_poly pts+width, gr_line, gr_rect±fill, gr_circle center/end) kept in pad-local mm on `pad.primitives`; serializer re-emits `(options (clearance outline) (anchor …))` + primitives verbatim.
  - Groups: top-level `(group)` case → `board.groups[] {name, uuid, locked, members[]}`; serialized after zones with members as quoted strings. No UI (opaque round-trip is the goal).
  - Pre-v6 compat: top-level `(module …)` now parses like `footprint` (the 20200829 fixture uses it).
- js/board.js: `arcPolyline(start,mid,end,n)` circumcircle sampling (collinear → 2-pt fallback) + exported `trackSegments(t)` (1 seg straight / 12 chords arc). Consumers switched: hitTrack, copperItems, copperItemsExt (per-chord clearance items), so DRC/hit-tests see arc geometry.
- js/render.js: track loop draws the sampled polyline per arc; drawPad gains a `custom` branch rendering primitives in pad space (poly filled; rect/circle filled when `(fill yes)` else stroked at their width; gr_line stroked).
- js/app.part2.js zoneCtx: zone blocking flattens arcs through trackSegments.
- Cache-bust ?v=21→?v=22 (21 refs), sw CACHE kipad-v15→kipad-v16. No new assets.
- Tests: new test/test_roundtrip2.js — 112 checks: all three fixtures parse → serialize → re-parse field-by-field stable (coords at r4 precision), double serialization byte-stable, arc polyline passes through mid (<0.05 mm), SOT-89-style poly values exact, group name/members/locked preserved, video.kicad_pcb smoke (7932 tracks / 189 footprints stable, ~619 ms full parse+serialize+parse cycle). All 20 suites green; node --check clean on touched files.
- Gotchas worth remembering: sexpr output is pretty-printed multiline, so content greps must not assume inline nodes; r4str rounds half-away-from-zero (36.60765 → "36.6077") unlike JS toFixed ("36.6076") — compare with tolerance in tests.

## 2026-08-24 ~06:40 UTC — KiCad keyboard shortcuts parity
Implemented the "Keyboard shortcuts parity" TODO item as a small, testable increment.

- js/keys.js (new, KipadKeys UMD, pure): `resolve(ev, ctx)` maps {key, ctrl/meta/shift/alt} + {mode, hasSelection} → action. Modifier combos resolve FIRST and return early — fixes the old ordering where e.g. Ctrl+S also fell through to the plain-'s' select-tool switch (Ctrl+Z/Y blocks at the bottom of the old handler are superseded and removed from the PCB branch).
- Wiring in app.part4.js keydown: resolver runs right after the INPUT/TEXTAREA guard; resolved actions preventDefault + dispatch through new `applyKeyAction`. New actions: save/open (mode-aware), undo/redo, zoomIn/zoomOut (+ = - _ , same 1.25× steps and 0.5–50 clamps as toolbar buttons), zoomFit (Home → zoomFit()), props (E → Properties tab when a PCB selection exists), addFootprint (A → footprint tool + Library tab, mirroring KiCad's Add-Footprint chooser flow), addSymbol (A → setSchTool('symbol'), which already switches to the Symbols tab), nudgeLeft/Right/Up/Down.
- `nudgeSel(dx,dy)` moves the current selection by one grid step: PCB footprints via B.moveFootprint + board texts via B.moveText; schematic symbols via Sch.moveSymbol (schPushUndo first on every path; refreshProps/refreshAll after). Track/via/zone selections intentionally not nudged.
- Launcher mode is fully inert to these bindings (resolver returns null for mode==='launcher').
- Help modal + Shortcuts modal text updated with the new keys.
- Cache-bust ?v=22→?v=23 (all refs incl. new js/keys.js tag after erc.js); sw CACHE kipad-v16→v17, './js/keys.js' added to ASSETS.
- Tests: test/test_keys.js — 27 checks (mod combos incl. Cmd variants and shift-redo, unknown-mod null so no tool leak, alt ignored, launcher gating, zoom keys both glyphs, Home, E/A context rules incl. no-selection nulls, all four arrows ± selection requirement, missing key). All **21 suites green** by exit code; node --check clean on touched files.

## 2026-08-24 ~07:10 UTC — iPad polish: two-finger tap = Undo
First sub-item of the iPad-polish milestone, matching the KiCad/iPadOS convention that a two-finger tap steps back one edit.

- `js/gestures.js` (new, KipadGestures UMD, pure): `twoFingerTap({tapMs=400, secondMs=220, slop=12})` → `feed({type:'down'|'move'|'up'|'cancel', id, x, y, t})`. Fires `'undo'` exactly once when exactly two fingers land within 220 ms of each other, neither moves >12 px from its landing spot, and the whole gesture (first down → last up) stays under 400 ms. Third finger, drags (pan/pinch), late second finger, and pointercancel all reset cleanly; boundaries are inclusive. No DOM/canvas — fully unit-testable.
- `js/app.part4.js`: recognizer fed from the shared canvas pointerdown/move/up/cancel handlers (`e.timeStamp`, client coords); on fire it runs the mode-aware undo path (`applyKeyAction('undo')` — same as Ctrl+Z) with a "Two-finger tap → Undo" status hint and consumes the event so the up-handler's double-tap logic can't misfire on the same lift. Safe mid-route: PCB `undo()` restores the last committed snapshot and already nulls route/zone/gfx drafts.
- Schematic multi-touch guard (bug fix): `schPointerDown` now only runs for the first finger — previously every finger of a pinch/two-finger tap fired schematic tap actions (pinching with the symbol tool could place parts).
- Cache-bust ?v=23→?v=24 (23 refs in index.html, new `js/gestures.js` tag before keys.js); sw CACHE kipad-v17→v18, './js/gestures.js' added to ASSETS. Help modal + Shortcuts modal gained a Touch line.
- Tests: `test/test_gestures.js` (24 checks: clean tap fires once + no double-fire, single-tap isolation & reuse, late second finger restarts tracking from it, gap/duration boundary inclusivity, drag disarming by either finger incl. after partner lifted, sub-slop wiggle ok, three-finger reset + recovery, cancel, unknown ids ignored, custom options). All **22 suites green**; node --check clean on touched files.
- Remaining in this milestone: haptics (iOS Safari has no navigator.vibrate — needs a strategy), Apple Pencil tilt/eraser.
- Push status: branch main is 2 commits ahead of origin (7dcfa41 keyboard parity + cbbf5ba this feature). Direct `git push` impossible (no stored credentials, prompts disabled) and ClawLink's GitHub tools take inline file contents only — the union diff carries the regenerated lib/symbols.json (425 KB) + lib/footprints.json (267 KB), ~1 MB total, too large for a single tool call. Needs either a chunked blob-upload sequence or an Avery-side push.
