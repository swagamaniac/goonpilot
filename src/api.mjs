import { rule34, proxifyPost } from './sources/rule34.mjs';
import { e621, e6ai } from './sources/e621.mjs';
import { paheal } from './sources/paheal.mjs';
import { makeCustom, CUSTOM_TYPES } from './sources/custom.mjs';
import { derpibooru } from './sources/derpibooru.mjs';
import { sankaku } from './sources/sankaku.mjs';

// Danbooru and Gelbooru reuse the custom-site adapter, minus the custom flag so it can't be removed in Settings.
const danbooru = { ...makeCustom({ id: 'danbooru', label: 'danbooru', base: 'https://danbooru.donmai.us', type: 'danbooru', envPrefix: 'DANBOORU' }), custom: false };
const gelbooru = { ...makeCustom({ id: 'gelbooru', label: 'gelbooru', base: 'https://gelbooru.com', type: 'gelbooru', envPrefix: 'GELBOORU', userKey: 'USER_ID' }), custom: false };
const BUILTIN = { [rule34.id]: rule34, [e621.id]: e621, [e6ai.id]: e6ai, [paheal.id]: paheal, [danbooru.id]: danbooru, [gelbooru.id]: gelbooru, [derpibooru.id]: derpibooru, [sankaku.id]: sankaku };
let SOURCES = { ...BUILTIN };
const RESERVED = new Set([...Object.keys(BUILTIN), 'lib', 'foryou', 'vision', 'keys', 'status', 'boorus']);

// Validates a user-added site; returns the cleaned entry or throws.
export function checkCustom(b) {
  const label = String(b.label || '').trim().slice(0, 30);
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
  if (!id || RESERVED.has(id)) throw Object.assign(new Error('Pick another name'), { status: 400 });
  if (!CUSTOM_TYPES[b.type]) throw Object.assign(new Error('Unknown API type'), { status: 400 });
  let u; try { u = new URL(String(b.base || '').trim()); } catch { throw Object.assign(new Error('Bad URL'), { status: 400 }); }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw Object.assign(new Error('Bad URL'), { status: 400 });
  return { id, label, base: u.origin + u.pathname.replace(/\/+$/, ''), type: b.type };
}
export function setCustomSources(list) {
  SOURCES = { ...BUILTIN };
  for (const c of list || []) { try { const e = checkCustom(c); SOURCES[e.id] = makeCustom(e); } catch {} }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

const int = (v, def, min, max) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const list = (v) => String(v || '').split(/\s+/).map(s => s.trim()).filter(Boolean).slice(0, 40);

const lanes = {};
let LOG = () => {};
export const setApiLog = (f) => { LOG = f; };
function polite(siteId, fn, minGap = 600) {
  const lane = lanes[siteId] || (lanes[siteId] = { chain: Promise.resolve(), last: 0 });
  const queued = Date.now();
  const run = lane.chain.then(async () => {
    const wait = lane.last + minGap - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lane.last = Date.now();
    const waited = lane.last - queued; if (waited > 400) LOG(`queue   ${siteId} waited ${waited}ms (gap ${minGap}ms)`);
    return fn();
  });
  lane.chain = run.catch(() => {});
  return run;
}

function guardPrivate(request, url) {
  const origin = request.headers.get('origin');
  if (request.headers.get('x-goonpilot') !== '1') return json({ error: 'Forbidden' }, 403);
  if (origin && origin !== url.origin) return json({ error: 'Forbidden' }, 403);
  const sfs = request.headers.get('sec-fetch-site');
  if (sfs && !['same-origin', 'none'].includes(sfs)) return json({ error: 'Forbidden' }, 403);
  return null;
}
async function readBody(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) return [null, json({ error: 'JSON only' }, 415)];
  const text = await request.text();
  if (text.length > 1_000_000) return [null, json({ error: 'Too large' }, 413)];
  let b; try { b = JSON.parse(text); } catch { return [null, json({ error: 'Bad JSON' }, 400)]; }
  if (!b || typeof b !== 'object') return [null, json({ error: 'Bad JSON' }, 400)];
  return [b, null];
}

