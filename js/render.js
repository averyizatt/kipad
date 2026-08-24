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
    return [(px - view.x) * view.zoom + cw / 2, (py - view.y) * view.zoom + cw / 2 - (cw / 2 - ch / 2)];
  }
  function s2w(view, sx, sy, cw, ch) {
    return [(sx - cw / 2) / view.zoom + view.x, (sy - ch / 2) / view.zoom + view.y];
  }
