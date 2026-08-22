/* Kipad — canvas renderer, KiCad 8-style. */
'use strict';

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.KipadRender = factory();
})(typeof self !== 'undefined' ? self : this, function (root) {
  root = root || (typeof globalThis !== 'undefined' ? globalThis : this);

  // KiCad 8-ish layer colors
  const LAYER_COLOR = {
    'F.Cu': '#ff0000',
    'B.Cu': '#0000ff',
    'F.SilkS': '#f0f0f0',
    'B.SilkS': '#f0f0f0',
    'F.Mask': '#00a000',
    'B.Mask': '#00a000',
    'F.Fab': '#808080',
    'B.Fab': '#808080',
    'F.CrtYd': '#c8c800',
    'B.CrtYd': '#c8c800',
    'Edge.Cuts': '#ffff00',
    'Dwgs.User': '#7f7fff'
  };
  const NET_HI = '#ffeb3b';
  const SEL = '#00d0ff';
  const BG = '#1e1e1e';
  const GRID_MINOR = '#2e2e2e';
  const GRID_MAJOR = '#454545';
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
      return `rgba(${r},${g},${b},${a})`;
    }

    // ---- grid (dots, KiCad style) ----
    const grid = state.grid || 0.25;
    const tl = s2w(view, 0, 0, cw, ch), br = s2w(view, cw, ch, cw, ch);
    const startX = Math.floor(tl[0] / grid) * grid;
    const startY = Math.floor(tl[1] / grid) * grid;
    ctx.fillStyle = GRID_MINOR;
    for (let gx = startX; gx <= br[0]; gx += grid) {
      for (let gy = startY; gy <= br[1]; gy += grid) {
        const major = (Math.abs(gx - Math.round(gx)) < 1e-9) && (Math.abs(gy - Math.round(gy)) < 1e-9);
        const [sx, sy] = w2s(view, gx, gy, cw, ch);
        ctx.fillStyle = major ? GRID_MAJOR : GRID_MINOR;
        ctx.beginPath(); ctx.arc(sx, sy, major ? 1.4 : 0.8, 0, Math.PI * 2); ctx.fill();
      }
    }

    // origin cross
    const [ox, oy] = w2s(view, 0, 0, cw, ch);
    ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ox - 10, oy); ctx.lineTo(ox + 10, oy);
    ctx.moveTo(ox, oy - 10); ctx.lineTo(ox, oy + 10); ctx.stroke();

    // ---- ratsnest ----
    if (state.showRats !== false) {
      const lines = (root.KipadBoard || {}).ratsnest ? root.KipadBoard.ratsnest(board) : [];
      ctx.strokeStyle = 'rgba(180,180,180,0.4)';
      ctx.lineWidth = 1;
      for (const l of lines) {
        const [ax, ay] = w2s(view, l.a[0], l.a[1], cw, ch);
        const [bx, by] = w2s(view, l.b[0], l.b[1], cw, ch);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }

    // ---- board outline ----
    ctx.strokeStyle = LAYER_COLOR['Edge.Cuts'];
    ctx.lineWidth = Math.max(1.5, 0.15 * view.zoom);
    for (const poly of board.outline) {
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const [sx, sy] = w2s(view, poly[i][0], poly[i][1], cw, ch);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      if (poly.length > 2) ctx.closePath();
      ctx.stroke();
    }

    // ---- footprints ----
    for (const fp of board.footprints) {
      const isSel = state.selId === fp.id;
      const lib = (root.KipadFootprints || {}).getFootprint ? root.KipadFootprints.getFootprint(fp.lib) : null;
      const t = (pt) => {
        const r = fp.angle * Math.PI / 180;
        const dx = pt[0] - fp.at[0], dy = pt[1] - fp.at[1];
        return [fp.at[0] + dx * Math.cos(r) - dy * Math.sin(r), fp.at[1] + dx * Math.sin(r) + dy * Math.cos(r)];
      };

      // courtyard (thin, always-ish)
      if (lib && lib.courtyard && isVisible(state, 'F.CrtYd')) {
        const a = t([lib.courtyard.min[0], lib.courtyard.min[1]]);
        const b = t([lib.courtyard.max[0], lib.courtyard.max[1]]);
        const [ax, ay] = w2s(view, a[0], a[1], cw, ch);
        const [bx, by] = w2s(view, b[0], b[1], cw, ch);
        ctx.strokeStyle = isSel ? SEL : 'rgba(200,200,0,0.75)';
        ctx.lineWidth = 1;
        ctx.strokeRect(ax, ay, bx - ax, by - ay);
      }

      // fab + silk
      if (lib && lib.silk) {
        for (const s of lib.silk) {
          const layer = s.layer || 'F.SilkS';
          if (layer === 'F.Fab' && !isVisible(state, 'F.Fab')) continue;
          if (layer === 'F.SilkS' && !isVisible(state, 'F.SilkS')) continue;
          const color = layer === 'F.Fab' ? LAYER_COLOR['F.Fab'] : (isSel ? SEL : 'rgba(240,240,240,0.9)');
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = Math.max(1, (layer === 'F.Fab' ? 0.1 : 0.12) * view.zoom);
          if (s.type === 'line') {
            ctx.beginPath();
            for (let i = 0; i < s.pts.length; i++) {
              const [sx, sy] = w2s(view, ...t(s.pts[i]), cw, ch);
              if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
            }
            ctx.stroke();
          } else if (s.type === 'circle') {
            const [cx, cy] = w2s(view, ...t(s.at), cw, ch);
            ctx.beginPath(); ctx.arc(cx, cy, s.r * view.zoom, 0, Math.PI * 2); ctx.stroke();
          } else if (s.type === 'text') {
            const [tx, ty] = w2s(view, ...t(s.at), cw, ch);
            ctx.save(); ctx.translate(tx, ty); ctx.rotate(fp.angle * Math.PI / 180);
            ctx.font = `${Math.max(6, s.size * view.zoom)}px -apple-system, sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(s.text, 0, 0); ctx.restore();
          }
        }
      }

      // pads
      const onActive = fp.layer === (state.activeLayer || 'F.Cu') || fp.layer !== 'B.Cu';
      for (const p of fp.pads) {
        const copper = LAYER_COLOR[fp.layer] || '#888';
        const color = (state.hiNet != null && p.netId === state.hiNet) ? NET_HI
          : (isSel ? SEL : dim(copper, !onActive));
        drawPad(ctx, view, cw, ch, p, color, isSel);
      }

      // ref text
      const [rx, ry] = w2s(view, fp.at[0], fp.at[1] - (lib && lib.courtyard ? (lib.courtyard.max[1] - lib.courtyard.min[1]) / 2 + 0.8 : 1.8), cw, ch);
      ctx.fillStyle = isSel ? SEL : '#c8c8c8';
      ctx.font = `${Math.max(8, 1.3 * view.zoom)}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(fp.ref, rx, ry);
    }

    // ---- tracks ----
    for (const t of board.tracks) {
      if (!isVisible(state, t.layer)) continue;
      const onActive = t.layer === (state.activeLayer || 'F.Cu');
      const color = (state.hiNet != null && t.netId === state.hiNet) ? NET_HI
        : dim(LAYER_COLOR[t.layer] || '#888', !onActive);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, t.width * view.zoom);
      ctx.lineCap = 'round';
      const [ax, ay] = w2s(view, t.start[0], t.start[1], cw, ch);
      const [bx, by] = w2s(view, t.end[0], t.end[1], cw, ch);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }

    // ---- vias ----
    for (const v of board.vias) {
      const color = (state.hiNet != null && v.netId === state.hiNet) ? NET_HI : '#c0c0c0';
      const [vx, vy] = w2s(view, v.at[0], v.at[1], cw, ch);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, (v.size - v.drill) / 2 * view.zoom);
      ctx.beginPath(); ctx.arc(vx, vy, v.size / 2 * view.zoom, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = BG;
      ctx.beginPath(); ctx.arc(vx, vy, v.drill / 2 * view.zoom, 0, Math.PI * 2); ctx.fill();
    }

    // ---- route in progress ----
    if (state.route && state.route.pts.length) {
      const layer = state.route.layer;
      ctx.strokeStyle = LAYER_COLOR[layer] || '#888';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = Math.max(1, state.route.width * view.zoom);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < state.route.pts.length; i++) {
        const [sx, sy] = w2s(view, state.route.pts[i][0], state.route.pts[i][1], cw, ch);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (state.route.cursor) {
        const last = state.route.pts[state.route.pts.length - 1];
        const [cx0, cy0] = w2s(view, last[0], last[1], cw, ch);
        const [cx1, cy1] = w2s(view, state.route.cursor[0], state.route.cursor[1], cw, ch);
        ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(cx1, cy1); ctx.stroke();
      }
    }

    // ---- measure ----
    if (state.measure && state.measure.a) {
      const a = state.measure.a, b = state.measure.b || state.measure.cur;
      if (b) {
        const [ax, ay] = w2s(view, a[0], a[1], cw, ch);
        const [bx, by] = w2s(view, b[0], b[1], cw, ch);
        ctx.strokeStyle = '#00ff88';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.setLineDash([]);
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        ctx.fillStyle = '#00ff88';
        ctx.font = '12px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(d.toFixed(2) + ' mm', (ax + bx) / 2, (ay + by) / 2 - 6);
      }
    }

    // ---- crosshair ----
    if (state.crosshair) {
      const [cx, cy] = w2s(view, state.crosshair[0], state.crosshair[1], cw, ch);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 4, cy);
      ctx.moveTo(cx + 4, cy); ctx.lineTo(cx + 14, cy);
      ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 4);
      ctx.moveTo(cx, cy + 4); ctx.lineTo(cx, cy + 14);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawPad(ctx, view, cw, ch, p, color, isSel) {
    const [cx, cy] = w2s(view, p.at[0], p.at[1], cw, ch);
    const w = Math.max(1, p.size[0] * view.zoom);
    const h = Math.max(1, p.size[1] * view.zoom);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p.angle * Math.PI / 180);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (p.shape === 'circle') {
      ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill();
      if (p.drill) {
        ctx.fillStyle = BG;
        ctx.beginPath(); ctx.arc(0, 0, p.drill / 2 * view.zoom, 0, Math.PI * 2); ctx.fill();
      }
    } else if (p.shape === 'roundrect') {
      const r = (p.radius != null ? p.radius : Math.min(w, h) * 0.25) * view.zoom;
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(r, w / 2, h / 2)); ctx.fill();
      if (p.drill) {
        ctx.fillStyle = BG;
        ctx.beginPath(); ctx.arc(0, 0, p.drill / 2 * view.zoom, 0, Math.PI * 2); ctx.fill();
      }
    } else if (p.shape === 'obround') {
      ctx.beginPath(); ctx.arc(-(w - h) / 2, 0, h / 2, Math.PI / 2, -Math.PI / 2); ctx.fill();
      ctx.beginPath(); ctx.arc((w - h) / 2, 0, h / 2, -Math.PI / 2, Math.PI / 2); ctx.fill();
      ctx.fillRect(-(w - h) / 2, -h / 2, w - h, h);
      if (p.drill) {
        ctx.fillStyle = BG;
        ctx.beginPath(); ctx.arc(0, 0, p.drill / 2 * view.zoom, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      ctx.fillRect(-w / 2, -h / 2, w, h);
      if (p.drill) {
        ctx.fillStyle = BG;
        ctx.beginPath(); ctx.arc(0, 0, p.drill / 2 * view.zoom, 0, Math.PI * 2); ctx.fill();
      }
    }
    // selection outline
    if (isSel) {
      ctx.strokeStyle = SEL;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, Math.max(w, h) / 2 + 2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- schematic rendering (Eeschema-like) ----------

  // Draw a schematic: symbols (from registry graphics), wires, labels, junctions.
  // state: { selSymId, wirePts (in-progress wire), previewSym (name+at+angle), getSymbol }
  function renderSchematic(ctx, cw, ch, sch, view, state, S) {
    const dpr = state.dpr || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, cw, ch);

    // grid
    const grid = state.grid || 0.25;
    const z = view.zoom;
    const step = grid * z;
    if (step > 3) {
      const x0 = (-view.x * z);
      const y0 = (-view.y * z);
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      for (let gx = x0 % step; gx < cw; gx += step) {
        for (let gy = y0 % step; gy < ch; gy += step) {
          ctx.fillRect(gx, gy, 1.5, 1.5);
        }
      }
    }

    // wires
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#4aa8ff';
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
      ctx.strokeStyle = 'rgba(74,168,255,0.6)';
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
    ctx.fillStyle = '#4aa8ff';
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
    ctx.fillStyle = '#7ee787';
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
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
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
    ctx.strokeStyle = selected ? '#ffa726' : '#e8e8e8';
    ctx.fillStyle = '#e8e8e8';
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
      ctx.strokeStyle = selected ? '#ffa726' : '#e8e8e8';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillStyle = selected ? '#ffa726' : '#c8c8c8';
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }

    // ref + value text
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = '#9cdcfe';
    ctx.textAlign = 'center';
    const refY = oy - (def.graphics.some(g => g.type === 'rect') ? 3.2 : 2.5) * z;
    ctx.fillText(sym.ref, ox, refY);
    ctx.fillStyle = '#6a9955';
    ctx.fillText(sym.value, ox, refY + 12);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  return { LAYER_COLOR, NET_HI, SEL, BG, COPPER_LAYERS, makeView, w2s, s2w, render, drawPad,
    renderSchematic: renderSchematic, drawSchematicSymbol: drawSchematicSymbol };
});
