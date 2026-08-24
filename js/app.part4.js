/* Kipad main app, part 4: pointer/keyboard input, menus, toolbar wiring, library loading, init. */
'use strict';

  // ---------- pointer handling ----------
  // iPadOS-style two-finger tap = undo (recognizer is pure, see js/gestures.js)
  const twoTap = KipadGestures.twoFingerTap();

  function updatePenHud(e) {
    const h = $('hud-pen');
    if (!h) return;
    const p = KipadGestures.penInfo(e);
    if (!p.isPen) return;
    h.classList.remove('hidden');
    h.textContent = p.eraser ? '⌫ Eraser' : '✏' + (p.altitude == null ? '' : ' ' + Math.round(p.altitude) + '°');
  }

  function eraseAt(wx, wy) {
    if (mode === 'schematic') {
      const tol = Math.max(0.3, 10 / view.zoom);
      const nc = (sch.noConnects || []).find(n => Math.hypot(n.at[0] - wx, n.at[1] - wy) <= tol);
      const sym = nc ? null : schHitSymbol(wx, wy);
      if (!nc && !sym) { setStatus('Eraser: nothing under Pencil'); return; }
      schSelNc = nc ? nc.id : null;
      schSelId = sym ? sym.id : null;
      schDoDelete();
      setStatus('Pencil eraser: deleted ' + (nc ? 'no-connect flag' : 'symbol'));
      return;
    }
    const hit = B.hitPad(board, wx, wy, pickTol()) || B.hitFootprint(board, wx, wy, pickTol());
    const tr = hit ? null : B.hitTrack(board, wx, wy, pickTol(6));
    const via = hit || tr ? null : B.hitVia(board, wx, wy, pickTol(6));
    const text = hit || tr || via ? null : B.hitText(board, wx, wy, pickTol());
    const zone = hit || tr || via || text ? null : hitZone(wx, wy);
    const id = hit ? (hit.fp ? hit.fp.id : hit.id) : tr ? tr.id : via ? via.id : text ? text.id : zone ? zone.id : null;
    if (!id) { setStatus('Eraser: nothing under Pencil'); return; }
    selId = id;
    selKind = hit ? 'footprint' : tr ? 'track' : via ? 'via' : text ? 'text' : 'zone';
    const erasedKind = selKind;
    doDelete();
    setStatus('Pencil eraser: deleted ' + erasedKind);
  }

  canvas.addEventListener('pointerdown', e => {
    const penHud = $('hud-pen');
    if (e.pointerType === 'pen') {
      penDown = e.pointerId;
      updatePenHud(e);
      if (KipadGestures.penInfo(e).eraser) {
        eraserPointers.add(e.pointerId);
        const [ex, ey] = s2w(e.clientX, e.clientY);
        eraseAt(ex, ey);
        e.preventDefault();
        return;
      }
      const now = Date.now();
      const drawing = mode === 'schematic'
        ? (schTool === 'wire' && schWirePts.length > 0) || schTool === 'symbol'
        : tool === 'track' ? !!route : !!(gfxStart || measureA) || tool === 'footprint' || (tool === 'zone' && !!zonePts);
      if (now - lastPenTap < 350 && !drawing) {
        lastPenTap = 0;
        if (mode === 'schematic') { if (schTool !== 'select') { setSchTool('select'); setStatus('Pencil double-tap → Select'); } }
        else if (tool !== 'select') { setTool('select'); setStatus('Pencil double-tap → Select'); }
        render(); refreshAll();
        return;
      }
      lastPenTap = now;
    }
    // palm rejection: ignore fingers while the pencil is down
    if (e.pointerType === 'touch' && penDown !== null) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [wx, wy] = s2w(e.clientX, e.clientY);
    crosshair = [wx, wy];
    twoTap.feed({ type: 'down', id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });

    if (mode === 'schematic') {
      // multi-touch (pinch zoom / two-finger tap) must not place parts or wire points
      if (pointers.size < 2) schPointerDown(wx, wy, e);
      return;
    }

    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      return;
    }

    if (tool === 'footprint' && placeLib) {
      pushUndo();
      B.placeFootprint(board, placeLib, [snap(wx), snap(wy)], placeAngle, layer);
      selId = board.footprints[board.footprints.length - 1].id;
      selKind = 'footprint';
      render(); refreshAll();
      return;
    }
    if (tool === 'track') {
      if (!route) startRoute(wx, wy);
      else extendRoute(wx, wy);
      render();
      return;
    }
    if (tool === 'via') {
      addViaHere(wx, wy);
      return;
    }
    if (tool === 'text' && textPlace) {
      pushUndo();
      const t = B.addText(board, { ...textPlace, at: [snap(wx), snap(wy)] });
      selId = t.id; selKind = 'text';
      textPlace = null;
      setTool('select');
      refreshAll(); render();
      setStatus('Text placed — edit it in Properties');
      return;
    }
    if (tool === 'zone') {
      const p = [snap(wx), snap(wy)];
      if (!zonePts) {
        // same net assignment flow as routing: pad under the start point,
        // else the highlighted net
        let netId = 0;
        const hit = B.hitPad(board, wx, wy, pickTol());
        if (hit) netId = hit.pad.netId;
        else if (hiNet != null) netId = hiNet;
        zonePts = { pts: [p], netId };
        setStatus('Zone on ' + layer + ' net "' + B.netName(board, netId) + '" — tap points, tap near the ring / double-tap to close');
      } else if (zonePts.pts.length >= 3 && Math.hypot(p[0] - zonePts.pts[0][0], p[1] - zonePts.pts[0][1]) < Math.max(0.5, grid)) {
        finishZone();
      } else {
        const last = zonePts.pts[zonePts.pts.length - 1];
        if (last[0] !== p[0] || last[1] !== p[1]) zonePts.pts.push(p);
      }
      render();
      return;
    }
    if (tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'arc') {
      if (!gfxStart) startGfx(wx, wy);
      else extendGfx(wx, wy);
      render();
      return;
    }
    if (tool === 'measure') {
      if (!measureA) {
        measureA = [wx, wy]; measureB = null; measureCur = null;
        setStatus('Measure: tap second point');
      } else {
        measureB = [wx, wy];
        const d = Math.hypot(measureB[0] - measureA[0], measureB[1] - measureA[1]);
        setStatus('Distance: ' + d.toFixed(3) + ' mm (ΔX ' + Math.abs(measureB[0] - measureA[0]).toFixed(3) + ', ΔY ' + Math.abs(measureB[1] - measureA[1]).toFixed(3) + ')');
        measureA = null; measureB = null;
      }
      render();
      return;
    }
    if (tool === 'highlight') {
      const hit = B.hitPad(board, wx, wy, pickTol());
      hiNet = hit ? hit.pad.netId : null;
      refreshNets(); render();
      return;
    }

    // select tool
    const padHit = B.hitPad(board, wx, wy, pickTol());
    const fpHit = B.hitFootprint(board, wx, wy, pickTol());
    const trHit = B.hitTrack(board, wx, wy, pickTol(3));
    const viaHit = B.hitVia(board, wx, wy, pickTol(3));
    const textHit = B.hitText(board, wx, wy, pickTol());
    if (padHit) {
      selId = padHit.fp.id; selKind = 'footprint';
      hiNet = padHit.pad.netId;
      dragging = { fpId: padHit.fp.id, dx: wx - padHit.fp.at[0], dy: wy - padHit.fp.at[1], moved: false };
    } else if (fpHit) {
      selId = fpHit.id; selKind = 'footprint';
      dragging = { fpId: fpHit.id, dx: wx - fpHit.at[0], dy: wy - fpHit.at[1], moved: false };
    } else if (trHit) {
      selId = trHit.id; selKind = 'track';
      dragging = { pan: true };
      lastPan = { x: e.clientX, y: e.clientY };
    } else if (viaHit) {
      selId = viaHit.id; selKind = 'via';
      dragging = { pan: true };
      lastPan = { x: e.clientX, y: e.clientY };
    } else if (textHit) {
      selId = textHit.id; selKind = 'text';
      dragging = { textId: textHit.id, dx: wx - textHit.at[0], dy: wy - textHit.at[1], moved: false };
    } else {
      const zHit = hitZone(wx, wy);
      if (zHit) {
        selId = zHit.id; selKind = 'zone';
        dragging = { pan: true };
        lastPan = { x: e.clientX, y: e.clientY };
      } else {
        selId = null; selKind = null; hiNet = null;
        dragging = { pan: true };
        lastPan = { x: e.clientX, y: e.clientY };
      }
    }
    render(); refreshAll();
  });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'pen') updatePenHud(e);
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    twoTap.feed({ type: 'move', id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
    const [wx, wy] = s2w(e.clientX, e.clientY);
    crosshair = [wx, wy];

    if (mode === 'schematic') {
      schWireCur = (schTool === 'wire' && schWirePts.length) ? [snap(wx), snap(wy)] : null;
      if (schDrag && schDrag.pan) {
        const dx = (e.clientX - lastPan.x) / view.zoom;
        const dy = (e.clientY - lastPan.y) / view.zoom;
        view.x -= dx; view.y -= dy;
        lastPan = { x: e.clientX, y: e.clientY };
      } else if (schDrag && schDrag.symId) {
        const s = sch.symbols.find(x => x.id === schDrag.symId);
        if (s) { Sch.moveSymbol(sch, s.id, [snap(wx - schDrag.dx), snap(wy - schDrag.dy)]); }
      }
      render();
      return;
    }

    routeCursor = (tool === 'track' && route) ? [wx, wy] : null;
    if (measureA) measureCur = [wx, wy];

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
        if (!dragging.moved) { pushUndo(); dragging.moved = true; }
        B.moveFootprint(board, fp.id, [snap(wx - dragging.dx), snap(wy - dragging.dy)]);
        render();
      }
    } else if (dragging && dragging.textId) {
      if (!dragging.moved) { pushUndo(); dragging.moved = true; }
      B.moveText(board, dragging.textId, [snap(wx - dragging.dx), snap(wy - dragging.dy)]);
      render();
    } else {
      render();
    }
  });

  canvas.addEventListener('pointerup', e => {
    if (e.pointerType === 'pen' && e.pointerId === penDown) { penDown = null; const h = $('hud-pen'); if (h) h.classList.add('hidden'); }
    if (eraserPointers.delete(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = null;
    const wasDragging = dragging;
    dragging = null; lastPan = null;

    if (twoTap.feed({ type: 'up', id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }) === 'undo') {
      applyKeyAction('undo');
      setStatus('Two-finger tap → Undo');
      return;
    }

    if (mode === 'schematic') {
      const now2 = Date.now();
      if (schTool === 'wire' && schWirePts.length >= 2 && now2 - lastTap < 350) {
        finishSchWire();
        lastTap = 0;
        render();
        return;
      }
      lastTap = now2;
      if (schDrag && schDrag.symId) schPushUndo();
      schDrag = null;
      schWireCur = null;
      render();
      return;
    }

    const now = Date.now();
    if ((tool === 'track' && route) || ((tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'arc') && gfxStart) || (tool === 'zone' && zonePts && zonePts.pts.length >= 3)) {
      if (now - lastTap < 350) {
        if (tool === 'track') finishRoute();
        else if (tool === 'zone') finishZone();
        else { outlinePts = null; gfxStart = null; render(); }
        lastTap = 0;
        return;
      }
    }
    lastTap = now;
  });

  canvas.addEventListener('pointercancel', e => {
    if (eraserPointers.delete(e.pointerId)) {
      if (e.pointerType === 'pen' && e.pointerId === penDown) { penDown = null; const h = $('hud-pen'); if (h) h.classList.add('hidden'); }
      return;
    }
    twoTap.feed({ type: 'cancel', id: e.pointerId });
    if (e.pointerType === 'pen' && e.pointerId === penDown) { penDown = null; const h = $('hud-pen'); if (h) h.classList.add('hidden'); }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = null;
    dragging = null; lastPan = null;
  });

  canvas.addEventListener('pointerleave', () => { crosshair = null; if (penDown !== null) { const h = $('hud-pen'); if (h) h.classList.add('hidden'); } });

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

  function schPointerDown(wx, wy, pe) {
    const sx = snap(wx), sy = snap(wy);
    if (schTool === 'symbol' && schPlaceName) {
      schPushUndo();
      const s = Sch.placeSymbol(sch, schPlaceName, [sx, sy], schAngle);
      schSelId = s.id;
      render(); refreshAll();
      setStatus('Placed ' + s.ref + ' — tap to place more, R rotates');
      return;
    }
    if (schTool === 'wire') {
      if (!schWirePts.length) {
        schWirePts = [[sx, sy]];
        setStatus('Wire: tap to add corner, double-tap to finish');
      } else {
        // finish on double-tap (handled in pointerup) or continue
        const last = schWirePts[schWirePts.length - 1];
        if (Math.abs(last[0] - sx) > 1e-9 || Math.abs(last[1] - sy) > 1e-9) {
          schWirePts.push([sx, sy]);
        }
        // junction when landing on existing wire/pin
        maybeJunction(sx, sy);
      }
      render();
      return;
    }
    if (schTool === 'label' || schTool === 'glabel') {
      const isGlobal = schTool === 'glabel';
      const text = prompt(isGlobal ? 'Global net label text:' : 'Net label text:');
      if (text && text.trim()) {
        schPushUndo();
        Sch.addLabel(sch, text.trim(), [sx, sy], 0, isGlobal ? 'global' : 'local');
        render(); refreshAll();
        setStatus((isGlobal ? 'Global label ' : 'Label ') + text.trim());
      }
      return;
    }
    if (schTool === 'junction') {
      schPushUndo();
      Sch.addJunction(sch, [sx, sy]);
      render();
      return;
    }
    if (schTool === 'noconn') {
      // KiCad snaps the flag onto a pin tip when one is close; otherwise it
      // lands on the grid point so a wire can be run to it later.
      let at = [sx, sy], best = null, bestD = 0.635;
      for (const sym of sch.symbols) {
        for (const p of Sch.pinPositions(sym, Syms.getSymbol)) {
          const d = Math.hypot(p.at[0] - wx, p.at[1] - wy);
          if (d <= bestD) { bestD = d; best = [p.at[0], p.at[1]]; }
        }
      }
      if (best) at = best;
      if ((sch.noConnects || []).some(n => Math.hypot(n.at[0] - at[0], n.at[1] - at[1]) < 0.01)) {
        setStatus('No-connect flag already here');
        return;
      }
      schPushUndo();
      Sch.addNoConnect(sch, at);
      render();
      setStatus(best ? 'No-connect flag on pin' : 'No-connect flag placed');
      return;
    }
    // select tool
    // ERC markers sit on top of the schematic — tapping one reports it before
    // symbol hit-testing (markers are drawn at the violation's exact coords).
    if (showErcMarkers && Erc && ercViolations.length) {
      const tol = Math.max(0.2, 10 / view.zoom);   // ~10 px screen tolerance
      let best = null, bestD = Infinity;
      for (const v of ercViolations) {
        if (typeof v.x !== 'number') continue;
        const d = Math.hypot(v.x - wx, v.y - wy);
        if (d <= tol && d < bestD) { best = v; bestD = d; }
      }
      if (best) {
        schSelId = best.symbolId || null;
        setStatus('ERC ' + best.code + ': ' + best.message);
        render(); refreshAll();
        return;
      }
    }
    const hitNcTol = Math.max(0.3, 10 / view.zoom);
    const ncHit = (sch.noConnects || []).find(n => Math.hypot(n.at[0] - wx, n.at[1] - wy) <= hitNcTol);
    if (ncHit) {
      schSelId = null; schSelNc = ncHit.id;
      setStatus('No-connect flag selected — ⌫ deletes');
      render(); refreshAll();
      return;
    }
    const hit = schHitSymbol(wx, wy);
    if (hit) {
      schSelId = hit.id; schSelNc = null;
      schDrag = { symId: hit.id, dx: wx - hit.at[0], dy: wy - hit.at[1] };
    } else {
      schSelId = null; schSelNc = null;
      schDrag = { pan: true };
      // seed from the real pointer position — stale (0,0) seeds here made the
      // first empty-canvas drag jump the schematic view
      lastPan = { x: pe.clientX, y: pe.clientY };
    }
    render(); refreshAll();
  }

  function maybeJunction(x, y) {
    // add junction if another wire/pin point coincides
    for (const w of sch.wires) {
      for (const p of w.pts) {
        if (Math.hypot(p[0] - x, p[1] - y) < 0.01) { Sch.addJunction(sch, [x, y]); return; }
      }
    }
  }

  function finishSchWire() {
    if (schWirePts.length < 2) { schWirePts = []; render(); return; }
    schPushUndo();
    Sch.addWire(sch, schWirePts);
    schWirePts = [];
    render(); refreshAll();
    setStatus('Wire placed');
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // KiCad-parity bindings (save/open/undo/redo, zoom, properties, add, nudge)
    const keyAct = KipadKeys.resolve(e, {
      mode: mode,
      hasSelection: mode === 'schematic' ? !!schSelId : !!selId
    });
    if (keyAct) { e.preventDefault(); applyKeyAction(keyAct); return; }
    if (mode === 'schematic') {
      switch (e.key) {
        case 's': case 'S': setSchTool('select'); break;
        case 'w': case 'W': setSchTool('wire'); break;
        case 'l': case 'L': setSchTool('label'); break;
        case 'j': case 'J': setSchTool('junction'); break;
        case 'q': case 'Q': setSchTool('noconn'); break;
        case 'r': case 'R': schDoRotate(); break;
        case 'g': case 'G': cycleGrid(); break;
        case 'h': case 'H':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); setSchTool('glabel'); }   // KiCad legacy Ctrl+H = Add Global Label
          break;
        case 'Delete': case 'Backspace': e.preventDefault(); schDoDelete(); break;
        case 'Enter': if (schTool === 'wire' && schWirePts.length) finishSchWire(); break;
        case 'Escape':
          schWirePts = []; schPlaceName = null; schSelNc = null; setSchTool('select'); break;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? schRedoStep() : schUndoStep(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); schRedoStep(); }
      return;
    }
    switch (e.key) {
      case 's': case 'S': setTool('select'); break;
      case 'h': case 'H': setTool('highlight'); break;
      case 'f': case 'F': setTool('footprint'); break;
      case 'x': case 'X': setTool('track'); break;
      case 'v': case 'V':
        if (tool === 'track' && route && route.pts.length) {
          addViaHere(route.pts[route.pts.length - 1][0], route.pts[route.pts.length - 1][1]);
        } else setTool('via');
        break;
      case 'z': case 'Z': setTool('zone'); break;
      case 't': case 'T': startTextTool(); break;
      case 'l': case 'L': setTool('line'); break;
      case 'm': case 'M': setTool('measure'); break;
      case 'g': case 'G': cycleGrid(); break;
      case 'n': case 'N': showRats = !showRats; $('btn-rats').classList.toggle('active', showRats); render(); break;
      case 'r': case 'R': doRotateSel(); break;
      case 'Delete': case 'Backspace': e.preventDefault(); doDelete(); break;
      case 'Enter':
        if (tool === 'track') finishRoute();
        else if (tool === 'zone' && zonePts) finishZone();
        else if (tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'arc') { outlinePts = null; gfxStart = null; render(); }
        break;
      case 'Escape':
        route = null; outlinePts = null; gfxStart = null; placeLib = null; measureA = null; measureB = null; zonePts = null;
        setTool('select'); break;
      case 'w': cycleTrackWidth(); break;
    }
  });

  function applyKeyAction(act) {
    switch (act) {
      case 'save': mode === 'schematic' ? schSave() : doSave(); break;
      case 'open': $('btn-open').click(); break;
      case 'undo': mode === 'schematic' ? schUndoStep() : undo(); break;
      case 'redo': mode === 'schematic' ? schRedoStep() : redo(); break;
      case 'zoomIn': view.zoom = Math.min(50, view.zoom * 1.25); render(); break;
      case 'zoomOut': view.zoom = Math.max(0.5, view.zoom / 1.25); render(); break;
      case 'zoomFit': zoomFit(); break;
      case 'props': setTab('props'); break;
      case 'addFootprint': setTool('footprint'); setTab('library'); break;
      case 'addSymbol': setSchTool('symbol'); break;
      case 'nudgeLeft': nudgeSel(-1, 0); break;
      case 'nudgeRight': nudgeSel(1, 0); break;
      case 'nudgeUp': nudgeSel(0, -1); break;
      case 'nudgeDown': nudgeSel(0, 1); break;
    }
  }

  // Move the current selection by one grid step (KiCad arrow-key behaviour).
  function nudgeSel(dx, dy) {
    if (mode === 'schematic') {
      const s = sch.symbols.find(x => x.id === schSelId);
      if (s) {
        schPushUndo();
        Sch.moveSymbol(sch, s.id, [s.at[0] + dx * grid, s.at[1] + dy * grid]);
        render(); refreshAll();
      }
      return;
    }
    const fp = board.footprints.find(f => f.id === selId);
    if (fp) {
      pushUndo();
      B.moveFootprint(board, fp.id, [fp.at[0] + dx * grid, fp.at[1] + dy * grid]);
      render(); refreshProps();
      return;
    }
    const tx = (board.texts || []).find(t => t.id === selId);
    if (tx) {
      pushUndo();
      B.moveText(board, tx.id, [tx.at[0] + dx * grid, tx.at[1] + dy * grid]);
      render(); refreshProps();
    }
  }

  function cycleGrid() {
    grid = GRIDS[(GRIDS.indexOf(grid) + 1) % GRIDS.length];
    setStatus('Grid: ' + grid + ' mm');
    render();
  }

  // ---------- toolbar / rail wiring ----------
  $('tool-select').addEventListener('click', () => setTool('select'));
  $('sch-select').addEventListener('click', () => setSchTool('select'));
  $('sch-symbol').addEventListener('click', () => setSchTool('symbol'));
  $('sch-wire').addEventListener('click', () => setSchTool('wire'));
  $('sch-label').addEventListener('click', () => setSchTool('label'));
  $('sch-glabel').addEventListener('click', () => setSchTool('glabel'));
  $('sch-junction').addEventListener('click', () => setSchTool('junction'));
  $('sch-noconn').addEventListener('click', () => setSchTool('noconn'));
  $('launch-sch').addEventListener('click', () => setMode('schematic'));
  $('launch-pcb').addEventListener('click', () => setMode('pcb'));
  // launcher PM toolbar + tree + cards (defensive: no-op if an element is missing)
  const wire = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  wire('pm-new', schNew);
  wire('pm-open', () => { const b = $('btn-open'); if (b) b.click(); });
  wire('pm-save', () => { if (mode !== 'launcher') { const b = $('btn-save'); if (b) b.click(); } });
  wire('pm-refresh', () => location.reload());
  document.querySelectorAll('.pm-file[data-open], .pm-app[data-open]').forEach(el =>
    el.addEventListener('click', () => setMode(el.dataset.open)));
  wire('launch-gerb', showGerberViewer);
  wire('launch-gerb2', showGerberViewer);
  wire('launch-calc', showCalc);
  wire('launch-calc2', showCalc);
  wire('launch-bitmap', showBitmapConv);
  wire('launch-pcm', showPlugins);
  wire('launch-symed', () => showLibEditor('symbol'));
  wire('launch-fped', () => showLibEditor('footprint'));
  wire('panel-collapse', togglePanelHidden);
  wire('panel-restore', togglePanelHidden);
  $('tool-highlight').addEventListener('click', () => setTool('highlight'));
  $('tool-footprint').addEventListener('click', () => setTool('footprint'));
  $('tool-track').addEventListener('click', () => setTool('track'));
  $('tool-via').addEventListener('click', () => setTool('via'));
  $('tool-zone').addEventListener('click', () => setTool('zone'));
  $('tool-text').addEventListener('click', startTextTool);
  $('tool-line').addEventListener('click', () => setTool('line'));
  $('tool-rect').addEventListener('click', () => setTool('rect'));
  $('tool-circle').addEventListener('click', () => setTool('circle'));
  $('tool-arc').addEventListener('click', () => setTool('arc'));
  $('tool-measure').addEventListener('click', () => setTool('measure'));
  $('btn-undo').addEventListener('click', () => mode === 'schematic' ? schUndoStep() : undo());
  $('btn-redo').addEventListener('click', () => mode === 'schematic' ? schRedoStep() : redo());
  $('btn-zoomin').addEventListener('click', () => { view.zoom = Math.min(50, view.zoom * 1.25); render(); });
  $('btn-zoomout').addEventListener('click', () => { view.zoom = Math.max(0.5, view.zoom / 1.25); render(); });
  $('btn-zoomfit').addEventListener('click', zoomFit);
  $('btn-grid').addEventListener('click', cycleGrid);
  $('btn-rats').addEventListener('click', () => { showRats = !showRats; $('btn-rats').classList.toggle('active', showRats); render(); });
  $('btn-drc').addEventListener('click', () => { runDRC(); render(); });
  $('btn-erc').addEventListener('click', () => { showErc(); render(); });
  $('btn-gerber').addEventListener('click', doGerber);
  $('btn-drill').addEventListener('click', doDrill);
  $('btn-new').addEventListener('click', () => {
    if (mode === 'schematic') { schNew(); return; }
    if (board.footprints.length && !confirm('Clear board?')) return;
    pushUndo();
    board = B.makeBoard(); selId = null; hiNet = null; route = null; outlinePts = null;
    zoneFills.clear(); markZonesDirty(true);
    render(); refreshAll();
  });
  $('btn-open').addEventListener('click', () => $('file-open').click());
  $('btn-save').addEventListener('click', () => mode === 'schematic' ? schSave() : doSave());
  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-open').addEventListener('change', e => { if (e.target.files[0]) { const f = e.target.files[0]; if (f.name.endsWith('.kicad_sch')) schOpen(f); else doOpen(f); } e.target.value = ''; });
  $('file-import').addEventListener('change', e => { if (e.target.files[0]) doImport(e.target.files[0]); e.target.value = ''; });

  // tabs
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // ---------- menus ----------
  function currentMenus() {
    if (mode === 'launcher') return {
      file: [
        ['New Schematic', schNew, ''],
        ['New PCB', () => setMode('pcb'), ''],
        ['Open…', () => $('btn-open').click(), ''],
        ['Save', () => { if (mode !== 'launcher') $('btn-save').click(); }, '']
      ],
      view: [
        ['Zoom to fit', zoomFit, ''],
        ['Grid: ' + grid + ' mm', cycleGrid, 'G']
      ],
      tools: [
        ['Symbol Editor…', () => showLibEditor('symbol'), ''],
        ['Footprint Editor…', () => showLibEditor('footprint'), ''],
        ['Plugin and Content Manager…', showPlugins, '']
      ],
      help: [
        ['How to use', showHelp, ''],
        ['Shortcuts', showShortcuts, '']
      ]
    };
    if (mode === 'schematic') return {
      file: [
        ['New schematic', schNew, ''],
        ['Open .kicad_sch…', () => $('btn-open').click(), ''],
        ['Save .kicad_sch', schSave, ''],
        ['Update PCB from Schematic', doUpdatePCB, ''],
        ['Export BOM (.csv)', doBom, ''],
        ['Export Netlist (.net)', doNetlist, ''],
        ['Switch to PCB Editor', () => setMode('pcb'), '']
      ],
      edit: [
        ['Undo', schUndoStep, '⌘Z'],
        ['Redo', schRedoStep, '⌘Y'],
        ['Delete selection', schDoDelete, '⌫'],
        ['Rotate 90°', schDoRotate, 'R']
      ],
      view: [
        ['Zoom in', () => $('btn-zoomin').click(), ''],
        ['Zoom out', () => $('btn-zoomout').click(), ''],
        ['Zoom to fit', zoomFit, ''],
        ['Grid: ' + grid + ' mm', cycleGrid, 'G'],
        ['ERC markers: ' + (showErcMarkers ? 'on' : 'off'), toggleErcMarkers, ''],
        [$('main').classList.contains('panel-hidden') ? 'Show Side Panel' : 'Hide Side Panel', togglePanelHidden, '']
      ],
      place: [
        ['Symbol…', () => { setTab('symbols'); setSchTool('symbol'); }, 'S'],
        ['Wire', () => setSchTool('wire'), 'W'],
        ['Net Label', () => setSchTool('label'), 'L'],
        ['Global Label', () => setSchTool('glabel'), 'Ctrl+H'],
        ['Junction', () => setSchTool('junction'), 'J'],
        ['No-connect flag', () => setSchTool('noconn'), 'Q']
      ],
      inspect: [
        ['Electrical Rules Check…', showErc, ''],
        ['Netlist', showSchNetlist, ''],
        ['Measure', () => setSchTool('select'), 'M']
      ],
      tools: [
        ['Edit Symbol Fields…', showSymFields, ''],
        ['Open Symbol Editor…', () => showLibEditor('symbol'), ''],
        ['Switch to PCB Editor', () => setMode('pcb'), ''],
        ['Plugin and Content Manager…', showPlugins, '']
      ],
      help: [
        ['How to use', showSchHelp, ''],
        ['Shortcuts', showShortcuts, '']
      ]
    };
    return {
      file: [
        ['New board', () => $('btn-new').click(), ''],
        ['Open .kicad_pcb…', () => $('btn-open').click(), ''],
        ['Save .kicad_pcb', doSave, ''],
        ['Import .kicad_mod/.kicad_sym…', () => $('btn-import').click(), ''],
        ['Export Gerber', doGerber, ''],
        ['Export Drill file', doDrill, ''],
        ['Export component placement (.pos)', doPos, ''],
        ['Switch to Schematic Editor', () => setMode('schematic'), '']
      ],
      edit: [
        ['Undo', undo, '⌘Z'],
        ['Redo', redo, '⌘Y'],
        ['Delete selection', doDelete, '⌫'],
        ['Rotate 90°', doRotateSel, 'R']
      ],
      view: [
        ['Zoom in', () => $('btn-zoomin').click(), ''],
        ['Zoom out', () => $('btn-zoomout').click(), ''],
        ['Zoom to fit', zoomFit, ''],
        ['Grid: ' + grid + ' mm', cycleGrid, 'G'],
        ['Ratsnest: ' + (showRats ? 'on' : 'off'), () => $('btn-rats').click(), 'N'],
        ['Layer: ' + layer, switchLayer, 'L'],
        [$('main').classList.contains('panel-hidden') ? 'Show Side Panel' : 'Hide Side Panel', togglePanelHidden, '']
      ],
      place: [
        ['Footprint…', () => { setTab('library'); setTool('footprint'); }, 'F'],
        ['Track', () => setTool('track'), 'X'],
        ['Via', () => setTool('via'), 'V'],
        ['Zone', () => setTool('zone'), 'Z'],
        ['Add Text…', startTextTool, 'T']
      ],
      route: [
        ['Finish track', () => { if (tool === 'track') finishRoute(); }, 'Enter'],
        ['Via + switch layer', () => { if (tool === 'track' && route && route.pts.length) addViaHere(route.pts[route.pts.length - 1][0], route.pts[route.pts.length - 1][1]); }, 'V'],
        ['Track width: ' + trackWidth + ' mm', cycleTrackWidth, 'W']
      ],
      inspect: [
        ['Run DRC', () => $('btn-drc').click(), ''],
        ['Measure', () => setTool('measure'), 'M']
      ],
      tools: [
        ['Open Footprint Editor…', () => showLibEditor('footprint'), ''],
        ['Plugin and Content Manager…', showPlugins, '']
      ],
      help: [
        ['How to use', showHelp, ''],
        ['Shortcuts', showShortcuts, '']
      ]
    };
  }
  function showSchNetlist() {
    if (!sch || !sch.symbols.length) { setStatus('Schematic is empty'); return; }
    const nets = Sch.extractNets(sch, Syms.getSymbol);
    const rows = nets.map(n => `<div class="net-row"><span>${esc(n.name)}</span><span style="margin-left:auto;color:var(--fg-dim)">${n.pins.length} pin${n.pins.length === 1 ? '' : 's'}</span></div>`).join('');
    showModal('Netlist (' + nets.length + ' nets)', `<div class="plugin-list">${rows}</div>`);
  }
  function showSchHelp() {
    showModal('Kipad — Schematic Editor', `
      <b>Tools</b><br>
      ➤ Select — tap symbol to select, drag to move, R rotates, Del deletes<br>
      ▤ Symbol — pick from Symbols panel, tap canvas to place<br>
      ╱ Wire — tap to start, tap for corners, double-tap/Enter to finish<br>
      🏷 Label — tap to place a net label (names the net)<br>
      🚩 Global Label — dark-red flag that names the net across sheets (Ctrl+H); both label types connect nets by matching text<br>
      • Junction — tap to add a wire junction dot<br>
      ✕ No-connect — tap a pin to mark it intentionally unconnected (suppresses its ERC warning); Q shortcut<br><br>
      <b>Flow</b>: place symbols → wire them → add labels → <b>Inspect → Electrical Rules Check…</b> to find unconnected pins, duplicate refs, label conflicts and more, then <b>File → Update PCB from Schematic</b> to continue in the PCB editor.<br><br>
      Violations are also drawn on the canvas as red/amber X markers — tap one for details (View menu toggles them).
    `);
  }
  document.querySelectorAll('.menu').forEach(m => {
    m.addEventListener('click', e => {
      e.stopPropagation();
      const pop = $('menu-popup');
      const open = pop.classList.contains('hidden');
      document.querySelectorAll('.menu').forEach(x => x.classList.remove('open'));
      if (!open) { pop.classList.add('hidden'); return; }
      m.classList.add('open');
      const r = m.getBoundingClientRect();
      const popPos = $('menu-popup');
      popPos.style.left = r.left + 'px';
      popPos.style.top = (r.bottom + 2) + 'px';
      const items = currentMenus()[m.dataset.menu] || [];
      pop.innerHTML = items.map(([label, , kbd]) =>
        `<div class="mi">${label}${kbd ? `<span class="kbd">${kbd}</span>` : ''}</div>`).join('');
      pop.querySelectorAll('.mi').forEach((mi, i) => mi.addEventListener('click', () => {
        pop.classList.add('hidden');
        document.querySelectorAll('.menu').forEach(x => x.classList.remove('open'));
        items[i][1]();
      }));
      pop.classList.remove('hidden');
    });
  });
  document.addEventListener('click', () => {
    $('menu-popup').classList.add('hidden');
    document.querySelectorAll('.menu').forEach(x => x.classList.remove('open'));
  });

  function showHelp() {
    showModal('Kipad — PCB Layout Editor', `
      <b>Tools (left rail)</b><br>
      ➤ Select — tap pad/footprint to select (tap pad = highlight net), drag to move<br>
      ⌁ Net Highlight — tap a pad to highlight its net<br>
      ▣ Footprint — pick from Library panel, tap board to place, R rotates<br>
      ╱ Route Track — tap pad to start (uses its net), tap for corners, double-tap/Enter to finish, V = via + layer<br>
      ◎ Via — tap to place a via<br>
      ⬟ Zone — draw a copper pour: tap points on the active layer/net, tap near the start ring / double-tap / Enter to close; fills only where it reaches same-net copper, keeps clearance from other nets, auto-refills after edits; select it to delete or override clearance (Properties)<br>
      T Text — place editable text on F.SilkS/B.SilkS; select it to edit content, size, stroke, rotation, alignment or layer<br>
      ╲ ▭ ◯ ◠ — draw line / rectangle / circle / arc on the board outline (Edge.Cuts)<br>
      📏 Measure — tap two points to read distance<br><br>
      <b>Right panel</b>: Layers (visibility + active layer) · Footprints (real KiCad footprints, search, place, import .kicad_mod) · Symbols (real KiCad symbols, search, import .kicad_sym) · Nets (highlight, add) · Properties (edit selection). The panel can be collapsed with the handle on its edge (View → Hide Side Panel).<br><br>
      <b>Library editors</b>: Project manager → Symbols / Footprints tiles (or Tools menu) open full editors — edit pins & pads on canvas or in tables, New/Import/Export .kicad_sym/.kicad_mod, Save keeps custom items across reloads.<br>
      <b>Shortcuts</b>: S select · H highlight · F/A footprint · X route · V via · Z zone · T text · L line · M measure · G grid · N ratsnest · R rotate · W width · E properties · arrows nudge selection · Del delete · Ctrl+S save · Ctrl+O open · Ctrl+Z/Y undo/redo<br><br>
      <b>Pencil</b>: palm rejection on (resting fingers won't draw/pan) · tilt angle shown in the HUD · eraser end deletes the item under the tip · double-tap pencil to return to Select<br>
      <b>Touch</b>: two-finger tap = Undo · pinch = zoom · drag = pan<br><br>
      <b>File</b>: Save = .kicad_pcb · Open = .kicad_pcb · Gerber = 9-layer fab set (F/B.Cu · Edge · F/B.SilkS · F/B.Mask · F/B.Paste) RS-274X · DRC = clearance + drilled-hole / board-edge / silkscreen-over-pad checks (Nets → Net Classes…)<br>
      Works offline. Add to Home Screen for fullscreen.
    `);
  }
  function showShortcuts() {
    showModal('Shortcuts', `
      S select · H net highlight · F / A footprint · X route · V via · Z zone · T text · L line · M measure<br>
      G grid cycle · N ratsnest · R rotate · W track width · E Properties panel · arrow keys nudge selection by one grid step · Del delete<br>
      Enter finish · Esc cancel · Ctrl/Cmd+S save · Ctrl/Cmd+O open · Ctrl/Cmd+Z undo · Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y redo<br>
      + / = zoom in · - zoom out · Home zoom to fit<br>
      Schematic: S select · W wire · L net label · Ctrl+H global label · J junction · Q no-connect<br>
      Pinch to zoom · drag empty area to pan<br>
      Pencil: tilt in HUD · eraser end deletes · double-tap → Select · palm rejection active<br>
      Touch: two-finger tap → Undo · pinch zoom · drag pan
    `);
  }
  $('modal-cancel').addEventListener('click', hideModal);
  $('modal-ok').addEventListener('click', hideModal);

  function zoomFit() {
    if (mode === 'schematic') {
      if (!sch || !sch.symbols.length) { view = R.makeView(); render(); return; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of sch.symbols) { x0 = Math.min(x0, s.at[0]); x1 = Math.max(x1, s.at[0]); y0 = Math.min(y0, s.at[1]); y1 = Math.max(y1, s.at[1]); }
      for (const w of sch.wires) for (const p of w.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      if (!isFinite(x0)) { view = R.makeView(); render(); return; }
      const w = (x1 - x0) || 10, h = (y1 - y0) || 10;
      view.zoom = Math.max(0.5, Math.min(20, Math.min(canvas.width / w, canvas.height / h) * 0.9));
      view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
      render();
      return;
    }
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

  // ---------- library loading ----------
  async function fetchJSON(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const type = r.headers.get('content-type') || '';
      if (url.split('?')[0].endsWith('.gz')) {
        const buf = await r.arrayBuffer();
        const ds = new DecompressionStream('gzip');
        const stream = new Blob([buf]).stream().pipeThrough(ds);
        const text = await new Response(stream).text();
        return JSON.parse(text);
      }
      return await r.json();
    } catch (e) { return null; }
  }
  function loadLibraries() {
    const jobs = [];
    if (FPs && FPs.loadLibrary) {
      jobs.push(fetchJSON('lib/footprints.json.gz?v=44').then(data => {
        if (data && data.length) { FPs.loadLibrary(data); setStatus('Loaded ' + data.length + ' footprints'); return true; }
        return fetchJSON('lib/footprints.json?v=44').then(d2 => {
          if (d2 && d2.length) { FPs.loadLibrary(d2); setStatus('Loaded ' + d2.length + ' footprints'); }
        });
      }).catch(() => {}));
    }
    if (Syms && Syms.loadLibrary) {
      jobs.push(fetchJSON('lib/symbols.json.gz?v=44').then(data => {
        if (data && data.length) { Syms.loadLibrary(data); setStatus('Loaded ' + data.length + ' symbols'); return true; }
        return fetchJSON('lib/symbols.json?v=44').then(d2 => {
          if (d2 && d2.length) { Syms.loadLibrary(d2); setStatus('Loaded ' + d2.length + ' symbols'); }
        });
      }).catch(() => {}));
    }
    Promise.all(jobs).then(() => {
      if (typeof leMergeCustomLibs === 'function') leMergeCustomLibs();
      refreshLibrary(); refreshSymbols();
    });
  }

  // ---------- init ----------
  loadLocal();
  setTab('layers');
  setTool('select');
  // build the side panels after first paint so the launcher shows instantly
  setTimeout(refreshAll, 0);
  window.addEventListener('resize', resize);
  resize();
  render();
  loadLibraries();
  loadPlugins();

  // start in launcher mode
  setMode('launcher');

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
