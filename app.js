/* FrogSchem — touch-first schematic editor
 * Vanilla JS, no dependencies. Canvas-based.
 */
'use strict';

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = n => (Math.round(n * 100) / 100).toString();

// ---------- Component definitions ----------
// Each type: { draw(ctx), pins(): [[x,y]...], w, h, defName, defVal, oneShot? }
const COMPONENTS = {
  R: {
    name: 'Resistor', defName: 'R', defVal: '1k',
    w: 2.4, h: 0.8,
    draw(ctx, c) {
      const u = 1; const z = 0.28;
      ctx.beginPath();
      ctx.moveTo(-c.w/2, 0);
      for (let i = 0; i < 6; i++) {
        const x = -c.w/2 + u * (i + 0.5);
        ctx.lineTo(x, (i % 2 === 0 ? -z : z));
      }
      ctx.lineTo(c.w/2, 0);
      ctx.stroke();
    },
    pins() { return [[-1, 0], [1, 0]]; }
  },
  C: {
    name: 'Capacitor', defName: 'C', defVal: '100n',
    w: 1.6, h: 0.9,
    draw(ctx) {
      ctx.beginPath(); ctx.moveTo(-0.8, 0); ctx.lineTo(-0.18, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.18, -0.42); ctx.lineTo(-0.18, 0.42); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.18, -0.42); ctx.lineTo(0.18, 0.42); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.18, 0); ctx.lineTo(0.8, 0); ctx.stroke();
    },
    pins() { return [[-1, 0], [1, 0]]; }
  },
  CP: {
    name: 'Polarized Cap', defName: 'C', defVal: '10u',
    w: 1.6, h: 0.9,
    draw(ctx) {
      ctx.beginPath(); ctx.moveTo(-0.8, 0); ctx.lineTo(-0.18, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.18, -0.42); ctx.lineTo(-0.18, 0.42); ctx.stroke();
      ctx.beginPath(); ctx.arc(0.18, 0, 0.42, Math.PI * 0.5, Math.PI * 1.5, true); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.18, 0); ctx.lineTo(0.8, 0); ctx.stroke();
      ctx.fillText('+', -0.35, -0.5);
    },
    pins() { return [[-1, 0], [1, 0]]; }
  },
  L: {
    name: 'Inductor', defName: 'L', defVal: '10m',
    w: 2.4, h: 0.6,
    draw(ctx) {
      ctx.beginPath(); ctx.moveTo(-1.2, 0);
      for (let i = 0; i < 4; i++) {
        ctx.arc(-0.6 + i * 0.4, 0, 0.2, Math.PI, 0, false);
      }
      ctx.lineTo(1.2, 0); ctx.stroke();
    },
    pins() { return [[-1, 0], [1, 0]]; }
  },
  D: {
    name: 'Diode', defName: 'D', defVal: '',
    w: 1.8, h: 1.0,
    draw(ctx) {
      ctx.beginPath(); ctx.moveTo(-0.9, 0); ctx.lineTo(-0.25, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.25, -0.5); ctx.lineTo(0.35, 0); ctx.lineTo(-0.25, 0.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0.35, -0.5); ctx.lineTo(0.35, 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.35, 0); ctx.lineTo(0.9, 0); ctx.stroke();
    },
    pins() { return [[-1, 0], [1, 0]]; }
  },
  LED: {
    name: 'LED', defName: 'LED', defVal: '',
    w: 1.8, h: 1.2,
    draw(ctx) {
      ctx.beginPath(); ctx.moveTo(-0.9, 0); ctx.lineTo(-0.25, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.25, -0.5); ctx.lineTo(0.35, 0); ctx.lineTo(-0.25, 0.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0.35, -0.5); ctx.lineTo(0.35, 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.35, 0); ctx.lineTo(0.9, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.1, -0.75); ctx.lineTo(0.15, -1.1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.25, -0.75); ctx.lineTo(0.5, -1.1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.05, -0.9); ctx.lineTo(0.35, -0.9); ctx.stroke();
    },
    pins() { return [[-1, 0], [1, 0]]; }
  },
  Z: {
    name: 'Zener', defName: 'D', defVal: '5.1V',
    w: 1.8, h: 1.0,
    draw(ctx) {
      ctx.beginPath(); ctx.moveTo(-0.9, 0); ctx.lineTo(-0.25, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.25, -0.5); ctx.lineTo(0.35, 0); ctx.lineTo(-0.25, 0.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0.35, -0.5); ctx.lineTo(0.35, 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.35, -0.45); ctx.lineTo(0.55, -0.15); ctx.lineTo(0.35, 0.15); ctx.lineTo(0.55, 0.45); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.35, 0); ctx.lineTo(0.9, 0); ctx.stroke();
    },
    pins() { return [[-1, 0], [1, 0]]; }
  },
  QN: {
    name: 'NPN', defName: 'Q', defVal: '',
    w: 2.0, h: 1.6,
    draw(ctx) {
      ctx.beginPath(); ctx.arc(0, 0, 0.8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1.0, -0.55); ctx.lineTo(-0.3, -0.55); ctx.stroke(); // base
      ctx.beginPath(); ctx.moveTo(0.3, -0.55); ctx.lineTo(0.3, -0.15); ctx.lineTo(0.8, -0.15); ctx.stroke(); // collector
      ctx.beginPath(); ctx.moveTo(0.3, 0.15); ctx.lineTo(0.3, 0.55); ctx.lineTo(0.8, 0.55); ctx.stroke(); // emitter
      ctx.beginPath(); ctx.moveTo(0.1, 0.55); ctx.lineTo(0.45, 0.2); ctx.stroke(); // arrow
      ctx.beginPath(); ctx.moveTo(0.1, 0.15); ctx.lineTo(0.1, 0.55); ctx.stroke();
    },
    pins() { return [[-1, -0.55], [1, -0.15], [1, 0.55]]; }
  },
  QP: {
    name: 'PNP', defName: 'Q', defVal: '',
    w: 2.0, h: 1.6,
    draw(ctx) {
      ctx.beginPath(); ctx.arc(0, 0, 0.8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1.0, -0.55); ctx.lineTo(-0.3, -0.55); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.3, -0.55); ctx.lineTo(0.3, -0.15); ctx.lineTo(0.8, -0.15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.3, 0.15); ctx.lineTo(0.3, 0.55); ctx.lineTo(0.8, 0.55); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.1, 0.55); ctx.lineTo(0.45, 0.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.45, 0.55); ctx.lineTo(0.45, 0.15); ctx.stroke();
    },
    pins() { return [[-1, -0.55], [1, -0.15], [1, 0.55]]; }
  },
  OP: {
    name: 'OpAmp', defName: 'U', defVal: '',
    w: 2.2, h: 1.8,
    draw(ctx) {
      ctx.beginPath(); ctx.moveTo(-1.1, -0.9); ctx.lineTo(0.7, 0); ctx.lineTo(-1.1, 0.9); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1.1, -0.45); ctx.lineTo(-0.7, -0.45); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1.1, 0.45); ctx.lineTo(-0.7, 0.45); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.7, 0); ctx.lineTo(1.1, 0); ctx.stroke();
      ctx.fillText('-', -0.95, -0.35);
      ctx.fillText('+', -0.95, 0.62);
    },
    pins() { return [[-1, -0.45], [-1, 0.45], [1, 0]]; }
  },
  V: {
    name: 'Voltage Source', defName: 'V', defVal: '5V',
    w: 2.0, h: 1.2,
    draw(ctx) {
      ctx.beginPath(); ctx.arc(0, 0, 0.6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1.0, 0); ctx.lineTo(-0.6, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.6, 0); ctx.lineTo(1.0, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.18, -0.18); ctx.lineTo(-0.18, 0.18); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.12, -0.18); ctx.lineTo(0.12, 0.18); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.05, 0); ctx.lineTo(0.19, 0); ctx.stroke();
    },
    pins() { return [[-1, 0], [1, 0]]; }
  },
  I: {
    name: 'Current Source', defName: 'I', defVal: '1mA',
    w: 2.0, h: 1.2,
    draw(ctx) {
      ctx.beginPath(); ctx.arc(0, 0, 0.6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1.0, 0); ctx.lineTo(-0.6, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.6, 0); ctx.lineTo(1.0, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.2, 0); ctx.lineTo(-0.2, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0.2); ctx.lineTo(0, -0.2); ctx.stroke();
    },
    pins() { return [[-1, 0], [1, 0]]; }
  },
  GND: {
    name: 'Ground', defName: 'GND', defVal: '', oneShot: true,
    w: 1.0, h: 1.2,
    draw(ctx) {
      ctx.beginPath(); ctx.moveTo(0, -1.0); ctx.lineTo(0, -0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.45, -0.3); ctx.lineTo(0.45, -0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.28, 0); ctx.lineTo(0.28, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.12, 0.3); ctx.lineTo(0.12, 0.3); ctx.stroke();
    },
    pins() { return [[0, -1]]; }
  },
  VCC: {
    name: 'VCC', defName: 'VCC', defVal: '5V', oneShot: true,
    w: 1.0, h: 1.2,
    draw(ctx) {
      ctx.beginPath(); ctx.moveTo(0, 1.0); ctx.lineTo(0, 0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.45, 0.3); ctx.lineTo(0.45, 0.3); ctx.stroke();
      ctx.fillText(ctx._name || 'VCC', 0.3, 0.85);
    },
    pins() { return [[0, 1]]; }
  },
  SW: {
    name: 'Switch', defName: 'SW', defVal: '',
    w: 2.2, h: 0.8,
    draw(ctx) {
      ctx.beginPath(); ctx.moveTo(-1.1, 0); ctx.lineTo(-0.2, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.15, 0.05); ctx.lineTo(0.8, 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.9, 0); ctx.lineTo(1.1, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(-0.05, 0, 0.12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0.95, 0, 0.12, 0, Math.PI * 2); ctx.stroke();
    },
    pins() { return [[-1, 0], [1, 0]]; }
  },
  T: {
    name: 'Label', defName: 'TEXT', defVal: 'text', textOnly: true,
    w: 2.0, h: 0.5,
    draw(ctx, c) { ctx.fillText(c.value || 'text', -0.8, 0.35); },
    pins() { return [[0, 0]]; }
  },
};

