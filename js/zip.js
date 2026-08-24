'use strict';

/**
 * KipadZip — minimal store-mode ZIP writer for the fabrication package.
 *
 * Produces a spec-compliant ZIP archive (local headers + central directory +
 * EOCD) using compression method 0 (store). Text inputs are UTF-8 encoded.
 * Deterministic per-input apart from the DOS timestamps (set from `new Date()`
 * unless `opts.now` is provided — handy for tests).
 *
 * UMD: browser global `KipadZip` / CommonJS module.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadZip = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Standard CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320).
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** string -> UTF-8 bytes (Uint8Array); passes through typed arrays. */
  function toBytes(data) {
    if (typeof data === 'string') {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(data);
      var out = [];
      for (var i = 0; i < data.length; i++) {
        var cp = data.codePointAt(i);
        if (cp > 0xFFFF) i++;
        if (cp < 0x80) out.push(cp);
        else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
        else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
      return new Uint8Array(out);
    }
    if (data instanceof Uint8Array) return data;
    if (Array.isArray(data)) return new Uint8Array(data);
    throw new Error('KipadZip: unsupported data type');
  }

  function dosDateTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: (((d.getFullYear() - 1980) & 127) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function u16(v) { return [v & 255, (v >>> 8) & 255]; }
  function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }

  /**
   * zipStore([{name, data}], opts?) -> Uint8Array
   * data: string (UTF-8) | Uint8Array | Array<number>. Method 0 (store).
   */
  function zipStore(entries, opts) {
    if (!Array.isArray(entries)) throw new Error('KipadZip: entries must be an array');
    var now = dosDateTime((opts && opts.now) || new Date());
    var parts = [];
    var centralParts = [];
    var centralMeta = []; // {nameLen, size} to advance offsets while writing CD
    var offset = 0;

    function push(arr) { parts.push(arr instanceof Uint8Array ? arr : Uint8Array.from(arr)); }

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || typeof e.name !== 'string' || !e.name.length) {
        throw new Error('KipadZip: entry ' + i + ' needs a name');
      }
      var nameB = toBytes(e.name);
      var data = toBytes(e.data == null ? '' : e.data);
      var crc = crc32(data);

      var local = [].concat(
        u32(0x04034b50),            // local file header signature
        u16(20),                    // version needed (2.0)
        u16(0x0800),                // flags: UTF-8 names
        u16(0),                     // method: store
        u16(now.time), u16(now.date),
        u32(crc),
        u32(data.length),           // compressed
        u32(data.length),           // uncompressed
        u16(nameB.length),
        u16(0)                      // extra len
      );
      push(local);
      push(nameB);
      push(data);

      centralParts.push([].concat(
        u32(0x02014b50),            // central directory signature
        u16(20),                    // version made by
        u16(20),                    // version needed
        u16(0x0800),
        u16(0),
        u16(now.time), u16(now.date),
        u32(crc),
        u32(data.length), u32(data.length),
        u16(nameB.length),
        u16(0), u16(0),             // extra, comment len
        u16(0), u16(0),             // disk start, internal attrs
        u32(0),                     // external attrs
        u32(offset)
      ));
      centralMeta.push({ nameB: nameB });
      offset += local.length + nameB.length + data.length;
    }

    var cdStart = offset;
    var cdSize = 0;
    for (var j = 0; j < centralParts.length; j++) {
      var entry = centralParts[j].concat(Array.prototype.slice.call(centralMeta[j].nameB));
      centralParts[j] = entry;
      centralMeta[j].size = entry.length;
      cdSize += entry.length;
    }
    for (var j2 = 0; j2 < centralParts.length; j2++) push(centralParts[j2]);

    var eocd = [].concat(
      u32(0x06054b50),
      u16(0), u16(0),
      u16(centralParts.length), u16(centralParts.length),
      u32(cdSize), u32(cdStart),
      u16(0)
    );
    push(eocd);

    var total = 0;
    for (var k = 0; k < parts.length; k++) total += parts[k].length;
    var outBuf = new Uint8Array(total);
    var pos = 0;
    for (var k2 = 0; k2 < parts.length; k2++) { outBuf.set(parts[k2], pos); pos += parts[k2].length; }
    return outBuf;
  }

  return { crc32: crc32, zipStore: zipStore, toBytes: toBytes };
});
