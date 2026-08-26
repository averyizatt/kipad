'use strict';

/*
 * Real-browser smoke test for Kipad's application shell.
 *
 * This intentionally uses Chrome's DevTools Protocol directly so the suite
 * adds no npm dependency. Set KIPAD_CHROMIUM when Chrome/Chromium is not on
 * PATH (Playwright's downloaded Chromium is discovered automatically).
 */
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.css': 'text/css', '.gz': 'application/gzip', '.html': 'text/html',
  '.ico': 'image/x-icon', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json'
};

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function chromiumExecutable() {
  if (process.env.KIPAD_CHROMIUM) return process.env.KIPAD_CHROMIUM;
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const found = childProcess.spawnSync('sh', ['-c', 'command -v "$1"', 'sh', name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(cache)) {
    const versions = fs.readdirSync(cache).sort().reverse();
    for (const version of versions) {
      const candidates = [
        path.join(cache, version, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
        path.join(cache, version, 'chrome-linux64', 'chrome')
      ];
      for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('Chrome/Chromium not found; install it or set KIPAD_CHROMIUM=/path/to/chrome');
}

function staticServer() {
  return http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    // PWA install/update/offline behavior has its own roadmap sub-item. An
    // inert worker keeps this shell test deterministic (the production worker
    // calls clients.claim(), which deliberately reloads a newly-controlled tab).
    if (relative === 'sw.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      res.end('// service-worker lifecycle excluded from browser shell smoke\n');
      return;
    }
    const file = path.resolve(ROOT, relative);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end('forbidden'); return;
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(err.code === 'ENOENT' ? 404 : 500).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
}

class Cdp {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const fn of this.listeners.get(message.method) || []) fn(message.params || {});
    });
  }
  async send(method, params) {
    await this.ready;
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return result;
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  close() { this.ws.close(); }
}

async function waitFor(fn, description, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 10000);
  let last;
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last; } catch (err) { last = err.message; }
    await sleep(50);
  }
  throw new Error('Timed out waiting for ' + description + (last ? ' (last: ' + last + ')' : ''));
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kipad-browser-smoke-'));
  const downloads = path.join(temp, 'downloads');
  const profile = path.join(temp, 'profile');
  fs.mkdirSync(downloads);
  fs.mkdirSync(profile);
  const fixture = path.join(temp, 'smoke.kicad_sch');
  fs.writeFileSync(fixture, '(kicad_sch\n  (version 20231120)\n  (generator "kipad-smoke")\n  (paper "A3")\n)\n');

  const server = staticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const browser = childProcess.spawn(chromiumExecutable(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    'http://127.0.0.1:' + port + '/'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserStderr = '';
  browser.stderr.on('data', chunk => { browserStderr += chunk; });

  let cdp;
  const failures = [];
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    await waitFor(() => fs.existsSync(portFile), 'Chromium DevTools endpoint', 10000);
    const debugPort = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
    const targets = await waitFor(async () => {
      const response = await fetch('http://127.0.0.1:' + debugPort + '/json/list');
      const list = await response.json();
      return list.find(target => target.type === 'page' && target.url.startsWith('http://127.0.0.1:'));
    }, 'application page target', 10000);
    cdp = new Cdp(targets.webSocketDebuggerUrl);
    await cdp.ready;
    cdp.on('Runtime.exceptionThrown', event => failures.push(
      (event.exceptionDetails.exception && event.exceptionDetails.exception.description) ||
      event.exceptionDetails.text || 'uncaught browser exception'));
    cdp.on('Log.entryAdded', event => {
      if (event.entry.level === 'error' && !/favicon/.test(event.entry.text)) failures.push(event.entry.text);
    });
    await Promise.all([cdp.send('Runtime.enable'), cdp.send('Page.enable'), cdp.send('DOM.enable'), cdp.send('Log.enable')]);
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    // Page.setDownloadBehavior is deprecated but still required by some
    // Chrome headless-shell builds; full Chrome honours the Browser command.
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

    const evaluate = async expression => {
      const out = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (out.exceptionDetails) throw new Error(out.exceptionDetails.text + ': ' + (out.exceptionDetails.exception && out.exceptionDetails.exception.description || ''));
      return out.result.value;
    };
    const waitExpr = (expression, label) => waitFor(() => evaluate(expression), label, 15000);
    const click = selector => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing ${selector}'); el.click(); return true; })()`);
    const menuItem = async label => {
      await click('#menubar .menu[data-menu="file"]');
      await evaluate(`(() => { const el = [...document.querySelectorAll('#menu-popup .mi')].find(x => x.textContent.includes(${JSON.stringify(label)})); if (!el) throw new Error('missing menu item: ${label}'); el.click(); return true; })()`);
    };

    await waitExpr("document.readyState === 'complete' && !document.querySelector('#launcher').classList.contains('hidden')", 'launcher shell');
    console.log('  ✓ launcher rendered');

    await click('.pm-app[data-open="schematic"]');
    await waitExpr("typeof mode !== 'undefined' && mode === 'schematic' && !document.querySelector('#canvas').classList.contains('hidden')", 'schematic editor');
    console.log('  ✓ launcher → schematic');

    const documentNode = await cdp.send('DOM.getDocument');
    const inputNode = await cdp.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#file-open' });
    await cdp.send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: [fixture] });
    await waitExpr("document.querySelector('#st-msg').textContent === 'Opened smoke.kicad_sch' && sch.paper === 'A3'", 'schematic open');
    console.log('  ✓ schematic open through file input');

    assert.strictEqual(await evaluate('sch.junctions.length'), 0);
    await click('#sch-junction');
    const rect = await evaluate("(() => { const r = document.querySelector('#canvas').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()");
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 });
    await waitExpr('sch.junctions.length === 1', 'schematic edit');
    await click('#btn-undo');
    await waitExpr('sch.junctions.length === 0', 'schematic undo');
    await click('#btn-redo');
    await waitExpr('sch.junctions.length === 1', 'schematic redo');
    console.log('  ✓ basic edit + undo/redo');

    await click('#btn-save');
    await waitExpr("document.querySelector('#st-msg').textContent.startsWith('Saved .kicad_sch')", 'schematic save validation');
    const savedSch = path.join(downloads, 'kipad.kicad_sch');
    await waitFor(() => fs.existsSync(savedSch) && fs.statSync(savedSch).size > 20, 'schematic download');
    assert.match(fs.readFileSync(savedSch, 'utf8'), /\(junction \(at /);
    console.log('  ✓ validated schematic save/download');

    await menuItem('Switch to PCB Editor');
    await waitExpr("mode === 'pcb' && !document.querySelector('#tool-track').classList.contains('hidden')", 'PCB editor');
    assert(await evaluate('board.footprints.length > 0'), 'demo board should provide fabrication content');
    console.log('  ✓ schematic → PCB');

    await menuItem('Export fabrication package');
    const fabZip = path.join(downloads, 'kipad-fab.zip');
    await waitFor(() => fs.existsSync(fabZip) && fs.statSync(fabZip).size > 100, 'fabrication ZIP download');
    const zip = fs.readFileSync(fabZip);
    assert.strictEqual(zip.readUInt32LE(0), 0x04034b50, 'fabrication output is a ZIP');
    assert(zip.includes(Buffer.from('gerbers/kipad-FCu.gbr')), 'fabrication ZIP contains front copper Gerber');
    console.log('  ✓ fabrication ZIP export/download');

    assert.deepStrictEqual(failures, [], 'browser console/runtime errors');
    console.log('Browser shell smoke: 7 workflow checks passed');
  } finally {
    if (cdp) cdp.close();
    browser.kill('SIGTERM');
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('Browser shell smoke FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