// ---------- State ----------
let comps = [];       // {id, type, x, y, rot, name, value}
let wires = [];       // {id, pts: [[x,y],...]}
let view = { x: 0, y: 0, zoom: 1.4 };
let tool = 'select';  // select | wire | pan
let sel = null;       // selected component id
let selWire = null;   // selected wire id
let undoStack = [];
let redoStack = [];
let nextId = 1;
let wirePts = [];     // in-progress wire
let paletteType = null; // type to place
let moving = null;    // {id, dx, dy}
let moved = false;
let pinchDist = null;
let panning = false;
let lastPan = null;
let propsVisible = false;

const canvas = $('canvas');
const ctx2 = canvas.getContext('2d');
const GRID = 0.5;

function snapshot() {
  return JSON.stringify({ comps, wires, nextId });
}
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}
function restore(s) {
  const data = JSON.parse(s);
  comps = data.comps; wires = data.wires; nextId = data.nextId;
  sel = null; selWire = null; wirePts = [];
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  render(); updateProps();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  render(); updateProps();
}

// ---------- Coordinate transforms ----------
function w2s(p) {
  return [(p[0] - view.x) * view.zoom + canvas.width / 2,
          (p[1] - view.y) * view.zoom + canvas.height / 2];
}
function s2w(sx, sy) {
  return [(sx - canvas.width / 2) / view.zoom + view.x,
          (sy - canvas.height / 2) / view.zoom + view.y];
}
function snap(v) { return Math.round(v / GRID) * GRID; }

