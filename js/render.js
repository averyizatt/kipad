/* Kipad — canvas renderer, KiCad 8-style. */
'use strict';

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.KipadRender = factory();
})(typeof self !== 'undefined' ? self : this, function (root) {
  root = root || (typeof globalThis !== 'undefined' ? globalThis : this);

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
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cw, ch);

    function hexA(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return `rgba(${r},${g},${b},${a})`;
    }
    const dim = (color, on) => on ? color : hexA(color, 0.38);

    const grid = state.grid || 0.25;
    const tl = s2w(view, 0, 0, cw, ch), br = s2w(view, cw, ch, cw, ch);
    const startX = Math.floor(tl[0] / grid) * grid;
    const startY = Math.floor(tl[1] / grid) * grid;
    for (let gx = startX; gx <= br[0]; gx += grid) {
      for (let gy = startY; gy <= br[1]; gy += grid) {
        const major = (Math.abs(gx - Math.round(gx)) < 1e-9) && (Math.abs(gy - Math.round(gy)) < 1e-9);
        const [sx, sy] = w2s(view, gx, gy, cw, ch);
        ctx.fillStyle = major ? GRID_MAJOR : GRID_MINOR;
        ctx.beginPath(); ctx.arc(sx, sy, major ? 1.4 : 0.8, 0, Math.PI * 2); ctx.fill();
      }
    }

    const [ox, oy] = w2s(view, 0, 0, cw, ch);
    ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ox - 10, oy); ctx.lineTo(ox + 10, oy);
    ctx.moveTo(ox, oy - 10); ctx.lineTo(ox, oy + 10); ctx.stroke();

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

    for (const fp of board.footprints) {
      const isSel = state.selId === fp.id;
      const lib = (root.KipadFootprints || {}).getFootprint ? root.KipadFootprints.getFootprint(fp.lib) : null;
      const t = (pt) => {
        const r = fp.angle * Math.PI / 180;
        const dx = pt[0] - fp.at[0], dy = pt[1] - fp.at[1];
        return [fp.at[0] + dx * Math.cos(r) - dy * Math.sin(r), fp.at[1] + dx * Math.sin(r) + dy * Math.cos(r)];
      };

      if (lib && lib.courtyard && isVisible(state, 'F.CrtYd')) {
        const a = t([lib.courtyard.min[0], lib.courtyard.min[1]]);
        const b = t([lib.courtyard.max[0], lib.courtyard.max[1]]);
        const [ax, ay] = w2s(view, a[0], a[1], cw, ch);
        const [bx, by] = w2s(view, b[0], b[1], cw, ch);
        ctx.strokeStyle = isSel ? SEL : 'rgba(200,200,0,0.75)';
        ctx.lineWidth = 1;
        ctx.strokeRect(ax, ay, bx - ax, by - ay);
      }

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

      const onActive = fp.layer === (state.activeLayer || 'F.Cu') || fp.layer !== 'B.Cu';
      for (const p of fp.pads) {
        const copper = LAYER_COLOR[fp.layer] || '#888';
        const color = (state.hiNet != null && p.netId === state.hiNet) ? NET_HI
          : (isSel ? SEL : dim(copper, onActive));
        drawPad(ctx, view, cw, ch, p, color, isSel);
      }

      const [rx, ry] = w2s(view, fp.at[0], fp.at[1] - (lib && lib.courtyard ? (lib.courtyard.max[1] - lib.courtyard.min[1]) / 2 + 0.8 : 1.8), cw, ch);
      ctx.fillStyle = isSel ? SEL : '#c8c8c8';
      ctx.font = `${Math.max(8, 1.3 * view.zoom)}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(fp.ref, rx, ry);
    }

    for (const t of board.tracks) {
      if (!isVisible(state, t.layer)) continue;
      const onActive = t.layer === (state.activeLayer || 'F.Cu');
      const color = (state.hiNet != null && t.netId === state.hiNet) ? NET_HI
        : dim(LAYER_COLOR[t.layer] || '#888', onActive);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, t.width * view.zoom);
      ctx.lineCap = 'round';
      const [ax, ay] = w2s(view, t.start[0], t.start[1], cw, ch);
      const [bx, by] = w2s(view, t.end[0], t.end[1], cw, ch);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }

    for (const v of board.vias) {
      const color = (state.hiNet != null && v.netId === state.hiNet) ? NET_HI : '#c0c0c0';
      const [vx, vy] = w2s(view, v.at[0], v.at[1], cw, ch);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, (v.size - v.drill) / 2 * view.zoom);
      ctx.beginPath(); ctx.arc(vx, vy, v.size / 2 * view.zoom, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = BG;
      ctx.beginPath(); ctx.arc(vx, vy, v.drill / 2 * view.zoom, 0, Math.PI * 2); ctx.fill();
    }

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

  return { LAYER_COLOR, NET_HI, SEL, BG, COPPER_LAYERS, makeView, w2s, s2w, render, drawPad };
});
