import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';

const RING_MAX = 200 * 1024 * 1024, ITEM_MAX = 60 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const TYPE = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));

export function createLibrary({ dir, upstream }) {
  const root = path.join(dir, 'library'), file = path.join(dir, 'library.json');
  let data = null;
  const get = () => data || (data = (() => { try { const d = JSON.parse(readFileSync(file, 'utf8')); return { enabled: d.enabled === true, items: d.items && typeof d.items === 'object' ? d.items : {} }; } catch { return { enabled: false, items: {} }; } })());
  const save = () => { const tmp = file + '.tmp'; writeFileSync(tmp, JSON.stringify(get())); renameSync(tmp, file); };
  let byUrl = null;
  const urls = () => byUrl || (byUrl = new Map(Object.values(get().items).flatMap(it => it.urls.map(u => [u, it.name]))));
  const ring = new Map(); let ringSize = 0;
  const pending = new Map();

  function remember(u, buf, type) {
    if (ring.has(u)) { ringSize -= ring.get(u).buf.length; ring.delete(u); }
    ring.set(u, { buf, type }); ringSize += buf.length;
    for (const [k, v] of ring) { if (ringSize <= RING_MAX) break; ring.delete(k); ringSize -= v.buf.length; }
  }

  function keep(key, snap) {
    if (!get().enabled || !snap || snap.gone || get().items[key]) return false;
    const up = (u) => upstream(u || '');
    const tries = [snap.file, snap.sample, snap.compat, snap.mid].map(up).filter(Boolean);
    const hit = tries.map(u => [u, ring.get(u)]).find(x => x[1]);
    if (!hit) return false;
    const [, { buf, type }] = hit, ext = EXT[type];
    if (!ext) return false;
    const name = key.replace(':', '_') + '.' + ext;
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, name), buf);
    const alias = [snap.file, snap.sample, snap.compat, snap.mid, ...(type.startsWith('image/') ? [snap.preview] : [])].map(up).filter(Boolean);
    get().items[key] = { name, urls: [...new Set(alias)], t: Date.now() };
    for (const u of alias) urls().set(u, name);
    save(); return true;
  }

  return {
    enabled: () => get().enabled,
    setEnabled(on) { get().enabled = !!on; if (!on) { ring.clear(); ringSize = 0; pending.clear(); } save(); return get().enabled; },
    files() { return Object.entries(get().items).map(([key, it]) => ({ key, file: path.join(root, it.name), urls: it.urls })).filter(x => existsSync(x.file)); },
    status() { return { enabled: get().enabled, count: Object.keys(get().items).length }; },

    tap(res, rawUrl) {
      try {
        if (!get().enabled || !res || res.status !== 200 || !res.body) return res;
        const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!EXT[type] || Number(res.headers.get('content-length') || 0) > ITEM_MAX) return res;
        const u = String(rawUrl || ''), reader = res.body.getReader(); let chunks = [], total = 0;
        const stream = new ReadableStream({
          async pull(c) {
            const { done, value } = await reader.read();
            if (done) { c.close(); if (chunks) remember(u, Buffer.concat(chunks), type); chunks = null; return; }
            if (chunks) { total += value.length; if (total > ITEM_MAX) chunks = null; else chunks.push(value); }
            c.enqueue(value);
          },
          cancel(reason) { chunks = null; return reader.cancel(reason); }
        });
        return new Response(stream, { status: res.status, headers: res.headers });
      } catch { return res; }
    },

    liked(key, snap) { if (!get().enabled || get().items[key]) return; if (!keep(key, snap)) pending.set(key, Date.now()); },
    snapped(key, snap) { if (pending.delete(key)) keep(key, snap); },

    serve(rawUrl, request) {
      const name = urls().get(String(rawUrl || '')); if (!name) return null;
      const f = path.join(root, name); if (!existsSync(f)) return null;
      const size = statSync(f).size, type = TYPE[name.split('.').pop()] || 'application/octet-stream';
      const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400', 'x-goonpilot-local': '1' };
      const m = /^bytes=(\d*)-(\d*)$/.exec(request?.headers.get('range') || '');
      if (m && (m[1] || m[2])) {
        let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])), end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        return new Response(Readable.toWeb(createReadStream(f, { start, end })), { status: 206, headers: { ...h, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
      }
      return new Response(Readable.toWeb(createReadStream(f)), { headers: { ...h, 'Content-Length': String(size) } });
    }
  };
}
