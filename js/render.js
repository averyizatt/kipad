/* Kipad — canvas renderer, KiCad 8-style. */
'use strict';

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.KipadRender = factory();
})(typeof self !== 'undefined' ? self : this, function (root) {
  root = root || (typeof globalThis !== 'undefined' ? globalThis : this);

  // KiCad 8 default theme colors (from KiCad source builtin_color_themes.h)
  const LAYER_COLOR = {
    'F.Cu': '#c83434',
    'B.Cu': '#4d7fc4',
    'F.SilkS': '#f2eda1',
    'B.SilkS': '#e8b2a7',
    'F.Mask': '#d864ff',
    'B.Mask': '#02ffee',
    'F.Fab': '#afafaf',
    'B.Fab': '#585d84',
    'F.CrtYd': '#ff26e2',
    'B.CrtYd': '#26e9ff',
    'Edge.Cuts': '#d0d2cd',
    'Dwgs.User': '#c2c2c2'
  };
  const NET_HI = '#00f8ff';   // KiCad ratsnest / highlight
  const SEL = '#04ff43';      // KiCad 8 select overlay
  const BG = '#001023';       // KiCad PCB canvas background
  const GRID_MINOR = '#28344a'; // subtle grid on dark canvas
  const GRID_MAJOR = '#848484';
  const COPPER_LAYERS = ['F.Cu', 'B.Cu'];
  const ALWAYS_LAYERS = ['Edge.Cuts'];

  function makeView() { return { x: 0, y: 0, zoom: 3 }; }

  function w2s(view, px, py, cw, ch) {
    return [(px - view.x) * view.zoom + cw / 2, (py - view.y) * view.zoom + ch / 2];
  }
  function s2w(view, sx, sy, cw, ch) {
    return [(sx - cw / 2) / view.zoom + view.x, (sy - ch / 2) / view.zoom + view.y];
  }

  function isVisible(state, layer) {
    if (!state.layerVis) return true;
    if (ALWAYS_LAYERS.indexOf(layer) !== -1) return true;
    return state.layerVis[layer] !== false;
  }

  function render(ctx, cw, ch, board, view, state) {
    // state: { selId, hiNet, showRats, route, layerVis, activeLayer, crosshair, measure }
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cw, ch);

    const dim = (color, on) => {
      if (!on) return color;
      // dim inactive copper layer
      const a = 0.38;
      return hexA(color, a);
    };
    function hexA(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    // grid
    const step = (grid || 1) * view.zoom;
    if (step > 6) {
      ctx.fillStyle = GRID_MINOR;
      const gx0 = (-view.x * view.zoom) % step;
      const gy0 = (-view.y * view.zoom) % step;
      for (let gx = gx0; gx < cw; gx += step) {
        for (let gy = gy0; gy < ch; gy += step) {
          ctx.fillRect(gx, gy, 1, 1);
        }
      }
    }

    const active = state.activeLayer || 'F.Cu';

    // board outline (Edge.Cuts)
    if (board.outline.length && isVisible(state, 'Edge.Cuts')) {
      ctx.strokeStyle = LAYER_COLOR['Edge.Cuts'];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < board.outline.length; i++) {
        const [sx, sy] = w2s(view, board.outline[i][0], board.outline[i][1]);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // footprints
    for (const fp of board.footprints) {
      const onCopper = fp.layer === 'F.Cu' || fp.layer === 'B.Cu';
      const dimLayer = onCopper && fp.layer !== active;
      drawFootprint(ctx, fp, view, state, dimLayer);
    }

    // tracks (copper)
    for (const t of board.tracks) {
      if (!isVisible(state, t.layer)) continue;
      const dimLayer = t.layer !== active;
      ctx.strokeStyle = dimLayer ? dim(LAYER_COLOR[t.layer] || '#ffffff', true) : (LAYER_COLOR[t.layer] || '#ffffff');
      ctx.lineWidth = Math.max(1, t.width * view.zoom);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < t.pts.length; i++) {
        const [sx, sy] = w2s(view, t.pts[i][0], t.pts[i][1]);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // vias
    for (const v of board.vias) {
      if (!isVisible(state, v.layer)) continue;
      const [cx, cy] = w2s(view, v.at[0], v.at[1]);
      ctx.strokeStyle = '#e3b72e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, v.size * view.zoom / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#23627a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, (v.size / 2 - 0.3) * view.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ratsnest
    if (state.showRats) {
      drawRatsnest(ctx, board, view, state);
    }

    // net highlight
    if (state.hiNet !== null && state.hiNet !== undefined) {
      highlightNet(ctx, board, view, state);
    }

    // in-progress route
    if (state.route && state.route.pts && state.route.pts.length) {
      const r = state.route;
      ctx.strokeStyle = 'rgba(0,248,255,0.8)';
      ctx.lineWidth = Math.max(1, r.width * view.zoom);
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i < r.pts.length; i++) {
        const [sx, sy] = w2s(view, r.pts[i][0], r.pts[i][1]);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      if (r.cur) {
        const [cx, cy] = w2s(view, r.cur[0], r.cur[1]);
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // crosshair
    if (state.crosshair) {
      const [cx, cy] = w2s(view, state.crosshair[0], state.crosshair[1]);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
      ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
      ctx.stroke();
    }

    // measure overlay
    if (state.measure) {
      const [x1, y1] = w2s(view, state.measure.a[0], state.measure.a[1]);
      const [x2, y2] = w2s(view, state.measure.b ? state.measure.b[0] : state.measure.cur[0], state.measure.b ? state.measure.b[1] : state.measure.cur[1]);
      ctx.strokeStyle = '#ffd042';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      const mm = Math.round(Math.hypot((state.measure.b || state.measure.cur)[0] - state.measure.a[0], (state.measure.b || state.measure.cur)[1] - state.measure.a[1]) * 1000) / 1000;
      ctx.fillStyle = '#ffd042';
      ctx.font = '12px system-ui';
      ctx.fillText(mm + ' mm', (x1 + x2) / 2 + 6, (y1 + y2) / 2 - 6);
    }

    // selection
    if (state.selId !== null && state.selId !== undefined) {
      const sel = board.footprints.find(f => f.id === state.selId);
      if (sel) {
        const [sx, sy] = w2s(view, sel.at[0], sel.at[1]);
        ctx.strokeStyle = SEL;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(sx - 4, sy - 4, 8, 8);
        ctx.setLineDash([]);
      }
    }
  }

  function drawFootprint(ctx, fp, view, state, dimLayer) {
    const [ox, oy] = w2s(view, fp.at[0], fp.at[1]);
    const z = view.zoom;
    const a = (fp.angle || 0) * Math.PI / 180;
    const T = (x, y) => {
      const rx = x * Math.cos(a) - y * Math.sin(a);
      const ry = x * Math.sin(a) + y * Math.cos(a);
      return [ox + rx * z, oy - ry * z];
    };
    const alpha = dimLayer ? 0.4 : 1;

    // courtyard
    if (fp.courtyard && isVisible(state, fp.courtyard.layer)) {
      const col = LAYER_COLOR[fp.courtyard.layer] || '#ff26e2';
      ctx.strokeStyle = hexA(col, 0.35 * alpha);
      ctx.lineWidth = 1;
      ctx.strokeRect(T(fp.courtyard.min[0], fp.courtyard.min[1])[0], T(fp.courtyard.min[0], fp.courtyard.min[1])[1],
        (fp.courtyard.max[0] - fp.courtyard.min[0]) * z, (fp.courtyard.max[1] - fp.courtyard.min[1]) * z);
    }

    // fab outline
    if (fp.fab && fp.fab.length && isVisible(state, fp.fab[0].layer)) {
      ctx.strokeStyle = hexA(LAYER_COLOR[fp.fab[0].layer] || '#afafaf', 0.6 * alpha);
      ctx.lineWidth = 1;
      for (const item of fp.fab) {
        if (item.type === 'rect') {
          ctx.strokeRect(T(item.start[0], item.start[1])[0], T(item.start[0], item.start[1])[1],
            (item.end[0] - item.start[0]) * z, (item.end[1] - item.start[1]) * z);
        } else if (item.type === 'line') {
          const [x1, y1] = T(item.start[0], item.start[1]);
          const [x2, y2] = T(item.end[0], item.end[1]);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
      }
    }

    // silk
    if (fp.silk && fp.silk.length && isVisible(state, fp.silk[0].layer)) {
      ctx.strokeStyle = hexA(LAYER_COLOR[fp.silk[0].layer] || '#f2eda1', 0.9 * alpha);
      ctx.lineWidth = 1;
      for (const item of fp.silk) {
        if (item.type === 'line') {
          const [x1, y1] = T(item.start[0], item.start[1]);
          const [x2, y2] = T(item.end[0], item.end[1]);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        } else if (item.type === 'rect') {
          ctx.strokeRect(T(item.start[0], item.start[1])[0], T(item.start[0], item.start[1])[1],
            (item.end[0] - item.start[0]) * z, (item.end[1] - item.start[1]) * z);
        } else if (item.type === 'circle') {
          const [cx, cy] = T(item.center[0], item.center[1]);
          ctx.beginPath(); ctx.arc(cx, cy, item.r * z, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }

    // pads
    for (const p of fp.pads) {
      const [px, py] = T(p.at[0], p.at[1]);
      const isCopper = (p.layers && p.layers.indexOf('F.Cu') !== -1) || (p.layers && p.layers.indexOf('B.Cu') !== -1);
      const layer = isCopper ? fp.layer : (p.layers && p.layers[0] || 'F.SilkS');
      const col = isCopper ? (LAYER_COLOR[fp.layer] || '#c83434') : (LAYER_COLOR[layer] || '#f2eda1');
      ctx.fillStyle = hexA(col, isCopper ? 1 * alpha : 0.7 * alpha);
      ctx.strokeStyle = hexA(col, isCopper ? 1 * alpha : 0.7 * alpha);
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(px, py, p.size[0] * z / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-a);
        ctx.fillRect(-p.size[0] * z / 2, -p.size[1] * z / 2, p.size[0] * z, p.size[1] * z);
        ctx.restore();
      }
      // hole
      if (p.hole && p.hole > 0) {
        ctx.fillStyle = BG;
        ctx.beginPath();
        ctx.arc(px, py, p.hole * z / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ref text
    if (fp.ref) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(-a);
      ctx.fillStyle = hexA('#f2eda1', 0.9 * alpha);
      ctx.font = Math.max(8, 1.2 * z) + 'px system-ui';
      ctx.textAlign = 'center';
      const refY = (fp.refPos ? fp.refPos[1] : 0) * z;
      ctx.fillText(fp.ref, 0, -refY + 8);
      ctx.restore();
    }
  }

  function drawRatsnest(ctx, board, view, state) {
    // simple: connect unconnected pads of same net to nearest
    const netPads = {};
    for (const fp of board.footprints) {
      for (const p of fp.pads) {
        if (p.netId === null || p.netId === undefined) continue;
        (netPads[p.netId] = netPads[p.netId] || []).push({ x: fp.at[0] + p.at[0], y: fp.at[1] + p.at[1] });
      }
    }
    ctx.strokeStyle = 'rgba(0,248,255,0.35)';
    ctx.lineWidth = 1;
    for (const netId in netPads) {
      const pts = netPads[netId];
      if (pts.length < 2) continue;
      // connect each pad to nearest unconnected (greedy)
      const used = new Set([0]);
      let cur = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        let best = -1, bd = Infinity;
        for (let j = 0; j < pts.length; j++) {
          if (used.has(j)) continue;
          const d = (pts[j].x - pts[cur].x) ** 2 + (pts[j].y - pts[cur].y) ** 2;
          if (d < bd) { bd = d; best = j; }
        }
        if (best < 0) break;
        const [x1, y1] = w2s(view, pts[cur].x, pts[cur].y);
        const [x2, y2] = w2s(view, pts[best].x, pts[best].y);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        used.add(best); cur = best;
      }
    }
  }

  function highlightNet(ctx, board, view, state) {
    const netId = state.hiNet;
    ctx.strokeStyle = NET_HI;
    ctx.lineWidth = 2;
    for (const t of board.tracks) {
      if (t.netId !== netId) continue;
      for (let i = 0; i < t.pts.length - 1; i++) {
        const [x1, y1] = w2s(view, t.pts[i][0], t.pts[i][1]);
        const [x2, y2] = w2s(view, t.pts[i + 1][0], t.pts[i + 1][1]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
    for (const fp of board.footprints) {
      for (const p of fp.pads) {
        if (p.netId !== netId) continue;
        const [px, py] = w2s(view, fp.at[0] + p.at[0], fp.at[1] + p.at[1]);
        ctx.beginPath(); ctx.arc(px, py, Math.max(3, p.size[0] * view.zoom / 2), 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  // ============ SCHEMATIC ============

  // Draw a schematic: symbols (from registry graphics), wires, labels, junctions.
  // state: { selSymId, wirePts (in-progress wire), previewSym (name+at+angle), getSymbol }
  function renderSchematic(ctx, cw, ch, sch, view, state, S) {
    const dpr = state.dpr || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#f5f4ef';   // KiCad schematic paper background
    ctx.fillRect(0, 0, cw, ch);

    // grid
    const grid = state.grid || 0.25;
    const z = view.zoom;
    const step = grid * z;
    if (step > 3) {
      const x0 = (-view.x * z);
      const y0 = (-view.y * z);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      for (let gx = x0 % step; gx < cw; gx += step) {
        for (let gy = y0 % step; gy < ch; gy += step) {
          ctx.fillRect(gx, gy, 1.5, 1.5);
        }
      }
    }

    // wires (KiCad: green)
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#009600';
    for (const w of sch.wires) {
      ctx.beginPath();
      for (let i = 0; i < w.pts.length; i++) {
        const [sx, sy] = w2s(view, w.pts[i][0], w.pts[i][1], cw, ch);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // in-progress wire
    if (state.wirePts && state.wirePts.length) {
      ctx.strokeStyle = 'rgba(0,150,0,0.55)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const all = state.wirePts.concat(state.wireCur ? [state.wireCur] : []);
      for (let i = 0; i < all.length; i++) {
        const [sx, sy] = w2s(view, all[i][0], all[i][1], cw, ch);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // junctions
    ctx.fillStyle = '#009600';
    for (const j of sch.junctions) {
      const [sx, sy] = w2s(view, j.at[0], j.at[1], cw, ch);
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // symbols
    for (const sym of sch.symbols) {
      const def = (S && S.getSymbol) ? S.getSymbol(sym.libId) : null;
      if (!def) continue;
      drawSchematicSymbol(ctx, cw, ch, view, sym, def, sym.id === state.selSymId);
    }

    // labels
    ctx.fillStyle = '#0f0f0f';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const l of sch.labels) {
      const [sx, sy] = w2s(view, l.at[0], l.at[1], cw, ch);
      ctx.fillText(l.text, sx + 6, sy);
    }

    // preview symbol following cursor
    if (state.previewSym && S && S.getSymbol) {
      const def = S.getSymbol(state.previewSym.name);
      if (def) {
        const sym = { at: state.previewSym.at, angle: state.previewSym.angle, libId: state.previewSym.name };
        ctx.globalAlpha = 0.6;
        drawSchematicSymbol(ctx, cw, ch, view, sym, def, false);
        ctx.globalAlpha = 1;
      }
    }

    // crosshair
    if (state.crosshair) {
      const [sx, sy] = w2s(view, state.crosshair[0], state.crosshair[1], cw, ch);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy); ctx.lineTo(sx + 8, sy);
      ctx.moveTo(sx, sy - 8); ctx.lineTo(sx, sy + 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSchematicSymbol(ctx, cw, ch, view, sym, def, selected) {
    const [ox, oy] = w2s(view, sym.at[0], sym.at[1], cw, ch);
    const z = view.zoom;
    const a = sym.angle * Math.PI / 180;
    const T = (x, y) => {
      const rx = x * Math.cos(a) - y * Math.sin(a);
      const ry = x * Math.sin(a) + y * Math.cos(a);
      return [ox + rx * z, oy - ry * z];   // world y up in schematic
    };

    ctx.save();
    ctx.strokeStyle = selected ? '#0079c1' : '#840000';   // KiCad: device dark red
    ctx.fillStyle = selected ? '#0079c1' : '#840000';
    ctx.lineWidth = 1.2;

    for (const g of def.graphics) {
      if (g.type === 'rect') {
        const p1 = T(g.start[0], g.start[1]), p2 = T(g.end[0], g.end[1]);
        ctx.strokeRect(Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.abs(p2[0] - p1[0]), Math.abs(p2[1] - p1[1]));
      } else if (g.type === 'polyline') {
        ctx.beginPath();
        for (let i = 0; i < g.pts.length; i++) {
          const [sx, sy] = T(g.pts[i][0], g.pts[i][1]);
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      } else if (g.type === 'circle') {
        const [cx, cy] = T(g.center[0], g.center[1]);
        ctx.beginPath();
        ctx.arc(cx, cy, g.r * z, 0, Math.PI * 2);
        ctx.stroke();
      } else if (g.type === 'arc') {
        // approximate arc with polyline through start/mid/end
        const [s1x, s1y] = T(g.start[0], g.start[1]);
        const [mx, my] = T(g.mid[0], g.mid[1]);
        const [e1x, e1y] = T(g.end[0], g.end[1]);
        ctx.beginPath();
        ctx.moveTo(s1x, s1y);
        ctx.quadraticCurveTo(mx, my, e1x, e1y);
        ctx.stroke();
      } else if (g.type === 'text') {
        const [tx, ty] = T(g.at[0], g.at[1]);
        ctx.font = (g.size ? g.size[1] : 1.27) * z + 'px system-ui, sans-serif';
        ctx.fillText(g.text, tx, ty);
      }
    }

    // pins: line from body to connection point, small square at tip
    for (const p of def.pins || []) {
      const [px, py] = T(p.at[0], p.at[1]);
      const dir = p.angle * Math.PI / 180;
      // pin points outward from body along angle
      const len = (p.length || 2.54) * z;
      const bx = px + Math.cos(dir) * len;
      const by = py - Math.sin(dir) * len;
      ctx.strokeStyle = selected ? '#0079c1' : '#840000';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillStyle = selected ? '#0079c1' : '#840000';
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }

    // ref + value text
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = '#006464';   // KiCad reference/value teal
    ctx.textAlign = 'center';
    const refY = oy - (def.graphics.some(g => g.type === 'rect') ? 3.2 : 2.5) * z;
    ctx.fillText(sym.ref, ox, refY);
    ctx.fillStyle = '#840084';   // KiCad value purple
    ctx.fillText(sym.value, ox, refY + 12);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  return { LAYER_COLOR, NET_HI, SEL, BG, COPPER_LAYERS, makeView, w2s, s2w, render, drawPad,
    renderSchematic: renderSchematic, drawSchematicSymbol: drawSchematicSymbol };
});
