'use strict';

/**
 * test_zip.js — KipadZip store-mode ZIP writer checks.
 * Run: node test/test_zip.js
 */

const assert = require('assert');
const Zip = require('../js/zip.js');

let checks = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  checks++;
}

// ---------- CRC-32 known vectors ----------
ok(Zip.crc32(Zip.toBytes('')) === 0, 'CRC32 of empty input is 0');
ok(Zip.crc32(Zip.toBytes('123456789')) === 0xCBF43926, 'CRC32("123456789") = 0xCBF43926');
ok(Zip.crc32(Zip.toBytes('The quick brown fox jumps over the lazy dog')) === 0x414FA339,
  'CRC32(fox vector) = 0x414FA339');

// ---------- UTF-8 encoding ----------
const enc = Buffer.from(Zip.toBytes('héllo ✓')).toString('utf8');
ok(enc === 'héllo ✓', 'toBytes round-trips multibyte UTF-8');
ok(Buffer.from(Zip.toBytes(new Uint8Array([1, 2, 3]))).equals(Buffer.from([1, 2, 3])),
  'toBytes passes Uint8Array through');
let threw = false;
try { Zip.toBytes(42); } catch (e) { threw = true; }
ok(threw, 'toBytes rejects unsupported types');

// ---------- archive structure ----------
const NOW = new Date(2026, 0, 1, 12, 30, 15);
const files = [
  { name: 'gerbers/kipad-FCu.gbr', data: 'G04 kipad gerber*\nM02*\n' },
  { name: 'bom/kipad-bom.csv', data: 'Reference,Value\nR1,10k\nR10,1M\n' },
  { name: 'drill/kipad.drl', data: 'M48\nFMAT,2\nT1C0.800\n%\nG90\nG05\nT1\nX100Y100\nM30\n' },
  { name: 'empty.txt', data: '' }
];
const buf = Buffer.from(Zip.zipStore(files, { now: NOW }));

function u32at(p) { return buf.readUInt32LE(p); }
function u16at(p) { return buf.readUInt16LE(p); }

ok(u32at(0) === 0x04034b50, 'file starts with local header signature');

// find EOCD by scanning backwards
let eocd = buf.length - 22;
while (eocd >= 0 && u32at(eocd) !== 0x06054b50) eocd--;
ok(eocd >= 0, 'EOCD record found');
ok(u16at(eocd + 8) === files.length && u16at(eocd + 10) === files.length,
  'EOCD entry counts match (' + files.length + ')');
ok(u16at(eocd + 20) === 0, 'no zip64 / comment length is zero');

const cdStart = u32at(eocd + 16);
const cdSize = u32at(eocd + 12);
ok(cdSize > 0 && cdStart > 0, 'central directory offset/size populated');

// walk central directory entries and cross-check against local headers
let cdOff = cdStart;
for (let i = 0; i < files.length; i++) {
  ok(u32at(cdOff) === 0x02014b50, 'central entry ' + i + ' signature');
  ok(u16at(cdOff + 8) === 0x0800, 'central entry ' + i + ' flags: UTF-8 names');
  ok(u16at(cdOff + 10) === 0, 'central entry ' + i + ' method is store (0)');
  ok(u16at(cdOff + 34) === 0, 'central entry ' + i + ' disk number start is 0');
  const crc = u32at(cdOff + 16);
  const csize = u32at(cdOff + 20);
  const usize = u32at(cdOff + 24);
  const nameLen = u16at(cdOff + 28);
  const lho = u32at(cdOff + 42);
  const name = buf.slice(cdOff + 46, cdOff + 46 + nameLen).toString('utf8');
  ok(name === files[i].name, 'central entry ' + i + ' name matches: ' + name);
  ok(csize === usize, 'entry ' + i + ' store method keeps sizes equal');
  // local header cross-check
  ok(u32at(lho) === 0x04034b50, 'local header ' + i + ' at central-directory offset');
  ok(u32at(lho + 14) === crc, 'entry ' + i + ' CRC consistent between headers');
  ok(u16at(lho + 26) === nameLen, 'local header ' + i + ' name length matches');
  const dataStart = lho + 30 + nameLen + u16at(lho + 28);
  const content = buf.slice(dataStart, dataStart + usize).toString('utf8');
  const expected = typeof files[i].data === 'string' ? files[i].data : String(files[i].data);
  ok(content === expected, 'entry ' + i + ' stored bytes round-trip exactly');
  ok(Zip.crc32(buf.slice(dataStart, dataStart + usize)) === crc, 'entry ' + i + ' CRC matches stored content');
  cdOff += 46 + nameLen;
}
ok(cdOff === cdStart + cdSize, 'walked central directory consumes exactly cdSize bytes');

// DOS timestamp encoding check on first local header
const dosTime = u16at(10), dosDate = u16at(12);
ok(dosTime === ((12 << 11) | (30 << 5) | (15 >> 1)), 'DOS time encodes 12:30:15');
ok(dosDate === (((2026 - 1980) << 9) | (1 << 5) | 1), 'DOS date encodes 2026-01-01');

// determinism with fixed timestamp
const again = Buffer.from(Zip.zipStore(files, { now: NOW }));
ok(again.equals(buf), 'same inputs + fixed timestamp -> byte-identical archive');

console.log('test_zip: ' + checks + ' checks passed');
