/* KipadKeys — pure keyboard-shortcut resolution for the KiCad-parity bindings.
 * UMD: works in node (tests) and browser (app.part4 keydown handler).
 *
 * resolve(ev, ctx) -> action string | null
 *   ev:  {key, ctrlKey, metaKey, shiftKey}
 *   ctx: {mode: 'launcher'|'schematic'|'pcb', hasSelection: bool}
 *
 * Actions:
 *   Ctrl/Cmd+S save · Ctrl/Cmd+O open · Ctrl/Cmd+Z undo · Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y redo
 *   Ctrl/Cmd+A select all (PCB)
 *   + / = zoomIn · - / _ zoomOut · Home zoomFit
 *   E properties (PCB, selection required) · A addFootprint (PCB) / addSymbol (schematic)
 *   ArrowLeft/Right/Up/Down nudge selection by one grid step (selection required)
 *
 * Plain-letter editing shortcuts (S/X/R/W/G/N/T/L/M/Z/V/H/Q/Del/Esc/Enter) stay in
 * app.part4.js exactly as before; this module only owns the parity surface and runs
 * BEFORE those switches so modifier combos never leak into single-key tools.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KipadKeys = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ZOOM = { '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', '_': 'zoomOut' };
  var ARROWS = { ArrowLeft: 'nudgeLeft', ArrowRight: 'nudgeRight', ArrowUp: 'nudgeUp', ArrowDown: 'nudgeDown' };

  function resolve(ev, ctx) {
    var k = ev && ev.key;
    if (!k) return null;
    if (ev.ctrlKey || ev.metaKey) {
      switch (k) {
        case 's': case 'S': return 'save';
        case 'o': case 'O': return 'open';
        case 'z': case 'Z': return ev.shiftKey ? 'redo' : 'undo';
        case 'y': case 'Y': return 'redo';
        case 'a': case 'A':
          return ctx && ctx.mode === 'pcb' ? 'selectAll' : null;
      }
      return null;
    }
    if (ev.altKey) return null; // leave browser/OS combos alone
    ctx = ctx || {};
    if (ctx.mode === 'launcher') return null;
    if (Object.prototype.hasOwnProperty.call(ZOOM, k)) return ZOOM[k];
    if (k === 'Home') return 'zoomFit';
    if (Object.prototype.hasOwnProperty.call(ARROWS, k))
      return ctx.hasSelection ? ARROWS[k] : null;
    if (k === 'e' || k === 'E')
      return ctx.mode === 'pcb' && ctx.hasSelection ? 'props' : null;
    if (k === 'a' || k === 'A')
      return ctx.mode === 'schematic' ? 'addSymbol' : 'addFootprint';
    return null;
  }

  return { resolve: resolve };
});
