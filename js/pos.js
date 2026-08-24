'use strict';

/**
 * KipadPos — KiCad pick-and-place / component placement exporter (.pos).
 *
 * Produces the same file family as KiCad's File > Fabrication Outputs >
 * Component Placement (.pos): one text table per board side (front/back),
 * columns Ref, Val, Package, PosX, PosY, Rot, Side.
 *
 * Conventions:
 *  - Coordinates are millimetres, straight from the internal board frame
 *    (same Y-down convention kicad_pcb uses, so no axis flip).
 *  - Only footprints with at least one pad are listed; pad-less art
 *    (logo images, silk-only modules) is excluded like KiCad's default
 *    "exclude from position files" behaviour for non-standard parts.
 *  - Side comes from the footprint's layer: F.Cu -> front, B.Cu -> back.
 *  - Rotation normalised to [0, 360) degrees.
 *
 * UMD: browser global `KipadPos` / CommonJS module.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadPos = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * collectPlacements(board) -> { front: [rows], back: [rows] }
   * row = { ref, value, pattern, x, y, rot }
   * Rows keep board order within each side (deterministic).
   */
  function collectPlacements(board) {
    var front = [], back = [];
    var fps = (board && board.footprints) || [];
    for (var i = 0; i < fps.length; i++) {
      var fp = fps[i];
      if (!fp.pads || !fp.pads.length) continue;
      var row = {
        ref: String(fp.ref || ''),
        value: String(fp.value || ''),
        pattern: String(fp.lib || ''),
        x: fp.at[0],
        y: fp.at[1],
        rot: ((Number(fp.angle) || 0) % 360 + 360) % 360
      };
      if (fp.layer === 'B.Cu') back.push(row); else front.push(row);
    }
    return { front: front, back: back };
  }

  function fmtNum(mm) {
    // KiCad .pos uses %.4f style coordinates
    return mm.toFixed(4);
  }

  /**
   * formatPos(rows, sideLabel, opts?) -> .pos text for one side.
   * opts.date overrides the creation timestamp (testing); otherwise UTC now.
   */
  function formatPos(rows, sideLabel, opts) {
    var when;
    if (opts && opts.date) when = opts.date;
    else {
      var d = new Date();
      when = d.getUTCFullYear() + '-' +
        String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
        String(d.getUTCDate()).padStart(2, '0') + 'T' +
        String(d.getUTCHours()).padStart(2, '0') + ':' +
        String(d.getUTCMinutes()).padStart(2, '0') + ':' +
        String(d.getUTCSeconds()).padStart(2, '0');
    }

    var out = [
      '### Module positions - created on ' + when + ' ###',
      '### Printed by Kipad ###',
      '## Unit = mm, Angle = deg.',
      '',
      '## Side : ' + sideLabel,
      '# Ref     Val       Package  PosX       PosY       Rot     Side'
    ];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out.push(
        r.ref.padEnd(9) + ' ' +
        ('"' + r.value + '"').padEnd(9) + ' ' +
        r.pattern.padEnd(8) + ' ' +
        fmtNum(r.x).padStart(10) + ' ' +
        fmtNum(r.y).padStart(10) + ' ' +
        r.rot.toFixed(2).padStart(7) + ' ' +
        sideLabel
      );
    }

    out.push('## End');
    return out.join('\n') + '\n';
  }

  /**
   * exportPos(board, opts?) -> { front: text|null, back: text|null }
   * Null when a side has no placements (KiCad skips empty sides too).
   */
  function exportPos(board, opts) {
    var p = collectPlacements(board);
    return {
      front: p.front.length ? formatPos(p.front, 'front', opts) : null,
      back: p.back.length ? formatPos(p.back, 'back', opts) : null
    };
  }

  return {
    collectPlacements: collectPlacements,
    formatPos: formatPos,
    exportPos: exportPos
  };
});
