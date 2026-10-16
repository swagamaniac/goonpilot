
const MAX_TAGS_LEN = 2000;

const TAG_TYPES = {
  artist: 'artist', character: 'character', copyright: 'copyright',
  metadata: 'meta', meta: 'meta', general: 'general', tag: 'general'
};

const decodeEntities = (s) => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const cleanTag = (t) => String(t).trim().replace(/\s+/g, '_').slice(0, 200);

function postType(url) {
  const u = String(url || '').toLowerCase().split('?')[0];
  if (u.endsWith('.mp4') || u.endsWith('.webm')) return 'video';
  if (u.endsWith('.gif')) return 'gif';
  return 'image';
}

export const viaProxy = (u) => u ? `/api/rule34/media?u=${encodeURIComponent(u)}` : '';
const isDirect = (u) => /^https:\/\/([a-z0-9-]+\.)*rule34\.xxx\//i.test(String(u || ''));
export const proxifyPost = (p) => p && { ...p, file: isDirect(p.file) ? viaProxy(p.file) : p.file, sample: isDirect(p.sample) ? viaProxy(p.sample) : p.sample, preview: isDirect(p.preview) ? viaProxy(p.preview) : p.preview };

function normalizePost(p) {
  const tags = Array.isArray(p.tag_info) && p.tag_info.length
    ? p.tag_info.map(t => ({ name: decodeEntities(t.tag), type: TAG_TYPES[t.type] || 'general', count: Number(t.count) || 0 }))
    : String(p.tags || '').split(' ').filter(Boolean).map(n => ({ name: decodeEntities(n), type: 'general', count: 0 }));
  const r = String(p.rating || '').toLowerCase();
  return {
    id: Number(p.id),
    md5: /^[0-9a-f]{32}$/i.test(p.hash || '') ? String(p.hash).toLowerCase() : '',
    w: Number(p.width) || 1, h: Number(p.height) || 1,
    type: postType(p.file_url),
    rating: r.startsWith('e') ? 'explicit' : r.startsWith('q') ? 'questionable' : 'safe',
    score: Number(p.score) || 0,
    date: Number(p.change) > 1e8 ? new Date(Number(p.change) * 1000).toISOString() : '',
    file: viaProxy(p.file_url),
    sample: viaProxy(p.sample_url || p.file_url),
    preview: viaProxy(p.preview_url),
    tags,
    link: `https://rule34.xxx/index.php?page=post&s=view&id=${Number(p.id)}`
  };
}

function buildTags({ include = [], exclude = [], or = [], orGroups = [], sort = 'id', rating = 'all', minScore = 0, shape = 'any' }) {
  const parts = [...include.map(cleanTag), ...exclude.map(t => '-' + cleanTag(t))].filter(t => t && t !== '-');
  const ors = or.map(cleanTag).filter(Boolean);
  if (ors.length === 1) parts.push(ors[0]);
  else if (ors.length > 1) parts.push(`( ${ors.join(' ~ ')} )`);
  for (const g of orGroups) { const t = g.map(cleanTag).filter(Boolean); if (t.length) parts.push(t.length > 1 ? `( ${t.join(' ~ ')} )` : t[0]); }
  if (sort === 'score') parts.push('sort:score:desc');
  else if (sort === 'updated') parts.push('sort:updated:desc');
  else if (sort === 'random') parts.push('sort:random');
  if (minScore > 0) parts.push(`score:>=${minScore}`);
  if (['safe', 'questionable', 'explicit'].includes(rating)) parts.push(`rating:${rating}`);
  return parts.join(' ').slice(0, MAX_TAGS_LEN);
}

async function readJson(res) {
  const text = await res.text();
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith('<')) {
    const m = /reason="([^"]+)"/.exec(t) || /<message>([^<]+)</.exec(t);
    throw Object.assign(new Error(m ? m[1] : 'rule34 returned XML instead of JSON'), { status: 502 });
  }
  try { return JSON.parse(t); }
  catch { throw Object.assign(new Error(t.slice(0, 200)), { status: 502 }); }
}

export const rule34 = {
  id: 'rule34',
  label: 'rule34',
  envKeys: ['RULE34_API_KEY', 'RULE34_USER_ID'],

  minGap: 600,
  configured() { return true; },
  auth(env) { return env.RULE34_API_KEY && env.RULE34_USER_ID ? 'API key' : 'public access (no API key)'; },

  async media(raw, request, env, fetchImpl = fetch) {
    let u;
    try { u = new URL(raw); } catch { return new Response('Bad media URL', { status: 400 }); }
    const testBase = env.RULE34_MEDIA_BASE ? new URL(env.RULE34_MEDIA_BASE) : null;
    const allowed = testBase ? u.host === testBase.host : (u.protocol === 'https:' && (u.hostname === 'rule34.xxx' || u.hostname.endsWith('.rule34.xxx')));
    if (!allowed) return new Response('Host not allowed', { status: 403 });
    const h = { 'User-Agent': 'Goonpilot/1.0 (personal)' };
    const range = request.headers.get('range'); if (range) h.Range = range;
    const res = await fetchImpl(u, { headers: h, signal: request.signal });
    const out = new Headers({ 'Cache-Control': 'private, max-age=86400' });
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) { const v = res.headers.get(k); if (v) out.set(k, v); }
    return new Response(res.body, { status: res.status, headers: out });
  },

  async search(q, env, fetchImpl = fetch) {
    const base = env.RULE34_BASE || 'https://api.rule34.xxx';
    const url = new URL('/index.php', base);
    url.search = new URLSearchParams({
      page: 'dapi', s: 'post', q: 'index', json: '1', fields: 'tag_info',
      limit: String(q.limit), pid: String(q.page),
      tags: buildTags(q),
      ...(env.RULE34_API_KEY && env.RULE34_USER_ID ? { api_key: env.RULE34_API_KEY, user_id: env.RULE34_USER_ID } : {})
    }).toString();
    console.log(`  [rule34] page ${q.page}  tags: ${buildTags(q) || '(none)'}`);
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'Goonpilot/1.0 (personal)' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw Object.assign(new Error(`rule34 answered ${res.status}`), { status: res.status === 429 ? 429 : 502 });
    const data = await readJson(res);
    if (!Array.isArray(data)) throw Object.assign(new Error(data && data.message ? data.message : 'Unexpected answer from rule34'), { status: 502 });
    let posts = data.filter(p => p && p.id && p.file_url).map(normalizePost);
    if (q.shape === 'portrait') posts = posts.filter(p => p.w / p.h < 1.12);
    else if (q.shape === 'landscape') posts = posts.filter(p => p.w / p.h >= 1.12);
    return { posts, hasMore: data.length >= q.limit };
  },

  async suggest(text, env, fetchImpl = fetch) {
    const base = env.RULE34_BASE || 'https://api.rule34.xxx';
    const url = new URL('/autocomplete.php', base);
    url.searchParams.set('q', cleanTag(text));
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'Goonpilot/1.0 (personal)' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw Object.assign(new Error(`rule34 answered ${res.status}`), { status: res.status === 429 ? 429 : 502 });
    const data = await readJson(res);
    if (!Array.isArray(data)) return [];
    return data.slice(0, 10).map(s => {
      const label = String(s.label || ''), m = /\((\d+)\)\s*$/.exec(label);
      return { name: decodeEntities(s.value || ''), count: m ? Number(m[1]) : 0, type: TAG_TYPES[s.type] || 'general' };
    }).filter(s => s.name);
  }
};

export const _test = { buildTags, normalizePost, postType };
