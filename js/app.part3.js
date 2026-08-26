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
    if (m === 'schematic' && !project) {
      project = Project.normalize(Project.fromSchematic(Sch.makeSchematic()), { makeSchematic: Sch.makeSchematic });
      schTool = 'select';
    }
    if (m === 'schematic') { setTab('symbols'); ercDirty = true; refreshSheetTabs(); }
    if (m === 'pcb') { setTab('layers'); if (typeof syncRouteControls === 'function') syncRouteControls(); }
    const ercPanel = $('erc-panel');
    if (ercPanel && m !== 'schematic') ercPanel.classList.add('hidden');
    setTool('select');
    applyPanelHidden();
    resize();
  }

  // ---------- collapsible side panel (per-mode, remembered) ----------
  function applyPanelHidden() {
    const hid = mode !== 'launcher' && localStorage.getItem('kipad.panel.hidden.' + mode) === '1';
    $('main').classList.toggle('panel-hidden', hid);
    const col = $('panel-collapse');
    if (col) col.classList.toggle('hidden', mode === 'launcher');
    const res = $('panel-restore');
    if (res) res.classList.toggle('hidden', !hid);
  }
  function togglePanelHidden() {
    if (mode === 'launcher') return;
    const key = 'kipad.panel.hidden.' + mode;
    localStorage.setItem(key, localStorage.getItem(key) === '1' ? '0' : '1');
    applyPanelHidden();
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
      selIds: (() => { const s = new Set(schSelSet.map(m => m.id)); if (schSelId) s.add(schSelId); return s; })(),
      box: schBoxSel,
      wirePts: schWirePts.length ? schWirePts : null,
      wireCur: schWireCur,
      snapHi: schSnapHi || null,
      previewSym: (schTool === 'symbol' && schPlaceName && crosshair)
        ? { name: schPlaceName, at: [snap(crosshair[0]), snap(crosshair[1])], angle: schAngle } : null,
      ercMarkers: (showErcMarkers && ercViolations.length && Erc)
        ? Erc.markers(ercViolations, view.zoom) : null
    };
    R.renderSchematic(ctx, cw, ch, sch(), view, state, Syms);
    $('hud-pos').textContent = fmt(view.x) + ', ' + fmt(view.y) + ' mm';
    $('hud-zoom').textContent = Math.round(view.zoom * 100 / 3) + '%';
    $('hud-tool').textContent = schToolName();
    $('st-pos').textContent = 'X: ' + fmt(view.x) + ' Y: ' + fmt(view.y) + ' mm';
    $('st-grid').textContent = 'Grid: ' + grid;
    $('st-zoom').textContent = 'Zoom: ' + Math.round(view.zoom * 100 / 3) + '%';
    $('st-tool').textContent = schToolName();
    $('st-layer').textContent = 'Schematic';
    refreshSheetStatus();
  }

  function schToolName() {
    const m = { select: 'Select', symbol: 'Place Symbol', wire: 'Wire', label: 'Net Label', glabel: 'Global Label', junction: 'Junction', noconn: 'No Connect' };
    return m[schTool] || schTool;
  }

  function toggleErcMarkers() {
    showErcMarkers = !showErcMarkers;
    render();
    setStatus('ERC markers ' + (showErcMarkers ? 'shown' : 'hidden'));
  }

  function schSnapshot() { return JSON.stringify(project); }
  function schCurrentSelection() {
    if (schSelSet.length) return schSelSet.slice();
    return schSelId && schSelKind ? [{ id: schSelId, kind: schSelKind }] : [];
  }
  function schSetPrimary(it) {
    schSelId = it ? it.id : null;
    schSelKind = it ? it.kind : null;
  }
  function schClearSelection() { schSelId = null; schSelKind = null; schSelSet = []; }
  function schPushUndo() {
    if (!project) return;
    schUndo.push(schSnapshot());
    if (schUndo.length > 50) schUndo.shift();
    schRedo = [];
    ercDirty = true;
  }
  function schUndoStep() {
    if (!schUndo.length) return;
    schRedo.push(schSnapshot());
    project = Project.normalize(JSON.parse(schUndo.pop()), { makeSchematic: Sch.makeSchematic });
    schClearSelection();
    ercDirty = true;
    refreshSheetTabs();
    render(); refreshAll();
  }
  function schRedoStep() {
    if (!schRedo.length) return;
    schUndo.push(schSnapshot());
    project = Project.normalize(JSON.parse(schRedo.pop()), { makeSchematic: Sch.makeSchematic });
    schClearSelection();
    ercDirty = true;
    refreshSheetTabs();
    render(); refreshAll();
  }

  function schDoDelete() {
    const members = schCurrentSelection();
    if (!members.length || !SchMSel) return;
    schPushUndo();
    const p = SchMSel.deletePlan(sch(), members);
    sch().symbols = sch().symbols.filter(x => !p.symbols.includes(x.id));
    sch().wires = sch().wires.filter(x => !p.wires.includes(x.id));
    sch().labels = sch().labels.filter(x => !p.labels.includes(x.id));
    sch().junctions = sch().junctions.filter(x => !p.junctions.includes(x.id));
    sch().noConnects = (sch().noConnects || []).filter(x => !p.noConnects.includes(x.id));
    const n = p.symbols.length + p.wires.length + p.labels.length + p.junctions.length + p.noConnects.length;
    schClearSelection();
    render(); refreshAll();
    setStatus('Deleted ' + n + ' schematic item' + (n === 1 ? '' : 's'));
  }
  function schDoRotate() {
    const members = schCurrentSelection();
    if (!members.length || !SchMSel) return;
    const b = SchMSel.bounds(sch(), members);
    if (!b) return;
    schPushUndo();
    const n = SchMSel.rotateItems(sch(), members, b.center, 90);
    render(); refreshAll();
    setStatus('Rotated ' + n + ' schematic item' + (n === 1 ? '' : 's') + ' about the selection centre');
  }

  function doUpdatePCB() {
    if (!sch() || !sch().symbols.length) { setStatus('Schematic is empty'); return; }
    try {
      const board2 = B.makeBoard();
      const getFootprint = name => !!FPs.getFootprint(name);
      const fallback = ref => {
        const p = ref.replace(/[0-9#]+$/, '');
        const map = { R: 'R_0603_1608Metric', C: 'C_0805_2012Metric', D: 'D_SOD-123', Q: 'SOT-23', U: 'SOIC-8_3.9x4.9mm_P1.27mm', J: 'PinHeader_1x04_P2.54mm_Vertical', L: 'L_0603_1608Metric', SW: 'SW_SPST_PTS645' };
        return map[p] || null;
      };
      Sch.updatePCB(sch(), board2, { getFootprint, fallbackFootprint: fallback });
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

  // Safe-save for schematics: same validation + backup ring as the PCB side.
  const SCH_BAK_KEY = 'kipad.backup.sch.v1';
  const PROJ_BAK_KEY = 'kipad.backup.proj.v1';
  let lastSavedSch = null;      // last opened / validated .kicad_sch text
  let lastSavedProj = null;     // last opened / validated .kicad_proj text

  function projectIsSingleSheet() {
    return !!project && project.sheets && project.sheets.length === 1;
  }
  function activeSheetName() {
    const s = Project.activeSheet(project);
    return s ? s.name : '';
  }
  function schSave() {
    if (!Sch) { setStatus('schematic module not loaded'); return; }
    if (!SafeSave) { setStatus('safesave module not loaded'); return; }
    if (!project) { setStatus('No project to save'); return; }
    // Single-sheet projects keep the legacy .kicad_sch export so existing
    // workflows don't change format on upgrade.
    if (projectIsSingleSheet()) {
      const schObj = Project.activeSheet(project).schematic;
      const text = Sch.serializeSch(schObj, Syms.getSymbol);
      const v = SafeSave.validate(text,
        t => Sch.parseSch(t, Syms.getSymbol),
        m => Sch.serializeSch(m, Syms.getSymbol));
      if (!v.ok) { setStatus('Save aborted: serialized schematic failed validation (' + v.error + ')'); return; }
      let backed = false;
      if (lastSavedSch && lastSavedSch !== text)
        backed = SafeSave.pushBackup(SafeSave.defaultStore(), SCH_BAK_KEY, lastSavedSch) > 0;
      download('kipad.kicad_sch', text, 'application/x-kicad-schematic');
      lastSavedSch = text;
      setStatus('Saved .kicad_sch' + (v.stable === false ? ' (round-trip differs)' : '') +
        (backed ? ' · previous version backed up' : ''));
      return;
    }
    schSaveProject();
  }
  function schSaveProject() {
    if (!Project) { setStatus('project module not loaded'); return; }
    if (!SafeSave) { setStatus('safesave module not loaded'); return; }
    if (!project) { setStatus('No project to save'); return; }
    const text = Project.serializeProject(project);
    const v = SafeSave.validate(text,
      t => Project.parseProject(t),
      m => Project.serializeProject(m));
    if (!v.ok) { setStatus('Save aborted: serialized project failed validation (' + v.error + ')'); return; }
    let backed = false;
    if (lastSavedProj && lastSavedProj !== text)
      backed = SafeSave.pushBackup(SafeSave.defaultStore(), PROJ_BAK_KEY, lastSavedProj) > 0;
    const fname = (project.name || 'kipad').replace(/[^A-Za-z0-9_.-]+/g, '_') + '.kicad_proj';
    download(fname, text, 'application/x-kipad-project');
    lastSavedProj = text;
    setStatus('Saved ' + fname + (v.stable === false ? ' (round-trip differs)' : '') +
      (backed ? ' · previous version backed up' : ''));
  }
  function restoreSchBackup() {
    if (!Sch) { setStatus('schematic module not loaded'); return; }
    const store = SafeSave.defaultStore();
    const preferProject = !projectIsSingleSheet() || !!lastSavedProj;
    const primaryKey = preferProject ? PROJ_BAK_KEY : SCH_BAK_KEY;
    const fallbackKey = preferProject ? SCH_BAK_KEY : PROJ_BAK_KEY;
    const b = SafeSave.getBackup(store, primaryKey, 0) || SafeSave.getBackup(store, fallbackKey, 0);
    if (!b) { setStatus('No schematic backups yet'); return; }
    try {
      schPushUndo();
      let rawProject = null;
      try { rawProject = JSON.parse(b.s); } catch (e) { rawProject = null; }
      if (Project && Project.isProject && Project.isProject(rawProject)) {
        project = Project.parseProject(b.s);
        lastSavedProj = b.s;
        setStatus('Restored previous .kicad_proj backup (' + new Date(b.t).toLocaleString() + ') — undo returns to the current sheet');
      } else {
        const schObj = Sch.parseSch(b.s, Syms.getSymbol);
        project = Project.normalize(Project.fromSchematic(schObj), { makeSchematic: Sch.makeSchematic });
        lastSavedSch = b.s;
        setStatus('Restored previous .kicad_sch backup (' + new Date(b.t).toLocaleString() + ') — undo returns to the current sheet');
      }
      schClearSelection(); schWirePts = [];
      setMode('schematic');
      refreshSheetTabs();
      zoomFit();
      render(); refreshAll();
    } catch (e) {
      schUndoStep();
      setStatus('Backup restore failed: ' + e.message);
    }
  }
  function schOpen(file) {
    if (!Sch) return;
    const r = new FileReader();
    r.onerror = () => setStatus('Could not read ' + file.name);
    r.onload = () => {
      try {
        schPushUndo();
        const text = r.result;
        if (Project && /\.kicad_proj\s*$/i.test(file.name || '')) {
          project = Project.parseProject(text);
          lastSavedProj = text;
          setStatus('Opened ' + file.name);
        } else {
          const schObj = Sch.parseSch(text, Syms.getSymbol);
          project = Project.normalize(Project.fromSchematic(schObj, {
            name: String(file.name || 'kipad').replace(/\.kicad_sch$/i, '') || 'kipad'
          }), { makeSchematic: Sch.makeSchematic });
          lastSavedSch = text;
          setStatus('Opened ' + file.name);
        }
        schClearSelection(); schWirePts = [];
        setMode('schematic');
        refreshSheetTabs();
        zoomFit();
        render(); refreshAll();
      } catch (e) { setStatus('Open failed: ' + e.message); }
    };
    r.readAsText(file);
  }

  function schNew() {
    schPushUndo();
    project = Project.normalize(Project.fromSchematic(Sch.makeSchematic()), { makeSchematic: Sch.makeSchematic });
    schClearSelection(); schWirePts = [];
    setMode('schematic');
    refreshSheetTabs();
    zoomFit(); render(); refreshAll();
    setStatus('New schematic');
  }

  // ---------- sheet management ----------
  function switchToSheet(idOrName) {
    if (!project || !Project) return;
    const before = project.activeSheetId;
    const candidate = Project.getSheet(project, idOrName);
    if (!candidate || candidate.id === before) return;
    schPushUndo();
    const target = Project.setActiveSheet(project, candidate.id);
    schClearSelection(); schWirePts = [];
    ercDirty = true;
    refreshSheetTabs();
    render(); refreshAll();
    setStatus('Switched to sheet: ' + target.name);
  }
  function addNewSheet() {
    if (!project || !Project) return;
    const suggested = 'Sheet ' + ((project.sheets || []).length + 1);
    const name = (typeof prompt === 'function') ? prompt('New sheet name:', suggested) : suggested;
    if (name === null) return;
    schPushUndo();
    const sheet = Project.addSheet(project, name || suggested, null, { makeSchematic: Sch.makeSchematic });
    Project.setActiveSheet(project, sheet.id);
    schClearSelection(); schWirePts = [];
    ercDirty = true;
    refreshSheetTabs();
    render(); refreshAll();
    setStatus('Added sheet: ' + sheet.name);
  }
  function renameActiveSheet() {
    if (!project || !Project) return;
    const cur = Project.activeSheet(project);
    if (!cur) return;
    const name = (typeof prompt === 'function') ? prompt('Rename sheet:', cur.name) : null;
    if (name === null || !String(name).trim()) return;
    schPushUndo();
    cur.name = String(name).trim();
    refreshSheetTabs();
    setStatus('Renamed sheet to: ' + cur.name);
  }
  function deleteActiveSheet() {
    if (!project || !Project) return;
    const cur = Project.activeSheet(project);
    if (cur) deleteSheet(cur.id);
  }
  function deleteSheet(idOrName) {
    if (!project || !Project) return;
    if (project.sheets.length <= 1) { setStatus('Cannot delete the only remaining sheet'); return; }
    const target = Project.getSheet(project, idOrName);
    if (!target) return;
    const x = target.schematic;
    const empty = (!x.symbols || !x.symbols.length) && (!x.wires || !x.wires.length) &&
      (!x.labels || !x.labels.length) && (!x.junctions || !x.junctions.length) &&
      (!x.noConnects || !x.noConnects.length);
    if (!empty && !confirm('Delete sheet "' + target.name + '"? Its contents will be lost.')) return;
    schPushUndo();
    const wasActive = project.activeSheetId === target.id;
    project.sheets = project.sheets.filter(s => s.id !== target.id);
    if (wasActive) project.activeSheetId = project.sheets[0].id;
    schClearSelection(); schWirePts = [];
    ercDirty = true;
    render(); refreshAll();
    setStatus('Deleted sheet: ' + target.name);
  }
  function refreshSheetStatus() {
    const cur = Project && project ? Project.activeSheet(project) : null;
    const stProj = $('st-project');
    if (stProj) stProj.textContent = 'Project: ' + (project ? project.name : 'kipad') +
      ' — Sheet: ' + (cur ? cur.name : '—');
  }
  function refreshSheetTabs() {
    const el = $('sheet-tabs');
    if (!el) return;
    if (!project || !Project) { el.innerHTML = ''; return; }
    const cur = Project.activeSheet(project);
    const items = project.sheets.map(s => {
      const active = cur && s.id === cur.id;
      const cls = 'sheet-tab' + (active ? ' active' : '');
      const name = esc(s.name);
      return `<div class="${cls}" data-sheet-id="${esc(s.id)}" title="${name}">
        <span class="sheet-name">${name}</span>
        <button class="sheet-x" data-sheet-id="${esc(s.id)}" title="Delete sheet">×</button>
      </div>`;
    }).join('');
    el.innerHTML = items + '<button class="sheet-add" id="sheet-add" title="New sheet">+</button>';
    el.querySelectorAll('.sheet-tab').forEach(tab => {
      const id = tab.dataset.sheetId;
      tab.addEventListener('click', e => {
        if (e.target.classList.contains('sheet-x')) return;
        switchToSheet(id);
      });
      tab.querySelector('.sheet-x').addEventListener('click', e => {
        e.stopPropagation();
        deleteSheet(id);
      });
      tab.addEventListener('contextmenu', e => {
        e.preventDefault();
        const target = Project.getSheet(project, id);
        if (target) { switchToSheet(id); renameActiveSheet(); }
      });
      let pressTimer = null;
      tab.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => {
          const target = Project.getSheet(project, id);
          if (target) { switchToSheet(id); renameActiveSheet(); }
        }, 600);
      }, { passive: true });
      tab.addEventListener('touchend', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
      tab.addEventListener('touchmove', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    });
    const addBtn = el.querySelector('#sheet-add');
    if (addBtn) addBtn.addEventListener('click', e => { e.stopPropagation(); addNewSheet(); });
    // Status bar text
    refreshSheetStatus();
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

  // ---------- Gerber Viewer (RS-274X import + generated layers) ----------
  function showGerberViewer() {
    const GV = window.KipadGerberViewer;
    if (!GV || !Gerber) { setStatus('Gerber viewer module not loaded'); return; }
    const colors = ['#e64545', '#4d8ee8', '#e7dc87', '#cf69e8', '#55d5c8', '#d5d5d5', '#8fd07a', '#e89b52', '#a58fe0'];
    const layers = Object.entries(Gerber.exportAll(board, FPs ? FPs.getFootprint : null)).map(([name, data], i) => ({ name, image: GV.parse(data), color: colors[i % colors.length] }));
    let cur = 'F.Cu';
    const body = `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><label class="btn">Open Gerber files<input id="gv-file" type="file" accept=".gbr,.ger,.gtl,.gbl,.gto,.gbo,.gts,.gbs,.gm1,text/plain" multiple class="hidden"></label><span id="gv-info" class="muted"></span></div>
      <div class="gv-layers" id="gv-layers"></div><canvas class="lib-preview" id="gv-canvas" style="height:45vh;background:#111"></canvas>`;
    showModal('Gerber Viewer', body);
    const rebuildTabs = () => {
      const row = $('gv-layers'); row.innerHTML = '';
      layers.forEach(layer => {
        const b = document.createElement('button'); b.className = 'btn' + (layer.name === cur ? ' primary' : '');
        b.textContent = layer.name; b.addEventListener('click', () => { cur = layer.name; rebuildTabs(); draw(); }); row.appendChild(b);
      });
    };
    const draw = () => {
      const cv = $('gv-canvas');
      if (!cv) return;
      const c = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
      const layer = layers.find(x => x.name === cur), image = layer && layer.image, b = image && image.bounds;
      if (!b) { $('gv-info').textContent = 'Empty layer'; return; }
      const bw = Math.max(0.01, b.x1 - b.x0), bh = Math.max(0.01, b.y1 - b.y0);
      const zoom = Math.min((w - 30) / bw, (h - 30) / bh), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const sx = x => w / 2 + (x - cx) * zoom, sy = y => h / 2 - (y - cy) * zoom;
      c.fillStyle = c.strokeStyle = layer.color; c.lineCap = 'round'; c.lineJoin = 'round';
      image.ops.forEach(op => {
        if (op.kind === 'region') { c.beginPath(); op.points.forEach((p, i) => (i ? c.lineTo(sx(p[0]), sy(p[1])) : c.moveTo(sx(p[0]), sy(p[1])))); c.closePath(); c.fill(); return; }
        const ap = op.aperture;
        if (op.kind === 'line') { c.lineWidth = Math.max(1, ap.w * zoom); c.beginPath(); c.moveTo(sx(op.x1), sy(op.y1)); c.lineTo(sx(op.x2), sy(op.y2)); c.stroke(); return; }
        const x = sx(op.x), y = sy(op.y), aw = Math.max(1, ap.w * zoom), ah = Math.max(1, ap.h * zoom);
        if (ap.shape === 'C') { c.beginPath(); c.arc(x, y, aw / 2, 0, Math.PI * 2); c.fill(); }
        else if (ap.shape === 'O') { c.beginPath(); c.roundRect(x - aw / 2, y - ah / 2, aw, ah, Math.min(aw, ah) / 2); c.fill(); }
        else c.fillRect(x - aw / 2, y - ah / 2, aw, ah);
      });
      $('gv-info').textContent = `${image.ops.length} objects · ${bw.toFixed(2)} × ${bh.toFixed(2)} mm`;
    };
    $('gv-file').addEventListener('change', e => Array.from(e.target.files || []).forEach((file, i) => {
      const rd = new FileReader();
      rd.onload = () => { try { layers.push({ name: file.name, image: GV.parse(rd.result), color: colors[(layers.length + i) % colors.length] }); cur = file.name; rebuildTabs(); draw(); } catch (err) { setStatus(`Could not parse ${file.name}: ${err.message}`); } };
      rd.onerror = () => setStatus(`Could not read ${file.name}`); rd.readAsText(file);
    }));
    rebuildTabs(); draw();
    $('modal-ok').addEventListener('click', hideModal);
  }

  // ---------- PCB Calculator (KiCad-style multi-tool) ----------
  function showCalc() {
    const tabs = [['track', 'Track Width'], ['via', 'Via Size'], ['spacing', 'Spacing'], ['resistor', 'Resistor Code'], ['divider', 'Divider'], ['eser', 'E-series'], ['regulator', 'Regulator'], ['antenna', 'Antenna'], ['microstrip', 'Microstrip'], ['stackup', 'Board Thickness']];
    let cur = 'track';
    showModal('PCB Calculator', `<div class="gv-layers">${tabs.map(t => `<button class="btn ${t[0] === cur ? 'primary' : ''}" data-cal="${t[0]}">${t[1]}</button>`).join('')}</div><div id="cal-body"></div>`);
    $('modal-body').querySelectorAll('[data-cal]').forEach(b => b.addEventListener('click', () => {
      cur = b.dataset.cal;
      $('modal-body').querySelectorAll('[data-cal]').forEach(x => x.classList.toggle('primary', x.dataset.cal === cur));
      renderCalTab();
    }));
    const fmt = (v, d) => Math.abs(v) >= 1e5 || (Math.abs(v) > 0 && Math.abs(v) < 1e-3) ? v.toExponential(2) : v.toFixed(d);
    const num = (id, def) => { const el = $(id); if (!el) return def; const v = parseFloat(el.value); return isFinite(v) ? v : def; };
    const bind = (ids, fn) => ids.forEach(id => { const el = $(id); if (el) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', fn); });
    const KC = window.KipadCalc;

    function renderCalTab() {
      const body = $('cal-body');
      if (!body) return;
      if (cur === 'track') {
        body.innerHTML = `<div class="prop-group"><h5>IPC-2221 trace width</h5>
          <div class="prop-row"><label>Current</label><input id="cal-i" type="number" step="0.1" min="0" value="1"><span>A</span></div>
          <div class="prop-row"><label>ΔT rise</label><input id="cal-t" type="number" step="1" min="1" value="10"><span>°C</span></div>
          <div class="prop-row"><label>Copper</label><select id="cal-oz"><option value="1">1 oz (35 µm)</option><option value="2">2 oz (70 µm)</option><option value="0.5">0.5 oz (18 µm)</option></select></div>
          <div class="prop-row"><label>Layer</label><select id="cal-ly"><option value="ext">External</option><option value="int">Internal</option></select></div></div>
          <div class="drc-item" id="cal-out"></div>`;
        const calc = () => {
          const r = KC.trackWidth(num('cal-i', 1), num('cal-t', 10), num('cal-oz', 1), $('cal-ly').value === 'int');
          out(`Required width: <b>${r.widthMm ? r.widthMm.toFixed(3) + ' mm' : '—'}</b>${r.widthMm ? ` (${r.widthMil.toFixed(2)} mil · ${r.areaMil2.toFixed(1)} mil² cross-section)` : ''}`);
        };
        bind(['cal-i', 'cal-t', 'cal-oz', 'cal-ly'], calc); calc();
      } else if (cur === 'via') {
        body.innerHTML = `<div class="prop-group"><h5>Via barrel capacity + IR drop</h5>
          <div class="prop-row"><label>Drill Ø</label><input id="cal-vd" type="number" step="0.05" min="0.1" value="0.6"><span>mm</span></div>
          <div class="prop-row"><label>Plating</label><input id="cal-vp" type="number" step="5" min="5" value="25"><span>µm</span></div>
          <div class="prop-row"><label>Length</label><input id="cal-vl" type="number" step="0.1" min="0.1" value="1.6"><span>mm</span></div>
          <div class="prop-row"><label>ΔT rise</label><input id="cal-vt" type="number" step="1" min="1" value="10"><span>°C</span></div>
          <div class="prop-row"><label>Current</label><input id="cal-vi" type="number" step="0.1" min="0" value="1"><span>A</span></div></div>
          <div class="drc-item" id="cal-out"></div>`;
        const calc = () => {
          const v = KC.viaStats({ drillMm: num('cal-vd', 0.6), platingUm: num('cal-vp', 25), lengthMm: num('cal-vl', 1.6), deltaT: num('cal-vt', 10), currentA: num('cal-vi', 0) });
          out(`Max current ≈ <b>${v.iMaxA.toFixed(2)} A</b> at ΔT · barrel ${(v.annulusMm2 * 100).toFixed(1)}e-2 mm²<br>R ${fmt(v.rOhms, 4)} Ω · drop ${fmt(v.vDrop, 4)} V · loss ${fmt(v.pLossW, 4)} W at the set current`);
        };
        bind(['cal-vd', 'cal-vp', 'cal-vl', 'cal-vt', 'cal-vi'], calc); calc();
      } else if (cur === 'spacing') {
        body.innerHTML = `<div class="prop-group"><h5>IPC-2221A Table 6-1 clearance</h5>
          <div class="prop-row"><label>Voltage</label><input id="cal-sp" type="number" step="1" min="0" value="50"><span>V peak</span></div></div>
          <div class="drc-item" id="cal-out"></div>`;
        const calc = () => {
          const s = KC.spacing(num('cal-sp', 50));
          out(`<table class="props-table" style="margin:auto"><tr><th></th><th>B1 int</th><th>B2 ext</th><th>A5</th><th>A6</th><th>A7</th></tr>
            <tr><td>mm</td><td>${s.b1}</td><td>${s.b2}</td><td>${s.a5}</td><td>${s.a6}</td><td>${s.a7}</td></tr></table><br>B1/B2 bare boards; A5–A7 coated assemblies`);
        };
        bind(['cal-sp'], calc); calc();
      } else if (cur === 'resistor') {
        body.innerHTML = `<div class="prop-group"><h5>Colour bands → value</h5>
          <div class="prop-row"><label>Bands</label><select id="cal-rn"><option value="4">4</option><option value="5">5</option></select><span></span></div>
          <div class="prop-row" id="cal-bandrow"></div>
          <div class="drc-item" id="cal-out"></div></div>
          <div class="prop-group"><h5>Value → colour bands</h5>
          <div class="prop-row"><label>Resistance</label><input id="cal-rv" type="number" step="any" min="0" value="4700"><span>Ω ±</span><select id="cal-rtol"><option>5</option><option>10</option><option>1</option><option>2</option><option>0.5</option><option>0.25</option></select><span>%</span></div>
          <div class="drc-item" id="cal-out2"></div></div>`;
        const chip = c => {
          const bg = { gold: '#d4af37', silver: '#c0c0c0', none: '#d9c9a3' }[c];
          return `<span style="display:inline-block;width:26px;height:34px;border-radius:6px;border:1px solid #999;margin:0 2px;background:${bg || ({ black: '#111', brown: '#7b3f00', red: '#c22', orange: '#e87a1e', yellow: '#f4c430', green: '#2e8b57', blue: '#2660a4', violet: '#8f68c0', grey: '#888' })[c]};color:#fff;vertical-align:middle" title="${c}"></span>`;
        };
        const sel = (id, opts) => `<select id="${id}">${opts.map(o => `<option>${o}</option>`).join('')}</select>`;
        const buildBands = () => {
          const n = parseInt($('cal-rn').value, 10);
          const digits = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];
          const mults = Object.keys(KC.MULTIPLIER);
          const tols = Object.keys(KC.TOLERANCE);
          let h = '<label>Bands</label>';
          for (let i = 0; i < n - 2; i++) h += `<span style="margin-left:6px">${sel('cal-bd' + i, digits)}</span>`;
          h += `<span style="margin-left:6px">×${sel('cal-bm', mults)}</span><span style="margin-left:6px">±${sel('cal-bt', tols)}</span>`;
          $('cal-bandrow').innerHTML = h;
          for (let i = 0; i < n - 2; i++) $(`cal-bd${i}`).addEventListener('change', calcBands);
          $('cal-bm').addEventListener('change', calcBands);
          $('cal-bt').addEventListener('change', calcBands);
          calcBands();
        };
        const calcBands = () => {
          const n = parseInt($('cal-rn').value, 10);
          const names = [];
          for (let i = 0; i < n - 2; i++) names.push($(`cal-bd${i}`).value);
          names.push($('cal-bm').value, $('cal-bt').value);
          try {
            const r = KC.resistorFromColors(names);
            $('cal-out').innerHTML = `<b>${r.ohms >= 1e6 ? (r.ohms / 1e6) + ' MΩ' : r.ohms >= 1e3 ? (r.ohms / 1e3) + ' kΩ' : r.ohms + ' Ω'}</b> ±${r.tolPct}%`;
          } catch (e) { $('cal-out').textContent = e.message; }
        };
        const calcValue = () => {
          try {
            const five = parseInt($('cal-rn').value, 10) === 5;
            const bands = KC.resistorToColors(num('cal-rv', 4700), parseFloat($('cal-rtol').value), five);
            $('cal-out2').innerHTML = bands.map(chip).join('') + ` <small>${bands.join(' · ')}</small>`;
          } catch (e) { $('cal-out2').textContent = e.message; }
        };
        buildBands();
        bind(['cal-rv'], calcValue);
        $('cal-rtol').addEventListener('change', calcValue);
        $('cal-rn').addEventListener('change', () => { buildBands(); calcValue(); });
        calcValue();
      } else if (cur === 'divider') {
        body.innerHTML = `<div class="prop-group"><h5>Voltage divider</h5>
          <div class="prop-row"><label>Vin</label><input id="cal-dvin" type="number" step="0.1" value="5"><span>V</span></div>
          <div class="prop-row"><label>R1</label><input id="cal-dr1" type="number" step="any" value="10000"><span>Ω</span></div>
          <div class="prop-row"><label>R2</label><input id="cal-dr2" type="number" step="any" value="10000"><span>Ω</span></div>
          <div class="prop-row"><label>Load RL</label><input id="cal-drl" type="number" step="any" placeholder="open"><span>Ω</span></div></div>
          <div class="drc-item" id="cal-out"></div>`;
        const calc = () => {
          const rlRaw = $('cal-drl').value.trim();
          const d = KC.voltageDivider(num('cal-dvin', 0), num('cal-dr1', 0), num('cal-dr2', 0), rlRaw === '' ? null : num('cal-drl', null));
          out(`Vout ideal <b>${isFinite(d.voutIdeal) ? d.voutIdeal.toFixed(3) : '—'} V</b>${rlRaw !== '' ? ` · loaded ${isFinite(d.vout) ? d.vout.toFixed(3) : '—'} V (${(d.iLoad * 1000).toFixed(2)} mA into RL)` : ' · open load'}`);
        };
        bind(['cal-dvin', 'cal-dr1', 'cal-dr2', 'cal-drl'], calc); calc();
      } else if (cur === 'eser') {
        body.innerHTML = `<div class="prop-group"><h5>Nearest preferred value (IEC 60063)</h5>
          <div class="prop-row"><label>Target</label><input id="cal-et" type="number" step="any" min="0" value="1140"><span>Ω</span></div>
          <div class="prop-row"><label>Series</label><select id="cal-es"><option>E24</option><option>E12</option><option>E96</option></select><span></span></div></div>
          <div class="drc-item" id="cal-out"></div>`;
        const calc = () => {
          try {
            const r = KC.eseriesNearest(num('cal-et', 0), $('cal-es').value);
            const ohms = r.value >= 1e6 ? (r.value / 1e6) + ' MΩ' : r.value >= 1e3 ? (r.value / 1e3) + ' kΩ' : String(r.value) + ' Ω';
            out(`Nearest ${r.series}: <b>${ohms}</b> (${(r.relErr * 100).toFixed(2)}% off)`);
          } catch (e) { $('cal-out').textContent = e.message; }
        };
        bind(['cal-et', 'cal-es'], calc); calc();
      } else if (cur === 'regulator') {
        body.innerHTML = `<div class="prop-group"><h5>Three-terminal adjustable regulator</h5>
          <div class="prop-row"><label>Vref</label><input id="cal-rg-vref" type="number" step="any" min="0" value="1.25"><span>V</span></div>
          <div class="prop-row"><label>Target Vout</label><input id="cal-rg-vout" type="number" step="any" min="0" value="5"><span>V</span></div>
          <div class="prop-row"><label>Rset (Vout→Adj)</label><input id="cal-rg-set" type="number" step="any" min="0" value="240"><span>Ω</span></div>
          <div class="prop-row"><label>Iadj</label><input id="cal-rg-ia" type="number" step="any" min="0" value="50"><span>µA</span></div>
          <div class="prop-row"><label>Preferred series</label><select id="cal-rg-es"><option>E96</option><option>E24</option><option>E12</option></select><span></span></div></div>
          <div class="drc-item" id="cal-out"></div>`;
        const calc = () => {
          try {
            const r = KC.adjustableRegulator({ vref: num('cal-rg-vref', 0), targetV: num('cal-rg-vout', 0), rSetOhms: num('cal-rg-set', 0), iAdjustUa: num('cal-rg-ia', 0), series: $('cal-rg-es').value });
            out(`Rground (Adj→GND) exact <b>${fmt(r.rGroundExact, 1)} Ω</b> · nearest ${r.series} <b>${fmt(r.rGroundOhms, 1)} Ω</b><br>Actual Vout <b>${fmt(r.actualV, 4)} V</b> (${r.errorPct >= 0 ? '+' : ''}${r.errorPct.toFixed(3)}%) · Rset current ${fmt(r.setCurrentA * 1000, 3)} mA`);
          } catch (e) { $('cal-out').textContent = e.message; }
        };
        bind(['cal-rg-vref', 'cal-rg-vout', 'cal-rg-set', 'cal-rg-ia', 'cal-rg-es'], calc); calc();
      } else if (cur === 'antenna') {
        body.innerHTML = `<div class="prop-group"><h5>RF wavelength / resonant element length</h5>
          <div class="prop-row"><label>Frequency</label><input id="cal-af" type="number" step="any" min="0" value="2400"><span>MHz</span></div>
          <div class="prop-row"><label>Velocity factor</label><input id="cal-av" type="number" step="0.01" min="0.01" max="1" value="1"><span>0–1</span></div></div>
          <div class="drc-item" id="cal-out"></div>`;
        const calc = () => {
          try {
            const r = KC.antennaLength(num('cal-af', 0), num('cal-av', 1));
            out(`Full wave <b>${fmt(r.wavelengthMm, 2)} mm</b> · half wave <b>${fmt(r.halfWaveMm, 2)} mm</b> · quarter wave <b>${fmt(r.quarterWaveMm, 2)} mm</b><br><small>Electrical starting lengths; tune the finished antenna for its geometry and surroundings.</small>`);
          } catch (e) { $('cal-out').textContent = e.message; }
        };
        bind(['cal-af', 'cal-av'], calc); calc();
      } else if (cur === 'microstrip') { // microstrip
        body.innerHTML = `<div class="prop-group"><h5>Microstrip transmission line</h5>
          <div class="prop-row"><label>Mode</label><select id="cal-ms-mode"><option value="analyse">Analyse width</option><option value="synth">Synthesize width</option></select><span></span></div>
          <div class="prop-row"><label id="cal-ms-main-label">Trace width</label><input id="cal-ms-main" type="number" step="any" min="0" value="0.3"><span id="cal-ms-main-unit">mm</span></div>
          <div class="prop-row"><label>Dielectric height</label><input id="cal-ms-h" type="number" step="any" min="0" value="0.2"><span>mm</span></div>
          <div class="prop-row"><label>Relative εr</label><input id="cal-ms-er" type="number" step="any" min="1.01" value="4.2"><span></span></div>
          <div class="prop-row"><label>Line length</label><input id="cal-ms-l" type="number" step="any" min="0" value="25"><span>mm</span></div>
          <div class="prop-row"><label>Frequency</label><input id="cal-ms-f" type="number" step="any" min="0" value="2.4"><span>GHz</span></div></div>
          <div class="drc-item" id="cal-out"></div>`;
        const calc = () => {
          try {
            const synth = $('cal-ms-mode').value === 'synth';
            $('cal-ms-main-label').textContent = synth ? 'Target impedance' : 'Trace width';
            $('cal-ms-main-unit').textContent = synth ? 'Ω' : 'mm';
            const h = num('cal-ms-h', 0), er = num('cal-ms-er', 0);
            const width = synth ? KC.microstripWidth(num('cal-ms-main', 50), h, er).widthMm : num('cal-ms-main', 0);
            const r = KC.microstrip({ widthMm: width, heightMm: h, er, lengthMm: num('cal-ms-l', 0), frequencyGHz: num('cal-ms-f', 0) });
            out(`${synth ? `Width <b>${fmt(width, 4)} mm</b> · ` : ''}Z₀ <b>${fmt(r.impedanceOhms, 2)} Ω</b> · εeff ${fmt(r.effectiveEr, 3)}<br>Delay ${fmt(r.delayPs, 2)} ps · electrical length ${fmt(r.electricalLengthDeg, 2)}°<br><small>Quasi-static thin-copper estimate; verify controlled impedance with the board fabricator.</small>`);
          } catch (e) { $('cal-out').textContent = e.message; }
        };
        $('cal-ms-mode').addEventListener('change', () => {
          $('cal-ms-main').value = $('cal-ms-mode').value === 'synth' ? '50' : '0.3';
          calc();
        });
        bind(['cal-ms-main', 'cal-ms-h', 'cal-ms-er', 'cal-ms-l', 'cal-ms-f'], calc); calc();
      } else if (cur === 'stackup') {
        const KINDS = [['copper', 'Copper'], ['substrate', 'Substrate (core)'], ['prepreg', 'Prepreg'], ['soldermask', 'Solder mask'], ['silkscreen', 'Silkscreen'], ['other', 'Other']];
        const PRESETS = {
          std2: [{ kind: 'soldermask', thicknessUm: 20 }, { kind: 'silkscreen', thicknessUm: 10 }, { kind: 'copper', thicknessUm: 35 }, { kind: 'substrate', thicknessUm: 1500 }, { kind: 'copper', thicknessUm: 35 }, { kind: 'soldermask', thicknessUm: 20 }, { kind: 'silkscreen', thicknessUm: 10 }],
          l4: [{ kind: 'silkscreen', thicknessUm: 10 }, { kind: 'soldermask', thicknessUm: 20 }, { kind: 'copper', thicknessUm: 35 }, { kind: 'prepreg', thicknessUm: 200 }, { kind: 'copper', thicknessUm: 17.5 }, { kind: 'substrate', thicknessUm: 1000 }, { kind: 'copper', thicknessUm: 17.5 }, { kind: 'prepreg', thicknessUm: 200 }, { kind: 'copper', thicknessUm: 35 }, { kind: 'soldermask', thicknessUm: 20 }, { kind: 'silkscreen', thicknessUm: 10 }]
        };
        let stack = PRESETS.std2.map(l => ({ ...l }));
        body.innerHTML = `<div class="prop-group"><h5>Board stackup thickness</h5>
          <div class="prop-row"><label>Preset</label><select id="cal-bt-preset"><option value="std2">2-layer, 1.6 mm FR-4</option><option value="l4">4-layer, 1.6 mm FR-4</option><option value="">(custom)</option></select><span></span></div>
          <div id="cal-bt-rows"></div>
          <div class="lib-actions"><button class="btn" id="cal-bt-add">+ Layer</button></div></div>
          <div class="drc-item" id="cal-bt-out"></div>`;
        const rowHtml = (l, i) => `<div class="prop-row"><select data-bt-kind="${i}">${KINDS.map(k => `<option value="${k[0]}"${k[0] === l.kind ? ' selected' : ''}>${k[1]}</option>`).join('')}</select><input data-bt-um="${i}" type="number" step="any" min="0" value="${l.thicknessUm}"><span>µm</span><button class="btn btn-sm" data-bt-del="${i}" title="Remove layer" style="padding:0 8px">×</button></div>`;
        const renderRows = () => { $('cal-bt-rows').innerHTML = stack.map(rowHtml).join(''); }; // eslint-disable-line
        const readback = () => {
          $('cal-bt-rows').querySelectorAll('[data-bt-kind]').forEach(s => { stack[+s.dataset.btKind].kind = s.value; });
          $('cal-bt-rows').querySelectorAll('[data-bt-um]').forEach(inp => { const v = parseFloat(inp.value); stack[+inp.dataset.btUm].thicknessUm = isFinite(v) ? v : NaN; });
        };
        const recalc = () => {
          try {
            const r = KC.boardThickness(stack);
            out(`<b>${r.totalMm.toFixed(3)} mm</b> finished thickness · ${r.totalMil.toFixed(1)} mil · ${r.totalInch.toFixed(3)} in<br>${r.copperLayers} copper layer${r.copperLayers === 1 ? '' : 's'} totalling ${r.copperOz.toFixed(2)} oz/ft²<br><small>${r.breakdown.map(b => `${b.thicknessUm} µm ${b.kind}`).join(' + ')}</small>`);
          } catch (e) { $('cal-bt-out').innerHTML = e.message; }
        };
        // Delegated listeners are attached exactly once to the persistent
        // #cal-bt-rows element; renders only refresh innerHTML.
        const wireRows = () => {
          const rows = $('cal-bt-rows');
          rows.addEventListener('change', e => { if (e.target.matches('[data-bt-kind]')) { readback(); recalc(); } });
          rows.addEventListener('input', e => { if (e.target.matches('[data-bt-um]')) { readback(); recalc(); } });
          rows.addEventListener('click', e => {
            const del = e.target.closest('[data-bt-del]');
            if (del && stack.length > 1) {
              readback();
              stack.splice(+del.dataset.btDel, 1);
              renderRows(); recalc();
            }
          });
        };
        renderRows(); wireRows(); recalc();
        $('cal-bt-add').addEventListener('click', () => {
          stack.push({ kind: 'substrate', thicknessUm: 500 });
          $('cal-bt-preset').value = '';
          renderRows(); recalc();
        });
        $('cal-bt-preset').addEventListener('change', () => {
          const p = PRESETS[$('cal-bt-preset').value];
          if (!p) return;
          stack = p.map(l => ({ ...l }));
          renderRows(); recalc();
        });
      }
    }
    renderCalTab();
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
