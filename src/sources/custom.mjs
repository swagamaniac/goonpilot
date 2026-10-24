import { makeE621ng } from './e621.mjs';
import { parsePosts, attrs } from './paheal.mjs';

// User-added sites. Request formats follow the built-in adapters: gelbooru = rule34's dapi,
// shimmie = paheal's danbooru-compat XML, e621 = the e621 adapter itself.
export const CUSTOM_TYPES = { gelbooru: 'Gelbooru (like rule34)', shimmie: 'Shimmie (like paheal)', e621: 'e621 / e621ng', danbooru: 'Danbooru', moebooru: 'Moebooru' };

const MAX_TAGS_LEN = 2000;
const TYPE_BY_NUMBER = { 0: 'general', 1: 'artist', 3: 'copyright', 4: 'character', 5: 'meta' };
const cleanTag = (t) => String(t).trim().replace(/\s+/g, '_').slice(0, 200);
const decodeEntities = (s) => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const kind = (u) => { const x = String(u || '').toLowerCase().split('?')[0]; return /\.(mp4|webm)$/.test(x) ? 'video' : x.endsWith('.gif') ? 'gif' : 'image'; };
const rate = (r) => { r = String(r || '').toLowerCase(); return r.startsWith('e') ? 'explicit' : r.startsWith('q') ? 'questionable' : 'safe'; };
const date = (v) => { const n = Number(v); const d = n > 1e8 ? new Date(n * 1000) : new Date(v); return isNaN(d) ? '' : d.toISOString(); };

function buildTags(q, style) {
  const { include = [], exclude = [], or = [], orGroups = [], sort = 'id', rating = 'all', minScore = 0 } = q;
  const parts = [...include.map(cleanTag), ...exclude.map(t => '-' + cleanTag(t))].filter(t => t && t !== '-');
  const group = (t) => t.length < 2 ? t : style === 'gelbooru' ? [`( ${t.join(' ~ ')} )`] : t.map(x => '~' + x);
  parts.push(...group(or.map(cleanTag).filter(Boolean)));
  for (const g of orGroups) parts.push(...group(g.map(cleanTag).filter(Boolean)));
  const sorts = style === 'gelbooru' ? { score: 'sort:score:desc', updated: 'sort:updated:desc', random: 'sort:random' } : { score: 'order:score', updated: 'order:updated', random: 'order:random' };
  if (sorts[sort]) parts.push(sorts[sort]);
  if (minScore > 0) parts.push(`score:>=${minScore}`);
  if (['safe', 'questionable', 'explicit'].includes(rating)) parts.push(style === 'danbooru' ? { safe: 'rating:g,s', questionable: 'rating:q', explicit: 'rating:e' }[rating] : `rating:${rating}`);
  return parts.join(' ').slice(0, MAX_TAGS_LEN);
}

const sameSite = (u, base) => {
  if (u.protocol !== base.protocol) return false;
  const root = base.hostname.split('.').slice(-2).join('.');
  return u.hostname === base.hostname || u.hostname === root || u.hostname.endsWith('.' + root);
};

