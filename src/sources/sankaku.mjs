// Sankaku (chan.sankakucomplex.com / sankaku.app). Experimental on Pages: the API may check Origin and the CDN Referer,
// which a browser can't set.
// Media URLs from the API are signed and expire, so posts carry stable proxy refs (sankaku:<md5>:<kind>) that the
// media route turns into a fresh CDN URL, from the last search when possible, otherwise with one md5 lookup.
const API = 'https://sankakuapi.com';
const SITE = 'https://sankaku.app';
const LINK = 'https://chan.sankakucomplex.com/posts/';
const H = { 'User-Agent': 'Goonpilot/1.0 (personal)', Accept: 'application/vnd.sankaku.api+json;v=2', Origin: SITE, Referer: SITE + '/' };

const TAG_TYPES = { 0: 'general', 1: 'artist', 2: 'artist', 3: 'copyright', 4: 'character', 5: 'general', 8: 'meta', 9: 'meta' };
const ORDER = ['artist', 'character', 'copyright', 'species', 'general', 'meta'];
// Tag name -> 's' (G) | 'q' (R15+) | 'e' (R18+). Filled from tag objects that carry a `rating` field (unconfirmed for post lists and autosuggest) and
// from For you queries the server rejected with _tags-explicit-limit (the tag dropped to fix it is remembered as 'q'). Memory only, resets on restart.
const HEAVY = new Set(['dragon', 'scalie', 'furry', 'monster', 'mythological_scalie']); // probes: any two of these in one query give _tags-explicit-limit
const tagRating = new Map([...HEAVY].map(t => [t, 'q']));
function noteRating(t, name) {
  // The tag object's own rating is the primary signal (e = R18+, q = R15+, s = G) and overrides the seeded and learned guesses; null/missing leaves them alone.
  const r = typeof t?.rating === 'string' ? t.rating.trim().toLowerCase()[0] : '';
  if (!r) return;
  for (const nm of [name, t.tagName, t.name_en]) { const n = String(nm || '').toLowerCase().replace(/ /g, '_'); if (n) tagRating.set(n, r === 'g' ? 's' : r); }
}
const REF = /^sankaku:([0-9a-f]{32}):(file|sample|preview)$/;

const cleanTag = (t) => String(t).trim().replace(/\s+/g, '_').slice(0, 200);
const viaProxy = (md5, kind) => `/api/sankaku/media?u=${encodeURIComponent(`sankaku:${md5}:${kind}`)}`;
const err = (msg, status) => Object.assign(new Error(msg), { status });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ON_PAGES = typeof ServiceWorkerGlobalScope !== 'undefined';

// Login token, kept in memory and tied to the login it came from.
let token = null;
let loginFailed = null; // { who, msg } after a rejected login, so the UI can warn instead of looking like guest access
const LOGIN_MSG = 'Sankaku rejected your login, so searches are NOT using your account. Check SANKAKU_USERNAME and SANKAKU_PASSWORD (Settings, site keys).';
async function login(env, fetchImpl) {
  const who = `${env.SANKAKU_USERNAME}\n${env.SANKAKU_PASSWORD}`;
  if (token?.who === who) return token.value;
  const res = await fetchImpl(API + '/auth/token', {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: env.SANKAKU_USERNAME, password: env.SANKAKU_PASSWORD }), signal: AbortSignal.timeout(20000)
  });
  let data; try { data = await res.json(); } catch {}
  if (!res.ok || !data?.success || !data.access_token) { loginFailed = { who }; throw err(LOGIN_MSG, 401); }
  loginFailed = null;
  token = { who, value: 'Bearer ' + data.access_token };
  return token.value;
}

