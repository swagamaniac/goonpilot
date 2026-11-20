import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, createWriteStream, statSync, unlinkSync, appendFileSync } from 'node:fs';
import { createHydraTagger } from './hydratags.mjs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const REV = '627aef95638667ddcaa3ac8ae625e88ea5b02f51';
export const MODEL = {
  base: `https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3/resolve/${REV}/`,
  files: { 'model.onnx': { bytes: 467460978, sha256: 'e6774bff34d43bd49f75a47db4ef217dce701c9847b546523eb85ff6dbba1db1' }, 'selected_tags.csv': { bytes: 308468 } }
};
const MAX_ITEMS = 60000, MAX_IMG = 15e6, MAX_QUEUE = 60, GEN_T = 0.35, CHAR_T = 0.85, MAX_TAGS = 80;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const LOOK_DIM = 32;
export function lookFeatures(rgb, w = 32, h = 32) {
  const n = w * h, lum = new Float32Array(n), f = new Array(LOOK_DIM).fill(0), hue = new Array(6).fill(0);
  let sL = 0, sL2 = 0, sR = 0, sG = 0, sB = 0, sS = 0, dark = 0, bright = 0, ex = 0, ey = 0, hueMass = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, r = rgb[i * 3] / 255, g = rgb[i * 3 + 1] / 255, b = rgb[i * 3 + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; lum[i] = l;
    sL += l; sL2 += l * l; sR += r; sG += g; sB += b;
    f[Math.min(3, (y * 4 / h) | 0) * 4 + Math.min(3, (x * 4 / w) | 0)] += l / (n / 16);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, s = mx ? d / mx : 0; sS += s;
    if (l < 0.2) dark++; else if (l > 0.8) bright++;
    if (d > 0.08) {
      let hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hue[Math.min(5, hh | 0)] += s; hueMass += s;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (x + 1 < w) ex += Math.abs(lum[i + 1] - lum[i]); if (y + 1 < h) ey += Math.abs(lum[i + w] - lum[i]);
  }
  const m = sL / n;
  f[16] = m; f[17] = Math.sqrt(Math.max(0, sL2 / n - m * m)); f[18] = sR / n; f[19] = sG / n; f[20] = sB / n; f[21] = sS / n;
  f[22] = dark / n; f[23] = bright / n; f[24] = ex / n; f[25] = ey / n;
  for (let k = 0; k < 6; k++) f[26 + k] = hueMass ? hue[k] / hueMass : 0;
  return f.map(v => Math.round(v * 1000) / 1000);
}
export function dHash(gray) {
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray[y * 9 + x] > gray[y * 9 + x + 1] ? '1' : '0';
  let hex = ''; for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function createVision({ dir, fetchImpl = fetch, log = () => {} }) {
  const file = path.join(dir, 'vision.json'), modelDir = path.join(dir, 'models');
  let data = null, dirty = null, libs = null, libErr = '', libTried = false, session = null, labels = null, sessErr = '';
  const wanted = new Set(), recent = new Map(); let recentBytes = 0;
  const keepRecent = (md5, buf) => { recent.set(md5, buf); recentBytes += buf.length; while (recent.size > 10 || recentBytes > 80e6) { const [k, b] = recent.entries().next().value; recent.delete(k); recentBytes -= b.length; } };
  const queue = [], queued = new Set(); let busy = false, done = 0, failed = 0, last = '';
  let setup = { state: 'idle', pct: 0, error: '' };
  let statsMemo = null, inForYou = null, worker = null, device = '';
  // Optional local override (data/vision-local.json, never in the repo): { "allViews": true } also analyses full images opened outside For you.
  const localFile = path.join(dir, 'vision-local.json');
  let allViews = (() => { try { return JSON.parse(readFileSync(localFile, 'utf8')).allViews === true; } catch { return false; } })();

  const get = () => {
    if (data) return data;
    try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { data = null; }
    if (!data || typeof data.items !== 'object') data = { v: 1, enabled: true, items: {} };
    return data;
  };
  const flush = () => { dirty = null; try { mkdirSync(dir, { recursive: true }); const t = file + '.tmp'; writeFileSync(t, JSON.stringify(get())); renameSync(t, file); } catch (e) { log('err', 'vision save failed ' + e.message); } };
  const touch = () => { statsMemo = null; if (!dirty) dirty = setTimeout(flush, 5000); };
  const have = (n) => existsSync(path.join(modelDir, n)) && statSync(path.join(modelDir, n)).size === MODEL.files[n].bytes;
  const modelOk = () => Object.keys(MODEL.files).every(have);

  async function loadLibs() {
    if (libs) return libs;
    try { const ort = await import('onnxruntime-node'); const sharp = (await import('sharp')).default; sharp.concurrency(1); libs = { ort, sharp }; }
    catch (e) { libErr = 'packages not installed (run: npm install)'; }
    return libs;
  }
  async function ensureSession() {
    if (session) return session;
    if (!(await loadLibs()) || !modelOk()) return null;
    try {
      const w = new Worker(new URL('./vision-worker.mjs', import.meta.url), { workerData: { model: path.join(modelDir, 'model.onnx'), device: process.env.GOONPILOT_VISION_CPU === '1' ? 'cpu' : (get().device || 'auto') } });
      const hello = await new Promise((ok, bad) => { w.once('message', ok); w.once('error', bad); });
      device = (hello?.ep || 'cpu') + (hello?.note ? ` (${hello.note})` : ''); log('vision', 'running on ' + device);
      const waits = new Map(); let seq = 0;
      w.on('message', (m) => { const r = waits.get(m.id); if (!r) return; waits.delete(m.id); if (m.error) r.bad(new Error(m.error)); else r.ok(m); });
      w.on('error', (e) => { for (const r of waits.values()) r.bad(e); waits.clear(); session = null; sessErr = e.message; });
      w.unref(); worker = w;
      session = { run: (input) => new Promise((ok, bad) => { const id = ++seq; waits.set(id, { ok, bad }); w.postMessage({ id, input }, [input.buffer]); }) };
      const rows = readFileSync(path.join(modelDir, 'selected_tags.csv'), 'utf8').trim().split('\n').slice(1);
      labels = rows.map(l => { const m = /^(\d+),("(?:[^"]|"")*"|[^,]*),(\d+),/.exec(l); return m ? { name: m[2].replace(/^"|"$/g, '').replace(/""/g, '"').replace(/ /g, '_'), cat: Number(m[3]) } : { name: '', cat: -1 }; });
    } catch (e) { sessErr = e.message; session = null; }
    return session;
  }

  async function analyse(buf) {
    const { sharp } = libs;
    const base = () => sharp(buf, { failOn: 'none', limitInputPixels: 1e8 }).flatten({ background: '#ffffff' }).removeAlpha();
    const [big, small, gray] = await Promise.all([
      base().resize(448, 448, { fit: 'contain', background: '#ffffff' }).raw().toBuffer(),
      base().resize(32, 32, { fit: 'fill' }).raw().toBuffer(),
      base().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
    ]);
    const input = new Float32Array(448 * 448 * 3);
    for (let i = 0; i < 448 * 448; i++) { input[i * 3] = big[i * 3 + 2]; input[i * 3 + 1] = big[i * 3 + 1]; input[i * 3 + 2] = big[i * 3]; }
    const out = await session.run(input), p = out.p, hits = [];
    labels.forEach((l, i) => { if ((l.cat === 0 && p[i] > GEN_T) || (l.cat === 4 && p[i] > CHAR_T)) hits.push([l.name, p[i], l.cat === 4 ? CHAR_T : GEN_T]); });
    hits.sort((a, b) => b[1] - a[1]);
    // tm = confidence % per tag: how far above that tag's own threshold (comparable with the Hydra tagger's numbers).
    const top = hits.slice(0, MAX_TAGS);
    return { t: top.map(h => h[0]), tm: top.map(h => Math.round(100 * Math.min(1, Math.max(0, (h[1] - h[2]) / (1 - h[2]))))), look: lookFeatures(small), h: dHash(gray), at: Date.now() };
  }

  // Tagger log: in-memory ring (last 300) + data/vision-log.txt (rotated at 1 MB). Shown in Settings > Image analysis.
  const evRing = [], logFile = path.join(dir, 'vision-log.txt'); let logN = 0;
  const logEv = (kind, msg, md5 = '', err = false) => {
    const e = { t: Date.now(), k: kind, m: String(msg).slice(0, 300), md5: md5 ? md5.slice(0, 8) : '', err }; evRing.push(e); if (evRing.length > 300) evRing.shift();
    try { if (++logN % 200 === 1 && existsSync(logFile) && statSync(logFile).size > 1e6) renameSync(logFile, logFile + '.old'); appendFileSync(logFile, `${new Date(e.t).toISOString()} ${kind.padEnd(7)} ${e.md5 ? e.md5 + ' ' : ''}${e.m}${err ? ' [ERROR]' : ''}\n`); } catch {}
  };
  // Optional Hydra tagger (needs its own extras; never started by the server itself, only by the Start button).
  const hydra = createHydraTagger({ root: path.dirname(dir), dir, log, ev: logEv });
  const TAGGERS = ['wd', 'hydra', 'both'];
  const taggerMode = () => TAGGERS.includes(get().tagger) ? get().tagger : 'wd'; // Hydra is opt-in
  const tagMax = () => Math.min(200, Math.max(5, Number(get().tagMax) || 60));
  // Hydra only: the WD tagger is not used at all (and may not be installed); WD needs a model session, Hydra needs a running tagger.
  const live = () => taggerMode() === 'hydra' ? hydra.running() : !!session;
  async function hydraTag(md5, buf) {
    if (taggerMode() === 'wd' || !hydra.running() || hydra.has(md5)) return;
    try { await hydra.tag(md5, !libs ? buf : await libs.sharp(buf, { failOn: 'none', limitInputPixels: 1e8 }).flatten({ background: '#ffffff' }).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer()); }
    catch (e) { logEv('hydra', 'failed: ' + e.message, md5, true); }
  }
  // -> [{ n: tag, p: combined confidence %, wd: WD %, hy: Hydra % }] or null. A tag both models give gets 1-(1-a)(1-b); the best tagMax() win.
  function tagInfo(md5) {
    const it = get().items[md5], mode = taggerMode(), h = mode === 'wd' ? null : hydra.tags(md5);
    const nw = it?.t?.length || 0, wdOf = (i) => it.tm?.length === nw ? it.tm[i] : Math.round(100 * Math.max(0.05, 1 - i / nw)); // older analyses have no stored %: rank estimate
    if (!h?.length) return it?.t ? it.t.map((t, i) => ({ n: t, p: wdOf(i), wd: wdOf(i), hy: null })) : null;
    const sc = new Map();
    if (mode === 'both' && it?.t) it.t.forEach((t, i) => sc.set(t, { n: t, wd: wdOf(i), hy: null }));
    for (const [t, m] of h) { const e = sc.get(t); if (e) e.hy = m; else sc.set(t, { n: t, wd: null, hy: m }); }
    for (const e of sc.values()) { const a = (e.wd ?? 0) / 100, b = (e.hy ?? 0) / 100; e.p = Math.round((1 - (1 - a) * (1 - b)) * 100); }
    return [...sc.values()].sort((x, y) => y.p - x.p).slice(0, tagMax());
  }

  // Thumbnails the server already proxied are analysed at low priority (opt 'thumbs'), full images first.
  const thumbQ = [];
  // A full image always wins: drop a waiting thumbnail job for the same post so it can't block the full analysis.
  const dropThumb = (md5) => { const i = thumbQ.findIndex(j => j.md5 === md5); if (i >= 0) { thumbQ.splice(i, 1); queued.delete(md5); } };
  const full = (md5) => { if (taggerMode() === 'hydra') return hydra.has(md5); const it = get().items[md5]; return !!it && !it.th; };
  function tapThumb(res, u) {
    const m = /([0-9a-f]{32})\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.exec(u) || /^sankaku:([0-9a-f]{32}):preview$/.exec(u); if (!m || !libs || !api.opt('thumbs')) return res;
    const md5 = m[1].toLowerCase(); if (full(md5)) return res;
    const reader = res.body.getReader(); let chunks = [], total = 0;
    const stream = new ReadableStream({
      async pull(c) {
        const { done: d, value } = await reader.read();
        if (d) {
          c.close();
          if (chunks?.length) {
            const buf = Buffer.concat(chunks);
            if (session && api.opt('thumbs') && !get().items[md5] && !queued.has(md5)) { queued.add(md5); thumbQ.push({ md5, buf, th: true }); if (thumbQ.length > 200) queued.delete(thumbQ.shift().md5); pump(); }
          }
          chunks = []; return;
        }
        if (chunks) { total += value.length; if (total > 2e6) chunks = null; else chunks.push(value); }
        c.enqueue(value);
      },
      cancel(reason) { chunks = null; return reader.cancel(reason); }
    }, { highWaterMark: 16 });
    return new Response(stream, { status: res.status, headers: res.headers });
  }

  async function pump() {
    if (busy) return; busy = true;
    try {
      while (queue.length || thumbQ.length) {
        const job = queue.length ? queue.shift() : thumbQ.shift(); queued.delete(job.md5);
        if (job.th && get().items[job.md5]) continue;
        try {
          if (taggerMode() === 'hydra') { if (!job.th) await hydraTag(job.md5, job.buf || readFileSync(job.file)); await sleep(300); continue; }
          if (!(await ensureSession())) { queue.length = 0; queued.clear(); break; }
          const t0 = Date.now(), src = job.buf || readFileSync(job.file), r = await analyse(src); if (!job.th) hydraTag(job.md5, src);
          const items = get().items, old = items[job.md5];
          if (job.th && old && !old.th) { /* full analysis already stored */ }
          else { if (job.th) r.th = 1; if (old || Object.keys(items).length < MAX_ITEMS) { items[job.md5] = r; touch(); } }
          done++; last = `${job.md5.slice(0, 8)} ${job.th ? 'thumb ' : ''}${r.t.length} tags ${Date.now() - t0}ms`;
          log('vision', last); logEv('wd', `${job.th ? 'thumbnail ' : 'full image '}${r.t.length} tags, ${Date.now() - t0}ms`, job.md5);
        } catch (e) { failed++; logEv('wd', 'failed: ' + e.message, job.md5, true); log('err', 'vision failed ' + job.md5.slice(0, 8) + ' ' + e.message); }
        await sleep(job.th ? 60 : 300);
      }
    } finally { busy = false; }
  }

  const api = {
    setMode(fy) { inForYou = !!fy; },
    want(md5) {
      md5 = String(md5 || '').toLowerCase(); if (/^[0-9a-f]{32}$/.test(md5)) dropThumb(md5); if (!/^[0-9a-f]{32}$/.test(md5) || !live() || !api.enabled() || full(md5) || queued.has(md5)) return;
      const buf = recent.get(md5);
      if (buf) { recent.delete(md5); recentBytes -= buf.length; queued.add(md5); queue.push({ md5, buf }); pump(); return; }
      wanted.add(md5); if (wanted.size > 100) wanted.delete(wanted.values().next().value);
    },
    // Backfill from files already on disk (offline library): no network. Returns how many were queued.
    queueFiles(list) {
      if (!live() || !api.enabled()) return 0; let n = 0;
      for (const { md5: m, file } of list) { const md5 = String(m || '').toLowerCase(); if (!/^[0-9a-f]{32}$/.test(md5) || get().items[md5] || queued.has(md5) || !/.(jpe?g|png|gif|webp)$/i.test(file)) continue; queued.add(md5); queue.push({ md5, file }); n++; }
      if (n) pump(); return n;
    },
    // Stop the model thread before the process exits (exiting while it loads can crash node).
    close: () => { if (dirty) { clearTimeout(dirty); flush(); } hydra.close(); return worker ? worker.terminate().catch(() => {}) : Promise.resolve(); },
    hasLocal: () => existsSync(localFile),
    setAllViews(v) { if (!existsSync(localFile)) return; allViews = !!v; writeFileSync(localFile, JSON.stringify({ allViews })); },
    enabled: () => get().enabled !== false,
    // Per-feature switches (default on): aiTags / look = used in For you scoring, thumbs = also analyse thumbnails.
    opt: (k) => (get().opts || {})[k] !== false,
    // 'auto' | 'gpu' | 'cpu'. Restarts the model thread; the next image loads it with the new choice.
    async setDevice(v) {
      if (!['auto', 'gpu', 'cpu'].includes(v)) return; get().device = v; touch();
      if (worker) { const w = worker; worker = null; session = null; device = ''; await w.terminate().catch(() => {}); }
      if (queue.length) ensureSession().then(() => pump());
    },
    setOpt(k, v) { if (!['aiTags', 'look', 'thumbs'].includes(k)) return; const d = get(); (d.opts || (d.opts = {}))[k] = !!v; touch(); },
    setEnabled(v) { get().enabled = !!v; touch(); },
    ready: () => !!(live() && api.enabled()),
    has: (md5) => !!get().items[md5],
    count: () => Object.keys(get().items).length,
    tags: (md5) => tagInfo(md5)?.map(e => e.n) || null,
    tagInfo,
    // Optional Hydra tagger: source (wd | hydra | both), max tags shown, Start / Stop (click only), log for Settings.
    tagger: () => ({ mode: taggerMode(), max: tagMax(), hydraTags: hydra.count(), available: hydra.present(), ...hydra.info() }),
    setTagger(mode, max) { if (TAGGERS.includes(mode)) get().tagger = mode; if (max != null && Number.isFinite(Number(max))) get().tagMax = Math.min(200, Math.max(5, Math.round(Number(max)))); touch(); },
    tagStart: () => hydra.start(),
    tagStop() { hydra.stop('Stop button'); return true; },
    logView: () => ({ now: Date.now(), wd: { ready: !!session, device, busy, queued: queue.length, thumbQueued: thumbQ.length, analysed: Object.keys(get().items).length, error: sessErr }, tagger: api.tagger(), events: evRing.slice(-80) }),
    look: (md5) => get().items[md5]?.look || null,
    hash: (md5) => get().items[md5]?.h || null,
    stats() {
      if (statsMemo) return statsMemo;
      const L = Object.values(get().items).map(i => i.look).filter(Boolean), mean = new Array(LOOK_DIM).fill(0), std = new Array(LOOK_DIM).fill(1);
      if (L.length >= 20) {
        for (const v of L) for (let k = 0; k < LOOK_DIM; k++) mean[k] += v[k] / L.length;
        for (let k = 0; k < LOOK_DIM; k++) { let s = 0; for (const v of L) s += (v[k] - mean[k]) ** 2; std[k] = Math.max(0.02, Math.sqrt(s / L.length)); }
      }
      return statsMemo = { n: L.length, mean, std };
    },
    z(look) { const s = api.stats(); return s.n >= 20 ? look.map((v, k) => (v - s.mean[k]) / s.std[k]) : null; },
    importTags(map) { let n = 0; const items = get().items; for (const [md5, t] of Object.entries(map)) if (/^[0-9a-f]{32}$/.test(md5) && Array.isArray(t) && !items[md5]) { items[md5] = { t: t.slice(0, MAX_TAGS), at: Date.now() }; n++; } if (n) { touch(); flush(); } return n; },

    forgetImported(all = false) { const items = get().items; let n = 0; for (const k of Object.keys(items)) if (all || !items[k].look) { delete items[k]; n++; } if (n) { touch(); flush(); } return n; },

    async status() {
      await loadLibs(); if (!session && libs && modelOk()) await ensureSession();
      return { enabled: api.enabled(), packages: !!libs, packagesError: libErr, model: modelOk(), ready: !!session, device, deviceChoice: get().device || 'auto', error: sessErr, setup, busy, queued: queue.length, thumbQueued: thumbQ.length, analysed: Object.keys(get().items).length, withLook: api.stats().n, opts: { aiTags: api.opt('aiTags'), look: api.opt('look'), thumbs: api.opt('thumbs') }, tagger: api.tagger(),...(api.hasLocal() ? { local: { allViews } } : {}), done, failed, last };
    },
    keepsAlive(rawUrl) {
      const u = String(rawUrl || '');
      if (!live() || !api.enabled() || (inForYou === false && !allViews)) return false;
      const m = /([0-9a-f]{32}).(?:jpe?g|png|gif|webp)(?:[?#]|$)/i.exec(u) || /^sankaku:([0-9a-f]{32}):(?:file|sample)$/.exec(u);
      return !!m && !full(m[1].toLowerCase());
    },
    tap(res, rawUrl) {
      try {
        const isThumb = /\/(preview|thumbnails?)\/|thumbnail_|^sankaku:[0-9a-f]{32}:preview$/i.test(String(rawUrl || ''));
        if (isThumb) return res && res.status === 200 && res.body && api.enabled() ? tapThumb(res, String(rawUrl)) : res;
        if (!live() || !api.enabled() || (inForYou === false && !allViews) || !res || res.status !== 200 || !res.body) return res;
        if (!/^image\//i.test(res.headers.get('content-type') || '')) return res;
        const u = String(rawUrl || '');
        // Sankaku media goes through the proxy as "sankaku:<md5>:<kind>" instead of a file URL.
        const m = /([0-9a-f]{32})\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/i.exec(u) || /^sankaku:([0-9a-f]{32}):(?:file|sample)$/.exec(u); if (!m) return res;
        const md5 = m[1].toLowerCase(); dropThumb(md5); if (full(md5) || queued.has(md5) || recent.has(md5)) return res;
        const len = Number(res.headers.get('content-length')) || 0; if (len > MAX_IMG) return res;
        // Split the stream: the phone gets its copy at full speed; the copy here is only analysed if the whole image
        // arrived. If the phone cancels (scrolled past), the download is aborted and the image is skipped.
        const [toPhone, mine] = res.body.tee();
        (async () => {
          const r = mine.getReader(), chunks = []; let total = 0;
          try { for (;;) { const { done: d, value } = await r.read(); if (d) break; total += value.length; if (total > MAX_IMG) { r.cancel().catch(() => {}); return; } chunks.push(value); } }
          catch { return; }
          dropThumb(md5); if (!chunks.length || full(md5) || queued.has(md5)) return;
          const buf = Buffer.concat(chunks);
          if (wanted.delete(md5) || inForYou === false) { if (queue.length < MAX_QUEUE) { queued.add(md5); queue.push({ md5, buf }); pump(); } } else keepRecent(md5, buf);
        })();
        return new Response(toPhone, { status: res.status, headers: res.headers });
      } catch { return res; }
    },

    async setupModel() {
      if (setup.state === 'downloading') return setup;
      setup = { state: 'downloading', pct: 0, error: '' };
      (async () => {
        try {
          if (!(await loadLibs())) throw new Error(libErr);
          mkdirSync(modelDir, { recursive: true });
          const names = Object.keys(MODEL.files), total = names.reduce((a, n) => a + MODEL.files[n].bytes, 0); let got = 0;
          for (const n of names) {
            if (have(n)) { got += MODEL.files[n].bytes; continue; }
            const res = await fetchImpl(MODEL.base + n); if (!res.ok) throw new Error(`${n}: ${res.status}`);
            const tmp = path.join(modelDir, n + '.part'), hash = createHash('sha256'), out = createWriteStream(tmp);
            const src = Readable.fromWeb(res.body); src.on('data', (c) => { hash.update(c); got += c.length; setup.pct = Math.min(99, Math.round(got / total * 100)); });
            await pipeline(src, out);
            if (statSync(tmp).size !== MODEL.files[n].bytes) throw new Error(`${n}: wrong size`);
            if (MODEL.files[n].sha256 && hash.digest('hex') !== MODEL.files[n].sha256) { unlinkSync(tmp); throw new Error(`${n}: checksum mismatch`); }
            renameSync(tmp, path.join(modelDir, n));
          }
          setup = { state: 'done', pct: 100, error: '' }; log('vision', 'model downloaded'); await ensureSession();
        } catch (e) { setup = { state: 'error', pct: setup.pct, error: e.message }; log('err', 'vision setup ' + e.message); }
      })();
      return setup;
    },
    async init() { if (modelOk()) await ensureSession(); },
    flush
  };
  return api;
}
