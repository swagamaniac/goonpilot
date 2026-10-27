// Sankaku (chan.sankakucomplex.com / sankaku.app). Local server only: the API checks Origin and the CDN checks Referer.
// Media URLs from the API are signed and expire, so posts carry stable proxy refs (sankaku:<md5>:<kind>) that the
// media route turns into a fresh CDN URL, from the last search when possible, otherwise with one md5 lookup.
const API = 'https://sankakuapi.com';
const SITE = 'https://sankaku.app';
const LINK = 'https://chan.sankakucomplex.com/posts/';
const H = { 'User-Agent': 'Goonpilot/1.0 (personal)', Accept: 'application/vnd.sankaku.api+json;v=2', Origin: SITE, Referer: SITE + '/' };

const TAG_TYPES = { 0: 'general', 1: 'artist', 2: 'artist', 3: 'copyright', 4: 'character', 5: 'general', 8: 'meta', 9: 'meta' };
const ORDER = ['artist', 'character', 'copyright', 'species', 'general', 'meta'];
const REF = /^sankaku:([0-9a-f]{32}):(file|sample|preview)$/;

const cleanTag = (t) => String(t).trim().replace(/\s+/g, '_').slice(0, 200);
const viaProxy = (md5, kind) => `/api/sankaku/media?u=${encodeURIComponent(`sankaku:${md5}:${kind}`)}`;
const err = (msg, status) => Object.assign(new Error(msg), { status });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Login token, kept in memory and tied to the login it came from.
let token = null;
async function login(env, fetchImpl) {
  const who = `${env.SANKAKU_USERNAME}\n${env.SANKAKU_PASSWORD}`;
  if (token?.who === who) return token.value;
  const res = await fetchImpl(API + '/auth/token', {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: env.SANKAKU_USERNAME, password: env.SANKAKU_PASSWORD }), signal: AbortSignal.timeout(20000)
  });
  let data; try { data = await res.json(); } catch {}
  if (!res.ok || !data?.success || !data.access_token) throw err('Sankaku rejected your login. Check SANKAKU_USERNAME and SANKAKU_PASSWORD in .dev.vars.', 401);
  token = { who, value: 'Bearer ' + data.access_token };
  return token.value;
}