async function handleLib(request, url, artists, library = null) {
  if (!artists) return json({ error: 'Not available' }, 404);
  const bad = guardPrivate(request, url); if (bad) return bad;
  try {
    if (url.pathname === '/api/lib/library' && library) {
      if (request.method === 'POST') { const [b, err] = await readBody(request); if (err) return err; library.setEnabled(b.enabled === true); }
      return json(library.status());
    }
    if (url.pathname === '/api/lib/ui') {
      if (request.method === 'GET') return json({ ui: artists.getUi() });
      if (request.method === 'POST') { const [b, err] = await readBody(request); if (err) return err; return json({ ui: artists.setUi(b) }); }
    }
    if (url.pathname === '/api/lib/artists') {
      if (request.method === 'GET') return json({ artists: artists.list() });
      if (request.method === 'POST') {
        const [b, err] = await readBody(request); if (err) return err;
        if (b.remove === true) { artists.remove(String(b.name)); return json({ ok: true }); }
        return json({ artist: artists.set({ name: String(b.name), note: b.note, kind: b.kind }) });
      }
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) { return json({ error: e.message || 'Failed' }, e.status === 400 ? 400 : 502); }
}

async function handleForYou(request, url, env, fetchImpl, fy, posts, profiles, vision = null, library = null) {
  if (!fy) return json({ error: 'For you is not available' }, 404);
  const bad = guardPrivate(request, url); if (bad) return bad;
  const route = url.pathname.slice('/api/foryou/'.length);
  const fail = (err) => json({ error: err.message || 'Failed' }, [400, 401, 403, 409, 429].includes(err.status) ? err.status : 502);
  try {
    if (request.method === 'GET' && route === 'state') return json({ ...fy.state(url.searchParams.get('tag')), ...(profiles ? { profileList: profiles.list() } : {}) });
    if (request.method === 'GET' && route === 'profiles' && profiles) return json(profiles.list());
    if (request.method === 'GET' && route === 'liked') {
      const p = url.searchParams;
      const r = fy.listVotes({ filter: p.get('filter') || 'likes', offset: int(p.get('offset'), 0, 0, 1e6), limit: int(p.get('limit'), 20, 1, 50) });
      return json({ total: r.total, items: r.items.map(it => { const c = posts?.get(`${it.site}:${it.id}`); return { ...it, post: c && !c.gone ? (it.site === 'rule34' ? proxifyPost(c) : c) : null, gone: !!c?.gone }; }) });
    }
    if (request.method === 'GET' && route === 'feed') {
      const p = url.searchParams;
      const sites = list(p.get('sites')).filter(id => SOURCES[id]?.configured(env));
      const rating = ['all', 'safe', 'questionable', 'explicit'].includes(p.get('rating')) ? p.get('rating') : 'all';
      const search = (id, q) => polite(id, () => SOURCES[id].search(q, env, fetchImpl), SOURCES[id].minGap);
      const exists = (id, names) => checkTags(SOURCES[id], names, env, fetchImpl);
      return json(await fy.feed({ sites, rating, shape: ['portrait', 'landscape'].includes(p.get('shape')) ? p.get('shape') : 'any', n: int(p.get('n'), 10, 1, 25), search, exists }));
    }
    if (request.method === 'POST') {
      const [b, err] = await readBody(request); if (err) return err;
      if (route === 'vote') {
        const vote = fy.vote({ site: String(b.site), id: b.id, vote: b.vote, post: b.post, strat: b.strat, md5: b.md5, dive: b.dive === true });
        if (library && vote > 0) library.liked(`${b.site}:${b.id}`, posts?.get(`${b.site}:${b.id}`));
        return json({ vote });
      }
      if (route === 'reset-learning') {
        if (b.confirm !== 'RESET' || !profiles) return json({ error: 'Not confirmed' }, 400);
        profiles.resetAllLearning(); return json({ ok: true });
      }
      if (route === 'seen') { if (vision && typeof b.md5 === 'string') vision.want(b.md5); }
      if (route === 'seen') return json({ ok: fy.markViewed({ site: String(b.site), id: b.id, post: b.post, md5: b.md5 }) });
      if (route === 'snap') {
        if (!posts || !/^[a-z0-9_-]{1,20}$/.test(String(b.site)) || !Number.isInteger(b.id)) return json({ error: 'Bad post' }, 400);
        const ok = posts.set(String(b.site), b.id, b.gone === true ? null : b.post);
        if (library) library.snapped(`${b.site}:${b.id}`, posts.get(`${b.site}:${b.id}`));
        return json({ ok });
      }
      if (route === 'profile' && profiles) {
        const act = String(b.action);
        if (act === 'create') { const id = profiles.create(b.name, b.kind === undefined ? 'normal' : String(b.kind)); if (b.switch === true) profiles.switchTo(id); return json({ id, ...profiles.list() }); }
        if (act === 'switch') profiles.switchTo(String(b.id));
        else if (act === 'rename') profiles.rename(String(b.id), b.name);
        else if (act === 'delete') { if (b.confirm !== true) return json({ error: 'Needs confirm' }, 400); profiles.remove(String(b.id)); }
        else return json({ error: 'Unknown action' }, 400);
        return json(profiles.list());
      }
      if (route === 'prefs') return json({ prefs: fy.setPrefs(b) });
      if (route === 'dive') { if (b.end === true) { fy.endDive(); return json({ ok: true }); } fy.startDive({ site: String(b.site), id: b.id, post: b.post }); return json({ ok: true, dive: fy.dive }); }
      if (route === 'enabled') return json({ enabled: fy.setEnabled(b.enabled === true) });
      if (route === 'reset') { if (b.confirm !== true) return json({ error: 'Needs confirm' }, 400); fy.reset(); return json({ ok: true }); }
    }
    return json({ error: 'Not found' }, 404);
  } catch (err) { return fail(err); }
}

const tagCache = new Map();
export async function checkTags(source, names, env, fetchImpl = fetch) {
  const out = {};
  for (const raw of names.slice(0, 12)) {
    const name = String(raw).trim().replace(/\s+/g, '_').toLowerCase();
    if (!name || /[:*]/.test(name) || name.length < 3) { out[raw] = true; continue; }
    const ck = source.id + '|' + name, hit = tagCache.get(ck);
    if (hit && hit.t > Date.now() - 864e5) { out[raw] = hit.v; continue; }
    let v;
    try {
      v = await polite(source.id, async () => {
        if (source.exists && await source.exists(name, env, fetchImpl)) return true;
        const sug = await source.suggest(name, env, fetchImpl);
        return sug.some(x => String(x.name).toLowerCase() === name) || sug.length >= 10;
      }, source.minGap);
    }
    catch { out[raw] = true; continue; }
    tagCache.set(ck, { v, t: Date.now() }); out[raw] = v;
  }
  return out;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crcStep = (crc, buf) => { let c = crc; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return c >>> 0; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

export function upstreamUrl(snapUrl) {
  const m = /^\/api\/[a-z0-9_-]+\/media\?u=(.+)$/.exec(snapUrl || '');
  if (m) { try { return decodeURIComponent(m[1]); } catch { return ''; } }
  return /^https:\/\//.test(snapUrl || '') ? snapUrl : '';
}
function safeName(site, id, snap, upstream) {
  const ext = (/^[a-z0-9]{2,5}$/i.test(snap.ext || '') ? snap.ext : (/\.([a-z0-9]{2,5})(?:\?|$)/i.exec(upstream) || [])[1] || 'bin').toLowerCase();
  return `${site}_${id}.${ext}`;
}

async function* zipStream(entries) {
  const central = []; let offset = 0;
  const push = (b) => { offset += b.length; return b; };
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), start = offset;
    yield push(Buffer.concat([u32(0x04034b50), u16(20), u16(0x0808), u16(0), u16(0), u16(0x21), u32(0), u32(0), u32(0), u16(name.length), u16(0), name]));
    let crc = 0xFFFFFFFF, size = 0;
    for await (const chunk of e.chunks()) { crc = crcStep(crc, chunk); size += chunk.length; yield push(Buffer.from(chunk)); }
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    yield push(Buffer.concat([u32(0x08074b50), u32(crc), u32(size), u32(size)]));
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0808), u16(0), u16(0), u16(0x21), u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(start), name]));
  }
  const cdStart = offset; let cdSize = 0;
  for (const c of central) { cdSize += c.length; yield c; }
  yield Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0)]);
}

