import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, createWriteStream, statSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';

const REV = '627aef95638667ddcaa3ac8ae625e88ea5b02f51';
export const MODEL = {
  base: `https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3/resolve/${REV}/`,
  files: { 'model.onnx': { bytes: 467460978, sha256: 'e6774bff34d43bd49f75a47db4ef217dce701c9847b546523eb85ff6dbba1db1' }, 'selected_tags.csv': { bytes: 308468 } }
};
const MAX_ITEMS = 60000, MAX_IMG = 15e6, MAX_QUEUE = 20, GEN_T = 0.35, CHAR_T = 0.85, MAX_TAGS = 80;
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
export const hamming = (a, b) => { let d = 0; for (let i = 0; i < 16; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } } return d; };

export function createVision({ dir, fetchImpl = fetch, log = () => {} }) {
  const file = path.join(dir, 'vision.json'), modelDir = path.join(dir, 'models');
  let data = null, dirty = null, libs = null, libErr = '', libTried = false, session = null, labels = null, sessErr = '';
  const wanted = new Set(), recent = new Map(); let recentBytes = 0;
  const keepRecent = (md5, buf) => { recent.set(md5, buf); recentBytes += buf.length; while (recent.size > 10 || recentBytes > 80e6) { const [k, b] = recent.entries().next().value; recent.delete(k); recentBytes -= b.length; } };
  const queue = [], queued = new Set(); let busy = false, done = 0, failed = 0, last = '';
  let setup = { state: 'idle', pct: 0, error: '' };
  let statsMemo = null, inForYou = null;

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
      session = await libs.ort.InferenceSession.create(path.join(modelDir, 'model.onnx'), { intraOpNumThreads: 1, interOpNumThreads: 1 });
      const rows = readFileSync(path.join(modelDir, 'selected_tags.csv'), 'utf8').trim().split('\n').slice(1);
      labels = rows.map(l => { const m = /^(\d+),("(?:[^"]|"")*"|[^,]*),(\d+),/.exec(l); return m ? { name: m[2].replace(/^"|"$/g, '').replace(/""/g, '"').replace(/ /g, '_'), cat: Number(m[3]) } : { name: '', cat: -1 }; });
    } catch (e) { sessErr = e.message; session = null; }
    return session;
  }

  async function analyse(buf) {
    const { ort, sharp } = libs;
    const base = () => sharp(buf, { failOn: 'none', limitInputPixels: 1e8 }).flatten({ background: '#ffffff' }).removeAlpha();
    const [big, small, gray] = await Promise.all([
      base().resize(448, 448, { fit: 'contain', background: '#ffffff' }).raw().toBuffer(),
      base().resize(32, 32, { fit: 'fill' }).raw().toBuffer(),
      base().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
    ]);
    const input = new Float32Array(448 * 448 * 3);
    for (let i = 0; i < 448 * 448; i++) { input[i * 3] = big[i * 3 + 2]; input[i * 3 + 1] = big[i * 3 + 1]; input[i * 3 + 2] = big[i * 3]; }
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 448, 448, 3]) });
    const p = out[session.outputNames[0]].data, hits = [];
    labels.forEach((l, i) => { if ((l.cat === 0 && p[i] > GEN_T) || (l.cat === 4 && p[i] > CHAR_T)) hits.push([l.name, p[i]]); });
    hits.sort((a, b) => b[1] - a[1]);
    return { t: hits.slice(0, MAX_TAGS).map(h => h[0]), look: lookFeatures(small), h: dHash(gray), at: Date.now() };
  }

  async function pump() {
    if (busy) return; busy = true;
    try {
      while (queue.length) {
        const job = queue.shift(); queued.delete(job.md5);
        try {
          if (!(await ensureSession())) { queue.length = 0; queued.clear(); break; }
          const t0 = Date.now(), r = await analyse(job.buf);
          const items = get().items; if (Object.keys(items).length < MAX_ITEMS) { items[job.md5] = r; touch(); }
          done++; last = `${job.md5.slice(0, 8)} ${r.t.length} tags ${Date.now() - t0}ms`;
          log('vision', last);
        } catch (e) { failed++; log('err', 'vision failed ' + job.md5.slice(0, 8) + ' ' + e.message); }
        await sleep(300);
      }
    } finally { busy = false; }
  }

  const api = {
    setMode(fy) { inForYou = !!fy; },
    want(md5) {
      md5 = String(md5 || '').toLowerCase(); if (!/^[0-9a-f]{32}$/.test(md5) || !session || !api.enabled() || get().items[md5] || queued.has(md5)) return;
      const buf = recent.get(md5);
      if (buf) { recent.delete(md5); recentBytes -= buf.length; queued.add(md5); queue.push({ md5, buf }); pump(); return; }
      wanted.add(md5); if (wanted.size > 100) wanted.delete(wanted.values().next().value);
    },
    enabled: () => get().enabled !== false,
    setEnabled(v) { get().enabled = !!v; touch(); },
    ready: () => !!(session && api.enabled()),
    has: (md5) => !!get().items[md5],
    count: () => Object.keys(get().items).length,
    tags: (md5) => get().items[md5]?.t || null,
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
      return { enabled: api.enabled(), packages: !!libs, packagesError: libErr, model: modelOk(), ready: !!session, error: sessErr, setup, queued: queue.length, analysed: Object.keys(get().items).length, withLook: api.stats().n, done, failed, last };
    },
    tap(res, rawUrl) {
      try {
        if (!session || !api.enabled() || inForYou === false || !res || res.status !== 200 || !res.body) return res;
        if (!/^image\//i.test(res.headers.get('content-type') || '')) return res;
        const u = String(rawUrl || ''); if (/\/(preview|thumbnails?)\/|thumbnail_/i.test(u)) return res;
        const m = /([0-9a-f]{32})\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/i.exec(u); if (!m) return res;
        const md5 = m[1].toLowerCase(); if (get().items[md5] || queued.has(md5) || recent.has(md5) || queue.length >= MAX_QUEUE) return res;
        const len = Number(res.headers.get('content-length')) || 0; if (len > MAX_IMG) return res;
        const reader = res.body.getReader(); let chunks = [], total = 0, over = false;
        const stream = new ReadableStream({
          async pull(c) {
            const { done: d, value } = await reader.read();
            if (d) { c.close(); if (!over && chunks.length) { const buf = Buffer.concat(chunks); if (wanted.delete(md5)) { queued.add(md5); queue.push({ md5, buf }); pump(); } else keepRecent(md5, buf); } chunks = []; return; }
            if (!over) { total += value.length; if (total > MAX_IMG) { over = true; chunks = []; } else chunks.push(value); }
            c.enqueue(value);
          },
          cancel(reason) { chunks = []; over = true; return reader.cancel(reason); }
        }, { highWaterMark: 16 });
        return new Response(stream, { status: res.status, headers: res.headers });
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
