# Kipad — KiCad-style electronics design for iPad

Kipad is an installable, offline-capable PWA for schematic capture and 2-layer PCB layout. It is touch-first, Apple Pencil-aware, and reads and writes KiCad file formats directly in the browser.

**Live app:** https://averyizatt.github.io/kipad/

On iPad, open the live app in Safari and choose **Share → Add to Home Screen**.

## Highlights

- **Schematic editor** — 2,000 built-in KiCad symbols, wires, junctions, labels, no-connect flags, symbol properties, footprint assignment, ERC, BOM and KiCad netlist export
- **PCB editor** — roughly 160 built-in KiCad footprints, interactive net-aware routing, vias and mid-route layer switching, copper zones, ratsnest, net classes and configurable track/via sizes
- **Selection and input** — group move/rotate/delete, desktop rubber-band selection, touch long-press box selection, keyboard shortcuts, pinch zoom, two-finger undo, Pencil tilt display and eraser support
- **KiCad interoperability** — open/save `.kicad_sch` and `.kicad_pcb`, import/export `.kicad_sym` and `.kicad_mod`, preserve unsupported PCB S-expression nodes where possible
- **Fabrication outputs** — nine Gerber layers (copper, Edge.Cuts, mask, paste and stroked silkscreen text), Excellon drill files and per-side pick-and-place files
- **Project tools** — symbol and footprint library editors, Gerber viewer, PCB calculator, autosave, validated downloads and ZIP project export
- **Offline PWA** — service-worker updates, local custom libraries and project state persist on-device

## Project layout

```text
index.html / style.css       application shell and KiCad-inspired UI
js/app.part1.js..part4.js    editor state, input, commands and menus
js/schematic.js              schematic model and KiCad schematic I/O
js/board.js                  PCB model, geometry, DRC and ratsnest
js/kicad_pcb.js              KiCad PCB parser and serializer
js/kicad_sym.js              KiCad symbol parser and serializer
js/kicad_mod.js              KiCad footprint parser and serializer
js/render.js                 canvas renderer
js/gerber.js                 nine-layer RS-274X exporter
js/erc.js / js/zones.js      electrical checks and copper-zone fill
js/editors.js                symbol and footprint library editors
lib/                         generated built-in symbol/footprint libraries
lib-build/                   library generators and real KiCad fixtures
test/                        dependency-free Node regression suites
sw.js                        offline asset cache and update lifecycle
```

Most modules use UMD exports so the same implementation runs as browser globals and CommonJS modules in Node.

## Development

Requirements: a current Node.js release and any static HTTP server. The test suite has no npm dependencies.

```bash
git clone https://github.com/averyizatt/kipad.git
cd kipad

# Run every regression suite.
for test_file in test/test_*.js; do node "$test_file" || exit 1; done

# Serve locally; service workers do not run from file:// URLs.
python3 -m http.server 8080
```

Then open `http://localhost:8080`. To regenerate the bundled libraries:

```bash
node lib-build/build-symbols.js
node lib-build/build-footprints.js
```

When adding or renaming a browser asset, also update `sw.js`. Bump both the query-string asset version in `index.html` and the cache name in `sw.js` for deploys that change cached files.

## Status

Kipad is an independent browser editor inspired by KiCad. It is useful for touch-first design and interoperability, but it is not affiliated with or a replacement for KiCad's full desktop toolchain. Current automated coverage comprises 44 Node regression suites, including real-file parse/save and headless load-and-render checks.

MIT licensed.
