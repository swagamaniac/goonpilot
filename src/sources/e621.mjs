
const MAX_PAGE = 750;
const MAX_TAGS_LEN = 2000;

const CATEGORY_BY_NUMBER = { 0: 'general', 1: 'artist', 2: 'artist', 3: 'copyright', 4: 'character', 5: 'species', 6: 'meta', 7: 'meta', 8: 'meta' };
const CATEGORY_BY_NAME = {
  general: 'general', artist: 'artist', contributor: 'artist', director: 'artist', copyright: 'copyright',
  character: 'character', species: 'species', invalid: 'meta', meta: 'meta', lore: 'meta'
};
const ORDER = ['artist', 'character', 'copyright', 'species', 'general', 'meta'];

const cleanTag = (t) => String(t).trim().replace(/\s+/g, '_').slice(0, 200);
// Tags with "ai" as a whole word; every e6ai post is AI, so they carry no signal there.
export const AI_TAG = /(^|[_-])ai([_-]|$)/i;

function buildTags({ include = [], exclude = [], or = [], orGroups = [], sort = 'id', rating = 'all', minScore = 0, shape = 'any', pr = 0.46 }, drop = null) {
  if (drop) { const k = (t) => !drop.test(cleanTag(t)); include = include.filter(k); exclude = exclude.filter(k); or = or.filter(k); orGroups = orGroups.map(g => g.filter(k)); }
  const parts = [...include.map(cleanTag), ...exclude.map(t => '-' + cleanTag(t))].filter(t => t && t !== '-');
  const ors = or.map(cleanTag).filter(Boolean);
  if (ors.length === 1) parts.push(ors[0]);
  else parts.push(...ors.map(t => '~' + t));
  for (const g of orGroups) { const t = g.map(cleanTag).filter(Boolean); if (t.length) parts.push(t.length > 1 ? `( ${t.map(x => '~' + x).join(' ')} )` : t[0]); }
  if (sort === 'score') parts.push('order:score');
  else if (sort === 'popular') parts.push('order:rank');
  else if (sort === 'updated') parts.push('order:updated');
  else if (sort === 'random') parts.push('order:random');
  if (minScore > 0) parts.push(`score:>=${minScore}`);
  if (shape === 'portrait') parts.push('ratio:..1.11'); else if (shape === 'landscape') parts.push('ratio:1.12..');
  if (rating === 'safe') parts.push('rating:s');
  else if (rating === 'questionable') parts.push('rating:q');
  else if (rating === 'explicit') parts.push('rating:e');
  return parts.join(' ').slice(0, MAX_TAGS_LEN);
}