// ---------- Rendering ----------
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function drawGrid() {
  const topleft = s2w(0, 0), botright = s2w(canvas.width, canvas.height);
  ctx2.strokeStyle = '#1e293b';
  ctx2.lineWidth = 1;
  for (let gx = Math.floor(topleft[0] / GRID) * GRID; gx <= botright[0]; gx += GRID) {
    const [sx] = w2s([gx, 0]);
    ctx2.beginPath(); ctx2.moveTo(sx, 0); ctx2.lineTo(sx, canvas.height); ctx2.stroke();
  }
  for (let gy = Math.floor(topleft[1] / GRID) * GRID; gy <= botright[1]; gy += GRID) {
    const [, sy] = w2s([0, gy]);
    ctx2.beginPath(); ctx2.moveTo(0, sy); ctx2.lineTo(canvas.width, sy); ctx2.stroke();
  }
}

function drawComp(c) {
  const def = COMPONENTS[c.type];
  if (!def) return;
  ctx2.save();
  const [sx, sy] = w2s([c.x, c.y]);
  ctx2.translate(sx, sy);
  ctx2.rotate(c.rot * Math.PI / 180);
  ctx2.scale(view.zoom, view.zoom);
  ctx2.strokeStyle = (c.id === sel) ? '#22d3ee' : '#f8fafc';
  ctx2.fillStyle = (c.id === sel) ? '#22d3ee' : '#f8fafc';
  ctx2.lineWidth = 2 / view.zoom;
  ctx2.font = `${11 / view.zoom}px -apple-system, sans-serif`;
  ctx2.textAlign = 'center';
  ctx2._name = c.name;
  def.draw(ctx2, c);
  ctx2.restore();

  // name/value labels
  ctx2.save();
  const [lx, ly] = w2s([c.x, c.y + def.h / 2 + 0.25]);
  ctx2.fillStyle = '#94a3b8';
  ctx2.font = `${11 / view.zoom}px -apple-system, sans-serif`;
  ctx2.textAlign = 'center';
  ctx2.fillText(c.name, lx, ly);
  if (c.value) {
    const [vx, vy] = w2s([c.x, c.y - def.h / 2 - 0.2]);
    ctx2.fillText(c.value, vx, vy);
  }
  ctx2.restore();
}