async function handleDownload(request, url, env, fetchImpl, fy, posts, library = null) {
  if (request.method !== 'GET') return json({ error: 'Only GET is allowed' }, 405);
  if (request.headers.get('sec-fetch-site') !== 'same-origin') return json({ error: 'Forbidden' }, 403);
  let refs = [];
  const filter = url.searchParams.get('filter');
  if (filter) refs = fy.listVotes({ filter, offset: 0, limit: 5000 }).items.map(v => ({ site: v.site, id: v.id }));
  else for (const part of String(url.searchParams.get('items') || '').split(',').slice(0, 5000)) {
    const m = /^([a-z0-9_-]+):(\d+)$/.exec(part); if (m) refs.push({ site: m[1], id: Number(m[2]) });
  }
  refs = refs.filter(r => SOURCES[r.site]).slice(0, 500);
  const files = [], missing = [];
  for (const r of refs) {
    const snap = posts.get(`${r.site}:${r.id}`), up = snap && !snap.gone ? upstreamUrl(snap.file) : '';
    if (!up) { missing.push(`${r.site}:${r.id}`); continue; }
    files.push({ ...r, up, name: safeName(r.site, r.id, snap, up) });
  }
  if (!files.length) return json({ error: 'Nothing to download (posts not saved locally yet: open them in the Liked view first)' }, 404);
  const fetchFile = (f) => library?.serve(f.up) || SOURCES[f.site].media(f.up, new Request('http://local/'), env, fetchImpl);
  if (files.length === 1) {
    const res = await fetchFile(files[0]);
    const h = new Headers(res.headers); h.set('Content-Disposition', `attachment; filename="${files[0].name}"`); h.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.ok ? 200 : 502, headers: h });
  }
  const entries = files.map(f => ({ name: f.name, async *chunks() {
    try { const res = await fetchFile(f); if (!res.ok || !res.body) { missing.push(`${f.site}:${f.id}`); return; } for await (const c of res.body) yield c; }
    catch { missing.push(`${f.site}:${f.id}`); }
  } }));
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { Readable } = await import('node:stream');
  return new Response(Readable.toWeb(Readable.from(zipStream(entries))), { headers: {
    'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="goonpilot-${filter || 'selected'}-${stamp}.zip"`, 'Cache-Control': 'no-store'
  } });
}

