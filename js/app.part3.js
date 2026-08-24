/* Kipad main app, part 2: modes, pointer/keyboard input, menus, library loading, init. */
'use strict';
  // ---------- mode / launcher ----------

  function setMode(m) {
    mode = m;
    $('launcher').classList.toggle('hidden', m !== 'launcher');
    $('menubar').classList.toggle('hidden', m === 'launcher');
    $('toolbar').classList.toggle('hidden', m === 'launcher');
    $('statusbar').classList.toggle('hidden', m === 'launcher');
    $('main').classList.toggle('hidden', m === 'launcher');
    document.querySelectorAll('.pcb-only').forEach(el => el.classList.toggle('hidden', m !== 'pcb'));
    document.querySelectorAll('.sch-only').forEach(el => el.classList.toggle('hidden', m !== 'schematic'));
    if (m === 'schematic' && !sch) { sch = Sch.makeSchematic(); schTool = 'select'; }
    if (m === 'schematic') { setTab('symbols'); ercDirty = true; }
    if (m === 'pcb') { setTab('layers'); }
    const ercPanel = $('erc-panel');
    if (ercPanel && m !== 'schematic') ercPanel.classList.add('hidden');
    setTool('select');
    resize();
  }

  function renderSchematicView() {
    // ERC results are cached; recompute only after a schematic change
    // (schPushUndo / undo / redo / open / new mark ercDirty).
    if (ercDirty) refreshErc();
    const state = {
      dpr: window.devicePixelRatio || 1,
      grid,
      crosshair,
      selSymId: schSelId,
      wirePts: schWirePts.length ? schWirePts : null,
      wireCur: schWireCur,
      previewSym: (schTool === 'symbol' && schPlaceName && crosshair)
        ? { name: schPlaceName, at: [snap(crosshair[0]), snap(crosshair[1])], angle: schAngle } : null,
      ercMarkers: (showErcMarkers && ercViolations.length && Erc)
        ? Erc.markers(ercViolations, view.zoom) : null
    };
    R.renderSchematic(ctx, cw, ch, sch, view, state, Syms);
    $('hud-pos').textContent = fmt(view.x) + ', ' + fmt(view.y) + ' mm';
    $('hud-zoom').textContent = Math.round(view.zoom * 100 / 3) + '%';
    $('hud-tool').textContent = schToolName();
    $('st-pos').textContent = 'X: ' + fmt(view.x) + ' Y: ' + fmt(view.y) + ' mm';
    $('st-grid').textContent = 'Grid: ' + grid;
    $('st-zoom').textContent = 'Zoom: ' + Math.round(view.zoom * 100 / 3) + '%';
    $('st-tool').textContent = schToolName();
    $('st-layer').textContent = 'Schematic';
  }

  function schToolName() {
    const m = { select: 'Select', symbol: 'Place Symbol', wire: 'Wire', label: 'Net Label', junction: 'Junction' };
    return m[schTool] || schTool;
  }

  function toggleErcMarkers() {
    showErcMarkers = !showErcMarkers;
    render();
    setStatus('ERC markers ' + (showErcMarkers ? 'shown' : 'hidden'));
  }

  function schSnapshot() { return JSON.stringify(sch); }
  function schPushUndo() { schUndo.push(schSnapshot()); if (schUndo.length > 50) schUndo.shift(); schRedo = []; ercDirty = true; }
  function schUndoStep() {
    if (!schUndo.length) return;
    schRedo.push(schSnapshot());
    sch = JSON.parse(schUndo.pop());
    ercDirty = true;
    render(); refreshAll();
  }
  function schRedoStep() {
    if (!schRedo.length) return;
    schUndo.push(schSnapshot());
    sch = JSON.parse(schRedo.pop());
    ercDirty = true;
    render(); refreshAll();
  }

  function schDoDelete() {
    if (!schSelId) return;
    schPushUndo();
    sch.symbols = sch.symbols.filter(s => s.id !== schSelId);
    schSelId = null;
    render(); refreshAll();
  }
  function schDoRotate() {
    if (!schSelId) return;
    const s = sch.symbols.find(x => x.id === schSelId);
    if (!s) return;
    schPushUndo();
    s.angle = (s.angle + 90) % 360;
    render();
  }

  function schHitSymbol(wx, wy) {
    for (let i = sch.symbols.length - 1; i >= 0; i--) {
      const s = sch.symbols[i];
      if (Math.hypot(wx - s.at[0], wy - s.at[1]) < 2) return s;
    }
    return null;
  }

  function doUpdatePCB() {
    if (!sch || !sch.symbols.length) { setStatus('Schematic is empty'); return; }
    try {
      const board2 = B.makeBoard();
      const getFootprint = name => !!FPs.getFootprint(name);
      const fallback = ref => {
        const p = ref.replace(/[0-9#]+$/, '');
        const map = { R: 'R_0603_1608Metric', C: 'C_0805_2012Metric', D: 'D_SOD-123', Q: 'SOT-23', U: 'SOIC-8_3.9x4.9mm_P1.27mm', J: 'PinHeader_1x04_P2.54mm_Vertical', L: 'L_0603_1608Metric', SW: 'SW_SPST_PTS645' };
        return map[p] || null;
      };
      Sch.updatePCB(sch, board2, { getFootprint, fallbackFootprint: fallback });
      if (!board2.footprints.length) { setStatus('No footprints could be resolved from schematic'); return; }
      pushUndo();
      board = board2;
      B.ensureNetClasses(board);
      selId = null; hiNet = null; route = null;
      markZonesDirty(true);
      setMode('pcb');
      zoomFit();
      refreshAll();
      setStatus('Updated PCB from schematic: ' + board.footprints.length + ' footprints, ' + board.nets.length + ' nets');
    } catch (e) { setStatus('Update PCB failed: ' + e.message); }
  }

  function schSave() {
    if (!Sch) { setStatus('schematic module not loaded'); return; }
    download('kipad.kicad_sch', Sch.serializeSch(sch, Syms.getSymbol), 'application/x-kicad-schematic');
    setStatus('Saved .kicad_sch');
  }
  function schOpen(file) {
    if (!Sch) return;
    const r = new FileReader();
    r.onerror = () => setStatus('Could not read ' + file.name);
    r.onload = () => {
      try {
        schPushUndo();
        sch = Sch.parseSch(r.result, Syms.getSymbol);
        schSelId = null; schWirePts = [];
        setMode('schematic');
        zoomFit();
        render(); refreshAll();
        setStatus('Opened ' + file.name);
      } catch (e) { setStatus('Open failed: ' + e.message); }
    };
    r.readAsText(file);
  }

  function schNew() {
    schPushUndo();
    sch = Sch.makeSchematic();
    schSelId = null; schWirePts = [];
    setMode('schematic');
    zoomFit(); render(); refreshAll();
    setStatus('New schematic');
  }

  // ---------- plugin manager ----------
  function loadPlugins() {
    try { plugins = JSON.parse(localStorage.getItem(PLUGINS_KEY)) || {}; } catch (e) { plugins = {}; }
  }
  function savePlugins() {
    localStorage.setItem(PLUGINS_KEY, JSON.stringify(plugins));
  }
  const BUILTIN_PLUGINS = [];
  function showPlugins() {
    loadPlugins();
    const rows = BUILTIN_PLUGINS.map(p => {
      const on = plugins[p.name] && plugins[p.name].enabled;
      return `<div class="plugin-row"><div><b>${p.label}</b><br><span class="desc">${p.desc}</span></div>
        <button class="btn ${on ? 'primary' : ''}" data-plug="${p.name}">${on ? 'Enabled' : 'Install'}</button></div>`;
    }).join('');
    const custom = installedPlugins.map(p =>
      `<div class="plugin-row"><div><b>${p.name}</b><br><span class="desc">custom .js plugin</span></div>
       <span class="desc">loaded</span></div>`).join('');
    showModal('Plugin and Content Manager', `
      <div class="plugin-list">${rows}${custom}</div>
      <p class="desc">Kipad plugins are lightweight JS extensions. Built-in modules listed above; more coming.
      Install a custom plugin (.js file) to extend tools.</p>`);
    $('modal-body').querySelectorAll('[data-plug]').forEach(b => b.addEventListener('click', () => {
      const name = b.dataset.plug;
      const cur = plugins[name] || {};
      plugins[name] = { enabled: !cur.enabled };
      savePlugins();
      setStatus((plugins[name].enabled ? 'Enabled ' : 'Disabled ') + name);
      showPlugins();
    }));
    $('modal-ok').addEventListener('click', hideModal);
  }

  // ---------- Gerber Viewer (per-layer preview) ----------
  function showGerberViewer() {
    const layers = ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts'];
    let cur = 'F.Cu';
    const body = `<div class="gv-layers">${layers.map(l => `<button class="btn ${l === cur ? 'primary' : ''}" data-gv="${l}">${l}</button>`).join('')}</div>
      <canvas class="lib-preview" id="gv-canvas" style="height:45vh"></canvas>`;
    showModal('Gerber Viewer', body);
    const draw = () => {
      const cv = $('gv-canvas');
      if (!cv) return;
      const c = cv.getContext('2d');
      cv.width = cv.clientWidth * (window.devicePixelRatio || 1);
      cv.height = cv.clientHeight * (window.devicePixelRatio || 1);
      c.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      const layerVis = {};
      for (const l of layers) layerVis[l] = false;
      if (cur !== 'Edge.Cuts') layerVis[cur] = true;
      // fit view to board
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const fp of board.footprints) for (const p of fp.pads) {
        x0 = Math.min(x0, p.at[0]); x1 = Math.max(x1, p.at[0]); y0 = Math.min(y0, p.at[1]); y1 = Math.max(y1, p.at[1]);
      }
      for (const t of board.tracks) {
        x0 = Math.min(x0, t.start[0], t.end[0]); x1 = Math.max(x1, t.start[0], t.end[0]);
        y0 = Math.min(y0, t.start[1], t.end[1]); y1 = Math.max(y1, t.start[1], t.end[1]);
      }
      for (const poly of board.outline) for (const p of poly) {
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
      }
      const fit = isFinite(x0);
      const v2 = fit
        ? (() => { const w = (x1 - x0) || 10, h = (y1 - y0) || 10;
            const zoom = Math.max(0.5, Math.min(20, Math.min(cv.clientWidth / w, cv.clientHeight / h) * 0.9));
            return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom }; })()
        : R.makeView();
      R.render(c, cv.clientWidth, cv.clientHeight, board, v2, { layerVis, showRats: false, activeLayer: cur, selId: null, hiNet: null, crosshair: null });
    };
    $('modal-body').querySelectorAll('[data-gv]').forEach(b => b.addEventListener('click', () => { cur = b.dataset.gv; showGerberViewer(); }));
    draw();
    $('modal-ok').addEventListener('click', hideModal);
  }

  // ---------- PCB Calculator (IPC-2221 track width) ----------
  function showCalc() {
    showModal('PCB Calculator — Track Width (IPC-2221)', `
      <div class="prop-group"><h5>Inputs</h5>
        <div class="prop-row"><label>Current</label><input id="cal-i" value="1" type="number" step="0.1" min="0"><span>A</span></div>
        <div class="prop-row"><label>ΔT rise</label><input id="cal-t" value="10" type="number" step="1" min="1"><span>°C</span></div>
        <div class="prop-row"><label>Copper</label><select id="cal-oz"><option value="1">1 oz (35 µm)</option><option value="2">2 oz (70 µm)</option><option value="0.5">0.5 oz (18 µm)</option></select></div>
      </div>
      <div class="drc-item" id="cal-out"></div>`);
    const calc = () => {
      const I = parseFloat($('cal-i').value) || 0;
      const dT = parseFloat($('cal-t').value) || 10;
      const oz = parseFloat($('cal-oz').value) || 1;
      // IPC-2221 external layer: A(mil²) = (I / (k · ΔT^b))^(1/c)
      const k = 0.024, b = 0.44, c = 0.725;
      let widthMil = 0;
      if (I > 0) {
        const A = Math.pow(I / (k * Math.pow(dT, b)), 1 / c);
        widthMil = A / (oz * 1.378);
      }
      const widthMm = widthMil * 0.0254;
      $('cal-out').innerHTML = `Required width: <b>${widthMm.toFixed(3)} mm</b> (${widthMil.toFixed(2)} mil) at ${I} A, ΔT ${dT}°C, ${oz} oz`;
    };
    ['cal-i', 'cal-t'].forEach(id => { const el = $(id); if (el) el.addEventListener('input', calc); });
    const oz = $('cal-oz');
    if (oz) oz.addEventListener('change', calc);
    calc();
    $('modal-ok').addEventListener('click', hideModal);
  }

  // ---------- Image Converter (bitmap → silkscreen footprint) ----------
  function showBitmapConv() {
    let img = null;
    showModal('Image Converter → Footprint', `
      <input type="file" id="bc-file" accept="image/*" class="lib-search">
      <div class="prop-row"><label>Threshold</label><input id="bc-th" type="range" min="0" max="255" value="128"></div>
      <div class="prop-row"><label>Pixel size</label><select id="bc-ps"><option value="0.254">0.254 mm</option><option value="0.5">0.5 mm</option><option value="1">1 mm</option></select></div>
      <canvas class="lib-preview" id="bc-pv" style="height:28vh"></canvas>
      <div class="lib-actions"><button class="btn primary" id="bc-add">Add footprint to board</button></div>`);
    const file = $('bc-file');
    if (file) file.addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const im = new Image();
        im.onload = () => { img = im; drawPreview(); };
        im.src = rd.result;
      };
      rd.readAsDataURL(f);
    });
    const drawPreview = () => {
      const cv = $('bc-pv');
      if (!cv || !img) return;
      const c = cv.getContext('2d');
      cv.width = cv.clientWidth * (window.devicePixelRatio || 1);
      cv.height = cv.clientHeight * (window.devicePixelRatio || 1);
      c.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      const w = cv.clientWidth, h = cv.clientHeight;
      c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
      const sc = Math.min(w / img.width, h / img.height);
      c.drawImage(img, (w - img.width * sc) / 2, (h - img.height * sc) / 2, img.width * sc, img.height * sc);
    };
    const th = $('bc-th');
    if (th) th.addEventListener('input', () => { if (img) drawPreview(); });
    const add = $('bc-add');
    if (add) add.addEventListener('click', () => {
      if (!img) { setStatus('Choose an image first'); return; }
      const T = parseInt($('bc-th').value) || 128;
      const ps = parseFloat($('bc-ps').value) || 0.254;
      const off = document.createElement('canvas');
      off.width = img.width; off.height = img.height;
      const oc = off.getContext('2d');
      oc.drawImage(img, 0, 0);
      const d = oc.getImageData(0, 0, img.width, img.height).data;
      const silk = [];
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (lum < T) {
            silk.push({ type: 'rect', layer: 'F.SilkS',
              start: [(x - img.width / 2) * ps, (img.height / 2 - y) * ps],
              end: [(x + 1 - img.width / 2) * ps, (img.height / 2 - y - 1) * ps] });
          }
        }
      }
      if (!silk.length) { setStatus('Nothing below threshold — raise the value and retry'); return; }
      pushUndo();
      // auto-number refs so repeated imports don't collide
      let n = 1;
      while (board.footprints.some(f => f.ref === 'LOGO' + n)) n++;
      board.footprints.push({ id: 'F' + (board.footprints.reduce((m, f) => Math.max(m, Number(String(f.id).replace(/^F/, '')) || 0), 0) + 1),
        lib: 'LOGO_IMAGE', name: 'LOGO_IMAGE', ref: 'LOGO' + n, value: '', at: [0, 0], angle: 0,
        layer: 'F.Cu', pads: [], silk,
        fab: [], courtyard: { layer: 'F.CrtYd', min: [-img.width * ps / 2, -img.height * ps / 2], max: [img.width * ps / 2, img.height * ps / 2] } });
      render(); refreshAll(); hideModal();
      setStatus('Added image footprint: ' + silk.length + ' silkscreen cells');
    });
    $('modal-ok').addEventListener('click', hideModal);
  }