function drawWires() {
  ctx2.strokeStyle = '#f8fafc';
  ctx2.lineWidth = 1.6;
  for (const w of wires) {
    ctx2.beginPath();
    for (let i = 0; i < w.pts.length; i++) {
      const [sx, sy] = w2s(w.pts[i]);
      if (i === 0) ctx2.moveTo(sx, sy); else ctx2.lineTo(sx, sy);
    }
    ctx2.stroke();
    // junction dots
    for (const p of w.pts) {
      const [jx, jy] = w2s(p);
      ctx2.beginPath(); ctx2.arc(jx, jy, 3, 0, Math.PI * 2); ctx2.fillStyle = '#f8fafc'; ctx2.fill();
    }
  }
  // in-progress wire
  if (wirePts.length) {
    ctx2.setLineDash([4, 4]);
    ctx2.beginPath();
    for (let i = 0; i < wirePts.length; i++) {
      const [sx, sy] = w2s(wirePts[i]);
      if (i === 0) ctx2.moveTo(sx, sy); else ctx2.lineTo(sx, sy);
    }
    ctx2.stroke();
    ctx2.setLineDash([]);
  }
}

function hitComp(wx, wy) {
  for (let i = comps.length - 1; i >= 0; i--) {
    const c = comps[i];
    const def = COMPONENTS[c.type];
    const dx = wx - c.x, dy = wy - c.y;
    // rotate hit test
    const rad = -c.rot * Math.PI / 180;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (Math.abs(rx) <= def.w / 2 + 0.15 && Math.abs(ry) <= def.h / 2 + 0.15) return c;
  }
  return null;
}

function hitWire(wx, wy) {
  const tol = 0.15;
  for (const w of wires) {
    for (let i = 0; i < w.pts.length - 1; i++) {
      const [x1, y1] = w.pts[i], [x2, y2] = w.pts[i + 1];
      const dx = x2 - x1, dy = y2 - y1;
      const L2 = dx * dx + dy * dy;
      let t = L2 ? ((wx - x1) * dx + (wy - y1) * dy) / L2 : 0;
      t = clamp(t, 0, 1);
      const px = x1 + t * dx, py = y1 + t * dy;
      if ((wx - px) ** 2 + (wy - py) ** 2 < tol * tol) return w;
    }
  }
  return null;
}

