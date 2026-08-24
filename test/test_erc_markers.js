/* KipadErc.markers — on-canvas ERC marker geometry (dedupe, colours, clamped radius). */
const path = require('path');
const Erc = require(path.join(__dirname, '..', 'js', 'erc.js'));

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name); }
}

console.log('test_erc_markers');

// empty / null input
t('empty input -> []', Erc.markers([], 3).length === 0);
t('null input -> []', Erc.markers(null, 3).length === 0);

const vs = [
  { severity: 'error', code: 'DUPLICATE_REF', message: 'R1 used twice', x: 10, y: 20 },
  { severity: 'warning', code: 'UNCONNECTED_PIN', message: 'Pin 1 of R1', x: 30, y: 40 },
  // same location as the first (within 0.05mm rounding) — deduped
  { severity: 'error', code: 'MISSING_VALUE', message: 'dup at same spot', x: 10.02, y: 19.99 },
  // non-finite coords are skipped
  { severity: 'warning', code: 'X', message: 'bad', x: NaN, y: 5 },
];

const ms = Erc.markers(vs, 3);
t('dedupe keeps first violation per location', ms.length === 2);
t('kept marker is the first one at that spot', ms[0].code === 'DUPLICATE_REF');
t('error colour', ms[0].color === '#cc0000');
t('warning colour', ms[1].color === '#b8860b');
t('message/code/severity carried through', ms[1].message === 'Pin 1 of R1' && ms[1].severity === 'warning');

// world coords preserved
t('world coords preserved', ms[0].x === 10 && ms[0].y === 20);

// radius: 0.9mm * zoom, clamped to [5,16]
t('radius scales with zoom mid-range (z=8 -> 7.2)', Math.abs(Erc.markers(vs, 8)[0].r - 7.2) < 1e-9);
const far = Erc.markers(vs, 100)[0];
t('radius clamps at max 16px when zoomed in', far.r === 16);
const near = Erc.markers(vs, 2)[0];
t('radius clamps at min 5px when zoomed out', near.r === 5);
t('zoom defaults to 3 when falsy (clamped to 5px)', Erc.markers(vs)[0].r === 5);

// determinism
t('deterministic output', JSON.stringify(Erc.markers(vs, 3)) === JSON.stringify(Erc.markers(vs, 3)));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
