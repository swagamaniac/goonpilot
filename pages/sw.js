// GitHub Pages backend (bundled into one classic script by the Pages workflow): runs the same API code as server.mjs inside a service worker.
// Everything is kept in this browser's IndexedDB; nothing here talks to anything but the booru sites.
import { handleApi, setCustomSources, checkCustom } from './src/api.mjs';
import { createProfiles } from './src/profiles.mjs';
import { createPostCache } from './src/postcache.mjs';
import { createArtists } from './src/artists.mjs';

const DB = 'goonpilot', KV = 'kv';
const idb = new Promise((resolve, reject) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(KV);
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
const tx = async (mode, fn) => { const db = await idb; return new Promise((resolve, reject) => { const t = db.transaction(KV, mode); const out = fn(t.objectStore(KV)); t.oncomplete = () => resolve(out?.result); t.onerror = () => reject(t.error); }); };

const mem = new Map(), dirty = new Set();
let writing = Promise.resolve(), timer = null;
function flush() {
  timer = null; if (!dirty.size) return writing;
  const keys = [...dirty]; dirty.clear();
  writing = writing.then(() => tx('readwrite', s => { for (const k of keys) mem.has(k) ? s.put(mem.get(k), k) : s.delete(k); })).catch(e => console.error('save failed', e));
  return writing;
}
const put = (k, v) => { if (v === undefined) mem.delete(k); else mem.set(k, v); dirty.add(k); if (!timer) timer = setTimeout(flush, 200); };
const kvStore = (name) => ({ load: () => mem.get(name) ?? null, save: (d) => put(name, d), snapshot() {}, flush });

let ctx, env;
const ready = (async () => {
  const [keys, vals] = await Promise.all([tx('readonly', s => s.getAllKeys()), tx('readonly', s => s.getAll())]);
  keys.forEach((k, i) => mem.set(k, vals[i]));
  build();
})();
function build() {
  env = { ...(mem.get('env') || {}) };
  setCustomSources(mem.get('boorus') || []);
  const posts = createPostCache(kvStore('posts'));
  ctx = {
    posts,
    artists: createArtists(kvStore('artists')),
    profiles: createProfiles({
      open: kvStore, has: (name) => mem.has(name),
      retire: (name) => { if (mem.has(name)) { put(`${name}.removed-${Date.now()}`, mem.get(name)); put(name, undefined); } },
      md5Of: (site, id) => posts.get(`${site}:${id}`)?.md5 || null
    }),
    saveVars: (vals) => { Object.assign(env, vals); put('env', { ...env }); },
    saveBoorus: (list) => { put('boorus', list.map(checkCustom)); setCustomSources(list); }
  };
  ctx.foryou = ctx.profiles.current;
}

// Browsers can't send User-Agent and preflight on Authorization, so logins go in the query string instead.
const UPSTREAM_ONLY = /(^|\.)(e621\.net|e6ai\.net)$/;
function browserFetch(input, init = {}) {
  const u = new URL(typeof input === 'string' ? input : input.url || String(input));
  const h = new Headers(init.headers || {});
  const auth = /^Basic (.+)$/.exec(h.get('authorization') || '');
  if (auth) { const [login, key] = atob(auth[1]).split(':'); u.searchParams.set('login', login); u.searchParams.set('api_key', key); }
  if (UPSTREAM_ONLY.test(u.hostname)) u.searchParams.set('_client', 'Goonpilot/1.0');
  for (const k of ['authorization', 'user-agent', 'range']) h.delete(k);
  return fetch(u, { ...init, headers: h, referrerPolicy: 'no-referrer', credentials: 'omit' });
}

// Backup file: every stored key except the logins.
async function backup(req) {
  if (req.method === 'GET') return new Response(JSON.stringify({ goonpilot: 1, at: new Date().toISOString(), data: Object.fromEntries([...mem].filter(([k]) => k !== 'env')) }), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="goonpilot-backup-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' } });
  if (req.headers.get('x-goonpilot') !== '1') return new Response('{"error":"Forbidden"}', { status: 403 });
  let b; try { b = await req.json(); } catch {}
  if (!b || b.goonpilot !== 1 || !b.data || typeof b.data !== 'object') return Response.json({ error: 'Not a Goonpilot backup' }, { status: 400 });
  for (const k of [...mem.keys()]) if (k !== 'env') put(k, undefined);
  for (const [k, v] of Object.entries(b.data)) if (k !== 'env') put(k, v);
  await flush(); build();
  return Response.json({ ok: true, reload: true });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const rest = url.pathname.startsWith(scope + 'api/') ? url.pathname.slice(scope.length - 1) : url.pathname.startsWith('/api/') ? url.pathname : null;
  if (!rest) return;
  const media = /^\/api\/[a-z0-9_-]+\/media$/.test(rest) && url.searchParams.get('u');
  if (media) { try { const m = new URL(media); if (m.protocol === 'https:') return event.respondWith(Response.redirect(m.href, 302)); } catch {} }
  event.respondWith((async () => {
    await ready;
    const req = event.request;
    if (rest === '/api/pages/backup') return backup(req);
    // A standalone Headers can carry sec-fetch-site, which a Request can't. Only this site's own pages
    // (and navigations into its scope) reach a service worker, so they count as same-origin.
    const h = new Headers([...req.headers]); h.set('sec-fetch-site', 'same-origin');
    const text = ['GET', 'HEAD'].includes(req.method) ? '' : await req.text();
    const inner = { url: location.origin + rest + url.search, method: req.method, headers: h, signal: req.signal, text: async () => text };
    let res;
    try { res = await handleApi(inner, env, browserFetch, ctx); }
    catch (e) { res = Response.json({ error: e.message || 'Failed' }, { status: 500 }); }
    if (rest === '/api/status') { const s = await res.json(); res = Response.json({ ...s, pages: true }); }
    event.waitUntil(new Promise(r => setTimeout(r, 250)).then(flush));
    return res;
  })());
});
