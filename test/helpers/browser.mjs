// Minimal Chrome DevTools adapter for the project's browser checks.
// Uses an isolated temporary profile and Node's built-in WebSocket (Node 22+).
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const candidates = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);

export class Browser {
  static async launch() {
    let executable;
    for (const path of candidates) {
      try { await access(path); executable = path; break; } catch { /* try next */ }
    }
    if (!executable) throw new Error('Chrome or Chromium not found. Set CHROME_PATH to its executable.');
    if (typeof WebSocket === 'undefined') throw new Error('Browser checks require Node.js 22 or later.');
    const profile = await mkdtemp(join(tmpdir(), 'lingtype-chrome-'));
    const child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio:'ignore' });
    const browser = new Browser(child, profile);
    try {
      let port;
      for (let i = 0; i < 300; i++) {
        if (child.exitCode !== null) throw new Error(`Chrome exited with code ${child.exitCode}`);
        try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await sleep(100); }
      }
      if (!port) throw new Error('Chrome did not start within 30 seconds');
      browser.base = `http://127.0.0.1:${port}`;
      return browser;
    } catch (error) { await browser.close(); throw error; }
  }
  constructor(child, profile) { this.child = child; this.profile = profile; this.pages = new Set(); }
  async newPage() {
    const response = await fetch(`${this.base}/json/new?about:blank`, { method:'PUT' });
    if (!response.ok) throw new Error(`Could not create Chrome tab: ${response.status}`);
    const target = await response.json();
    const page = await Page.connect(target.webSocketDebuggerUrl);
    page.onClose = () => this.pages.delete(page);
    this.pages.add(page);
    return page;
  }
  async close() {
    for (const page of [...this.pages]) await page.close();
    if (this.child.exitCode === null) {
      this.child.kill();
      await Promise.race([new Promise(resolve => this.child.once('exit', resolve)), sleep(2000)]);
    }
    await rm(this.profile, { recursive:true, force:true, maxRetries:3 });
  }
}

class Page {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once:true }); socket.addEventListener('error', reject, { once:true }); });
    const page = new Page(socket);
    await Promise.all([page.send('Page.enable'), page.send('Runtime.enable')]);
    await page.send('Page.setLifecycleEventsEnabled', { enabled:true });
    return page;
  }
  constructor(socket) {
    this.socket = socket; this.nextId = 0; this.pending = new Map(); this.consoleErrors = []; this.loaded = new Set(); this.loadCount = 0;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      } else if (message.method === 'Page.lifecycleEvent' && message.params.name === 'load') {
        this.loaded.add(`${message.params.frameId}:${message.params.loaderId}`); this.loadCount++;
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
      }
    });
    socket.addEventListener('close', () => { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Chrome connection closed')); } this.pending.clear(); });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Chrome command timed out: ${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, ...args) {
    const source = typeof expression === 'function' ? `(${expression})(...${JSON.stringify(args)})` : expression;
    const result = await this.send('Runtime.evaluate', { expression:source, returnByValue:true, awaitPromise:true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async goto(url, { settleMs = 0 } = {}) {
    const loads = this.loadCount;
    const result = await this.send('Page.navigate', { url });
    if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`);
    // Opening the current address with a fragment (such as #practice) only
    // scrolls the page. Reload it so every goto starts a fresh page.
    // The fragment change completes after Page.navigate returns; reloading
    // before it would reload the previous address.
    if (!result.loaderId) {
      for (let i = 0; i < 40; i++) {
        try { if (await this.eval(expected => location.href === expected, url)) break; } catch { /* page busy */ }
        await sleep(50);
      }
      await this.send('Page.reload');
    }
    for (let i = 0; i < 200; i++) {
      // A readyState check alone can observe the previous document, especially
      // when reloading the same URL. Wait for this navigation's loader instead.
      if (result.loaderId && this.loaded.has(`${result.frameId}:${result.loaderId}`)) break;
      if (!result.loaderId && this.loadCount > loads) {
        try { if (await this.eval(expected => location.href === expected && document.readyState === 'complete', url)) break; } catch { /* navigation in progress */ }
      }
      if (i === 199) throw new Error(`Timed out loading ${url}`);
      await sleep(50);
    }
    if (result.loaderId) this.loaded.delete(`${result.frameId}:${result.loaderId}`);
    if (settleMs) await sleep(settleMs);
  }
  async setViewport({ width, height, mobile = false, dsf = 1 }) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, mobile, deviceScaleFactor:dsf });
  }
  async screenshot({ path, fullPage = false }) {
    const params = { format:path.endsWith('.png') ? 'png' : 'jpeg', captureBeyondViewport:fullPage };
    if (fullPage) {
      const { cssContentSize } = await this.send('Page.getLayoutMetrics');
      params.clip = { x:0, y:0, width:Math.ceil(cssContentSize.width), height:Math.ceil(cssContentSize.height), scale:1 };
    }
    const { data } = await this.send('Page.captureScreenshot', params);
    await mkdir(dirname(path), { recursive:true });
    await writeFile(path, Buffer.from(data, 'base64'));
  }
  async close() { this.socket.close(); this.onClose?.(); }
}
