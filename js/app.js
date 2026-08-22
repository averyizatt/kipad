/* Kipad — KiCad-like PCB editor for iPad. Main app logic. */
'use strict';

(function () {
  const B = window.KipadBoard;
  const R = window.KipadRender;
  const Pcb = window.KipadPcb;
  const Gerber = window.KipadGerber;
  const FPs = window.KipadFootprints;

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  // ---------- State ----------
  let board = B.makeBoard();
  let view = R.makeView();
  let tool = 'select';          // select | footprint | track | via | outline
  let layer = 'F.Cu';           // active copper layer
  let selId = null;             // selected footprint id
  let hiNet = null;             // highlighted net id
  let route = null;             // {pts, netId, layer, width}
  let outlinePts = null;        // current outline polyline being drawn
  let placeLib = null;          // footprint lib name being placed
  let placeAngle = 0;
  let trackWidth = 0.25;
  let viaSize = 0.6, viaDrill = 0.3;
  let undoStack = [], redoStack = [];
  let dragging = null;          // {fpId, dx, dy} or {pan}
  let pinchDist = null;
  let panning = false, lastPan = null;
  let pointers = new Map();
  let lastTap = 0;
  const GRID = 0.25;

  const TRACK_WIDTHS = [0.2, 0.25, 0.5, 1.0];

  // ---------- persistence ----------
  const LS_KEY = 'kipad.board';
  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ board, view, layer, trackWidth })); } catch (e) {}
  }
  function loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_KEY));
      if (d && d.board) { board = d.board; view = d.view || view; layer = d.layer || layer; trackWidth = d.trackWidth || trackWidth; }
    } catch (e) {}
  }

  // ---------- coords ----------
  let cw = 0, ch = 0; // logical (CSS px) canvas size
  function w2s(p) { return R.w2s(view, p[0], p[1], cw, ch); }
  function s2w(sx, sy) { return R.s2w(view, sx, sy, cw, ch); }
  function snap(v) { return Math.round(v / GRID) * GRID; }

  // ---------- undo ----------
  function snapshot() { return JSON.stringify(board); }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }
  function restore(s) {
    board = JSON.parse(s);
    selId = null; hiNet = null; route = null; outlinePts = null;
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    render(); refreshSidebars();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    render(); refreshSidebars();
  }

  // ---------- render ----------
  function render() {
    const state = {
      selId, hiNet,
      showRats: true,
      route: route ? { ...route, cursor: routeCursor } : null
    };
    R.render(ctx, cw, ch, board, view, state);
    $('hud-pos').textContent = fmt(view.x) + ', ' + fmt(view.y) + ' mm';
    $('hud-zoom').textContent = Math.round(view.zoom * 100 / 3) + '%';
    $('hud-tool').textContent = toolName();
    $('status-layer').textContent = 'Layer: ' + layer;
  }
  let routeCursor = null;
  function toolName() {
    return { select: 'Select', footprint: 'Footprint', track: 'Route', via: 'Via', outline: 'Outline' }[tool] || tool;
  }
  function fmt(n) { return (Math.round(n * 1000) / 1000).toString(); }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    cw = canvas.clientWidth; ch = canvas.clientHeight;
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  // ---------- sidebars ----------
  function refreshSidebars() {
    // footprints
    const fl = $('fp-list');
    fl.innerHTML = '';
    if (FPs) {
      for (const name of FPs.listFootprints()) {
        const item = document.createElement('div');
        item.className = 'side-item' + (placeLib === name ? ' active' : '');
        item.textContent = name;
        item.addEventListener('click', () => {
          setTool('footprint');
          placeLib = name; placeAngle = 0;
          refreshSidebars(); render();
          setStatus('Tap board to place ' + name + ' (R rotate, Esc stop)');
        });
        fl.appendChild(item);
      }
    }
    // nets
    const nl = $('net-list');
    nl.innerHTML = '';
    for (const n of board.nets) {
      if (n.id === 0) continue;
      const item = document.createElement('div');
      item.className = 'side-item net' + (hiNet === n.id ? ' net-hi' : '');
      item.textContent = n.name;
      item.addEventListener('click', () => {
        hiNet = (hiNet === n.id) ? null : n.id;
        refreshSidebars(); render();
      });
      nl.appendChild(item);
    }
  }
  function setStatus(t) { $('status').textContent = t; }

  // ---------- tools ----------
  function setTool(t) {
    tool = t;
    route = null; outlinePts = null; routeCursor = null;
    if (t !== 'footprint') placeLib = null;
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    const map = { select: 'tool-select', footprint: 'tool-footprint', track: 'tool-track', via: 'tool-via', outline: 'tool-outline' };
    if (map[t]) $(map[t]).classList.add('active');
    render(); refreshSidebars();
  }

  // ---------- actions ----------
  function doDelete() {
    if (!selId && !route) return;
    pushUndo();
    if (selId) {
      board.footprints = board.footprints.filter(f => f.id !== selId);
      selId = null;
    }
    render(); refreshSidebars();
  }
  function doRotateSel() {
    if (selId) { pushUndo(); B.rotateFootprint(board, selId, 90); render(); }
    else if (tool === 'footprint') { placeAngle = (placeAngle + 90) % 360; render(); }
  }
  function switchLayer() {
    layer = layer === 'F.Cu' ? 'B.Cu' : 'F.Cu';
    $('layer-label').textContent = layer;
    render();
  }

  function startRoute(x, y) {
    const hit = B.hitPad(board, x, y, 0.3);
    let netId = 0;
    if (hit) netId = hit.pad.netId;
    else if (hiNet != null) netId = hiNet;
    route = { pts: [[snap(x), snap(y)]], netId, layer, width: trackWidth };
    if (hit) route.pts = [[hit.pad.at[0], hit.pad.at[1]]];
    setStatus('Routing net "' + B.netName(board, netId) + '" — tap points, double-tap/Enter to finish, V = via+layer');
  }
  function extendRoute(x, y) {
    if (!route) return;
    const last = route.pts[route.pts.length - 1];
    const p = [snap(x), snap(y)];
    // if same point, ignore
    if (p[0] === last[0] && p[1] === last[1]) return;
    route.pts.push(p);
  }
  function finishRoute() {
    if (!route || route.pts.length < 2) { route = null; render(); return; }
    pushUndo();
    for (let i = 0; i < route.pts.length - 1; i++) {
      B.addTrack(board, route.pts[i], route.pts[i + 1], route.width, route.layer, route.netId);
    }
    route = null; routeCursor = null;
    render(); refreshSidebars(); setStatus('Track placed');
  }
  function addViaHere(x, y) {
    pushUndo();
    const netId = route ? route.netId : (hiNet != null ? hiNet : 0);
    const v = B.addVia(board, [snap(x), snap(y)], viaSize, viaDrill, netId);
    if (route) { route.layer = route.layer === 'F.Cu' ? 'B.Cu' : 'F.Cu'; }
    render(); refreshSidebars();
    return v;
  }

  function startOutline(x, y) {
    outlinePts = [[snap(x), snap(y)]];
    setStatus('Draw outline — tap corners, double-tap/Enter to close');
  }
  function extendOutline(x, y) {
    if (!outlinePts) return;
    const last = outlinePts[outlinePts.length - 1];
    const p = [snap(x), snap(y)];
    if (p[0] === last[0] && p[1] === last[1]) return;
    outlinePts.push(p);
  }
  function finishOutline() {
    if (!outlinePts || outlinePts.length < 3) { outlinePts = null; render(); return; }
    pushUndo();
    board.outline.push(outlinePts.slice());
    outlinePts = null;
    render(); refreshSidebars(); setStatus('Outline added');
  }

  // ---------- DRC ----------
  function runDRC() {
    const panel = $('drc-panel');
    const viol = B.runDRC(board);
    panel.classList.remove('hidden');
    if (!viol.length) {
      panel.innerHTML = '<h4>DRC</h4><div class="drc-clear">✓ No clearance violations</div>';
    } else {
      panel.innerHTML = '<h4>DRC — ' + viol.length + ' violation(s)</h4>' +
        viol.slice(0, 40).map(v =>
          `<div class="drc-item">${v.type} <b>${v.netA}↔${v.netB}</b> gap ${v.dist}mm (min ${v.clearance}) @${v.x},${v.y} ${v.layer}</div>`
        ).join('');
    }
  }

  // ---------- save/open/export ----------
  function doSave() {
    if (!Pcb) { setStatus('kicad_pcb module not loaded'); return; }
    const text = Pcb.serializeBoard(board);
    download('kipad.kicad_pcb', text, 'application/x-kicad-pcb');
    setStatus('Saved .kicad_pcb');
  }
  function doOpen(file) {
    if (!Pcb) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        pushUndo();
        board = Pcb.parseBoard(r.result);
        selId = null; hiNet = null; route = null; outlinePts = null;
        render(); refreshSidebars(); setStatus('Opened ' + file.name);
      } catch (e) { setStatus('Open failed: ' + e.message); }
    };
    r.readAsText(file);
  }
  function doGerber() {
    if (!Gerber) { setStatus('Gerber module not loaded'); return; }
    const out = Gerber.exportAll(board);
    for (const [l, g] of Object.entries(out)) {
      download(`kipad-${l.replace(/[^A-Za-z0-9]/g, '')}.gbr`, g, 'application/gerber');
    }
    setStatus('Gerber exported (F.Cu, B.Cu, Edge.Cuts)');
  }
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- pointer handling ----------
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [wx, wy] = s2w(e.clientX, e.clientY);

    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      return;
    }

    if (tool === 'footprint' && placeLib) {
      pushUndo();
      B.placeFootprint(board, placeLib, [snap(wx), snap(wy)], placeAngle, layer);
      selId = board.footprints[board.footprints.length - 1].id;
      render(); refreshSidebars();
      return;
    }
    if (tool === 'track') {
      if (!route) startRoute(wx, wy);
      else extendRoute(wx, wy);
      render();
      return;
    }
    if (tool === 'outline') {
      if (!outlinePts) startOutline(wx, wy);
      else extendOutline(wx, wy);
      render();
      return;
    }
    if (tool === 'via') {
      addViaHere(wx, wy);
      return;
    }

    // select tool
    const padHit = B.hitPad(board, wx, wy, 0.3);
    const fpHit = B.hitFootprint(board, wx, wy, 0.3);
    const trHit = B.hitTrack(board, wx, wy, 0.2);
    const viaHit = B.hitVia(board, wx, wy, 0.2);
    if (padHit) {
      selId = padHit.fp.id;
      hiNet = padHit.pad.netId;
      dragging = { fpId: padHit.fp.id, dx: wx - padHit.fp.at[0], dy: wy - padHit.fp.at[1] };
    } else if (fpHit) {
      selId = fpHit.id;
      dragging = { fpId: fpHit.id, dx: wx - fpHit.at[0], dy: wy - fpHit.at[1] };
    } else if (trHit) {
      selId = null;
      dragging = { pan: true };
      lastPan = { x: e.clientX, y: e.clientY };
    } else if (viaHit) {
      selId = null;
      dragging = { pan: true };
      lastPan = { x: e.clientX, y: e.clientY };
    } else {
      selId = null; hiNet = null;
      dragging = { pan: true };
      lastPan = { x: e.clientX, y: e.clientY };
    }
    render(); refreshSidebars();
  });

  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [wx, wy] = s2w(e.clientX, e.clientY);
    routeCursor = (tool === 'track' && route) ? [wx, wy] : null;

    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (pinchDist) {
        const mid = [(p1.x + p2.x) / 2, (p1.y + p2.y) / 2];
        const factor = d / pinchDist;
        const [mw, mwy] = s2w(mid[0], mid[1]);
        view.zoom = Math.max(0.5, Math.min(50, view.zoom * factor));
        const [nw, nwy] = s2w(mid[0], mid[1]);
        view.x += mw - nw; view.y += mwy - nwy;
        pinchDist = d;
      }
      render();
      return;
    }

    if (dragging && dragging.pan) {
      const dx = (e.clientX - lastPan.x) / view.zoom;
      const dy = (e.clientY - lastPan.y) / view.zoom;
      view.x -= dx; view.y -= dy;
      lastPan = { x: e.clientX, y: e.clientY };
      render();
      return;
    }
    if (dragging && dragging.fpId) {
      const fp = board.footprints.find(f => f.id === dragging.fpId);
      if (fp) {
        B.moveFootprint(board, fp.id, [snap(wx - dragging.dx), snap(wy - dragging.dy)]);
        render();
      }
    } else {
      render();
    }
  });

  canvas.addEventListener('pointerup', e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = null;
    const wasDragging = dragging;
    dragging = null; lastPan = null;

    // double-tap to finish route / outline
    const now = Date.now();
    if ((tool === 'track' && route) || (tool === 'outline' && outlinePts)) {
      if (now - lastTap < 350) {
        if (tool === 'track') finishRoute();
        else finishOutline();
        lastTap = 0;
        return;
      }
    }
    lastTap = now;
    if (wasDragging && wasDragging.fpId) pushUndo();
  });

  canvas.addEventListener('pointercancel', e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = null;
    dragging = null; lastPan = null;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const [mx, my] = [e.clientX, e.clientY];
    const [mw, mwy] = s2w(mx, my);
    view.zoom = Math.max(0.5, Math.min(50, view.zoom * factor));
    const [nw, nwy] = s2w(mx, my);
    view.x += mw - nw; view.y += mwy - nwy;
    render();
  }, { passive: false });

  // ---------- keyboard ----------
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case 's': case 'S': setTool('select'); break;
      case 'f': case 'F': setTool('footprint'); break;
      case 'x': case 'X': setTool('track'); break;
      case 'v': case 'V':
        if (tool === 'track' && route && route.pts.length) {
          addViaHere(route.pts[route.pts.length - 1][0], route.pts[route.pts.length - 1][1]);
        } else setTool('via');
        break;
      case 'b': case 'B': setTool('outline'); break;
      case 'l': case 'L': switchLayer(); break;
      case 'r': case 'R': doRotateSel(); break;
      case 'Delete': case 'Backspace': e.preventDefault(); doDelete(); break;
      case 'Enter': if (tool === 'track') finishRoute(); else if (tool === 'outline') finishOutline(); break;
      case 'Escape':
        route = null; outlinePts = null; placeLib = null;
        setTool('select'); break;
      case 'w': // cycle track width
        trackWidth = TRACK_WIDTHS[(TRACK_WIDTHS.indexOf(trackWidth) + 1) % TRACK_WIDTHS.length];
        setStatus('Track width: ' + trackWidth + ' mm'); break;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
  });

  // ---------- toolbar wiring ----------
  $('tool-select').addEventListener('click', () => setTool('select'));
  $('tool-footprint').addEventListener('click', () => setTool('footprint'));
  $('tool-track').addEventListener('click', () => setTool('track'));
  $('tool-via').addEventListener('click', () => setTool('via'));
  $('tool-outline').addEventListener('click', () => setTool('outline'));
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  $('btn-layer').addEventListener('click', switchLayer);
  $('btn-zoomfit').addEventListener('click', zoomFit);
  $('btn-new').addEventListener('click', () => {
    if (board.footprints.length && !confirm('Clear board?')) return;
    pushUndo();
    board = B.makeBoard(); selId = null; hiNet = null; route = null; outlinePts = null;
    render(); refreshSidebars();
  });
  $('btn-open').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.kicad_pcb,text/plain';
    inp.onchange = () => { if (inp.files[0]) doOpen(inp.files[0]); };
    inp.click();
  });
  $('btn-save').addEventListener('click', doSave);
  $('btn-gerber').addEventListener('click', doGerber);
  $('btn-drc').addEventListener('click', () => { runDRC(); render(); });
  $('btn-help').addEventListener('click', () => {
    showModal('Kipad — PCB Layout Editor', `
      <b>Tools</b><br>
      ⭣ Select — tap pad/footprint to select (tap pad = highlight net), drag to move<br>
      ▣ Footprint — pick from left list, tap board to place, R rotates<br>
      ╱ Route — tap pad to start (uses its net), tap to add corners, double-tap/Enter to finish, V = via + layer switch<br>
      ◎ Via — tap to place a via (on highlighted net)<br>
      ▢ Outline — tap corners, double-tap/Enter to close (Edge.Cuts)<br><br>
      <b>Shortcuts</b>: S select · F footprint · X route · V via · B outline · L layer · R rotate · W track width · Del delete · Ctrl+Z/Y undo/redo<br><br>
      <b>File</b>: Save = .kicad_pcb · Gerber = F.Cu/B.Cu/Edge.Cuts RS-274X · DRC = clearance check (0.2mm)<br>
      Works offline. Add to Home Screen for fullscreen.
    `);
  });
  $('modal-cancel').addEventListener('click', hideModal);
  $('modal-ok').addEventListener('click', hideModal);

  function showModal(title, body) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = body;
    $('modal').classList.remove('hidden');
  }
  function hideModal() { $('modal').classList.add('hidden'); }

  function zoomFit() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const fp of board.footprints) for (const p of fp.pads) {
      x0 = Math.min(x0, p.at[0]); x1 = Math.max(x1, p.at[0]);
      y0 = Math.min(y0, p.at[1]); y1 = Math.max(y1, p.at[1]);
    }
    for (const t of board.tracks) {
      x0 = Math.min(x0, t.start[0], t.end[0]); x1 = Math.max(x1, t.start[0], t.end[0]);
      y0 = Math.min(y0, t.start[1], t.end[1]); y1 = Math.max(y1, t.start[1], t.end[1]);
    }
    for (const poly of board.outline) for (const p of poly) {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    if (!isFinite(x0)) { view = R.makeView(); render(); return; }
    const w = (x1 - x0) || 10, h = (y1 - y0) || 10;
    view.zoom = Math.max(0.5, Math.min(20, Math.min(canvas.width / w, canvas.height / h) * 0.9));
    view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
    render();
  }

  // ---------- init ----------
  loadLocal();
  $('layer-label').textContent = layer;
  setTool('select');
  refreshSidebars();
  window.addEventListener('resize', resize);
  resize();
  render();

  setInterval(saveLocal, 3000);
  window.addEventListener('beforeunload', saveLocal);

  // demo board if empty
  if (!board.footprints.length) {
    try {
      B.addNet(board, 'GND');
      B.addNet(board, 'VCC');
      const r1 = B.placeFootprint(board, 'R_0603_1608Metric', [0, 0], 0, 'F.Cu', 'R');
      const c1 = B.placeFootprint(board, 'C_0603_1608Metric', [3, 0], 90, 'F.Cu', 'C');
      const u1 = B.placeFootprint(board, 'SOIC-8_3.9x4.9mm_P1.27mm', [1.5, 3.5], 0, 'F.Cu', 'U');
      r1.pads[0].netId = 1; r1.pads[1].netId = 2;
      c1.pads[0].netId = 1; c1.pads[1].netId = 2;
      u1.pads.forEach((p, i) => { p.netId = (i % 4 === 0) ? 1 : 0; });
      board.outline.push([[-2, -1], [6.5, -1], [6.5, 6], [-2, 6], [-2, -1]]);
      zoomFit();
    } catch (e) { /* footprints module may not be ready */ }
  }
})();