async function call(path, params, env, fetchImpl, retry = true) {
  const url = new URL(path, API);
  url.search = new URLSearchParams({ lang: 'en', ...params }).toString();
  const h = { ...H };
  if (env.SANKAKU_USERNAME && env.SANKAKU_PASSWORD) h.Authorization = await login(env, fetchImpl);
  const res = await fetchImpl(url, { headers: h, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (res.status === 429) {
    if (text.includes('_tags-explicit-limit')) throw err('Too many tags for Sankaku on this account: use fewer tags.', 400);
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    throw err(`Sankaku rate limit reached${reset > 1e9 ? `, try again after ${new Date(reset * 1000).toLocaleTimeString()}` : ''}`, 429);
  }
  let data = null; try { data = JSON.parse(text); } catch {}
  const code = String(data?.code || '');
  if (res.status === 401 || /(unauthorized|invalid[-_]token)$/.test(code)) {
    if (token && retry) { token = null; return call(path, params, env, fetchImpl, false); }
    throw err('Sankaku rejected your login. Check SANKAKU_USERNAME and SANKAKU_PASSWORD in .dev.vars.', 401);
  }
  if (!data) throw err(`Unexpected answer from Sankaku (${res.status})`, res.status === 403 ? 403 : 502);
  if (!res.ok || data?.success === false) throw err(`Sankaku: ${code.split('__').pop().replace(/[-_]/g, ' ') || res.status}`, res.status >= 500 ? 502 : 400);
  return data;
}

// Fresh CDN URLs per md5, filled by every search and by md5 lookups.
const urls = new Map();
const expiry = (u) => { try { return Number(new URL(u).searchParams.get('e')) * 1000 || 0; } catch { return 0; } };
function remember(p) {
  const md5 = String(p.md5 || '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(md5) || !p.file_url) return;
  const https = (u) => u ? String(u).replace(/^http:/, 'https:') : '';
  const file = https(p.file_url);
  urls.delete(md5);
  urls.set(md5, { file, sample: https(p.sample_url) || file, preview: https(p.preview_url) || https(p.sample_url) || file, exp: expiry(file) || Date.now() + 30 * 60e3 });
  if (urls.size > 5000) urls.delete(urls.keys().next().value);
}
const lookups = new Map();
let lookupLane = Promise.resolve();
function lookup(md5, env, fetchImpl) {
  if (lookups.has(md5)) return lookups.get(md5);
  const run = lookupLane.then(async () => {
    const data = await call('/v2/posts', { page: '1', limit: '1', tags: 'md5:' + md5 }, env, fetchImpl);
    (Array.isArray(data) ? data : data?.data || []).forEach(remember);
    await sleep(1000);
  });
  lookupLane = run.catch(() => {});
  const done = run.finally(() => lookups.delete(md5));
  lookups.set(md5, done);
  return done;
}

function idOf(p, md5) {
  // Sankaku post ids are strings; Goonpilot needs ascending integers. Upload second * 1e5 plus a slice of the md5 keeps
  // "new since last visit" working and collisions unlikely.
  const s = Number(p.created_at?.s) || 0;
  return s * 1e5 + (parseInt(md5.slice(-5), 16) % 1e5);
}

function normalizePost(p) {
  const md5 = String(p.md5).toLowerCase();
  const mime = String(p.file_type || '').toLowerCase();
  const ext = (mime.split('/')[1] || (/\.([a-z0-9]{2,5})(?:\?|$)/i.exec(p.file_url) || [])[1] || '').replace('jpeg', 'jpg').toLowerCase();
  const type = mime.startsWith('video/') || ['mp4', 'webm'].includes(ext) ? 'video' : ext === 'gif' ? 'gif' : 'image';
  // The typed `tags` objects may be a short excerpt; `tag_names` has the full list, so the rest come in as general.
  const typed = (Array.isArray(p.tags) ? p.tags : []).filter(t => t && typeof t === 'object')
    .map(t => ({ name: t.name_en || t.name || t.tagName, type: TAG_TYPES[t.type] || 'general', count: Number(t.post_count ?? t.count) || 0 }));
  const seen = new Map();
  for (const t of [...typed, ...(p.tag_names || []).map(name => ({ name, type: 'general', count: 0 }))]) {
    const name = String(t.name || '').toLowerCase().replace(/ /g, '_');
    if (name && !seen.has(name)) seen.set(name, { ...t, name });
  }
  const tags = [...seen.values()];
  tags.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  const r = String(p.rating || '').toLowerCase();
  const s = Number(p.created_at?.s);
  return {
    id: idOf(p, md5), md5,
    w: Number(p.width) || 1, h: Number(p.height) || 1,
    type,
    rating: r.startsWith('e') ? 'explicit' : r.startsWith('q') ? 'questionable' : 'safe',
    score: Number(p.total_score ?? p.fav_count) || 0,
    date: s > 1e8 ? new Date(s * 1000).toISOString() : '',
    file: viaProxy(md5, 'file'), sample: viaProxy(md5, 'sample'), preview: viaProxy(md5, 'preview'),
    ext, tags,
    link: LINK + encodeURIComponent(String(p.id))
  };
}

function buildTags({ include = [], exclude = [], or = [], orGroups = [], sort = 'id', rating = 'all' }) {
  const parts = [...include.map(cleanTag), ...exclude.map(t => '-' + cleanTag(t))].filter(t => t && t !== '-');
  const groups = [or, ...orGroups].map(g => g.map(cleanTag).filter(Boolean)).filter(g => g.length);
  if (groups.filter(g => g.length > 1).length > 1) throw err('Sankaku supports only one OR group per search', 400);
  for (const g of groups) parts.push(...(g.length > 1 ? g.map(t => '~' + t) : g));
  if (sort === 'score') parts.push('order:quality');
  else if (sort === 'random') parts.push('order:random');
  if (rating === 'safe') parts.push('rating:s');
  else if (rating === 'questionable') parts.push('rating:q');
  else if (rating === 'explicit') parts.push('rating:e');
  return parts.join(' ');
}

// Sankaku pages with a cursor. Cursors per search are kept so page N follows page N-1; a gap of up to 2 pages is walked.
const cursors = new Map();

export const sankaku = {
  id: 'sankaku',
  label: 'sankaku',
  envKeys: ['SANKAKU_USERNAME', 'SANKAKU_PASSWORD'],
  minGap: 1000,
  localOnly: true,

  configured() { return true; },
  auth(env) { return env.SANKAKU_USERNAME && env.SANKAKU_PASSWORD ? `logged in as ${env.SANKAKU_USERNAME}` : 'public access (no login, some posts have no file)'; },

  async media(raw, request, env, fetchImpl = fetch) {
    const m = REF.exec(String(raw || ''));
    if (!m) return new Response('Bad media URL', { status: 400 });
    const [, md5, kind] = m;
    let res;
    for (let i = 0; i < 2; i++) {
      let hit = urls.get(md5);
      if (!hit || hit.exp - 60e3 < Date.now()) { urls.delete(md5); await lookup(md5, env, fetchImpl); hit = urls.get(md5); }
      if (!hit) return new Response('Post not found on Sankaku', { status: 404 });
      let u; try { u = new URL(hit[kind]); } catch { return new Response('Bad media URL', { status: 502 }); }
      if (u.protocol !== 'https:' || !u.hostname.endsWith('.sankakucomplex.com')) return new Response('Host not allowed', { status: 403 });
      const h = { 'User-Agent': H['User-Agent'], Referer: H.Referer };
      const range = request.headers.get('range'); if (range) h.Range = range;
      res = await fetchImpl(u, { headers: h, signal: request.signal });
      if (!/expired\.png/.test(res.url || '') && res.status !== 403) break;
      res.body?.cancel(); urls.delete(md5); res = null;
    }
    if (!res) return new Response('Sankaku link expired', { status: 502 });
    const out = new Headers({ 'Cache-Control': 'private, max-age=86400' });
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) { const v = res.headers.get(k); if (v) out.set(k, v); }
    return new Response(res.body, { status: res.status, headers: out });
  },

  async search(q, env, fetchImpl = fetch) {
    const tags = buildTags(q), key = `${tags}|${q.limit}`;
    let c = cursors.get(key);
    if (!c || q.page === 0) { c = [null]; cursors.delete(key); cursors.set(key, c); if (cursors.size > 50) cursors.delete(cursors.keys().next().value); }
    // A jump past the known cursors (For You picks random pages) loads the next page in order instead of walking there.
    const start = Math.min(q.page, c.length - 1), want = q.page - start > 2 ? start : q.page;
    let data;
    for (let page = start; page <= want; page++) {
      if (page > 0 && !c[page]) return { posts: [], hasMore: false };
      if (page > start) await sleep(1000);
      console.log(`  [sankaku] page ${page}  tags: ${tags || '(none)'}`);
      data = await call('/v2/posts/keyset', { limit: String(q.limit), tags, ...(c[page] ? { next: c[page] } : {}) }, env, fetchImpl);
      c[page + 1] = data?.meta?.next || '';
    }
    const raw = Array.isArray(data?.data) ? data.data : [];
    raw.forEach(remember);
    let posts = raw.filter(p => p && p.id && p.file_url && /^[0-9a-f]{32}$/i.test(p.md5 || '')).map(normalizePost);
    const hidden = raw.length - posts.length;
    if (q.minScore > 0) posts = posts.filter(p => p.score >= q.minScore);
    if (q.shape === 'portrait') posts = posts.filter(p => p.w / p.h < 1.12);
    else if (q.shape === 'landscape') posts = posts.filter(p => p.w / p.h >= 1.12);
    return { posts, hasMore: !!c[want + 1], hidden };
  },

  // Endpoint taken from what the site's own search box calls; not confirmed against the live API.
  async suggest(text, env, fetchImpl = fetch) {
    const term = cleanTag(text);
    if (term.length < 2) return [];
    let data;
    try { data = await call('/tags/autosuggestCreating', { tag: term }, env, fetchImpl); } catch (e) { if (e.status === 429 || e.status === 401) throw e; return []; }
    const list = Array.isArray(data) ? data : data?.data || [];
    return list.slice(0, 10).map(t => ({ name: String(t.name_en || t.name || t.tagName || '').toLowerCase().replace(/ /g, '_'), count: Number(t.post_count ?? t.count) || 0, type: TAG_TYPES[t.type] || 'general' })).filter(t => t.name);
  }
};

export const _test = { buildTags, normalizePost, idOf };