function render() {
  ctx2.clearRect(0, 0, canvas.width, canvas.height);
  ctx2.fillStyle = '#0f172a';
  ctx2.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  drawWires();
  for (const c of comps) drawComp(c);
  $('hud-pos').textContent = fmt(view.x) + ', ' + fmt(view.y);
  $('hud-zoom').textContent = Math.round(view.zoom * 100) + '%';
}

// ---------- Placement / selection ----------
function placeComponent(type, wx, wy) {
  const def = COMPONENTS[type];
  pushUndo();
  const c = {
    id: 'c' + (nextId++), type,
    x: snap(wx), y: snap(wy), rot: 0,
    name: def.defName, value: def.defVal
  };
  comps.push(c);
  if (!def.oneShot) { sel = c.id; paletteType = null; }
  else { sel = null; }
  render(); updateProps();
}

function updateProps() {
  const bar = $('propsbar');
  const c = comps.find(x => x.id === sel);
  if (c) {
    bar.classList.remove('hidden');
    $('prop-name').value = c.name;
    $('prop-value').value = c.value || '';
    propsVisible = true;
  } else {
    bar.classList.add('hidden');
    propsVisible = false;
  }
}

// ---------- Pointer handling ----------
const pointers = new Map();
let lastTap = 0;

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const [wx, wy] = s2w(e.clientX, e.clientY);

  if (pointers.size === 2) {
    const [p1, p2] = [...pointers.values()];
    pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    return;
  }

  if (paletteType) {
    placeComponent(paletteType, wx, wy);
    return;
  }

  if (tool === 'wire') {
    const c = hitComp(wx, wy);
    if (c && wirePts.length === 0) {
      // snap to nearest pin
      const def = COMPONENTS[c.type];
      let best = null, bd = 1e9;
      for (const p of def.pins()) {
        const rad = c.rot * Math.PI / 180;
        const px = c.x + p[0] * Math.cos(rad) - p[1] * Math.sin(rad);
        const py = c.y + p[0] * Math.sin(rad) + p[1] * Math.cos(rad);
        const d = (px - wx) ** 2 + (py - wy) ** 2;
        if (d < bd) { bd = d; best = [px, py]; }
      }
      if (best) { wirePts.push(best); }
    } else {
      wirePts.push([snap(wx), snap(wy)]);
    }
    render();
    return;
  }

  if (tool === 'pan') {
    panning = true;
    lastPan = { x: e.clientX, y: e.clientY };
    return;
  }

  // select tool
  const c = hitComp(wx, wy);
  if (c) {
    sel = c.id; selWire = null;
    moving = { id: c.id, dx: wx - c.x, dy: wy - c.y };
    moved = false;
  } else {
    const w = hitWire(wx, wy);
    if (w) { selWire = w.id; sel = null; }
    else {
      sel = null; selWire = null;
      panning = true;
      lastPan = { x: e.clientX, y: e.clientY };
    }
  }
  render(); updateProps();
});

canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    const [p1, p2] = [...pointers.values()];
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    if (pinchDist) {
      const mid = [(p1.x + p2.x) / 2, (p1.y + p2.y) / 2];
      const factor = d / pinchDist;
      const [mw, mwy] = s2w(mid[0], mid[1]);
      view.zoom = clamp(view.zoom * factor, 0.3, 8);
      const [nw, nwy] = s2w(mid[0], mid[1]);
      view.x += mw - nw; view.y += mwy - nwy;
      pinchDist = d;
      render();
    }
    return;
  }

  if (panning && lastPan) {
    const dx = (e.clientX - lastPan.x) / view.zoom;
    const dy = (e.clientY - lastPan.y) / view.zoom;
    view.x -= dx; view.y -= dy;
    lastPan = { x: e.clientX, y: e.clientY };
    render();
    return;
  }

  if (moving) {
    const [wx, wy] = s2w(e.clientX, e.clientY);
    const c = comps.find(x => x.id === moving.id);
    if (c) {
      c.x = snap(wx - moving.dx);
      c.y = snap(wy - moving.dy);
      moved = true;
      render();
    }
  }
});

