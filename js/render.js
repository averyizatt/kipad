/* Kipad — canvas renderer, KiCad 8-style. */
'use strict';

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.KipadRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {

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
  function isVisible(state, layerName) {
    if (ALWAYS_LAYERS.includes(layerName)) return true;
    if (state && state.layerVis && layerName in state.layerVis) return !!state.layerVis[layerName];
    return true;
  }

  // ---------- main PCB renderer ----------
  function render(ctx, cw, ch, board, view, state) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.textBaseline = 'middle';

    const dim = a => a * (state && state.fade ? 0.35 : 1);
    function hexA(hex, a) {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + dim(a) + ')';
    }

    // ---- grid (dots, KiCad style) ----
    const grid = state.grid || 0.25;
    const tl = s2w(view, 0, 0, cw, ch), br = s2w(view, cw, ch, cw, ch);
    // Never draw sub-pixel grid dots, and hard-cap dots per frame: at the
    // default 3 px/mm a 0.25 mm grid would otherwise issue >1M canvas arcs
    // (the PCB-entry stall), and huge windows could still draw ~500k.
    let drawGrid = grid;
    while ((drawGrid * view.zoom < 4) ||
           (((br[0] - tl[0]) / drawGrid) * ((br[1] - tl[1]) / drawGrid) > 40000)) {
      drawGrid *= 2;
    }
    const startX = Math.floor(tl[0] / drawGrid) * drawGrid;
    const startY = Math.floor(tl[1] / drawGrid) * drawGrid;
    // Batch dots into two paths (minor + major): thousands of individual
    // beginPath/fill calls still janked Safari even after density culling.
    for (const [color, r, wantMajor] of [[GRID_MINOR, 0.8, false], [GRID_MAJOR, 1.4, true]]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let gx = startX; gx <= br[0]; gx += drawGrid) {
        for (let gy = startY; gy <= br[1]; gy += drawGrid) {
          const major = Math.abs(gx - Math.round(gx)) < 1e-9 && Math.abs(gy - Math.round(gy)) < 1e-9;
          if (major !== wantMajor) continue;
          const [sx, sy] = w2s(view, gx, gy, cw, ch);
          ctx.moveTo(sx + r, sy);
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    }

    // origin cross
    ctx.strokeStyle = hexA('#ffffff', 0.25);
    ctx.lineWidth = 1;
    const o = w2s(view, 0, 0, cw, ch);
    ctx.beginPath();
    ctx.moveTo(o[0] - 10, o[1]); ctx.lineTo(o[0] + 10, o[1]);
    ctx.moveTo(o[0], o[1] - 10); ctx.lineTo(o[0], o[1] + 10);
    ctx.stroke();

    // ---- ratsnest ----
    if (state.showRats) {
      ctx.strokeStyle = hexA(NET_HI, 0.45);
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      for (const n of board.nets) {
        if (!n.pads.length) continue;
        const a = n.pads[0].at, b = n.pads[n.pads.length - 1].at;
        const s1 = w2s(view, a.x, a.y, cw, ch), s2 = w2s(view, b.x, b.y, cw, ch);
        ctx.moveTo(s1[0], s1[1]); ctx.lineTo(s2[0], s2[1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ---- board outline ----
    if (board.outline.length >= 2) {
      ctx.strokeStyle = LAYER_COLOR['Edge.Cuts'];
      ctx.lineWidth = Math.max(1, 0.1 * view.zoom);
      ctx.beginPath();
      board.outline.forEach((pt, i) => {
        const s = w2s(view, pt.x, pt.y, cw, ch);
        if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
      });
      ctx.closePath();
      ctx.stroke();
    }

    // ---- copper zones (poured fills, cached) ----
    if (state.zones) {
      for (const z of board.zones || []) {
        const fill = state.zones.get(z.id);
        if (!fill) continue;
        ctx.fillStyle = hexA(LAYER_COLOR[z.layer] || '#c83434', z.opacity == null ? 0.35 : z.opacity);
        for (const poly of fill.polys) {
          ctx.beginPath();
          poly.forEach((pt, i) => {
            const s = w2s(view, pt.x, pt.y, cw, ch);
            if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
          });
          ctx.closePath();
          ctx.fill('evenodd');
        }
        // zone outline (thin, while placing/editing)
        if (state.zoneDraft === z.id || state.showZoneOutline) {
          ctx.strokeStyle = hexA(LAYER_COLOR[z.layer] || '#c83434', 0.9);
          ctx.lineWidth = 1;
          ctx.beginPath();
          (z.outline || []).forEach((pt, i) => {
            const s = w2s(view, pt.x, pt.y, cw, ch);
            if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
          });
          ctx.closePath();
          ctx.stroke();
        }
      }
      // draft outline while placing a new zone
      if (state.zoneDraftPts && state.zoneDraftPts.length) {
        ctx.strokeStyle = SEL;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        state.zoneDraftPts.forEach((pt, i) => {
          const s = w2s(view, pt.x, pt.y, cw, ch);
          if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ---- board texts (silkscreen) ----
    for (const t of board.texts || []) {
      if (!isVisible(state, t.layer)) continue;
      const col = LAYER_COLOR[t.layer] || '#f2eda1';
      const s = w2s(view, t.at.x, t.at.y, cw, ch);
      ctx.save();
      ctx.translate(s[0], s[1]);
      ctx.rotate(-(t.angle || 0) * Math.PI / 180);
      if (t.mirror) ctx.scale(-1, 1);
      ctx.fillStyle = selId === t.id ? SEL : col;
      ctx.font = `${Math.max(6, t.size * view.zoom)}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
    // text placement preview
    if (state.textPlace) {
      const tp = state.textPlace;
      const s = w2s(view, tp.at.x, tp.at.y, cw, ch);
      ctx.save();
      ctx.translate(s[0], s[1]);
      ctx.rotate(-(tp.angle || 0) * Math.PI / 180);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = LAYER_COLOR[tp.layer] || '#f2eda1';
      ctx.font = `${Math.max(6, tp.size * view.zoom)}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(tp.text, 0, 0);
      ctx.restore();
    }

    // ---- footprints ----
    for (const fp of board.footprints) {
      const sel = selId === fp.id;
      const cosA = Math.cos(fp.angle * Math.PI / 180), sinA = Math.sin(fp.angle * Math.PI / 180);
      const tf = (px, py) => ({
        x: fp.at.x + px * cosA - py * sinA,
        y: fp.at.y + px * sinA + py * cosA
      });
      // courtyard when selected
      if (sel) {
        const cy = fp.courtyard;
        if (cy) {
          ctx.strokeStyle = hexA(SEL, 0.9);
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          cy.forEach((pt, i) => {
            const p = tf(pt.x, pt.y), s = w2s(view, p.x, p.y, cw, ch);
            if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
          });
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      // fab + silk layers
      const layerSets = [
        ['F.Fab', 'F.SilkS'],
        ['B.Fab', 'B.SilkS']
      ];
      for (const [fabL, silkL] of layerSets) {
        if (!isVisible(state, fabL)) continue;
        const fabCol = hexA(LAYER_COLOR[fabL], 0.9);
        const silkCol = LAYER_COLOR[silkL];
        for (const g of fp.graphics || []) {
          const lay = g.layer || 'F.SilkS';
          if (lay !== silkL && lay !== fabL) continue;
          if (!isVisible(state, lay)) continue;
          const col = lay === fabL ? fabCol : silkCol;
          ctx.strokeStyle = g.width ? col : col;
          ctx.fillStyle = col;
          ctx.lineWidth = Math.max(0.75, (g.width || 0.12) * view.zoom);
          if (g.type === 'line' && g.pts.length >= 2) {
            ctx.beginPath();
            g.pts.forEach((pt, i) => {
              const p = tf(pt.x, pt.y), s = w2s(view, p.x, p.y, cw, ch);
              if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
            });
            if (g.closed) ctx.closePath();
            if (g.fill === 'solid') ctx.fill(); else ctx.stroke();
          } else if (g.type === 'circle') {
            const c = tf(g.cx, g.cy), s = w2s(view, c.x, c.y, cw, ch);
            const rr = Math.max(1, g.r * view.zoom);
            ctx.beginPath();
            ctx.arc(s[0], s[1], rr, 0, Math.PI * 2);
            if (g.fill === 'solid') ctx.fill(); else ctx.stroke();
          } else if (g.type === 'arc') {
            const c = tf(g.cx, g.cy), s = w2s(view, c.x, c.y, cw, ch);
            const rr = Math.max(1, g.r * view.zoom);
            let a0 = -(g.a1 || 0) * Math.PI / 180, a1 = -(g.a2 || 360) * Math.PI / 180;
            ctx.beginPath();
            ctx.arc(s[0], s[1], rr, a0, a1, false);
            ctx.stroke();
          }
        }
      }
      // pads
      for (const pad of fp.pads) {
        if (!isVisible(state, pad.layers && pad.layers[0] === 'B.Cu' ? 'B.Cu' : 'F.Cu')) continue;
        const p = tf(pad.at.x, pad.at.y);
        drawPad(ctx, view, cw, ch, p.x, p.y, pad, fp.angle + (pad.angle || 0), sel, hiNet, netIdOf(board, pad.net));
      }
      // reference text
      if (fp.ref) {
        const rp = tf(fp.refOff ? fp.refOff.x : 0, fp.refOff ? fp.refOff.y : 0);
        const s = w2s(view, rp.x, rp.y, cw, ch);
        ctx.save();
        ctx.translate(s[0], s[1]);
        ctx.rotate(-fp.angle * Math.PI / 180);
        ctx.fillStyle = sel ? SEL : '#f2eda1';
        ctx.font = `${Math.max(6, 0.8 * view.zoom)}px -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(fp.ref, 0, 0);
        ctx.restore();
      }
    }

    // ---- tracks (active copper layers) ----
    for (const tr of board.tracks) {
      const vis = isVisible(state, tr.layer) || tr.net === hiNet;
      if (!vis) continue;
      const a = w2s(view, tr.a.x, tr.a.y, cw, ch), b = w2s(view, tr.b.x, tr.b.y, cw, ch);
      const hl = tr.net !== null && tr.net === hiNet;
      ctx.strokeStyle = hl ? NET_HI : (LAYER_COLOR[tr.layer] || '#c83434');
      ctx.lineWidth = Math.max(1, tr.width * view.zoom);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      if (tr.sel === 1) {
        ctx.strokeStyle = SEL;
        ctx.lineWidth += 2;
        ctx.stroke();
      }
    }

    // ---- vias ----
    for (const v of board.vias) {
      if (!isVisible(state, 'F.Cu') && !isVisible(state, 'B.Cu')) continue;
      const s = w2s(view, v.at.x, v.at.y, cw, ch);
      ctx.fillStyle = '#d9b46a';
      ctx.beginPath();
      ctx.arc(s[0], s[1], Math.max(2, v.size / 2 * view.zoom), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = BG;
      ctx.beginPath();
      ctx.arc(s[0], s[1], Math.max(1, v.drill / 2 * view.zoom), 0, Math.PI * 2);
      ctx.fill();
      if (v.sel === 1) {
        ctx.strokeStyle = SEL;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s[0], s[1], Math.max(2, v.size / 2 * view.zoom) + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ---- route in progress ----
    if (route && route.pts.length) {
      ctx.strokeStyle = LAYER_COLOR[route.layer] || '#c83434';
      ctx.lineWidth = Math.max(1, route.width * view.zoom);
      ctx.beginPath();
      route.pts.forEach((pt, i) => {
        const s = w2s(view, pt.x, pt.y, cw, ch);
        if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
      });
      const cur = w2s(view, route.cur.x, route.cur.y, cw, ch);
      ctx.lineTo(cur[0], cur[1]);
      ctx.stroke();
    }

    // ---- measure ----
    if (measureA) {
      const a = w2s(view, measureA.x, measureA.y, cw, ch);
      const b = w2s(view, crosshair ? crosshair.x : measureA.x, crosshair ? crosshair.y : measureA.y, cw, ch);
      ctx.strokeStyle = SEL;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ---- crosshair ----
    if (crosshair && !dragging) {
      const s = w2s(view, crosshair.x, crosshair.y, cw, ch);
      ctx.strokeStyle = hexA('#ffffff', 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, s[1]); ctx.lineTo(cw, s[1]);
      ctx.moveTo(s[0], 0); ctx.lineTo(s[0], ch);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawPad(ctx, view, cw, ch, wx, wy, pad, rot, sel, hiNet, netId) {
    const s = w2s(view, wx, wy, cw, ch);
    const hl = pad.net !== null && pad.net === hiNet && netId !== null;
    const col = hl ? NET_HI : '#d9b46a';
    ctx.save();
    ctx.translate(s[0], s[1]);
    ctx.rotate(rot * Math.PI / 180);
    const w = Math.max(1, pad.size[0] * view.zoom);
    const h = Math.max(1, pad.size[1] * view.zoom);
    ctx.fillStyle = col;
    if (pad.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (pad.shape === 'oval') {
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) / 2);
      ctx.fill();
    } else if (pad.shape === 'roundrect') {
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.25);
      ctx.fill();
    } else {
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    if (pad.drill) {
      ctx.fillStyle = BG;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0.5, pad.drill / 2 * view.zoom), 0, Math.PI * 2);
      ctx.fill();
    }
    if (pad.net != null && pad.netLabel && view.zoom >= 8) {
      ctx.fillStyle = '#000';
      ctx.font = `${Math.max(5, 0.4 * view.zoom)}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pad.netLabel, 0, 0);
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- schematic rendering (Eeschema-like) ----------
function renderSchematic(ctx, cw, ch, sch, view, opts) {
  opts = opts || {};
  ctx.fillStyle = '#f5f5dc';
  ctx.fillRect(0, 0, cw, ch);
  ctx.lineCap = 'round';
  ctx.textBaseline = 'middle';
  const S = 50; // symbol unit size
  ctx.save();
  ctx.translate(cw / 2 - view.x * view.zoom, ch / 2 - view.y * view.zoom);
  ctx.scale(view.zoom, view.zoom);

  // grid dots
  ctx.fillStyle = '#dcdcc8';
  const step = 50;
  const x0 = Math.floor((view.x - cw / 2 / view.zoom) / step) * step;
  const y0 = Math.floor((view.y - ch / 2 / view.zoom) / step) * step;
  const x1 = view.x + cw / 2 / view.zoom, y1 = view.y + ch / 2 / view.zoom;
  for (let gx = x0; gx <= x1; gx += step)
    for (let gy = y0; gy <= y1; gy += step) {
      ctx.beginPath();
      ctx.arc(gx, gy, 0.8 / view.zoom * 2, 0, Math.PI * 2);
      ctx.fill();
    }

  // wires
  ctx.strokeStyle = '#00aa00';
  ctx.lineWidth = 2 / view.zoom * 2;
  for (const w of sch.wires) {
    ctx.beginPath();
    w.pts.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
    ctx.stroke();
  }
  // junctions
  ctx.fillStyle = '#00aa00';
  for (const j of sch.junctions) {
    ctx.beginPath();
    ctx.arc(j.at.x, j.at.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // labels
  ctx.fillStyle = '#000000';
  for (const l of sch.labels) {
    ctx.font = '12px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(l.text, l.at.x, l.at.y - 6);
  }

  // symbols
  for (const sym of sch.symbols)
    drawSchematicSymbol(ctx, sym, opts.selSymId === sym.id);

  ctx.restore();
}

function drawSchematicSymbol(ctx, sym, selected) {
  const lib = window.KipadSymbols && window.KipadSymbols[sym.name];
  ctx.save();
  ctx.translate(sym.at.x, sym.at.y);
  ctx.rotate((sym.angle || 0) * Math.PI / 180);
  if (sym.mirror) ctx.scale(-1, 1);
  ctx.strokeStyle = selected ? '#007acc' : '#000000';
  ctx.fillStyle = selected ? '#007acc' : '#000000';
  ctx.lineWidth = 2;
  if (lib && lib.draw) {
    lib.draw(ctx, sym.value);
  } else {
    // fallback box
    ctx.strokeRect(-25, -25, 50, 50);
  }
  // reference + value
  ctx.font = 'italic 12px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(sym.ref || '?', 0, -38);
  ctx.font = '12px -apple-system, sans-serif';
  ctx.fillText(sym.value || sym.name, 0, 40);
  ctx.restore();
}

  return { LAYER_COLOR, NET_HI, SEL, BG, COPPER_LAYERS, makeView, w2s, s2w, render, drawPad,
    renderSchematic, drawSchematicSymbol };
})();
