'use strict';

/**
 * KipadSafeSave — safe-save validation and automatic backup ring.
 *
 * Guards the two ways Kipad "overwrites" a KiCad file:
 *  - validate(): before handing serialized text to the user, parse it back
 *    with the real parser (and optionally re-serialize) so a broken save
 *    never leaves the app. A parse failure aborts the save; an unstable
 *    round trip is reported but allowed (the text is still valid).
 *  - pushBackup(): before a new version replaces a previously opened/saved
 *    file, keep rotating timestamped snapshots of the old text in storage
 *    so an accidental overwrite can be restored from File > Restore.
 *
 * Storage is injectable ({getItem,setItem}) — tests pass a mock, the app
 * passes localStorage via defaultStore(). Every storage failure degrades to
 * "no backup", never an exception: backups must not break saving.
 *
 * UMD: browser global `KipadSafeSave` / CommonJS module.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadSafeSave = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_MAX_KEEP = 3;
  var SUFFIX = '.bak.v1';

  /** localStorage may itself throw on access (Safari private mode). */
  function defaultStore() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) {}
    return null;
  }

  /**
   * validate(text, parse[, reserialize])
   *   parse:        fn(text) -> model. Must not throw for a valid save.
   *   reserialize:  optional fn(model) -> text. When given, reports
   *                 `stable`: serialize(parse(text)) === text.
   * Returns { ok:true, stable?:bool } or { ok:false, stage, error }.
   */
  function validate(text, parse, reserialize) {
    var parsed;
    try {
      parsed = parse(text);
    } catch (e) {
      return { ok: false, stage: 'parse', error: (e && e.message) || String(e) };
    }
    if (typeof reserialize === 'function') {
      try {
        var again = reserialize(parsed);
        return { ok: true, stable: again === text };
      } catch (e) {
        return { ok: false, stage: 'reserialize', error: (e && e.message) || String(e) };
      }
    }
    return { ok: true };
  }

  function readList(store, k) {
    try {
      var v = JSON.parse(store.getItem(k));
      if (Array.isArray(v)) return v.filter(function (e) { return e && typeof e.s === 'string'; });
    } catch (e) {}
    return [];
  }

  /**
   * pushBackup(store, key, text[, opts]) -> number kept (0 = none stored).
   * Newest-first ring under key + '.bak.v1', trimmed to opts.maxKeep
   * (default 3). On quota errors the oldest entries are dropped and the
   * write retried; if nothing fits, gives up quietly.
   */
  function pushBackup(store, key, text, opts) {
    store = store || defaultStore();
    if (!store || typeof store.setItem !== 'function') return 0;
    if (typeof text !== 'string' || !text) return 0;
    var k = key + SUFFIX;
    var max = Math.max(1, (opts && opts.maxKeep) || DEFAULT_MAX_KEEP);
    var list = readList(store, k);
    list.unshift({ t: Date.now(), n: text.length, s: text });
    list = list.slice(0, max);
    while (list.length) {
      try {
        store.setItem(k, JSON.stringify(list));
        return list.length;
      } catch (e) {
        list.pop(); // quota pressure: drop oldest and retry
      }
    }
    return 0;
  }

  /** listBackups(store, key) -> newest-first [{t, n}] metadata (no payload). */
  function listBackups(store, key) {
    store = store || defaultStore();
    if (!store) return [];
    return readList(store, key + SUFFIX).map(function (e) {
      return { t: e.t, n: e.n };
    });
  }

  /** getBackup(store, key[, idx]) -> {t, n, s} | null. idx 0 = newest. */
  function getBackup(store, key, idx) {
    store = store || defaultStore();
    if (!store) return null;
    var list = readList(store, key + SUFFIX);
    var i = idx == null ? 0 : idx;
    var e = list[i];
    return e ? { t: e.t, n: e.n, s: e.s } : null;
  }

  return {
    DEFAULT_MAX_KEEP: DEFAULT_MAX_KEEP,
    defaultStore: defaultStore,
    validate: validate,
    pushBackup: pushBackup,
    listBackups: listBackups,
    getBackup: getBackup
  };
});
