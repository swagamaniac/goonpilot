// Derpibooru (Philomena). Tags use spaces there; the app uses underscores, so they're swapped on the way in and out.
const SITE = 'https://derpibooru.org';
const ENV_KEY = 'DERPIBOORU_API_KEY';
const EVERYTHING_FILTER = '56027'; // the site's "Everything" filter, so the rating picker decides what shows
const UA = { 'User-Agent': 'Goonpilot/1.0' }; // plain app/version UA, no Referer (what other API clients send)
const CATEGORY = { origin: 'artist', character: 'character', oc: 'character', species: 'species', rating: 'meta', 'content-official': 'copyright' };
const RATINGS = new Set(['safe', 'suggestive', 'questionable', 'explicit', 'semi-grimdark', 'grimdark', 'grotesque']);
const MEDIA = /(^|\.)(derpicdn\.net|derpibooru\.org)$/;

const cleanTag = (t) => String(t).trim().replace(/\s+/g, '_').slice(0, 200);
const term = (t) => { const n = cleanTag(t).replace(/_/g, ' '); return /[(),"\\*?]|\|\||&&/.test(n) ? `"${n.replace(/["\\]/g, '\\$&')}"` : n; };
const tagType = (n) => n.startsWith('artist:') ? 'artist' : n.startsWith('oc:') ? 'character' : RATINGS.has(n) ? 'meta' : 'general';

function buildQuery({ include = [], exclude = [], or = [], orGroups = [], rating = 'all', minScore = 0, shape = 'any' }) {
  const parts = [...include.filter(cleanTag).map(term), ...exclude.filter(cleanTag).map(t => '-' + term(t))];
  for (const g of [or, ...orGroups]) { const t = g.filter(cleanTag).map(term); if (t.length) parts.push(t.length > 1 ? `(${t.join(' || ')})` : t[0]); }
  if (minScore > 0) parts.push(`score.gte:${minScore}`);
  if (shape === 'portrait') parts.push('aspect_ratio.lte:1.11'); else if (shape === 'landscape') parts.push('aspect_ratio.gte:1.12');
  if (rating === 'safe') parts.push('safe'); else if (rating === 'questionable') parts.push('(suggestive || questionable)'); else if (rating === 'explicit') parts.push('explicit');
  return parts.join(', ') || '*';
}

async function call(path, params, env, fetchImpl) {
  const url = new URL(path, SITE);
  url.search = new URLSearchParams({ ...params, ...(env[ENV_KEY] ? { key: env[ENV_KEY] } : {}) }).toString();
  const res = await fetchImpl(url, { headers: { ...UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (res.status === 429 || res.status === 503) throw Object.assign(new Error('Derpibooru rate limit reached'), { status: 429 });
  if (res.headers.get('cf-mitigated') === 'challenge') throw Object.assign(new Error(`Cloudflare blocked the request to Derpibooru (bot check for non-browser apps). Works in a browser, not from the local server.`), { status: 403 });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`Derpibooru refused the request (${res.status}). Check ${ENV_KEY}.`), { status: res.status });
  let data;
  try { data = await res.json(); } catch { throw Object.assign(new Error(`Unexpected answer from Derpibooru (${res.status})`), { status: 502 }); }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Derpibooru answered ${res.status}`), { status: res.status >= 500 ? 502 : 400 });
  return data;
}

const viaProxy = (u) => u ? `/api/derpibooru/media?u=${encodeURIComponent(new URL(u, SITE).href)}` : '';

function normalize(p) {
  const r = p.representations || {}, fmt = String(p.format || '').toLowerCase();
  return {
    id: Number(p.id), md5: '',
    w: Number(p.width) || 1, h: Number(p.height) || 1,
    type: fmt === 'webm' || fmt === 'mp4' ? 'video' : fmt === 'gif' ? 'gif' : 'image',
    rating: p.tags.includes('explicit') ? 'explicit' : p.tags.includes('questionable') || p.tags.includes('suggestive') ? 'questionable' : 'safe',
    score: Number(p.score) || 0,
    date: p.created_at || '',
    file: viaProxy(r.full), sample: viaProxy(r.large || r.full), preview: viaProxy(r.medium || r.thumb),
    tags: p.tags.map(n => ({ name: cleanTag(n), type: tagType(n), count: 0 })),
    link: `${SITE}/images/${Number(p.id)}`
  };
}

export const derpibooru = {
  id: 'derpibooru', label: 'derpibooru',
  envKeys: [ENV_KEY],
  minGap: 1000,
  configured() { return true; },
  auth(env) { return env[ENV_KEY] ? 'API key set' : 'public access (no key)'; },

  async media(raw, request, env, fetchImpl = fetch) {
    let u;
    try { u = new URL(raw); } catch { return new Response('Bad media URL', { status: 400 }); }
    if (u.protocol !== 'https:' || !MEDIA.test(u.hostname)) return new Response('Host not allowed', { status: 403 });
    const h = { ...UA }; const range = request.headers.get('range'); if (range) h.Range = range;
    const res = await fetchImpl(u, { headers: h, signal: request.signal });
    const out = new Headers({ 'Cache-Control': 'private, max-age=86400' });
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) { const v = res.headers.get(k); if (v) out.set(k, v); }
    return new Response(res.body, { status: res.status, headers: out });
  },

  async search(q, env, fetchImpl = fetch) {
    const query = buildQuery(q), per = Math.min(q.limit, 50), page = q.page + 1;
    console.log(`  [derpibooru] page ${q.page}  q: ${query}`);
    const sf = { score: 'score', popular: 'wilson_score', updated: 'updated_at', random: 'random' }[q.sort] || 'created_at';
    const data = await call('/api/v1/json/search/images', { q: query, page: String(page), per_page: String(per), sf, sd: 'desc', filter_id: EVERYTHING_FILTER }, env, fetchImpl);
    const raw = Array.isArray(data?.images) ? data.images : [];
    const ok = raw.filter(p => p && p.id && Array.isArray(p.tags) && p.representations?.full && !p.hidden_from_users && !p.duplicate_of).map(normalize);
    return { posts: ok, hasMore: page * per < (Number(data?.total) || 0), hidden: raw.length - ok.length };
  },

  async suggest(text, env, fetchImpl = fetch) {
    const t = cleanTag(text).replace(/_/g, ' ').replace(/[,*"\\()]/g, '');
    if (t.length < 2) return [];
    let data;
    try { data = await call('/api/v1/json/search/tags', { q: `name:${t}*`, per_page: '10' }, env, fetchImpl); } catch { return []; }
    return (Array.isArray(data?.tags) ? data.tags : []).filter(x => x?.name).sort((a, b) => (b.images || 0) - (a.images || 0))
      .map(x => ({ name: cleanTag(x.name), count: Number(x.images) || 0, type: CATEGORY[x.category] || tagType(x.name) }));
  }
};
