/* Kipad — canvas renderer for PCB board. */
'use strict';

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.KipadRender = factory();
})(typeof self !== 'undefined' ? self : this, function (root) {
  root = root || (typeof globalThis !== 'undefined' ? globalThis : this);

  const LAYER_COLOR = {
    'F.Cu': '#c8341f',
    'B.Cu': '#0030ff',
    'F.SilkS': '#f2f2f2',
    'B.SilkS': '#f2f2f2',
    'Edge.Cuts': '#ffd24a'
  };
  const NET_HI = '#ffeb3b';
  const SEL = '#00d0ff';
  const BG = '#242424';
  const GRID_MINOR = '#2d2d2d';
  const GRID_MAJOR = '#3a3a3a';

  // world -> screen
  function makeView() { return { x: 0, y: 0, zoom: 3 }; } // zoom = px per mm

  function w2s(view, px, py, cw, ch) {
    return [(px - view.x) * view.zoom + cw / 2, (py - view.y) * view.zoom + ch / 2];
  }
  function s2w(view, sx, sy, cw, ch) {
    return [(sx - cw / 2) / view.zoom + view.x, (sy - ch / 2) / view.zoom + view.y];
  }

  function render(ctx, cw, ch, board, view, state) {
    // state: { selId, hiNet, route: {pts, layer}, gridSnap }
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cw, ch);

    const grid = 0.25; // mm minor; major every 1.0 mm
    const tl = s2w(view, 0, 0, cw, ch), br = s2w(view, cw, ch, cw, ch);
    ctx.lineWidth = 1;
    for (let gx = Math.floor(tl[0] / grid) * grid; gx <= br[0]; gx += grid) {
      const [sx] = w2s(view, gx, 0, cw, ch);
      ctx.strokeStyle = (Math.abs(gx - Math.round(gx)) < 1e-9) ? GRID_MAJOR : GRID_MINOR;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, ch); ctx.stroke();
    }
    for (let gy = Math.floor(tl[1] / grid) * grid; gy <= br[1]; gy += grid) {
      const [, sy] = w2s(view, 0, gy, cw, ch);
      ctx.strokeStyle = (Math.abs(gy - Math.round(gy)) < 1e-9) ? GRID_MAJOR : GRID_MINOR;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(cw, sy); ctx.stroke();
    }

    // origin cross
    const [ox, oy] = w2s(view, 0, 0, cw, ch);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ox - 8, oy); ctx.lineTo(ox + 8, oy);
    ctx.moveTo(ox, oy - 8); ctx.lineTo(ox, oy + 8); ctx.stroke();

    // ratsnest (under copper)
    if (state.showRats) {
      const lines = (root.KipadBoard || {}).ratsnest ? root.KipadBoard.ratsnest(board) : [];
      ctx.strokeStyle = 'rgba(200,200,200,0.35)';
      ctx.lineWidth = 1;
      for (const l of lines) {
        const [ax, ay] = w2s(view, l.a[0], l.a[1], cw, ch);
        const [bx, by] = w2s(view, l.b[0], l.b[1], cw, ch);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }

    // outline
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

    // footprints: silk + pads
    for (const fp of board.footprints) {
      const isSel = state.selId === fp.id;
      // pads
      for (const p of fp.pads) {
        const color = (state.hiNet != null && p.netId === state.hiNet) ? NET_HI
          : (isSel ? SEL : (LAYER_COLOR[fp.layer] || '#888'));
        drawPad(ctx, view, cw, ch, p, color);
      }
      // silk (fp lib lookup via KipadFootprints)
      const lib = (root.KipadFootprints || {}).getFootprint ? root.KipadFootprints.getFootprint(fp.lib) : null;
      if (lib && lib.silk) {
        ctx.strokeStyle = isSel ? SEL : 'rgba(242,242,242,0.85)';
        ctx.fillStyle = isSel ? SEL : '#f2f2f2';
        ctx.lineWidth = Math.max(1, 0.12 * view.zoom);
        ctx.font = `${Math.max(8, 1.2 * view.zoom)}px -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        for (const s of lib.silk) {
          // rotate silk by fp.angle around fp.at
          const t = (pt) => {
            const r = fp.angle * Math.PI / 180;
            const dx = pt[0] - fp.at[0], dy = pt[1] - fp.at[1];
            return [fp.at[0] + dx * Math.cos(r) - dy * Math.sin(r), fp.at[1] + dx * Math.sin(r) + dy * Math.cos(r)];
          };
          if (s.type === 'line') {
            const [ax, ay] = w2s(view, ...t(s.pts[0]), cw, ch);
            const [bx, by] = w2s(view, ...t(s.pts[1]), cw, ch);
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          } else if (s.type === 'circle') {
            const [cx, cy] = w2s(view, ...t(s.at), cw, ch);
            ctx.beginPath(); ctx.arc(cx, cy, s.r * view.zoom, 0, Math.PI * 2); ctx.stroke();
          } else if (s.type === 'text') {
            const [tx, ty] = w2s(view, ...t(s.at), cw, ch);
            ctx.save(); ctx.translate(tx, ty); ctx.rotate(fp.angle * Math.PI / 180);
            ctx.fillText(s.text, 0, 0); ctx.restore();
          }
        }
      }
      // ref label
      const [rx, ry] = w2s(view, fp.at[0], fp.at[1] - 1.8, cw, ch);
      ctx.fillStyle = isSel ? SEL : '#9a9a9a';
      ctx.font = `${Math.max(9, 1.4 * view.zoom)}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(fp.ref, rx, ry);
    }

    // tracks
    for (const t of board.tracks) {
      const color = (state.hiNet != null && t.netId === state.hiNet) ? NET_HI : (LAYER_COLOR[t.layer] || '#888');
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, t.width * view.zoom);
      ctx.lineCap = 'round';
      const [ax, ay] = w2s(view, t.start[0], t.start[1], cw, ch);
      const [bx, by] = w2s(view, t.end[0], t.end[1], cw, ch);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }

    // vias
    for (const v of board.vias) {
      const color = (state.hiNet != null && v.netId === state.hiNet) ? NET_HI : '#bbbbbb';
      const [vx, vy] = w2s(view, v.at[0], v.at[1], cw, ch);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, (v.size - v.drill) / 2 * view.zoom);
      ctx.beginPath(); ctx.arc(vx, vy, v.size / 2 * view.zoom, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = BG;
      ctx.beginPath(); ctx.arc(vx, vy, v.drill / 2 * view.zoom, 0, Math.PI * 2); ctx.fill();
    }

    // route in progress
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
      // preview to cursor
      if (state.route.cursor) {
        const [cx0, cy0] = w2s(view, state.route.pts[state.route.pts.length - 1][0], state.route.pts[state.route.pts.length - 1][1], cw, ch);
        const [cx1, cy1] = w2s(view, state.route.cursor[0], state.route.cursor[1], cw, ch);
        ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(cx1, cy1); ctx.stroke();
      }
    }
  }

  function drawPad(ctx, view, cw, ch, p, color) {
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
      const r = Math.min(w, h) * 0.25;
      roundRect(ctx, -w / 2, -h / 2, w, h, r); ctx.fill();
      if (p.drill) {
        ctx.fillStyle = BG;
        ctx.beginPath(); ctx.arc(0, 0, p.drill / 2 * view.zoom, 0, Math.PI * 2); ctx.fill();
      }
    } else { // rect / obround
      if (p.shape === 'obround') {
        ctx.beginPath(); ctx.arc(-(w - h) / 2, 0, h / 2, Math.PI / 2, -Math.PI / 2); ctx.fill();
        ctx.beginPath(); ctx.arc((w - h) / 2, 0, h / 2, -Math.PI / 2, Math.PI / 2); ctx.fill();
        ctx.fillRect(-(w - h) / 2, -h / 2, w - h, h);
      } else {
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
      if (p.drill) {
        ctx.fillStyle = BG;
        ctx.beginPath(); ctx.arc(0, 0, p.drill / 2 * view.zoom, 0, Math.PI * 2); ctx.fill();
      }
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

  return { LAYER_COLOR, NET_HI, SEL, makeView, w2s, s2w, render, drawPad };
});
