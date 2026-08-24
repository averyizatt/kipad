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
      return `rgba(${r},${g},${b},${a})`;
    }

    // ---- grid (dots, KiCad style) ----
    const grid = state.grid || 0.25;
    // Never draw sub-pixel grid dots, and hard-cap dots per frame: at the
    // default 3 px/mm a 0.25 mm grid would otherwise issue >1M canvas arcs
    // (the PCB-entry stall), and huge windows could still draw ~500k.
    let drawGrid = grid;
    const tl = s2w(view, 0, 0, cw, ch), br = s2w(view, cw, ch, cw, ch);
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
          const major = (Math.abs(gx - Math.round(gx)) < 1e-9) && (Math.abs(gy - Math.round(gy)) < 1e-9);
          if (major !== wantMajor) continue;
          const [sx, sy] = w2s(view, gx, gy, cw, ch);
          ctx.moveTo(sx + r, sy);
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
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

    // ---- copper zones (solid fills, drawn under tracks/pads) ----
    // state.zoneFills: Map(zone.id -> KipadZones.fillZone result). Zones on
    // the inactive copper layer are skipped, like KiCad's layer focus.
    if (board.zones && board.zones.length) {
      for (const z of board.zones) {
        if (z.layer !== (state.activeLayer || 'F.Cu')) continue;
        if (!isVisible(state, z.layer)) continue;
        const zc = LAYER_COLOR[z.layer] || '#888';
        const sel = state.selKind === 'zone' && state.selId === z.id;
        const fill = state.zoneFills ? state.zoneFills.get(z.id) : null;
        if (fill && fill.runs && fill.runs.length) {
          ctx.fillStyle = hexA(zc, 0.6);
          ctx.beginPath();
          for (const run of fill.runs) {
            const x0 = fill.ox + run[1] * fill.cellSize;
            const y0 = fill.oy + run[0] * fill.cellSize;
            const w = (run[2] - run[1] + 1) * fill.cellSize;
            const [rx, ry] = w2s(view, x0, y0, cw, ch);
            ctx.rect(rx, ry, Math.max(1, w * view.zoom), Math.max(1, fill.cellSize * view.zoom));
          }
          ctx.fill();
        }
        // subtle outline (+ KiCad-green highlight when selected)
        ctx.strokeStyle = sel ? SEL : hexA(zc, 0.8);
        ctx.lineWidth = sel ? 2 : 1;
        ctx.beginPath();
        for (let i = 0; i < z.outline.length; i++) {
          const [px, py] = w2s(view, z.outline[i].x, z.outline[i].y, cw, ch);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    // ---- zone placement in progress ----
    if (state.zoneDraft && state.zoneDraft.length > 1) {
      const pts = state.zoneDraft;
      ctx.strokeStyle = SEL;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [sx, sy] = w2s(view, pts[i][0], pts[i][1], cw, ch);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // first-point marker (tap near it to close) + vertex dots
      const [fx, fy] = w2s(view, pts[0][0], pts[0][1], cw, ch);
      ctx.strokeStyle = SEL;
      ctx.beginPath(); ctx.arc(fx, fy, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = SEL;
      for (const p of pts) {
        const [sx, sy] = w2s(view, p[0], p[1], cw, ch);
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }
    }

    // ---- free board text (F/B silkscreen) ----
    for (const t of board.texts || []) {
      if (!isVisible(state, t.layer)) continue;
      const [tx, ty] = w2s(view, t.at[0], t.at[1], cw, ch);
      const selected = state.selKind === 'text' && state.selId === t.id;
      const sizePx = Math.max(6, (t.size || 1.5) * view.zoom);
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate((t.angle || 0) * Math.PI / 180);
      ctx.fillStyle = selected ? SEL : (LAYER_COLOR[t.layer] || '#f2eda1');
      ctx.font = `500 ${sizePx}px -apple-system, sans-serif`;
      ctx.textAlign = t.justify || 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.text, 0, 0);
      if (selected) {
        const w = Math.max(sizePx, ctx.measureText(t.text).width);
        ctx.strokeStyle = SEL; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
        const x0 = t.justify === 'left' ? 0 : (t.justify === 'right' ? -w : -w / 2);
        ctx.strokeRect(x0 - 3, -sizePx * 0.65, w + 6, sizePx * 1.3);
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    if (state.textPreview) {
      const t = state.textPreview;
      const [tx, ty] = w2s(view, t.at[0], t.at[1], cw, ch);
      ctx.save(); ctx.translate(tx, ty); ctx.rotate((t.angle || 0) * Math.PI / 180);
      ctx.globalAlpha = 0.65; ctx.fillStyle = LAYER_COLOR[t.layer] || '#f2eda1';
      ctx.font = `500 ${Math.max(6, (t.size || 1.5) * view.zoom)}px -apple-system, sans-serif`;
      ctx.textAlign = t.justify || 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t.text, 0, 0);
      ctx.restore();
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

      // fab + silk (library graphics when available, else graphics stored
      // directly on the placed footprint — imported .kicad_mod parts and
      // image-converter logos keep their art this way)
      const silkItems = (lib && lib.silk && lib.silk.length) ? lib.silk : (fp.silk || []);
      if (silkItems.length) {
        for (const s of silkItems) {
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
          } else if (s.type === 'rect') {
            const a = t([Math.min(s.start[0], s.end[0]), Math.min(s.start[1], s.end[1])]);
            const b = t([Math.max(s.start[0], s.end[0]), Math.max(s.start[1], s.end[1])]);
            const [ax, ay] = w2s(view, a[0], a[1], cw, ch);
            const [bx, by] = w2s(view, b[0], b[1], cw, ch);
            ctx.strokeRect(ax, ay, bx - ax, by - ay);
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
      // dim pads on the inactive side (tracks use the same rule)
      const onActive = fp.layer === (state.activeLayer || 'F.Cu');
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
      const segs = (typeof KipadBoard !== 'undefined' && KipadBoard.trackSegments)
        ? KipadBoard.trackSegments(t)
        : [{ ax: t.start[0], ay: t.start[1], bx: t.end[0], by: t.end[1] }];
      ctx.beginPath();
      for (let si = 0; si < segs.length; si++) {
        const [ax, ay] = w2s(view, segs[si].ax, segs[si].ay, cw, ch);
        const [bx, by] = w2s(view, segs[si].bx, segs[si].by, cw, ch);
        if (si === 0) ctx.moveTo(ax, ay); else ctx.lineTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
    }

    // ---- vias ----
    for (const v of board.vias) {
      const color = (state.hiNet != null && v.netId === state.hiNet) ? NET_HI : '#c0c0c0';
      const [vx, vy] = w2s(view, v.at[0], v.at[1], cw, ch);
      ctx.strokeStyle = color;
      // annulus between drill/2 and size/2: stroke a mid-radius circle whose
      // half-width reaches exactly those edges
      ctx.lineWidth = Math.max(1.5, (v.size - v.drill) / 2 * view.zoom);
      ctx.beginPath(); ctx.arc(vx, vy, (v.size + v.drill) / 4 * view.zoom, 0, Math.PI * 2); ctx.stroke();
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
        // 45°-constrained preview: elbow path instead of a straight free-angle line
        const tail = KipadRoute.elbow(last, state.route.cursor, state.route.posture || 'diag');
        ctx.beginPath();
        let started = false;
        for (const p of [last].concat(tail)) {
          const [sx, sy] = w2s(view, p[0], p[1], cw, ch);
          if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
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
    } else if (p.shape === 'custom' && p.primitives && p.primitives.length) {
      const z = view.zoom;
      for (const prim of p.primitives) {
        if (prim.kind === 'gr_line') {
          ctx.lineWidth = Math.max(1, (prim.width || 0.1) * z);
          ctx.beginPath();
          ctx.moveTo(prim.start[0] * z, prim.start[1] * z);
          ctx.lineTo(prim.end[0] * z, prim.end[1] * z);
          ctx.stroke();
        }
      }
      ctx.beginPath();
      for (const prim of p.primitives) {
        if (prim.kind === 'gr_poly' && prim.pts && prim.pts.length >= 2) {
          ctx.moveTo(prim.pts[0][0] * z, prim.pts[0][1] * z);
          for (let pi = 1; pi < prim.pts.length; pi++)
            ctx.lineTo(prim.pts[pi][0] * z, prim.pts[pi][1] * z);
          ctx.closePath();
        } else if (prim.kind === 'gr_rect') {
          const x1 = Math.min(prim.start[0], prim.end[0]) * z;
          const y1 = Math.min(prim.start[1], prim.end[1]) * z;
          const rw = Math.abs(prim.end[0] - prim.start[0]) * z;
          const rh = Math.abs(prim.end[1] - prim.start[1]) * z;
          if (prim.fill) ctx.rect(x1, y1, rw, rh);
          else { ctx.lineWidth = Math.max(1, (prim.width || 0.1) * z); ctx.strokeRect(x1, y1, rw, rh); }
        } else if (prim.kind === 'gr_circle') {
          const cr = Math.hypot(prim.end[0] - prim.center[0], prim.end[1] - prim.center[1]) * z;
          if (prim.fill) {
            ctx.moveTo(prim.center[0] * z + cr, prim.center[1] * z);
            ctx.arc(prim.center[0] * z, prim.center[1] * z, cr, 0, Math.PI * 2);
          } else {
            ctx.lineWidth = Math.max(1, (prim.width || 0.1) * z);
            ctx.beginPath();
            ctx.arc(prim.center[0] * z, prim.center[1] * z, cr, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
          }
        }
      }
      ctx.fill();
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
  ctx.fillStyle = '#f5f4ef';   // KiCad schematic paper background
  ctx.fillRect(0, 0, cw, ch);

  // grid — KiCad eeschema style: 1px dots in LAYER_SCHEMATIC_GRID grey
  // (#B5B5B5, builtin_color_themes.h Kicad 2007 light theme), plus the grid
  // axes cross through the world origin in LAYER_SCHEMATIC_GRID_AXES blue.
  const grid = state.grid || 0.25;
  const z = view.zoom;
  const step = grid * z;
  if (step > 3) {
    const x0 = (-view.x * z);
    const y0 = (-view.y * z);
    ctx.fillStyle = 'rgb(181,181,181)';
    const d = step > 10 ? 2 : 1;   // slightly larger dots when zoomed in
    for (let gx = x0 % step; gx < cw; gx += step) {
      for (let gy = y0 % step; gy < ch; gy += step) {
        ctx.fillRect(gx, gy, d, d);
      }
    }
    // axes at world origin (KiCad draws these by default in schematic mode)
    const [ox, oy] = w2s(view, 0, 0, cw, ch);
    ctx.strokeStyle = 'rgb(0,0,132)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, oy); ctx.lineTo(cw, oy);
    ctx.moveTo(ox, 0); ctx.lineTo(ox, ch);
    ctx.stroke();
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

  // no-connect flags (KiCad: dark-blue X at the pin tip)
  if (sch.noConnects && sch.noConnects.length) {
    ctx.strokeStyle = '#000084';
    ctx.lineWidth = 2;
    for (const nc of sch.noConnects) {
      const [sx, sy] = w2s(view, nc.at[0], nc.at[1], cw, ch);
      const r = Math.max(4, 0.635 * z);   // world half-diagonal 0.635 mm, min screen size
      ctx.beginPath();
      ctx.moveTo(sx - r, sy - r); ctx.lineTo(sx + r, sy + r);
      ctx.moveTo(sx - r, sy + r); ctx.lineTo(sx + r, sy - r);
      ctx.stroke();
    }
  }

  // symbols
  for (const sym of sch.symbols) {
    const def = (S && S.getSymbol) ? S.getSymbol(sym.libId) : null;
    if (!def) continue;
    drawSchematicSymbol(ctx, cw, ch, view, sym, def, sym.id === state.selSymId);
  }

  // labels — local: near-black text right of the anchor (LAYER_LOCLABEL
  // #0F0F0F). global: KiCad flag/banner docked on the anchor, dark red
  // outline + text (LAYER_GLOBLABEL #840000).
  ctx.textBaseline = 'middle';
  for (const l of sch.labels) {
    const [sx, sy] = w2s(view, l.at[0], l.at[1], cw, ch);
    if ((l.type || 'local') === 'global') {
      const h = Math.max(12, Math.min(1.905 * z, 40));   // banner height ~1.9 mm world, clamped
      const pad = h * 0.35;
      ctx.font = Math.round(h * 0.62) + 'px system-ui, sans-serif';
      const tw = ctx.measureText(l.text).width;
      const tip = 8;                                     // pointed end length
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + tip, sy - h / 2);
      ctx.lineTo(sx + tip + tw + pad * 2, sy - h / 2);
      ctx.lineTo(sx + tip + tw + pad * 2, sy + h / 2);
      ctx.lineTo(sx + tip, sy + h / 2);
      ctx.closePath();
      ctx.fillStyle = '#f5f4ef';                          // paper fill so it occludes wires
      ctx.fill();
      ctx.strokeStyle = '#840000';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#840000';
      ctx.fillText(l.text, sx + tip + pad, sy);
    } else {
      ctx.fillStyle = '#0f0f0f';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(l.text, sx + 6, sy);
    }
  }

  // ERC violation markers (KiCad-style X-in-circle, precomputed by app via
  // KipadErc.markers — r is already in screen px)
  if (state.ercMarkers && state.ercMarkers.length) {
    for (const m of state.ercMarkers) {
      const [sx, sy] = w2s(view, m.x, m.y, cw, ch);
      const r = m.r;
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
      const k = r * 0.5;
      ctx.beginPath();
      ctx.moveTo(sx - k, sy - k); ctx.lineTo(sx + k, sy + k);
      ctx.moveTo(sx - k, sy + k); ctx.lineTo(sx + k, sy - k);
      ctx.stroke();
    }
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