canvas.addEventListener('pointerup', e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = null;

  if (moving) {
    if (moved) pushUndo();
    moving = null;
    return;
  }
  if (panning) {
    panning = false;
    lastPan = null;
  }

  // double-tap to finish wire
  const now = Date.now();
  if (tool === 'wire' && wirePts.length && now - lastTap < 350) {
    finishWire();
  }
  lastTap = now;
});

canvas.addEventListener('pointercancel', e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = null;
  moving = null; panning = false; lastPan = null;
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const [mx, my] = [e.clientX, e.clientY];
  const [mw] = s2w(mx, my), [mwy] = s2w(mx, my);
  view.zoom = clamp(view.zoom * factor, 0.3, 8);
  const [nw] = s2w(mx, my), [, nwy] = s2w(mx, my);
  view.x += mw - nw; view.y += mwy - nwy;
  render();
}, { passive: false });

// ---------- Wire finishing ----------
function finishWire() {
  if (wirePts.length < 2) { wirePts = []; render(); return; }
  pushUndo();
  wires.push({ id: 'w' + (nextId++), pts: wirePts.slice() });
  wirePts = [];
  render();
}

// ---------- Toolbar ----------
function setTool(t) {
  tool = t;
  paletteType = null;
  document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
  $('tool-' + t).classList.add('active');
  render();
}

function buildPalette() {
  const grid = $('palette-grid');
  grid.innerHTML = '';
  for (const [type, def] of Object.entries(COMPONENTS)) {
    const item = document.createElement('div');
    item.className = 'pal-item';
    const cvs = document.createElement('canvas');
    cvs.width = 44; cvs.height = 44;
    const g = cvs.getContext('2d');
    g.strokeStyle = '#f8fafc'; g.fillStyle = '#f8fafc';
    g.lineWidth = 2;
    g.translate(22, 22);
    g.scale(0.9, 0.9);
    g.font = '10px sans-serif';
    g.textAlign = 'center';
    def.draw(g, { x: 0, y: 0, rot: 0, name: def.defName, value: def.defVal });
    const span = document.createElement('span');
    span.textContent = def.name;
    item.appendChild(cvs);
    item.appendChild(span);
    item.addEventListener('pointerdown', e => {
      e.stopPropagation();
      paletteType = (paletteType === type) ? null : type;
      document.querySelectorAll('.pal-item').forEach(p => p.style.borderColor = 'transparent');
      if (paletteType) item.style.borderColor = '#22d3ee';
    });
    grid.appendChild(item);
  }
}

// ---------- Actions ----------
function doDelete() {
  if (sel) {
    pushUndo();
    comps = comps.filter(c => c.id !== sel);
    sel = null;
  } else if (selWire) {
    pushUndo();
    wires = wires.filter(w => w.id !== selWire);
    selWire = null;
  }
  render(); updateProps();
}
function doRotate() {
  const c = comps.find(x => x.id === sel);
  if (!c) return;
  pushUndo();
  c.rot = (c.rot + 90) % 360;
  render();
}
function doDuplicate() {
  const c = comps.find(x => x.id === sel);
  if (!c) return;
  pushUndo();
  const nc = { ...c, id: 'c' + (nextId++), x: c.x + 1, y: c.y + 1 };
  comps.push(nc);
  sel = nc.id;
  render(); updateProps();
}
function doZoomFit() {
  if (!comps.length) { view = { x: 0, y: 0, zoom: 1.4 }; render(); return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const c of comps) {
    const def = COMPONENTS[c.type];
    x0 = Math.min(x0, c.x - def.w / 2); x1 = Math.max(x1, c.x + def.w / 2);
    y0 = Math.min(y0, c.y - def.h / 2); y1 = Math.max(y1, c.y + def.h / 2);
  }
  const z = clamp(Math.min(canvas.width / (x1 - x0 + 2), canvas.height / (y1 - y0 + 2)), 0.3, 8);
  view = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: z };
  render();
}

