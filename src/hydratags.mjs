// Optional Hydra tagger (e621-style tags). Everything here is off unless the user installed the extras (see the wiki page "Image analysis").
// A small local Python sidecar (tagger/hydra_tag_sidecar.py, 127.0.0.1 only, no outbound network) is started ONLY by the Start button and
// stopped with Stop; the server never starts it by itself. Tags are stored in data/vision-hydratags.json (vision.json is never touched).
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = 'hydra-3.5-tags@1024', MAX_ITEMS = 30000, START_S = 180, IDLE_MS = 10 * 60 * 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OOM = /paging file|out of memory|outofmemory|memoryerror|not enough memory|cannot allocate/i;

// root = repo folder, dir = data folder. Overrides: GOONPILOT_HYDRA_DIR (model folder), GOONPILOT_HYDRA_PYTHON, GOONPILOT_HYDRA_PORT.
export function createHydraTagger({ root, dir, log = () => {}, ev = () => {} }) {
  const modelDir = process.env.GOONPILOT_HYDRA_DIR || path.join(dir, 'models', 'hydra');
  const venvPy = [path.join(dir, 'models', 'hydra-venv', 'Scripts', 'python.exe'), path.join(dir, 'models', 'hydra-venv', 'bin', 'python')].find(existsSync);
  const py = process.env.GOONPILOT_HYDRA_PYTHON || venvPy || (process.platform === 'win32' ? 'python' : 'python3');
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tagger', 'hydra_tag_sidecar.py');
  const port = Number(process.env.GOONPILOT_HYDRA_PORT) || 8793, base = `http://127.0.0.1:${port}`;
  const present = () => existsSync(script) && existsSync(path.join(modelDir, 'models', 'hydra-3.5.safetensors'));
  let proc = null, adopted = false, caps = null, starting = null, gen = 0, err = '', errTail = '', pinned = false, idleT = null, startedAt = 0, stoppedAt = 0, stopWhy = '', chain = Promise.resolve();

  // ---- stored tags: md5 -> [[tag, confidence %], ...] ----
  const file = path.join(dir, 'vision-hydratags.json'); let data = null, dirty = null, readOnly = false;
  const get = () => {
    if (data) return data; let d = null;
    if (existsSync(file)) {
      try { d = JSON.parse(readFileSync(file, 'utf8')); } catch { d = null; }
      if (!d || d.model !== MODEL || !d.items) { d = null; readOnly = true; log('err', 'vision-hydratags.json is unreadable or for another model; left untouched, new tags are kept in memory only'); }
    }
    return data = d || { v: 1, model: MODEL, items: {} };
  };
  const flush = () => { dirty = null; if (readOnly || !data) return; try { mkdirSync(dir, { recursive: true }); const t = file + '.tmp'; writeFileSync(t, JSON.stringify(data)); renameSync(t, file); } catch (e) { log('err', 'hydra tags save failed ' + e.message); } };

  // ---- sidecar process ----
  const health = async (ms = 3000) => { try { const r = await fetch(base + '/health', { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; } };
  const running = () => !!caps && ((!!proc && proc.exitCode == null) || adopted);
  const arm = () => { clearTimeout(idleT); if (pinned) return; idleT = setTimeout(() => stop('idle timeout'), IDLE_MS); idleT.unref?.(); };
  function stop(why = 'stopped') {
    gen++; clearTimeout(idleT); pinned = false; const p = proc, was = adopted; proc = null; adopted = false; caps = null;
    if (p?.pid) { try { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); else p.kill(); } catch {} }
    else if (was) fetch(base + '/quit', { method: 'POST', headers: { 'x-goonpilot': '1' }, signal: AbortSignal.timeout(3000) }).catch(() => {});
    if (p || was) { stoppedAt = Date.now(); stopWhy = why; ev('hydra', 'tagger stopped (' + why + ')'); }
  }
  const why = (code) => OOM.test(errTail) ? 'out of memory while loading the model (close other RAM/GPU-heavy programs)' : 'tagger exited ' + code + (errTail.trim() ? ': ' + errTail.trim().split(/\r?\n/).pop().slice(0, 200) : '');
  async function start() {
    err = '';
    if (!present()) { err = 'model files missing (see the wiki page "Image analysis")'; return false; }
    if (running()) { pinned = true; clearTimeout(idleT); return true; }
    if (starting) return starting;
    const g = ++gen;
    return starting = (async () => {
      try {
        const h0 = await health();
        if (h0?.model === MODEL) { adopted = true; caps = h0; pinned = true; return true; }
        if (h0) throw new Error(`port ${port} is answered by another program`);
        errTail = '';
        const p = spawn(py, ['-I', script, String(port), modelDir], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], cwd: root, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
        proc = p; p.stderr.setEncoding('utf8'); p.stderr.on('data', (s) => { errTail = (errTail + s).slice(-4000); });
        p.on('error', (e) => { errTail += '\n' + e.message; });
        p.on('exit', (code) => { if (proc !== p) return; proc = null; caps = null; if (!starting) { err = why(code); ev('hydra', err, '', true); } });
        for (let i = 0; i < START_S; i++) {
          await sleep(1000);
          if (gen !== g) return false;
          if (p.exitCode != null) throw new Error(why(p.exitCode));
          const h = await health(); if (h?.model === MODEL) { caps = h; pinned = true; startedAt = Date.now(); ev('hydra', `tagger ready (${h.device || '?'})`); return true; }
        }
        throw new Error('tagger start timed out');
      } catch (e) { if (gen === g) { err = e.message; ev('hydra', 'start failed: ' + e.message, '', true); stop('start failed'); } return false; }
      finally { starting = null; }
    })();
  }
  const run = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
  // jpg buffer -> [[tag, confidence 0..1], ...] or null (needs a tagger that is already running; never starts one)
  const tagOne = (jpg) => run(async () => {
    if (!running()) return null;
    try {
      const r = await fetch(base + '/tags', { method: 'POST', body: jpg, headers: { 'content-type': 'application/octet-stream', 'x-goonpilot': '1' }, signal: AbortSignal.timeout(120000) });
      if (r.status === 500 || r.status === 413) return null;
      if (!r.ok) throw new Error('tags ' + r.status);
      const t = (await r.json()).t; arm();
      return Array.isArray(t) ? t.filter(x => Array.isArray(x) && typeof x[0] === 'string' && x[0].length < 80 && Number.isFinite(x[1])).slice(0, 100).map(x => [x[0], Math.min(1, Math.max(0, x[1]))]) : null;
    } catch (e) { err = e.message; stop('error: ' + e.message.slice(0, 80)); return null; }
  });

  return {
    running, present, error: () => err,
    start, stop,
    has: (md5) => !!get().items[md5],
    tags: (md5) => get().items[md5] || null,
    count: () => Object.keys(get().items).length,
    // Tag one image (jpg buffer) and store the result. -> true when stored.
    async tag(md5, jpg) {
      const d = get(); if (d.items[md5]) return true; if (!running() || Object.keys(d.items).length >= MAX_ITEMS) return false;
      const t0 = Date.now(), r = await tagOne(jpg);
      if (!r) { ev('hydra', 'no tags returned (image could not be read, or the tagger went away)', md5, true); return false; }
      d.items[md5] = r.map(x => [x[0], Math.round(x[1] * 100)]); if (!dirty) dirty = setTimeout(flush, 5000);
      ev('hydra', `${r.length} tags ${Date.now() - t0}ms`, md5); return true;
    },
    info: () => ({ running: running(), starting: !!starting, present: present(), error: err, device: caps?.device || '', startedAt, stoppedAt, stopWhy }),
    close() { if (dirty) { clearTimeout(dirty); flush(); } stop('server shutdown'); }
  };
}