export function makeCustom({ id, label, base, type }) {
  const prefix = `CUSTOM_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const site = String(base).replace(/\/+$/, ''), baseUrl = new URL(site);
  const extra = { custom: true, type, base: site };
  if (type === 'e621') return { ...makeE621ng({ id, label, site, domain: baseUrl.hostname.split('.').slice(-2).join('.'), envPrefix: prefix }), ...extra };

  const ENV_USER = `${prefix}_USERNAME`, ENV_KEY = `${prefix}_API_KEY`;
  const viaProxy = (u) => { if (!u) return ''; try { return `/api/${id}/media?u=${encodeURIComponent(new URL(u, site + '/').href)}`; } catch { return ''; } };
  const logged = (env) => !!(env[ENV_USER] && env[ENV_KEY]);
  const authParams = (env) => !logged(env) || type === 'shimmie' ? {} : type === 'gelbooru' ? { user_id: env[ENV_USER], api_key: env[ENV_KEY] }
    : type === 'moebooru' ? { login: env[ENV_USER], password_hash: env[ENV_KEY] } : { login: env[ENV_USER], api_key: env[ENV_KEY] };
  const UA = { 'User-Agent': 'Goonpilot/1.0 (personal)' };

  async function call(path, params, env, fetchImpl) {
    const url = new URL(path, site + '/');
    url.search = new URLSearchParams({ ...params, ...authParams(env) }).toString();
    const res = await fetchImpl(url, { headers: { ...UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (res.status === 429 || res.status === 503) throw Object.assign(new Error(`${label} rate limit reached`), { status: 429 });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`${label} refused the request (${res.status}). Check its login in Settings.`), { status: res.status });
    const t = (await res.text()).trim();
    if (!res.ok) throw Object.assign(new Error(`${label} answered ${res.status}`), { status: 502 });
    if (type === 'shimmie') return t;
    if (!t) return [];
    try { return JSON.parse(t); } catch { throw Object.assign(new Error(`${label} did not answer with JSON. Is the API type right?`), { status: 502 }); }
  }

  function normalize(p) {
    const tags = [];
    if (type === 'danbooru') {
      for (const [k, ty] of [['artist', 'artist'], ['character', 'character'], ['copyright', 'copyright'], ['general', 'general'], ['meta', 'meta']])
        for (const n of String(p[`tag_string_${k}`] || '').split(' ').filter(Boolean)) tags.push({ name: n, type: ty, count: 0 });
    } else for (const n of String(p.tags || '').split(' ').filter(Boolean)) tags.push({ name: decodeEntities(n), type: 'general', count: 0 });
    const file = p.file_url || '', md5 = p.md5 || p.hash || '';
    const sample = type === 'danbooru' ? p.large_file_url : p.sample_url;
    return {
      id: Number(p.id),
      md5: /^[0-9a-f]{32}$/i.test(md5) ? md5.toLowerCase() : '',
      w: Number(p.width ?? p.image_width) || 1, h: Number(p.height ?? p.image_height) || 1,
      type: kind(p.file_ext ? '.' + p.file_ext : p.file_name || file),
      rating: rate(p.rating),
      score: Number(p.score) || 0,
      date: date(p.created_at ?? p.change ?? (p.date && String(p.date).replace(' ', 'T') + 'Z')),
      file: viaProxy(file), sample: viaProxy(sample || file), preview: viaProxy(p.preview_url || p.preview_file_url),
      tags,
      link: type === 'gelbooru' ? `${site}/index.php?page=post&s=view&id=${Number(p.id)}` : type === 'moebooru' ? `${site}/post/show/${Number(p.id)}` : type === 'shimmie' ? `${site}/post/view/${Number(p.id)}` : `${site}/posts/${Number(p.id)}`
    };
  }

  return {
    id, label, ...extra,
    envKeys: type === 'shimmie' ? [] : [ENV_USER, ENV_KEY],
    minGap: 1000,
    configured() { return true; },
    auth(env) { return type === 'shimmie' ? 'no login needed' : logged(env) ? 'login set' : 'public access (no login)'; },

    async media(raw, request, env, fetchImpl = fetch) {
      let u;
      try { u = new URL(raw); } catch { return new Response('Bad media URL', { status: 400 }); }
      if (!sameSite(u, baseUrl)) return new Response('Host not allowed', { status: 403 });
      const h = { ...UA }; const range = request.headers.get('range'); if (range) h.Range = range;
      const res = await fetchImpl(u, { headers: h, signal: request.signal });
      const out = new Headers({ 'Cache-Control': 'private, max-age=86400' });
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) { const v = res.headers.get(k); if (v) out.set(k, v); }
      return new Response(res.body, { status: res.status, headers: out });
    },

    async search(q, env, fetchImpl = fetch) {
      const tags = buildTags(q, type);
      console.log(`  [${id}] page ${q.page}  tags: ${tags || '(none)'}`);
      if (type === 'shimmie') {
        // Shimmie's compat API takes plain tags only, like paheal.
        const tags = [...q.include.map(cleanTag), ...q.exclude.map(t => '-' + cleanTag(t))].filter(t => t && t !== '-' && !/^(score|rating|sort|order|ratio):/i.test(t)).join(' ');
        const page = q.page + 1;
        const { count, posts: raw } = parsePosts(await call('api/danbooru/find_posts', { tags, limit: String(q.limit), page: String(page) }, env, fetchImpl));
        const ok = raw.filter(p => p.id && p.file_url).map(normalize);
        return { posts: ok, hasMore: (page - 1) * q.limit + raw.length < count };
      }
      const data = type === 'gelbooru'
        ? await call('index.php', { page: 'dapi', s: 'post', q: 'index', json: '1', limit: String(q.limit), pid: String(q.page), tags }, env, fetchImpl)
        : await call(type === 'moebooru' ? 'post.json' : 'posts.json', { tags, limit: String(q.limit), page: String(q.page + 1) }, env, fetchImpl);
      const raw = Array.isArray(data) ? data : Array.isArray(data?.post) ? data.post : Array.isArray(data?.posts) ? data.posts : null;
      if (!raw) throw Object.assign(new Error(data?.message || `Unexpected answer from ${label}`), { status: 502 });
      const ok = raw.filter(p => p && p.id && p.file_url).map(normalize);
      let posts = ok;
      if (q.shape === 'portrait') posts = posts.filter(p => p.w / p.h < 1.12);
      else if (q.shape === 'landscape') posts = posts.filter(p => p.w / p.h >= 1.12);
      return { posts, hasMore: raw.length >= q.limit, hidden: raw.length - ok.length };
    },

    async suggest(text, env, fetchImpl = fetch) {
      const term = cleanTag(text);
      if (term.length < 2) return [];
      let data;
      try {
        if (type === 'shimmie') {
          const xml = await call('api/danbooru/find_tags', { name: term }, env, fetchImpl), out = [], re = /<tag\b([^>]*?)\/?>/g; let m;
          while ((m = re.exec(xml))) { const a = attrs(m[1]); if (a.name) out.push({ name: a.name, count: Number(a.counts) || 0, type: 'general' }); }
          return out.slice(0, 10);
        }
        data = type === 'gelbooru' ? await call('index.php', { page: 'dapi', s: 'tag', q: 'index', json: '1', name_pattern: term + '%', orderby: 'count', limit: '10' }, env, fetchImpl)
          : type === 'moebooru' ? await call('tag.json', { name: term + '*', order: 'count', limit: '10' }, env, fetchImpl)
          : await call('tags.json', { 'search[name_matches]': term + '*', 'search[order]': 'count', limit: '10' }, env, fetchImpl);
      } catch { return []; }
      const list = Array.isArray(data) ? data : Array.isArray(data?.tag) ? data.tag : [];
      return list.slice(0, 10).map(t => ({ name: decodeEntities(t.name || ''), count: Number(t.count ?? t.post_count) || 0, type: TYPE_BY_NUMBER[t.type ?? t.category] || 'general' })).filter(t => t.name);
    }
  };
}