async function call(path, params, env, fetchImpl, retry = true, hdr = {}) {
  const url = new URL(path, API);
  url.search = new URLSearchParams({ lang: 'en', ...params }).toString();
  const h = { ...H, ...hdr };
  if (env.SANKAKU_USERNAME && env.SANKAKU_PASSWORD) h.Authorization = await login(env, fetchImpl);
  const res = await fetchImpl(url, { headers: h, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (res.status === 429) {
    if (text.includes('_tags-explicit-limit')) throw Object.assign(err('Too many tags for Sankaku on this account: use fewer tags.', 400), { tagLimit: true });
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    throw err(`Sankaku rate limit reached${reset > 1e9 ? `, try again after ${new Date(reset * 1000).toLocaleTimeString()}` : ''}`, 429);
  }
  let data = null; try { data = JSON.parse(text); } catch {}
  const code = String(data?.code || '');
  if (res.status === 401 || /(unauthorized|invalid[-_]token)$/.test(code)) {
    if (token && retry) { token = null; return call(path, params, env, fetchImpl, false, hdr); }
    loginFailed = { who: `${env.SANKAKU_USERNAME}\n${env.SANKAKU_PASSWORD}` };
    throw err(LOGIN_MSG, 401);
  }
  const opHint = res.status >= 500 && /(^|\s)(~|[^\s]*\*)/.test(params.tags || '') ? ' (too many ~ or * tags? try fewer)' : '';
  if (!data) throw Object.assign(err(`Unexpected answer from Sankaku (${res.status})${opHint}`, res.status === 403 ? 403 : 502), { http: res.status });
  if (!res.ok || data?.success === false) throw Object.assign(err(`Sankaku: ${code.split('__').pop().replace(/[-_]/g, ' ') || res.status}${opHint}`, res.status >= 500 ? 502 : 400), { http: res.status });
  return data;
}

// Opt-in favorite sync: POST adds, DELETE removes the post from the logged-in account's favorites. `id` is Sankaku's own
// post id string (from the post link). Single attempt, no retry; the caller must not let a failure here affect anything local.
async function favorite(id, on, env, fetchImpl = fetch) {
  if (!/^[A-Za-z0-9]{3,32}$/.test(String(id))) throw err('Bad Sankaku post id', 400);
  if (!(env.SANKAKU_USERNAME && env.SANKAKU_PASSWORD)) throw err('Not logged in to Sankaku', 401);
  const send = async () => fetchImpl(`${API}/posts/${id}/favorite?lang=en`, {
    method: on ? 'POST' : 'DELETE', headers: { ...H, Authorization: await login(env, fetchImpl) }, signal: AbortSignal.timeout(20000)
  });
  let res = await send();
  if (res.status === 401 && token) { token = null; res = await send(); } // expired token: log in once more
  res.body?.cancel?.();
  if (!res.ok) throw err(`Sankaku favorite ${on ? 'add' : 'remove'} failed (${res.status})`, res.status);
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
    .map(t => (noteRating(t, t.name_en || t.name || t.tagName), t)).map(t => ({ name: t.name_en || t.name || t.tagName, type: TAG_TYPES[t.type] || 'general', count: Number(t.post_count ?? t.count) || 0 }));
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

// Outgoing-request rewrite only: plain 'audio'/'sound' mean Sankaku's has_audio tag.
const sankakuTerm = (t) => { const c = cleanTag(t); return /^(audio|sound)$/i.test(c) ? 'has_audio' : c; };

function buildTags({ include = [], exclude = [], or = [], orGroups = [], sort = 'id', rating = 'all', forYou = false }, level = 0) {
  const parts = [...include.map(sankakuTerm), ...exclude.map(t => '-' + sankakuTerm(t))].filter(t => t && t !== '-');
  const groups = [or, ...orGroups].map(g => g.map(sankakuTerm).filter(Boolean)).filter(g => g.length);
  for (const g of groups) parts.push(...(g.length > 1 ? g.map(t => '~' + t) : g));
  // Measured Sankaku limits: 7 plain tags and 2 ~ (or) tags (no confirmed cap on - or *). Extras are dropped from the end
  // (your own tags come before blocklist excludes), so a search never fails with "too many tags".
  let plain = 0, tildes = 0;
  const kept = parts.filter(t => (t[0] === '~' ? ++tildes <= 2 : /^-|\*/.test(t) ? true : ++plain <= 7));
  if (kept.length < parts.length) console.log(`  [sankaku] over the tag limit (7 plain, 2 ~): dropped ${parts.filter(t => !kept.includes(t)).join(' ')}`);
  // For you only: at most 2 ~ or * tags combined (- excludes are not counted: 5 of them worked on the site), to stay clear of Sankaku's server errors.
  // Fallback levels (used by search() after a 500): 1 = no - excludes, 2 = also no ~ or * tags.
  if (forYou) {
    let ops = 0;
    let capped = kept.filter(t => level >= 2 && /^~|\*/.test(t) ? false : level >= 1 && t[0] === '-' ? false : (/^~|\*/.test(t) ? ++ops <= 2 : true));
    // Free account: 9 tags in total, and at most 2 of them R15+/R18+ rated (else 429 _tags-explicit-limit). Plain tags known (or learned) to be rated go last and only 2 are kept;
    // operators and colon tags are unrated but count toward the 9. Anything past 9 is dropped from the end (ors, then excludes).
    // Probe: rated tags count in excludes too (`piledriver -dragon -scalie` fails), so - and ~ tags are checked by their bare name; plain tags (own search) take the 2 slots first.
    const isPlain = t => !/^[~-]|\*|:/.test(t), rated = t => !/\*|:/.test(t) && /^[qe]$/.test(tagRating.get(t.replace(/^[~-]/, '').toLowerCase()) || '');
    // Probe: any two of the heavy tags fail together, so only the first one (own search first) is kept per query.
    let heavy = 0; capped = capped.filter(t => !HEAVY.has(t.replace(/^[~-]/, '').toLowerCase()) || ++heavy <= 1);
    let nr = 0; const plains = capped.filter(isPlain);
    capped = [...plains.filter(t => !rated(t)), ...plains.filter(rated).filter(() => ++nr <= 2), ...capped.filter(t => !isPlain(t)).filter(t => !rated(t) || ++nr <= 2)].slice(0, 9);
    // Level 3+: also drop plain tags from the end, one more per level, always keeping the first one.
    for (let n = level - 2, i = capped.length - 1; n > 0 && i > 0; i--) if (!/^[~-]|\*/.test(capped[i])) { capped.splice(i, 1); n--; }
    if (capped.length < kept.length) console.log(`  [sankaku] For you ${level ? `fallback ${level}` : 'operand cap (2 of ~ *)'}: dropped ${kept.filter(t => !capped.includes(t)).join(' ')}`);
    kept.splice(0, kept.length, ...capped);
  }
  parts.splice(0, parts.length, ...kept);
  if (sort === 'score') parts.push('order:quality');
  else if (sort === 'popular') parts.push('order:popularity');
  else if (sort === 'random') parts.push('order:random');
  else if (sort === 'updated') parts.push('order:change_desc');
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

  configured() { return true; },
  favorite,
  auth(env) {
    if (loginFailed?.who === `${env.SANKAKU_USERNAME}\n${env.SANKAKU_PASSWORD}`) return 'Login failed: ' + LOGIN_MSG;
    const who = env.SANKAKU_USERNAME && env.SANKAKU_PASSWORD ? `logged in as ${env.SANKAKU_USERNAME}` : 'public access (no login, some posts have no file)';
    return ON_PAGES ? who + '. Experimental in the web version, may not load: the local server is more reliable' : who;
  },

  async media(raw, request, env, fetchImpl = fetch) {
    const m = REF.exec(String(raw || ''));
    if (!m) return new Response('Bad media URL', { status: 400 });
    console.log(`  [sankaku] media ${String(raw).slice(8, 16)} requested`);
    const [, md5, kind] = m;
    let res;
    for (let i = 0; i < 2; i++) {
      let hit = urls.get(md5);
      if (!hit || hit.exp - 60e3 < Date.now()) {
        console.log(`  [sankaku] ${md5.slice(0, 8)} ${kind}: ${hit ? `link expires in ${Math.round((hit.exp - Date.now()) / 1000)}s` : 'not cached'}, md5 lookup (${lookups.size} queued)`);
        urls.delete(md5); const t0 = Date.now(); await lookup(md5, env, fetchImpl); hit = urls.get(md5);
        console.log(`  [sankaku] ${md5.slice(0, 8)} lookup done in ${Date.now() - t0}ms${hit ? '' : ', not found'}`);
      }
      if (!hit) return new Response('Post not found on Sankaku', { status: 404 });
      let u; try { u = new URL(hit[kind]); } catch { return new Response('Bad media URL', { status: 502 }); }
      if (u.protocol !== 'https:' || !u.hostname.endsWith('.sankakucomplex.com')) return new Response('Host not allowed', { status: 403 });
      if (ON_PAGES) return Response.redirect(u.href, 302);
      const h = { 'User-Agent': H['User-Agent'], Referer: H.Referer };
      const range = request.headers.get('range'); if (range) h.Range = range;
      const t1 = Date.now();
      res = await fetchImpl(u, { headers: h, signal: request.signal });
      if (Date.now() - t1 > 3000) console.log(`  [sankaku] ${md5.slice(0, 8)} ${kind}: CDN took ${Date.now() - t1}ms to answer (${res.status})`);
      if (/expired\.png/.test(res.url || '')) console.log(`  [sankaku] ${md5.slice(0, 8)} ${kind}: CDN says link expired, retrying`);
      if (!/expired\.png/.test(res.url || '') && res.status !== 403) break;
      res.body?.cancel(); urls.delete(md5); res = null;
    }
    if (!res) return new Response('Sankaku link expired', { status: 502 });
    const out = new Headers({ 'Cache-Control': 'private, max-age=86400' });
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) { const v = res.headers.get(k); if (v) out.set(k, v); }
    return new Response(res.body, { status: res.status, headers: out });
  },

  async search(q, env, fetchImpl = fetch) {
    // Sankaku For you (read-only, nothing is sent back): 'feed' = the site's For You feed, tags and excludes still apply like on the site;
    // 'user' = the recommended_for:<username> tag (a separate, favs/votes-based recommender).
    if (q.forYou) for (const n of q.rated || []) if (!tagRating.has(n)) tagRating.set(n, 'q'); // learned list kept per profile by For you
    const base = buildTags(q), forUser = q.recommend === 'user' && env.SANKAKU_USERNAME && !/(^|\s)recommended_for/.test(base) ? `recommended_for:${cleanTag(env.SANKAKU_USERNAME)}` : '';
    const tags = [forUser, base].filter(Boolean).join(' '), rec = q.recommend === 'feed', key = `${rec ? 'rec|' : ''}${tags}|${q.limit}`;
    let c = cursors.get(key);
    if (!c || q.page === 0) { c = [null]; cursors.delete(key); cursors.set(key, c); if (cursors.size > 50) cursors.delete(cursors.keys().next().value); }
    // A jump past the known cursors (For You picks random pages) loads the next page in order instead of walking there.
    const start = Math.min(q.page, c.length - 1), want = q.page - start > 2 ? start : q.page;
    let data;
    for (let page = start; page <= want; page++) {
      if (page > 0 && !c[page]) return { posts: [], hasMore: false };
      if (page > start) await sleep(1000);
      let failedTg = null;
      for (;;) {
        // For you only: after a 500 the same search is retried with fewer operands (level 1: no - excludes, level 2: also no ~ or *); the level sticks for this search's later pages.
        const lv = c.level || 0, tg = lv ? [forUser, buildTags(q, lv)].filter(Boolean).join(' ') : tags;
        console.log(`  [sankaku] page ${page}  ${rec ? 'for you ' : ''}tags: ${tg || '(none)'}`);
        try {
          // Same extra parameters the site's own search sends (default_threshold 2, hide_posts_in_books in-larger-tags); Settings can lower the threshold to 0 and hide book pages always. pool:/fav: searches skip the book filter.
          data = await call('/v2/posts/keyset', { limit: String(q.limit), ...(tg ? { tags: tg } : {}), ...(rec ? { is_recommendation: 'true', page: String(page + 1) } : {}), default_threshold: String(q.threshold ?? 2), ...(/(^|\s)(pool|fav):/.test(tg) ? {} : { hide_posts_in_books: q.books === 'always' ? 'always' : 'in-larger-tags' }), ...(c[page] && c[page] !== '-' ? { next: c[page] } : {}) }, env, fetchImpl, true, rec ? { 'X-Sankaku-Capabilities': 'recommendation-context-v2' } : {});
          // A plain tag dropped by the step that fixed a tag-limit rejection is probably a rated one: remember it so later For you queries put it last / skip it.
          if (failedTg) for (const t of failedTg.split(' ')) if (!tg.split(' ').includes(t) && !/^[~-]|\*|:/.test(t) && !tagRating.has(t.toLowerCase())) { tagRating.set(t.toLowerCase(), 'q'); q.onRated?.(t.toLowerCase()); console.log(`  [sankaku] learned as rated: ${t}`); }
          break;
        } catch (e) {
          if (e.tagLimit) failedTg = tg;
          if (!q.forYou || !(e.http >= 500 || e.tagLimit)) throw e;
          // Step down: no - excludes, then no ~/*, then one fewer plain tag per step. Steps that would send the same tags are skipped.
          let next = lv, nt = tg;
          while (nt === tg && next < 14) { next++; nt = [forUser, buildTags(q, next)].filter(Boolean).join(' '); }
          if (nt === tg) throw e;
          c.level = next; console.log(`  [sankaku] For you query rejected (${e.tagLimit ? 'tag limit' : e.http}), retrying with fewer tags (level ${next})`);
        }
      }
      // The For You feed can end its cursor while more pages exist; the site keeps going as long as a page has posts ('-' = page number only).
      c[page + 1] = data?.meta?.next || (rec && data?.data?.length ? '-' : '');
    }
    const raw = Array.isArray(data?.data) ? data.data : [];
    const life = raw[0]?.file_url ? Math.round((expiry(String(raw[0].file_url)) - Date.now()) / 1000) : null;
    console.log(`  [sankaku] got ${raw.length} posts, ${raw.filter(p => !p?.file_url).length} without file${life !== null ? `, links valid ${life}s` : ''}`);
    raw.forEach(remember);
    let posts = raw.filter(p => p && p.id && p.file_url && /^[0-9a-f]{32}$/i.test(p.md5 || '')).map(normalizePost);
    const hidden = raw.length - posts.length;
    console.log(`  [sankaku] kept ${posts.length}/${raw.length}${hidden ? ` (dropped: ${raw.filter(p => !p?.id).length} no id, ${raw.filter(p => !/^[0-9a-f]{32}$/i.test(p?.md5 || '')).length} bad md5, e.g. md5=${JSON.stringify(String(raw.find(p => !/^[0-9a-f]{32}$/i.test(p?.md5 || ''))?.md5 ?? 'none').slice(0, 40))})` : ''}`);
    // After a fallback the dropped - excludes are applied here instead, so blocked tags don't leak through.
    if (q.forYou && q.exclude?.length) {
      const res = q.exclude.map(sankakuTerm).filter(Boolean).map(t => new RegExp('^' + t.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
      const before = posts.length;
      posts = posts.filter(p => !(p.tags || []).some(t => res.some(r => r.test(String(t.name ?? t).toLowerCase()))));
      if (posts.length < before) console.log(`  [sankaku] fallback: ${before - posts.length} posts removed client-side by excludes`);
    }
    if (q.shape === 'portrait') posts = posts.filter(p => p.w / p.h < 1.12);
    else if (q.shape === 'landscape') posts = posts.filter(p => p.w / p.h >= 1.12);
    // Guard: stop after 3 pages in a row that leave nothing to show, so a broken filter can't page through the whole site.
    c.empty = posts.length ? 0 : (c.empty || 0) + 1;
    if (c.empty >= 20) console.log('  [sankaku] 20 empty pages in a row, stopping this search');
    return { posts, hasMore: !!c[want + 1] && c.empty < 20, hidden };
  },

  // Endpoint taken from what the site's own search box calls; not confirmed against the live API.
  async suggest(text, env, fetchImpl = fetch) {
    const term = cleanTag(text);
    if (term.length < 2) return [];
    let data;
    try { data = await call('/tags/autosuggestCreating', { tag: term }, env, fetchImpl); } catch (e) { if (e.status === 429 || e.status === 401) throw e; return []; }
    const list = Array.isArray(data) ? data : data?.data || [];
    list.slice(0, 10).forEach(t => noteRating(t, t.name_en || t.name || t.tagName));
    return list.slice(0, 10).map(t => ({ name: String(t.name_en || t.name || t.tagName || '').toLowerCase().replace(/ /g, '_'), count: Number(t.post_count ?? t.count) || 0, type: TAG_TYPES[t.type] || 'general' })).filter(t => t.name);
  }
};

export const _test = { buildTags, normalizePost, idOf };
