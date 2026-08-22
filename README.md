# FrogSchem 🐸⚡

Touch-first electrical schematic editor that runs in the browser — built for iPad (and anything else with a screen).

Draw circuit diagrams with your fingers or Apple Pencil, then export them as SVG/PNG or JSON. Works offline, installs to your home screen like a native app.

## Try it

Open `index.html` in any browser, or host the folder on any static server. On iPad:

1. Open the site in Safari
2. Tap **Share → Add to Home Screen**
3. Launch FrogSchem fullscreen, works offline

## Features

- **Components**: resistor, capacitor (polarized), inductor, diode, LED, zener, NPN/PNP BJT, op-amp, voltage/current sources, ground, VCC, switch, labels
- **Wire tool**: tap to place points, double-tap to finish; junction dots at every vertex
- **Pan/zoom**: one-finger pan, pinch zoom (touch), scroll-wheel zoom + middle-drag (desktop)
- **Edit**: move, rotate (90°), duplicate, delete; edit ref designator + value in the bottom bar
- **Undo/redo** (Ctrl+Z / Ctrl+Y)
- **Persistence**: autosaves to localStorage every 3s
- **Export**: SVG, PNG, or JSON project files (Save/Open)
- **PWA**: installable, offline via service worker, dark theme

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `V` | Select tool |
| `W` | Wire tool |
| `H` | Pan tool |
| `R` | Rotate selected |
| `Del` | Delete selected |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Enter` | Finish wire |
| `Esc` | Cancel |

## Project structure

- `index.html` — app shell
- `style.css` — dark theme, safe-area aware
- `app.js` — the whole editor (no dependencies)
- `manifest.webmanifest` + `sw.js` — PWA/offline
- `make_icons.py` — regenerates the PNG icons (stdlib only)

## Roadmap

- Real schematic symbol rendering for SVG export (currently boxes + labels)
- SPICE netlist export
- More components (MOSFETs, transformers, ICs)
- Multi-page schematics

MIT License