export function makeE621ng({ id, label, site, domain, envPrefix, dropTag = null }) {
  const ENV_USER = `${envPrefix}_USERNAME`, ENV_KEY = `${envPrefix}_API_KEY`;
  const baseUrl = (env) => env[`${envPrefix}_BASE`] || site;
  const viaProxy = (u) => u ? `/api/${id}/media?u=${encodeURIComponent(u)}` : '';

  function headers(env) {
    const who = env[ENV_USER] ? `by ${env[ENV_USER]} on ${label}` : 'personal use';
    const h = { 'User-Agent': `Goonpilot/1.0 (${who})`, Accept: 'application/json', Referer: site + '/' };
    if (env[ENV_USER] && env[ENV_KEY]) h.Authorization = 'Basic ' + btoa(`${env[ENV_USER]}:${env[ENV_KEY]}`);
    return h;
  }

  async function call(url, env, fetchImpl) {
    const res = await fetchImpl(url, { headers: headers(env), signal: AbortSignal.timeout(20000) });
    if (res.status === 503 || res.status === 429) throw Object.assign(new Error(`${label} rate limit reached`), { status: 429 });
    if (res.status === 401) throw Object.assign(new Error(`${label} rejected your username or API key. Check ${ENV_USER} and ${ENV_KEY} in .dev.vars.`), { status: 401 });
    if (res.status === 403) throw Object.assign(new Error(`${label} refused the request (403). It may be blocking this connection.`), { status: 403 });
    let data;
    try { data = await res.json(); } catch { throw Object.assign(new Error(`Unexpected answer from ${label} (${res.status})`), { status: 502 }); }
    if (!res.ok) throw Object.assign(new Error(data?.message || data?.reason || `${label} answered ${res.status}`), { status: res.status >= 500 ? 502 : 400 });
    return data;
  }

  function normalizePost(p) {
    const ext = String(p.file?.ext || '').toLowerCase();
    const type = ext === 'webm' || ext === 'mp4' ? 'video' : ext === 'gif' ? 'gif' : 'image';
    const file = p.file?.url || '';
    let compat = file, mid = '';
    if (type === 'video') {
      const sm = p.sample?.alternates?.samples;
      mid = sm?.['720p']?.url || sm?.['480p']?.url || '';
      const v = p.sample?.alternates?.variants?.mp4?.url;
      if (v) compat = v;
    }
    const tags = [];
    for (const [cat, names] of Object.entries(p.tags || {})) {
      const t = CATEGORY_BY_NAME[cat] || 'general';
      for (const name of names || []) if (!dropTag || !dropTag.test(name)) tags.push({ name, type: t, count: 0 });
    }
    tags.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
    const r = String(p.rating || '');
    return {
      id: Number(p.id),
      md5: /^[0-9a-f]{32}$/i.test(p.file?.md5 || '') ? String(p.file.md5).toLowerCase() : '',
      w: Number(p.file?.width) || 1, h: Number(p.file?.height) || 1,
      type,
      rating: r === 'e' ? 'explicit' : r === 'q' ? 'questionable' : 'safe',
      score: Number(p.score?.total) || 0,
      date: p.created_at && !isNaN(Date.parse(p.created_at)) ? new Date(p.created_at).toISOString() : '',
      file: viaProxy(file),
      compat: viaProxy(compat),
      mid: viaProxy(mid),
      ext,
      sample: viaProxy((p.sample?.has && p.sample?.url) || p.file?.url || ''),
      preview: viaProxy(p.preview?.url || ''),
      tags,
      link: `${site}/posts/${Number(p.id)}`
    };
  }

  return {
    id, label,
    envKeys: [ENV_USER, ENV_KEY],
    minGap: 1000,

    configured() { return true; },
    auth(env) { return env[ENV_USER] && env[ENV_KEY] ? `logged in as ${env[ENV_USER]}` : 'public access (no login)'; },

    async media(raw, request, env, fetchImpl = fetch) {
      let u;
      try { u = new URL(raw); } catch { return new Response('Bad media URL', { status: 400 }); }
      const testBase = env[`${envPrefix}_MEDIA_BASE`] ? new URL(env[`${envPrefix}_MEDIA_BASE`]) : null;
      const allowed = testBase ? u.host === testBase.host
        : (u.protocol === 'https:' && (u.hostname === domain || u.hostname.endsWith('.' + domain)));
      if (!allowed) return new Response('Host not allowed', { status: 403 });
      const h = headers(env); delete h.Accept;
      const range = request.headers.get('range'); if (range) h.Range = range;
      let res = await fetchImpl(u, { headers: h, signal: request.signal });
      if (res.status === 401 || res.status === 403) {
        const q = new URL(u); q.searchParams.set('login', env[ENV_USER] || ''); q.searchParams.set('api_key', env[ENV_KEY] || '');
        res = await fetchImpl(q, { headers: h, signal: request.signal });
      }
      const out = new Headers({ 'Cache-Control': 'private, max-age=86400' });
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
        const v = res.headers.get(k); if (v) out.set(k, v);
      }
      return new Response(res.body, { status: res.status, headers: out });
    },

    async search(q, env, fetchImpl = fetch) {
      const page = q.page + 1;
      if (page > MAX_PAGE) return { posts: [], hasMore: false };
      const url = new URL('/posts.json', baseUrl(env));
      const tags = buildTags(q, dropTag);
      url.search = new URLSearchParams({ tags, limit: String(q.limit), page: String(page) }).toString();
      console.log(`  [${id}] page ${page}  tags: ${tags || '(none)'}`);
      const data = await call(url, env, fetchImpl);
      const raw = Array.isArray(data?.posts) ? data.posts : [];
      const posts = raw.filter(p => p && p.id && p.file?.url).map(normalizePost);
      return { posts, hasMore: raw.length >= q.limit && page < MAX_PAGE, hidden: raw.length - posts.length };
    },

    async exists(text, env, fetchImpl = fetch) {
      const name = cleanTag(text).toLowerCase();
      if (!name) return true;
      const url = new URL('/tags.json', baseUrl(env));
      url.search = new URLSearchParams({ 'search[name]': name, limit: '1' }).toString();
      const data = await call(url, env, fetchImpl);
      return Array.isArray(data) && data.some(t => String(t.name).toLowerCase() === name && Number(t.post_count) > 0);
    },

    async suggest(text, env, fetchImpl = fetch) {
      const term = cleanTag(text);
      if (term.length < 3) return [];
      const url = new URL('/tags/autocomplete.json', baseUrl(env));
      url.search = new URLSearchParams({ 'search[name_matches]': term, expiry: '7' }).toString();
      const data = await call(url, env, fetchImpl);
      if (!Array.isArray(data)) return [];
      return data.slice(0, 10).map(t => ({ name: t.name, count: Number(t.post_count) || 0, type: CATEGORY_BY_NUMBER[t.category] || 'general' }));
    }
  };
}

export const e621 = makeE621ng({ id: 'e621', label: 'e621', site: 'https://e621.net', domain: 'e621.net', envPrefix: 'E621' });
export const e6ai = makeE621ng({ id: 'e6ai', label: 'e6ai', site: 'https://e6ai.net', domain: 'e6ai.net', envPrefix: 'E6AI', dropTag: AI_TAG });

export const _test = { buildTags };
