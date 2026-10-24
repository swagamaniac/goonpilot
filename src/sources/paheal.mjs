
const BASE = 'https://rule34.paheal.net';
const UA = { 'User-Agent': 'Goonpilot/1.0 (personal)' };

const decodeEntities = (s) => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const cleanTag = (t) => String(t).trim().replace(/\s+/g, '_').slice(0, 200);
const ALIAS_IN = { porkyman: 'pokemon' }, ALIAS_OUT = { pokemon: 'porkyman' };
const NO_META = /^(score|rating|sort|order|aspectratiof?|ratio):/i;

export const viaProxy = (u) => u ? `/api/paheal/media?u=${encodeURIComponent(u)}` : '';

function attrs(s) {
  const o = {}, re = /([a-z0-9_]+)=(?:'([^']*)'|"([^"]*)")/g; let m;
  while ((m = re.exec(s))) o[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
  return o;
}
function parsePosts(xml) {
  const head = /<posts\b([^>]*)>/.exec(xml);
  const count = head ? Number(attrs(head[1]).count) || 0 : 0;
  const posts = [];
  const re = /<post\b([^>]*?)\/?>/g; let m;
  while ((m = re.exec(xml))) posts.push(attrs(m[1]));
  return { count, posts };
}

function normalizePost(p) {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(p.file_name || '') || [])[1]?.toLowerCase() || '';
  const type = ext === 'mp4' || ext === 'webm' ? 'video' : ext === 'gif' ? 'gif' : 'image';
  const seen = new Set(), tags = [];
  for (const n of String(p.tags || '').split(/\s+/)) { const low = n.toLowerCase(), name = ALIAS_IN[low] || low; if (name && !seen.has(name)) { seen.add(name); tags.push({ name, type: 'general', count: 0 }); } }
  const md5 = /^[0-9a-f]{32}$/i.test(p.md5 || '') ? p.md5.toLowerCase() : '';
  return {
    id: Number(p.id), md5,
    w: Number(p.width) || 1, h: Number(p.height) || 1,
    type, ext,
    rating: 'explicit',
    score: 0,
    date: p.date && !isNaN(Date.parse(String(p.date).replace(' ', 'T') + 'Z')) ? new Date(String(p.date).replace(' ', 'T') + 'Z').toISOString() : '',
    file: viaProxy(p.file_url), compat: viaProxy(p.file_url), mid: '',
    sample: viaProxy(p.file_url),
    preview: viaProxy(p.preview_url),
    tags,
    link: `${BASE}/post/view/${Number(p.id)}`
  };
}

const MAX_TAGS = 3;
function pick({ include = [], exclude = [] }) {
  const out = (t) => { const c = cleanTag(t); return ALIAS_OUT[c.toLowerCase()] || c; };
  const inc = include.filter(t => !NO_META.test(t)).map(out).filter(Boolean).slice(0, MAX_TAGS);
  const excAll = exclude.filter(t => !NO_META.test(t)).map(out).filter(Boolean);
  const exc = excAll.slice(0, MAX_TAGS - inc.length);
  return { inc, exc, dropped: excAll.slice(exc.length) };
}
function buildTags(q) {
  const { inc, exc } = pick(q);
  return [...inc, ...exc.map(t => '-' + t)].join(' ').slice(0, 2000);
}

let coolUntil = 0;
async function getXml(url, fetchImpl) {
  if (Date.now() < coolUntil) throw Object.assign(new Error('paheal is rate-limiting us; pausing for 5 minutes'), { status: 429 });
  const res = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (res.status === 403 || res.status === 429) { coolUntil = Date.now() + 300000; throw Object.assign(new Error(`paheal answered ${res.status} (rate limit?); pausing for 5 minutes`), { status: 429 }); }
  if (!res.ok) throw Object.assign(new Error(`paheal answered ${res.status}`), { status: 502 });
  return res.text();
}

export const paheal = {
  id: 'paheal',
  label: 'paheal',
  envKeys: [],
  minGap: 700,
  configured() { return true; },
  auth() { return 'no login needed'; },

  async media(raw, request, env, fetchImpl = fetch) {
    let u;
    try { u = new URL(raw); } catch { return new Response('Bad media URL', { status: 400 }); }
    const h = u.hostname;
    const allowed = u.protocol === 'https:' && (h === 'paheal.net' || h.endsWith('.paheal.net') || h === 'paheal-cdn.net' || h.endsWith('.paheal-cdn.net'));
    if (!allowed) return new Response('Host not allowed', { status: 403 });
    const hd = { ...UA }; const range = request.headers.get('range'); if (range) hd.Range = range;
    const res = await fetchImpl(u, { headers: hd, signal: request.signal });
    const out = new Headers({ 'Cache-Control': 'private, max-age=86400' });
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) { const v = res.headers.get(k); if (v) out.set(k, v); }
    return new Response(res.body, { status: res.status, headers: out });
  },

  async search(q, env, fetchImpl = fetch) {
    if (q.rating === 'safe' || q.rating === 'questionable') return { posts: [], hasMore: false };
    const page = q.page + 1, limit = Math.min(q.limit, 100);
    const url = new URL('/api/danbooru/find_posts', env.PAHEAL_BASE || BASE);
    const tags = buildTags(q);
    url.search = new URLSearchParams({ tags, limit: String(limit), page: String(page) }).toString();
    console.log(`  [paheal] page ${page}  tags: ${tags || '(none)'}`);
    const { count, posts: raw } = parsePosts(await getXml(url, fetchImpl));
    let posts = raw.filter(p => p.id && p.file_url).map(normalizePost);
    const drop = new Set(pick(q).dropped.map(t => (ALIAS_IN[t.toLowerCase()] || t).toLowerCase()));
    if (drop.size) posts = posts.filter(p => !p.tags.some(t => drop.has(t.name)));
    if (q.shape === 'portrait') posts = posts.filter(p => p.w / p.h < 1.12);
    else if (q.shape === 'landscape') posts = posts.filter(p => p.w / p.h >= 1.12);
    return { posts, hasMore: (page - 1) * limit + raw.length < count };
  },

  async suggest(text, env, fetchImpl = fetch) {
    const c0 = cleanTag(text), name = ALIAS_OUT[c0.toLowerCase()] || c0;
    if (!name) return [];
    const url = new URL('/api/danbooru/find_tags', env.PAHEAL_BASE || BASE);
    url.search = new URLSearchParams({ name }).toString();
    const xml = await getXml(url, fetchImpl), out = [], re = /<tag\b([^>]*?)\/?>/g; let m;
    while ((m = re.exec(xml))) { const a = attrs(m[1]); if (a.name) out.push({ name: ALIAS_IN[a.name.toLowerCase()] || a.name, count: Number(a.counts) || 0, type: 'general' }); }
    return out.slice(0, 10);
  }
};

export { parsePosts, attrs };
export const _test = { buildTags, normalizePost, parsePosts };