export function buildLikedCsv(fy, posts, filter = 'likes') {
  const rows = ['site,id,link,file,vote'];
  for (const v of fy.listVotes({ filter, offset: 0, limit: 100000 }).items) {
    const snap = posts.get(`${v.site}:${v.id}`);
    const link = snap?.link || ({ rule34: `https://rule34.xxx/index.php?page=post&s=view&id=${v.id}`, e621: `https://e621.net/posts/${v.id}`, e6ai: `https://e6ai.net/posts/${v.id}`, paheal: `https://rule34.paheal.net/post/view/${v.id}`, danbooru: `https://danbooru.donmai.us/posts/${v.id}`, gelbooru: `https://gelbooru.com/index.php?page=post&s=view&id=${v.id}`, derpibooru: `https://derpibooru.org/images/${v.id}` })[v.site] || '';
    rows.push([v.site, v.id, link, (snap && !snap.gone && upstreamUrl(snap.file)) || '', v.vote].join(','));
  }
  return '\ufeff' + rows.join('\r\n') + '\r\n';
}
function handleExport(request, url, fy, posts) {
  if (request.headers.get('sec-fetch-site') !== 'same-origin') return json({ error: 'Forbidden' }, 403);
  const filter = ['likes', 'super', 'dislikes', 'all'].includes(url.searchParams.get('filter')) ? url.searchParams.get('filter') : 'likes';
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return new Response(buildLikedCsv(fy, posts, filter), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="goonpilot-${filter}-${stamp}.csv"`, 'Cache-Control': 'no-store' } });
}

export async function handleApi(request, env, fetchImpl = fetch, ctx = {}) {
  const url = new URL(request.url);
  if (url.pathname === '/api/lib/export' && request.method === 'GET') return handleExport(request, url, ctx.foryou, ctx.posts);
  if (url.pathname === '/api/lib/download') return handleDownload(request, url, env, fetchImpl, ctx.foryou, ctx.posts, ctx.library);
  if (url.pathname === '/api/lib/restart' && request.method === 'POST') {
    const bad = guardPrivate(request, url); if (bad) return bad;
    if (!ctx.restart) return json({ error: 'Restart only works when started with start-phone.bat' }, 409);
    ctx.restart(); return json({ ok: true });
  }
  if (url.pathname.startsWith('/api/lib/')) return handleLib(request, url, ctx.artists, ctx.library);
  const visionGuard = () => (request.headers.get('x-goonpilot') === '1' || request.headers.get('sec-fetch-site') === 'none') && (!request.headers.get('origin') || request.headers.get('origin') === url.origin) ? null : json({ error: 'Forbidden' }, 403);
  if (url.pathname === '/api/vision/status') return json(ctx.vision ? { ...(await ctx.vision.status()), votes: ctx.visionVotes ? ctx.visionVotes() : undefined } : { enabled: false, packages: false, model: false, ready: false });
  if (url.pathname === '/api/vision/tags') {
    const bad = visionGuard(); if (bad) return bad;
    const m = String(url.searchParams.get('md5') || '').toLowerCase();
    return json({ tags: ctx.vision && /^[0-9a-f]{32}$/.test(m) ? (ctx.vision.tags(m) || []) : [] });
  }
  if (url.pathname === '/api/vision/setup') {
    const bad = visionGuard(); if (bad) return bad;
    return json(ctx.vision ? await ctx.vision.setupModel() : { state: 'error', error: 'not available' });
  }
  if (url.pathname === '/api/vision/mode' && request.method === 'POST') {
    const bad = guardPrivate(request, url); if (bad) return bad;
    if (ctx.vision) ctx.vision.setMode(url.searchParams.get('fy') === '1'); return json({ ok: true });
  }
  if (url.pathname === '/api/vision/import') {
    const bad = visionGuard(); if (bad) return bad;
    return json({ imported: ctx.visionImport ? ctx.visionImport() : 0 });
  }
  if (url.pathname === '/api/vision/backfill' && request.method === 'POST') {
    const bad = visionGuard(); if (bad) return bad;
    return json(ctx.visionBackfill ? await ctx.visionBackfill() : { queued: 0, error: 'not available' });
  }
  if (url.pathname === '/api/vision/forget-imported') {
    const bad = visionGuard(); if (bad) return bad;
    return json({ removed: ctx.vision ? ctx.vision.forgetImported(url.searchParams.get('all') === '1') : 0 });
  }
  if (url.pathname === '/api/vision/allviews') {
    const bad = visionGuard(); if (bad) return bad;
    if (!ctx.vision?.hasLocal()) return json({ error: 'not available' }, 404);
    ctx.vision.setAllViews(url.searchParams.get('on') === '1'); return json(await ctx.vision.status());
  }
  if (url.pathname === '/api/vision/toggle') {
    const bad = visionGuard(); if (bad) return bad;
    if (!ctx.vision) return json({ error: 'not available' }, 409);
    ctx.vision.setEnabled(url.searchParams.get('on') !== '0'); return json(await ctx.vision.status());
  }
  if (url.pathname.startsWith('/api/foryou/')) return handleForYou(request, url, env, fetchImpl, ctx.foryou, ctx.posts, ctx.profiles, ctx.vision, ctx.library);
  if (url.pathname === '/api/boorus' && request.method === 'POST') {
    const bad = guardPrivate(request, url); if (bad) return bad;
    if (!ctx.saveBoorus) return json({ error: 'Sites can only be changed on the computer running the server' }, 403);
    const [b, err] = await readBody(request); if (err) return err;
    const list = Object.values(SOURCES).filter(s => s.custom).map(({ id, label, base, type }) => ({ id, label, base, type }));
    try {
      if (b.action === 'remove') { ctx.saveBoorus(list.filter(c => c.id !== String(b.id))); return json({ ok: true }); }
      const e = checkCustom(b);
      if (SOURCES[e.id]) return json({ error: 'A site with that name already exists' }, 409);
      ctx.saveBoorus([...list, e]); return json({ ok: true, id: e.id });
    } catch (e) { return json({ error: e.message }, e.status || 400); }
  }
  if (url.pathname === '/api/keys' && request.method === 'POST') {
    const bad = guardPrivate(request, url); if (bad) return bad;
    if (!ctx.saveVars) return json({ error: 'Logins can only be changed on the computer running the server' }, 403);
    const [b, err] = await readBody(request); if (err) return err;
    const allowed = new Set(Object.values(SOURCES).flatMap(s => s.envKeys)), vals = {};
    for (const [k, v] of Object.entries(b)) {
      if (!allowed.has(k) || typeof v !== 'string' || v.length > 200 || /[\r\n]/.test(v)) return json({ error: 'Invalid value' }, 400);
      vals[k] = v.trim();
    }
    ctx.saveVars(vals); return json({ ok: true });
  }
  // Paste or upload a whole .dev.vars: merges site keys, backs up the old file, answers with key names only.
  if (url.pathname === '/api/keys/import' && request.method === 'POST') {
    const bad = guardPrivate(request, url); if (bad) return bad;
    if (!ctx.saveVars) return json({ error: 'Logins can only be changed on the computer running the server' }, 403);
    const [b, err] = await readBody(request); if (err) return err;
    if (typeof b.text !== 'string') return json({ error: 'Nothing to import' }, 400);
    const vals = {}; let skipped = 0;
    for (const line of b.text.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      const v = m && m[2].replace(/^["']|["']$/g, '');
      if (!m || !/^(RULE34|E621|E6AI|GELBOORU|DANBOORU|SANKAKU|CUSTOM)_/.test(m[1]) || !v || v.length > 500) { skipped++; continue; }
      vals[m[1]] = v;
    }
    if (!Object.keys(vals).length) return json({ error: 'No site keys found' }, 400);
    ctx.saveVars(vals, true); return json({ ok: true, keys: Object.keys(vals), skipped });
  }
  if (request.method !== 'GET') return json({ error: 'Only GET is allowed' }, 405);

  if (url.pathname === '/api/status') {
    return json({ types: CUSTOM_TYPES, sources: Object.values(SOURCES).map(s => ({ id: s.id, label: s.label, configured: s.configured(env), auth: s.auth(env), keys: s.envKeys.map(k => ({ name: k, set: !!env[k] })), ...(s.custom ? { custom: true, type: s.type, base: s.base } : {}) })) });
  }

  const m = /^\/api\/([a-z0-9_-]+)\/(posts|suggest|media|tagcheck)$/.exec(url.pathname);
  if (!m) return json({ error: 'Not found' }, 404);
  const source = SOURCES[m[1]];
  if (!source) return json({ error: 'Unknown site' }, 404);
  if (!source.configured(env)) {
    return json({ error: `${source.label} is not set up: add ${source.envKeys.join(' and ')} to .dev.vars and restart.` }, 503);
  }

  const p = url.searchParams;
  try {
    if (m[2] === 'media') {
      if (!source.media) return json({ error: 'Not found' }, 404);
      const local = ctx.library?.serve(p.get('u') || '', request); if (local) return local;
      let mres = await source.media(p.get('u') || '', request, env, fetchImpl);
      if (ctx.library) mres = ctx.library.tap(mres, p.get('u') || '');
      return ctx.vision ? ctx.vision.tap(mres, p.get('u') || '') : mres;
    }
    if (m[2] === 'tagcheck') return json({ exists: await checkTags(source, list(p.get('names')), env, fetchImpl) });
    if (m[2] === 'suggest') {
      const q = (p.get('q') || '').trim();
      if (q.length < 1) return json({ suggestions: [] });
      const suggestions = await polite(source.id, () => source.suggest(q.slice(0, 100), env, fetchImpl), 300);
      return json({ suggestions });
    }
    const query = {
      include: list(p.get('inc')),
      exclude: list(p.get('exc')),
      or: list(p.get('or')),
      orGroups: String(p.get('og') || '').split('|').map(list).filter(g => g.length).slice(0, 10),
      sort: ['id', 'score', 'popular', 'updated', 'random', 'phone'].includes(p.get('sort')) ? p.get('sort') : 'id',
      rating: ['all', 'safe', 'questionable', 'explicit'].includes(p.get('rating')) ? p.get('rating') : 'all',
      minScore: int(p.get('min'), 0, 0, 100000),
      threshold: p.has('th') ? int(p.get('th'), 0, 0, 5) : null,
      books: p.get('bk') === 'always' ? 'always' : null,
      pr: Math.min(5, Math.max(0.2, Number(p.get('pr')) || 0.46)),
      shape: ['portrait', 'landscape'].includes(p.get('shape')) ? p.get('shape') : 'any',
      page: int(p.get('page'), 0, 0, 200000),
      limit: int(p.get('limit'), 20, 1, 100)
    };
    if (query.sort === 'phone') query.limit = 100;
    const result = await polite(source.id, () => source.search(query, env, fetchImpl), source.minGap);
    if (query.sort === 'phone' && result.posts?.length) {
      const d = (x) => (x.w && x.h) ? Math.abs(Math.log((x.w / x.h) / query.pr)) : 9;
      result.posts = result.posts.map((x, i) => [x, i]).sort((a, b) => d(a[0]) - d(b[0]) || a[1] - b[1]).map(x => x[0]);
    }
    return json(result);
  } catch (err) {
    const status = [400, 401, 403, 429].includes(err.status) ? err.status : 502;
    return json({ error: err.message || 'Request to the site failed' }, status);
  }
}
