'use strict';

/*
 * Browser-level service-worker lifecycle smoke for Kipad.
 *
 * Uses Chrome DevTools Protocol directly, like browser_shell_smoke.js, and
 * therefore adds no package dependency. The server can be taken genuinely
 * offline and can publish a second worker generation during the test.
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
    for (const version of fs.readdirSync(cache).sort().reverse()) {
      for (const candidate of [
        path.join(cache, version, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
        path.join(cache, version, 'chrome-linux64', 'chrome')
      ]) if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('Chrome/Chromium not found; install it or set KIPAD_CHROMIUM=/path/to/chrome');
}

function lifecycleServer(state) {
  const sourceWorker = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  return http.createServer((req, res) => {
    if (!state.online) {
      state.offlineRequests++;
      req.socket.destroy();
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (relative === 'sw.js') {
      const worker = sourceWorker.replace(
        /const CACHE = '[^']+';/,
        `const CACHE = 'kipad-pwa-smoke-v${state.generation}';`
      ) + `\n// test generation ${state.generation}\n`;
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      res.end(worker);
      return;
    }
    const file = path.resolve(ROOT, relative);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end('forbidden'); return;
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(err.code === 'ENOENT' ? 404 : 500).end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
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
  const deadline = Date.now() + (timeoutMs || 15000);
  let last;
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last; } catch (err) { last = err.message; }
    await sleep(50);
  }
  throw new Error('Timed out waiting for ' + description + (last ? ' (last: ' + last + ')' : ''));
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kipad-pwa-smoke-'));
  const profile = path.join(temp, 'profile');
  fs.mkdirSync(profile);
  const state = { online: true, generation: 1, offlineRequests: 0 };
  const server = lifecycleServer(state);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = childProcess.spawn(chromiumExecutable(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    origin + '/'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserStderr = '';
  browser.stderr.on('data', chunk => { browserStderr += chunk; });

  let cdp;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    await waitFor(() => fs.existsSync(portFile), 'Chromium DevTools endpoint', 10000);
    const debugPort = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
    const target = await waitFor(async () => {
      const list = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
      return list.find(item => item.type === 'page' && item.url.startsWith(origin));
    }, 'application page target', 10000);
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.ready;
    await Promise.all([cdp.send('Runtime.enable'), cdp.send('Page.enable')]);
    let mainFrameNavigations = 0;
    cdp.on('Page.frameNavigated', event => {
      if (!event.frame.parentId) mainFrameNavigations++;
    });
    const evaluate = async expression => {
      const out = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (out.exceptionDetails) throw new Error(out.exceptionDetails.text + ': ' +
        (out.exceptionDetails.exception && out.exceptionDetails.exception.description || ''));
      return out.result.value;
    };
    const waitExpr = (expression, label) => waitFor(() => evaluate(expression), label, 20000);

    await waitExpr(`(async () => {
      if (!navigator.serviceWorker.controller) return false;
      const reg = await navigator.serviceWorker.ready;
      const keys = await caches.keys();
      return reg.active && keys.includes('kipad-pwa-smoke-v1');
    })()`, 'service-worker installation and cache population');
    assert(await evaluate(`(async () => (await caches.open('kipad-pwa-smoke-v1')).keys().then(x => x.length > 50))()`),
      'app-shell cache should contain the production asset set');
    console.log('  ✓ production worker installed, activated, and populated the app-shell cache');

    state.online = false;
    await cdp.send('Page.navigate', { url: origin + '/offline-startup-probe' });
    await waitExpr(`document.readyState === 'complete' &&
      !document.querySelector('#launcher').classList.contains('hidden') &&
      navigator.serviceWorker.controller !== null`, 'offline app-shell startup');
    assert(state.offlineRequests > 0, 'uncached navigation should reach the unavailable origin before fallback');
    assert.strictEqual(await evaluate(`document.querySelectorAll('script[src]').length > 20`), true,
      'cache-busted application scripts loaded from the canonical precache entries');
    console.log('  ✓ uncached navigation started the full app shell while the origin was offline');

    state.online = true;
    await cdp.send('Page.navigate', { url: origin + '/' });
    await waitExpr(`document.readyState === 'complete' && navigator.serviceWorker.controller !== null`, 'online return');
    await evaluate(`sessionStorage.removeItem('kipad-sw-reload')`);
    const beforeUpdateNavigations = mainFrameNavigations;
    state.generation = 2;
    await evaluate(`navigator.serviceWorker.getRegistration().then(reg => reg.update())`);
    await waitExpr(`(async () => {
      const keys = await caches.keys();
      return keys.includes('kipad-pwa-smoke-v2') &&
        !keys.includes('kipad-pwa-smoke-v1') &&
        sessionStorage.getItem('kipad-sw-reload') === '1';
    })()`, 'updated worker activation, cache cleanup, and controlled reload');
    await waitExpr(`document.readyState === 'complete' &&
      !document.querySelector('#launcher').classList.contains('hidden')`, 'shell after update reload');
    assert(mainFrameNavigations > beforeUpdateNavigations, 'controllerchange should reload the controlled page');
    console.log('  ✓ worker update replaced the cache, removed v1, and reloaded into the new controller');
    console.log('Browser PWA smoke: 3 lifecycle checks passed');
  } catch (err) {
    if (/DevTools endpoint/.test(err.message) && browserStderr.trim()) {
      err.message += '\nChromium stderr:\n' + browserStderr.trim();
    }
    throw err;
  } finally {
    if (cdp) cdp.close();
    browser.kill('SIGTERM');
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('Browser PWA smoke FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