// ---------- Save / load ----------
const LS_KEY = 'frogschem-project';
function saveLocal() {
  localStorage.setItem(LS_KEY, JSON.stringify({
    comps, wires, nextId, view
  }));
}
function loadLocal() {
  try {
    const data = JSON.parse(localStorage.getItem(LS_KEY));
    if (data && data.comps) {
      comps = data.comps; wires = data.wires || [];
      nextId = data.nextId || 1;
      view = data.view || view;
    }
  } catch (e) { /* ignore */ }
}
function doSave() {
  const data = JSON.stringify({ comps, wires, nextId }, null, 1);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'schematic.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
function doOpen(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      pushUndo();
      comps = data.comps || []; wires = data.wires || [];
      nextId = data.nextId || 1;
      sel = null; selWire = null;
      render(); updateProps();
    } catch (e) { alert('Could not open file'); }
  };
  reader.readAsText(file);
}
function doExportSVG() {
  const GRIDPX = 10;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="-300 -300 600 600" style="background:#0f172a">\n`;
  svg += `<g stroke="#f8fafc" stroke-width="2" fill="none">\n`;
  for (const w of wires) {
    svg += `<polyline points="${w.pts.map(p => (p[0] * GRIDPX) + ',' + (p[1] * GRIDPX)).join(' ')}"/>\n`;
    for (const p of w.pts) {
      svg += `<circle cx="${p[0] * GRIDPX}" cy="${p[1] * GRIDPX}" r="2.5" fill="#f8fafc" stroke="none"/>\n`;
    }
  }
  svg += `</g>\n<g fill="none" stroke="#f8fafc" stroke-width="2">\n`;
  for (const c of comps) {
    svg += `<g transform="translate(${c.x * GRIDPX},${c.y * GRIDPX}) rotate(${c.rot})">\n`;
    const def = COMPONENTS[c.type];
    // crude: draw bounding box + label as placeholder for arbitrary shapes
    svg += `<rect x="${-def.w / 2 * GRIDPX}" y="${-def.h / 2 * GRIDPX}" width="${def.w * GRIDPX}" height="${def.h * GRIDPX}" fill="#0f172a" stroke="#22d3ee" stroke-dasharray="3,3" opacity="0.35"/>\n`;
    svg += `<text x="0" y="0" fill="#f8fafc" stroke="none" font-family="sans-serif" font-size="10" text-anchor="middle">${c.type}</text>\n`;
    svg += `<text x="0" y="${(def.h / 2 + 0.25) * GRIDPX}" fill="#94a3b8" stroke="none" font-family="sans-serif" font-size="9" text-anchor="middle">${c.name}${c.value ? ' ' + c.value : ''}</text>\n`;
    svg += `</g>\n`;
  }
  svg += `</g></svg>\n`;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'schematic.svg';
  a.click();
  URL.revokeObjectURL(a.href);
}
function doExportPNG() {
  const off = document.createElement('canvas');
  off.width = 800; off.height = 600;
  const g = off.getContext('2d');
  g.fillStyle = '#0f172a'; g.fillRect(0, 0, 800, 600);
  const savedView = view;
  view = { x: 0, y: 0, zoom: 1 };
  // scale drawing: temporarily render into offscreen with our renderer
  // (simplified: use 10px per unit)
  const GRIDPX = 10;
  g.strokeStyle = '#f8fafc'; g.lineWidth = 2;
  for (const w of wires) {
    g.beginPath();
    for (let i = 0; i < w.pts.length; i++) {
      const x = 400 + w.pts[i][0] * GRIDPX, y = 300 + w.pts[i][1] * GRIDPX;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.font = '12px sans-serif'; g.textAlign = 'center';
  g.fillStyle = '#f8fafc';
  for (const c of comps) {
    const x = 400 + c.x * GRIDPX, y = 300 + c.y * GRIDPX;
    g.save(); g.translate(x, y); g.rotate(c.rot * Math.PI / 180);
    g.strokeRect(-COMPONENTS[c.type].w / 2 * GRIDPX, -COMPONENTS[c.type].h / 2 * GRIDPX,
                 COMPONENTS[c.type].w * GRIDPX, COMPONENTS[c.type].h * GRIDPX);
    g.fillStyle = '#94a3b8';
    g.fillText(c.name, 0, COMPONENTS[c.type].h / 2 * GRIDPX + 14);
    g.fillStyle = '#f8fafc';
    g.restore();
  }
  view = savedView;
  off.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'schematic.png';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ---------- Modal ----------
function showModal(title, body) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = body;
  $('modal').classList.remove('hidden');
}
function hideModal() { $('modal').classList.add('hidden'); }

// ---------- Wire up ----------
$('tool-select').addEventListener('click', () => setTool('select'));
$('tool-wire').addEventListener('click', () => setTool('wire'));
$('tool-pan').addEventListener('click', () => setTool('pan'));
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-zoomfit').addEventListener('click', doZoomFit);
$('btn-new').addEventListener('click', () => {
  if (comps.length && !confirm('Clear the schematic?')) return;
  pushUndo();
  comps = []; wires = []; sel = null; selWire = null;
  render(); updateProps();
});
$('btn-save').addEventListener('click', doSave);
$('btn-export').addEventListener('click', () => {
  showModal('Export', `
    <button class="btn" style="width:100%;margin-bottom:8px" onclick="doExportSVG();hideModal()">Export SVG</button>
    <button class="btn" style="width:100%" onclick="doExportPNG();hideModal()">Export PNG</button>
  `);
});
$('btn-open').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => { if (inp.files[0]) doOpen(inp.files[0]); };
  inp.click();
});
$('btn-help').addEventListener('click', () => {
  showModal('FrogSchem', `
    <b>Tools</b><br>
    &#9654; Select — tap to select, drag to move, tap empty to pan<br>
    &#8270; Wire — tap to place points, double-tap to finish<br>
    &#9998; Pan — drag to pan (also pinch on iPad)<br><br>
    <b>Place components</b> — tap one in the palette, then tap the canvas.<br>
    <b>Selected component</b> — edit ref/value, rotate, copy, delete.<br>
    <b>Save</b> downloads JSON, <b>Export</b> gives SVG/PNG.<br>
    Works offline. Add to Home Screen for fullscreen mode.
  `);
});
$('modal-cancel').addEventListener('click', hideModal);
$('modal-ok').addEventListener('click', hideModal);
$('prop-rotate').addEventListener('click', doRotate);
$('prop-dupe').addEventListener('click', doDuplicate);
$('prop-del').addEventListener('click', doDelete);
$('prop-done').addEventListener('click', () => { sel = null; updateProps(); render(); });
$('prop-name').addEventListener('change', e => {
  const c = comps.find(x => x.id === sel);
  if (c) { c.name = e.target.value || c.name; render(); }
});
$('prop-value').addEventListener('change', e => {
  const c = comps.find(x => x.id === sel);
  if (c) { c.value = e.target.value; render(); }
});

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'v' || e.key === 'V') setTool('select');
  if (e.key === 'w' || e.key === 'W') setTool('wire');
  if (e.key === 'h' || e.key === 'H') setTool('pan');
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); doDelete(); }
  if (e.key === 'r' || e.key === 'R') doRotate();
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
  if (e.key === 'Enter' && tool === 'wire') finishWire();
  if (e.key === 'Escape') {
    if (wirePts.length) { wirePts = []; render(); }
    else if (paletteType) { paletteType = null; document.querySelectorAll('.pal-item').forEach(p => p.style.borderColor = 'transparent'); }
    else if (sel || selWire) { sel = null; selWire = null; updateProps(); render(); }
  }
});

// autosave
setInterval(saveLocal, 3000);
window.addEventListener('beforeunload', saveLocal);

// ---------- Init ----------
loadLocal();
buildPalette();
setTool('select');
window.addEventListener('resize', resize);
resize();
render();

// Expose for inline handlers
window.doSave = doSave;
window.doExportSVG = doExportSVG;
window.doExportPNG = doExportPNG;
window.hideModal = hideModal;
