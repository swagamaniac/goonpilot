import { AI_TAG } from './sources/e621.mjs';

const DAY = 86400000;
const HALF_LIFE = Infinity;
const SESSION_IDLE = 15 * 60e3, SESSION_HALF = 5 * 60e3, MAX_SESSION_W = 0.25;
const CAT_W = { boost: 2, character: 2.5, artist: 2, copyright: 2, species: 1.5, general: 0.4, ai: 0.3, meta: 0 };
const STRATS = ['anchor', 'pivot', 'reach', 'wildcard'];
const LABELS = { anchor: 'Close to your likes', pivot: 'Next to your likes', reach: 'Reaching a bit further', wildcard: 'Wildcard', popular: 'Popular pick (starter)' };
const MAX_VOTES = 20000, MAX_SEEN = 8000, MAX_TAGSEEN = 30000;

export const GENERIC_R34 = ['nipples', 'penis', 'pussy', 'ass', 'balls', 'thighs', 'thick_thighs', 'navel', 'anus', 'tongue', 'tongue_out', 'big_penis', 'big_breasts', 'huge_breasts', 'big_ass',
  'wide_hips', 'genitals', 'erection', 'testicles', 'areola', 'nude', 'blush', 'blonde_hair', 'black_hair', 'brown_hair', 'blue_eyes', 'smile', 'open_mouth', 'clothing', 'sweat', 'fur', 'tail',
  'hair', 'sex', 'cum', 'anal', 'penetration', 'vaginal_penetration', 'spread_legs', '1girls', '1boy', 'male_only', 'female_only', 'straight', 'censored', 'light-skinned_female', 'light_skin'];
export const DEFAULT_IGNORED = [
  '1girl', '1boy', '2girls', '2boys', 'multiple_girls', 'multiple_boys', 'solo', 'duo', 'trio', 'group', 'solo_focus',
  'comic', 'monochrome', 'greyscale', 'text', 'english_text', 'commentary', 'translated', 'check_commentary',
  'highres', 'absurdres', 'hi_res', 'absurd_res', 'tagme', 'animated', 'sound', 'sound_edit', 'no_sound', 'video', 'webm', 'mp4',
  'long_video', 'short_playtime', 'loop', '3d_(artwork)', 'digital_media_(artwork)', 'simple_background', 'looking_at_viewer', 'looking_at_another',
  'original', 'photo', 'parody', 'duplicate', 'unknown_artist', 'anonymous_artist', 'source_request', 'artist_request', 'character_request',
  'copyright_request', 'cosplay_request', 'check_character', 'spoiler', 'scenery',
  'female', 'male', 'human', 'mammal', 'long_hair', 'short_hair', 'breasts', 'large_breasts',
  ...GENERIC_R34
];
function makeIgnore(list) {
  const exact = new Set(), wild = [];
  for (const x of list) { if (x.includes('*')) wild.push(new RegExp('^' + x.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')); else exact.add(x); }
  return { has: (n) => exact.has(n) || wild.some(r => r.test(n)) };
}
const PAHEAL_KEEP_IGNORED = new Set(['animated', 'video', 'tagme', 'gif', 'mp4', 'webm']);
const SCORE_RULE = /^score:(>=?)(\d{1,6})$/;
export const DEFAULT_WEIGHTS = { like: 1, dislike: 1, superLike: 3, superDislike: 3, dive: 1 };
export const DEFAULT_PREFS = { mode: 'balanced', media: 'all', blacklist: [], whitelist: [], ignoreCharacters: false, ignoreCopyright: false, ignoreArtists: false, ignoreSpecies: false, minScore: {}, boost: {}, boostType: {}, weights: { ...DEFAULT_WEIGHTS }, genericV1: true, ignored: DEFAULT_IGNORED };
const MODES = { balanced: { cut: 0.6, every: 4 }, comfort: { cut: 0.85, every: 8 }, explore: { cut: 0.4, every: 2 } };
export const emptyData = () => ({ v: 1, prefs: { ...DEFAULT_PREFS }, enabled: true, votes: {}, seen: {}, seenMd5: {}, tagSeen: {}, nSeen: 0, bandit: {} });

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const postKey = (site, id) => `${site}:${id}`;
const mediaOf = (type) => (type === 'video' ? 'video' : 'image');

export function cleanPost(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.tags)) return null;
  const tags = [];
  for (const t of p.tags.slice(0, 400)) {
    if (!t || typeof t.name !== 'string' || !t.name || t.name.length > 200) continue;
    tags.push({ name: t.name, type: Object.hasOwn(CAT_W, t.type) ? t.type : 'general' });
  }
  return {
    tags,
    rating: ['safe', 'questionable', 'explicit'].includes(p.rating) ? p.rating : 'safe',
    type: ['video', 'gif', 'image'].includes(p.type) ? p.type : 'image'
  };
}

class Session {
  constructor(now, skip = (t) => t.type === 'meta') { this.now = now; this.skip = skip; this.reset(); }
  reset() {
    this.tags = new Map(); this.ratings = new Map(); this.media = new Map();
    this.mass = 0; this.last = null; this.lastDecay = this.now(); this.budget = new Map(); this.done = new Set();
  }
  advance() {
    const t = this.now();
    if (this.last !== null && t - this.last >= SESSION_IDLE) { this.reset(); return; }
    if (t - this.lastDecay < 1000) return;
    const d = Math.pow(0.5, (t - this.lastDecay) / SESSION_HALF);
    for (const m of [this.tags, this.ratings, this.media]) for (const [k, v] of m) m.set(k, v * d);
    this.mass *= d; this.lastDecay = t;
  }
  record(key, post, signal) {
    this.advance();
    const id = `${key}:${signal}`;
    if (this.done.has(id)) return 0;
    this.done.add(id);
    const names = post.tags.filter(t => !this.skip(t)).map(t => t.name);
    const bump = (m, k) => m.set(k, clamp((m.get(k) || 0) + signal, -6, 6));
    names.forEach(n => bump(this.tags, n)); bump(this.ratings, post.rating); bump(this.media, mediaOf(post.type));
    this.mass = Math.min(20, this.mass + Math.abs(signal));
    this.last = this.now();
    const topics = names.length ? names : [`media:${post.type}`];
    const spent = topics.reduce((a, t) => a + (this.budget.get(t) || 0), 0) / topics.length;
    const pw = Math.max(0, Math.min(1 / Math.sqrt(1 + spent), (2 - spent) / Math.abs(signal)));
    for (const t of topics) this.budget.set(t, (this.budget.get(t) || 0) + Math.abs(signal) * pw);
    return pw;
  }
  get weight() { this.advance(); return MAX_SESSION_W * this.mass / (this.mass + 4); }
  score(post) {
    this.advance();
    const m = post.tags.filter(t => !this.skip(t)).map(t => this.tags.get(t.name) || 0).filter(Boolean);
    let s = m.length ? m.reduce((a, v) => a + Math.tanh(v / 2), 0) / m.length : 0;
    s = s * 0.8 + Math.tanh((this.ratings.get(post.rating) || 0) / 3) * 0.1 + Math.tanh((this.media.get(mediaOf(post.type)) || 0) / 3) * 0.1;
    return clamp(0.5 + s * 0.5, 0, 1);
  }
}

function gamma(k, rnd) {
  if (k < 1) return gamma(k + 1, rnd) * Math.pow(rnd(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      const u1 = rnd() || 1e-9, u2 = rnd();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v; const u = rnd();
    if (Math.log(u || 1e-9) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}
const beta = (a, b, rnd) => { const x = gamma(a, rnd), y = gamma(b, rnd); return x / (x + y); };
function pickWeighted(items, weightOf, count, rnd) {
  const pool = items.map(i => ({ i, w: Math.max(1e-6, weightOf(i)) })), out = [];
  while (out.length < count && pool.length) {
    let r = rnd() * pool.reduce((a, p) => a + p.w, 0), k = 0;
    for (; k < pool.length - 1; k++) { r -= pool[k].w; if (r <= 0) break; }
    out.push(pool.splice(k, 1)[0].i);
  }
  return out;
}

const MISS_TTL = Infinity;
const missing = new Map();
const PAHEAL_COMMON = { porkyman: 'pokemon' }, PAHEAL_SITE = { pokemon: 'porkyman' };
const siteTagSets = new Map(), siteTagCounts = new Map(), PAHEAL_POSTS = 6.5e6;
const PAHEAL_MIN = 200;
const pahealThin = (name) => { const cm = siteTagCounts.get('paheal'); if (!cm) return false; const c = cm.get(name) ?? cm.get(PAHEAL_SITE[name]); return c !== undefined && c < PAHEAL_MIN; };
export const siteTags = { set(site, names, counts = null) { const low = names.map(n => String(n).toLowerCase()); siteTagSets.set(site, new Set(low)); if (counts && counts.length === low.length) siteTagCounts.set(site, new Map(low.map((n, i) => [n, counts[i]]))); }, has(site) { return siteTagSets.has(site); } };
export const tagMissing = {
  load(o) { if (o && o.v === 1 && o.m && typeof o.m === 'object') for (const [k, t] of Object.entries(o.m)) if (/^[a-z0-9_-]+\|/.test(k) && Number.isFinite(t) && t > Date.now() - MISS_TTL) missing.set(k, t); },
  dump() { return { v: 1, m: Object.fromEntries([...missing].filter(([, t]) => t > Date.now() - MISS_TTL)) }; },
  get size() { return missing.size; }
};

const LR_MIN = 40, LR_MAX = 0.8;
const LOOK_W = 0.08;
export function createForYou({ load, save, backup = () => {}, enabled, setEnabled, now = Date.now, random = Math.random, scope = 'normal', shared = null, vision = null, md5Of = null }) {
  const aiTags = (md5, have) => { const t = vision && md5 && vision.enabled() ? vision.tags(md5) : null; return t ? t.filter(n => !have.has(n)) : []; }
  const voteTags = (v) => { const base = v.site === 'e6ai' ? v.tags.filter(t => !AI_TAG.test(t[0])) : v.tags; if (!vision || !md5Of) return base; const md5 = md5Of(v.site, v.id), have = new Set(v.tags.map(t => t[0])), extra = aiTags(md5, have); return extra.length ? [...base, ...extra.map(n => [n, 'ai'])] : base; };
  const lookOf = (md5) => { const l = vision && md5 && vision.enabled() ? vision.look(md5) : null; return l ? vision.z(l) : null; };
  let data = null;
  let ignCache = null;
  const ignoredSet = () => { const a = get().prefs.ignored; if (!ignCache || ignCache.a !== a) ignCache = { a, set: makeIgnore(a) }; return ignCache.set; };
  const skipTag = (t) => t.type === 'meta' || ignoredSet().has(t.name) || (get().prefs.ignoreCharacters === true && t.type === 'character') || (get().prefs.ignoreCopyright === true && t.type === 'copyright') || (get().prefs.ignoreArtists === true && t.type === 'artist') || (get().prefs.ignoreSpecies === true && t.type === 'species');
  const session = new Session(now, skipTag);
  const isOn = () => enabled ? enabled() : get().enabled;
  const get = () => {
    if (!data) {
      const loaded = load();
      data = Object.assign(emptyData(), loaded || {});
      const needsGeneric = !!loaded && !(loaded.prefs && loaded.prefs.genericV1);
      data.prefs = { ...DEFAULT_PREFS, ...data.prefs };
      if (loaded && !loaded.pwFixV1) { try { backup('before-pw-restore'); } catch {} for (const v of Object.values(data.votes || {})) if ((v.pw ?? 1) < 1) v.pw = 1; data.pwFixV1 = true; save(data); }
      if (needsGeneric) { data.prefs.ignored = [...new Set([...(data.prefs.ignored || []), ...GENERIC_R34])]; data.prefs.genericV1 = true; save(data); }
    }
    return data;
  };
  let dive = null;
  const served = new Map(), servedMd5 = new Set();
  const persist = () => save(get());

  function markSeen(post, site) {
    const d = get(), k = postKey(site, post.id);
    if (post.md5) (d.seenMd5 ||= {})[post.md5] = now();
    if (d.seen[k]) return;
    d.seen[k] = now(); d.nSeen++;
    for (const t of post.tags) if (t.type !== 'meta') d.tagSeen[t.name] = (d.tagSeen[t.name] || 0) + 1;
  }
  function prune() {
    const d = get(), t = now();
    const keys = Object.keys(d.seen);
    if (keys.length > MAX_SEEN) for (const k of keys) if (t - d.seen[k] > 30 * DAY) delete d.seen[k];
    const mk = Object.keys(d.seenMd5 || {});
    if (mk.length > MAX_SEEN) for (const k of mk) if (t - d.seenMd5[k] > 30 * DAY) delete d.seenMd5[k];
    const tk = Object.keys(d.tagSeen);
    if (tk.length > MAX_TAGSEEN) for (const k of tk) if (d.tagSeen[k] <= 1) delete d.tagSeen[k];
  }


  let lrMemo = null;
  const lrFeat = (post, tagsIn) => {
    const m = new Map();
    for (const t of tagsIn) { if (!t || skipTag(t)) continue; m.set(t.name, 1); }
    m.set('@r:' + post.rating, 1); m.set('@m:' + mediaOf(post.type), 1);
    return m;
  };
  // Signed vote strength from prefs.weights, applied when read so a change also covers past votes.
  // Older Deep Dive votes were stored with pw 0.1 and no flag; they read as dive votes at full session weight.
  const voteW = (v, W) => {
    const oldDive = v.dive === undefined && v.pw === 0.1, a = Math.abs(v.vote);
    const base = v.vote > 0 ? (a === 2 ? W.superLike : W.like) : (a === 2 ? W.superDislike : W.dislike);
    return Math.sign(v.vote) * base * (oldDive ? 1 : v.pw ?? 1) * (oldDive || v.dive ? W.dive : 1);
  };
  const weights = () => ({ ...DEFAULT_WEIGHTS, ...get().prefs.weights });
  function trainLR(votes, forPaheal, key) {
    if (lrMemo && lrMemo.key === key) return lrMemo.model;
    let model = null;
    const use = votes.filter(v => v.vote && (forPaheal || v.site !== 'paheal'));
    const pos = use.filter(v => v.vote > 0).length, neg = use.length - pos;
    if (use.length >= LR_MIN && pos >= 8 && neg >= 8) {
      const tEnd = Math.max(...use.map(v => v.t));
      const docs = use.map(v => lrFeat(v, voteTags(v).map(([n, ty]) => ({ name: (v.site === 'paheal' && PAHEAL_COMMON[n]) || n, type: ty }))));
      const VW = weights();
      const ys = use.map(v => v.vote > 0 ? 1 : 0), ws = use.map(v => Math.abs(voteW(v, VW)) * (Math.abs(v.vote) === 2 ? 2 / 3 : 1));
      const idx = new Map(); for (const d of docs) for (const k of d.keys()) if (!idx.has(k)) idx.set(k, idx.size);
      const W = new Float64Array(idx.size), G = new Float64Array(idx.size).fill(1e-6); let b = 0, gb = 1e-6;
      const order = docs.map((_, i) => i); let seed = 1; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const lam = 0.003, lrate = 0.3;
      for (let e = 0; e < 30; e++) {
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
        for (const i of order) {
          let z = b; for (const [k, x] of docs[i]) z += W[idx.get(k)] * x;
          const g = (1 / (1 + Math.exp(-z)) - ys[i]) * ws[i];
          for (const [k, x] of docs[i]) { const j = idx.get(k), gj = g * x + lam * W[j]; G[j] += gj * gj; W[j] -= lrate * gj / Math.sqrt(G[j]); }
          gb += g * g; b -= lrate * g / Math.sqrt(gb);
        }
      }
      const zOf = (d) => { let z = b; for (const [k, x] of d) { const j = idx.get(k); if (j !== undefined) z += W[j] * x; } return z; };
      const zs = docs.map(zOf), mu = zs.reduce((a, c) => a + c, 0) / zs.length;
      const sd = Math.sqrt(zs.reduce((a, c) => a + (c - mu) * (c - mu), 0) / zs.length) || 1;
      const share = LR_MAX * Math.min(1, (use.length - LR_MIN) / 80);
      model = { zOf, mu, sd, share, n: use.length };
    }
    lrMemo = { key, model };
    return model;
  }

  function profile(forPaheal = false) {
    const d = get(), t = now(), tags = new Map(), ratings = {}, media = {}, W = weights();
    let votes = Object.values(d.votes);
    if (scope === 'paheal-own') votes = votes.filter(v => v.site === 'paheal');
    else if (scope === 'paheal-all' && shared) votes = [...votes, ...shared.votes()];
    forPaheal = forPaheal || scope !== 'normal';
    for (const v of votes) {
      if (!forPaheal && v.site === 'paheal') continue;
      const w = Math.pow(0.5, (t - v.t) / HALF_LIFE) * voteW(v, W);
      for (const [name0, type] of voteTags(v)) {
        const name = (v.site === 'paheal' && PAHEAL_COMMON[name0]) || name0;
        if (forPaheal && v.site !== 'paheal' && siteTagSets.has('paheal') && !siteTagSets.get('paheal').has(name) && !siteTagSets.get('paheal').has(PAHEAL_SITE[name])) continue;
        if (forPaheal && v.site !== 'paheal' && pahealThin(name)) continue;
        let generic = false;
        if (skipTag({ name, type })) {
          if (v.site === 'paheal' && type !== 'meta' && ignoredSet().has(name) && !PAHEAL_KEEP_IGNORED.has(name)) generic = true;
          else continue;
        }
        let e = tags.get(name); if (!e) tags.set(name, e = { pos: 0, neg: 0, type, sites: new Set(), generic });
        if (w > 0) e.pos += w; else e.neg -= w; e.sites.add(v.site);
      }
      ratings[v.rating] = (ratings[v.rating] || 0) + w;
      media[mediaOf(v.type)] = (media[mediaOf(v.type)] || 0) + w;
    }
    for (const e of tags.values()) e.aff = (e.pos - e.neg) / (e.pos + e.neg + 1.5);
    let look = null;
    if (vision && md5Of && LOOK_W > 0 && vision.stats().n >= 40) {
      const dir = new Array(32).fill(0); let wsum = 0, nv = 0;
      for (const v of votes) {
        if (!forPaheal && v.site === 'paheal') continue;
        const z = lookOf(md5Of(v.site, v.id)); if (!z) continue;
        const w = Math.pow(0.5, (t - v.t) / HALF_LIFE) * voteW(v, W);
        for (let k = 0; k < 32; k++) dir[k] += w * z[k]; wsum += Math.abs(w); nv++;
      }
      if (nv >= 15 && wsum > 0) look = dir.map(x => x / wsum);
    }
    for (const [name, lvl] of Object.entries(d.prefs.boost || {})) {
      if (skipTag({ name, type: 'general' })) continue;
      let e = tags.get(name);
      if (!e) { e = { pos: 0, neg: 0, type: (d.prefs.boostType || {})[name] || 'boost', sites: new Set(['rule34', 'e621', 'e6ai', 'paheal']), aff: 0 }; tags.set(name, e); }
      e.aff = clamp(e.aff + lvl * 0.35, -1, 1); e.boost = lvl;
    }
    const key = [scope, forPaheal, votes.length, votes.reduce((m, v) => v.t > m ? v.t : m, 0), d.prefs.ignored, d.prefs.ignoreCharacters, d.prefs.ignoreCopyright, d.prefs.ignoreArtists, d.prefs.ignoreSpecies, JSON.stringify(W), vision && vision.enabled() ? vision.count() : 0].join('|');
    let lr = null; try { lr = trainLR(votes, forPaheal, key); } catch (e) { lr = null; }
    return { tags, ratings, media, look, lr };
  }
  let sharedSeenMemo = null;
  const sharedSeen = () => { if (scope !== 'paheal-all' || !shared?.seen) return null; const t = now(); if (!sharedSeenMemo || t - sharedSeenMemo.t > 60000) sharedSeenMemo = { t, ...shared.seen() }; return sharedSeenMemo; };
  const idf = (name) => {
    const d = get(), ss = sharedSeen(), n = d.nSeen + (ss ? ss.nSeen : 0) + 10, df = (d.tagSeen[name] || 0) + (ss ? ss.tagSeen[name] || 0 : 0);
    return Math.max(0.05, Math.log(n / (df + 1)) / Math.log(n));
  };

  function scorePost(post, prof, withNoise = true, useLR = true) {
    let raw = 0; const parts = [];
    let ptags = post.tags, aiAdded = [];
    if (vision && post.md5) { const have = new Set(ptags.map(t => t.name)), extra = aiTags(post.md5, have); aiAdded = extra; if (extra.length) ptags = [...ptags, ...extra.map(name => ({ name, type: 'ai' }))]; }
    for (const t of ptags) {
      const e = prof.tags.get(t.name); if (!e || t.type === 'meta') continue;
      if (e.generic && post.site !== 'paheal') continue;
      const c = e.aff * (CAT_W[t.type] ?? 0.4) * (t.type === 'ai' ? 0.6 : idf(t.name));
      raw += c; parts.push({ name: t.name, c });
    }
    let s = Math.tanh(raw / 2) + 0.15 * Math.tanh((prof.ratings[post.rating] || 0) / 2) + 0.1 * Math.tanh((prof.media[mediaOf(post.type)] || 0) / 2);
    if (prof.look && post.md5) { const z = lookOf(post.md5); if (z) { let dot = 0; for (let k = 0; k < 32; k++) dot += z[k] * prof.look[k]; s += LOOK_W * Math.tanh(dot / Math.sqrt(32)); } }
    const tagS = s; let bl = null;
    if (useLR && prof.lr) { const m = prof.lr, z = m.zOf(lrFeat(post, ptags)), l = Math.tanh((z - m.mu) / (1.5 * m.sd)); s = (1 - m.share) * s + m.share * l; bl = { tag: tagS, lr: l, share: m.share, n: m.n }; }
    const base = 0.5 + 0.5 * clamp(s, -1, 1), sw = session.weight;
    const score = base * (1 - sw) + session.score(post) * sw + (withNoise ? random() * 0.08 : 0);
    parts.sort((a, b) => b.c - a.c);
    return { score, parts, base, sess: sw, bl, ai: aiAdded };
  }

  const dry = new Map(), DRY_TTL = 12 * 60 * 60e3;
  const isMissing = (site, name) => { if (site === 'paheal' && pahealThin(name)) return true; const L = siteTagSets.get(site); if (L && !L.has(name) && !(site === 'paheal' && L.has(PAHEAL_SITE[name]))) return true; const t = missing.get(site + '|' + name); return !!t && t > now() - MISS_TTL; };
  function pool(prof, site) {
    const all = [...prof.tags].filter(([, e]) => e.aff > 0 && e.type !== 'meta')
      .map(([name, e]) => ({ name, type: e.type, sites: e.sites, w: e.aff * (CAT_W[e.type] ?? 0.4) * idf(name) }))
      .filter(x => x.w > 0 && !isMissing(site, x.name)).sort((a, b) => b.w - a.w);
    const mine = all.filter(x => x.sites.has(site));
    const src = mine.length >= 3 ? mine : all; src.forEach((x, i) => { x.rank = i + 1; x.of = src.length; });
    return src.slice(0, 25);
  }
  function excludes(prof, site) {
    return [...prof.tags].filter(([, e]) => e.aff < -0.45 && e.neg >= 2 && e.type !== 'meta' && (CAT_W[e.type] ?? 0.4) >= 0.4 && e.sites.has(site))
      .sort((a, b) => a[1].aff * (CAT_W[a[1].type] ?? 1) - b[1].aff * (CAT_W[b[1].type] ?? 1)).slice(0, 5).map(([n]) => n);
  }

  function makeQuery(strat, prof, site, rating) {
    const q = makeQuery0(strat, prof, site, rating); q.ranks = {};
    for (const x of pool(prof, site)) if (q.include.includes(x.name)) q.ranks[x.name] = [x.rank, x.of];
    return q;
  }
  function makeQuery0(strat, prof, site, rating) {
    const p = pool(prof, site), page = (n) => Math.floor(random() * n);
    const base = { include: [], exclude: excludes(prof, site), rating, sort: 'id', minScore: 0, page: 0, limit: 30, or: [], orGroups: [] };
    const pick = (n) => pickWeighted(p, x => Math.pow(x.w, 1.5), n, random).map(x => x.name);
    if (strat === 'popular' || p.length === 0) return { ...base, strat: 'popular', sort: 'score', page: page(25), exclude: [] };
    if (strat === 'anchor') return { ...base, strat, include: pick(Math.min(2, p.length)), page: page(3) };
    if (strat === 'pivot') {
      const top = pick(1), mid = pickWeighted(p.slice(3), x => x.w, 1, random).map(x => x.name);
      return { ...base, strat, include: [...top, ...mid], page: page(3) };
    }
    if (strat === 'reach') return { ...base, strat, include: pickWeighted(p.slice(Math.min(5, p.length - 1)), x => x.w, 1, random).map(x => x.name), page: page(6) };
    return { ...base, strat: 'wildcard', include: pick(1), sort: 'random', page: 0 };
  }

  function chooseStrategies(count, hasPool, mode = 'balanced') {
    const b = get().bandit;
    const list = !hasPool ? ['popular'] : mode === 'comfort' ? ['anchor', 'pivot'] : mode === 'explore' ? ['reach', 'wildcard', 'pivot'] : STRATS;
    return list.map(s => ({ s, th: beta(1 + (b[s]?.w || 0), 1 + (b[s]?.l || 0), random) }))
      .sort((a, c) => c.th - a.th).slice(0, count).map(x => x.s);
  }

  const DIVE_W = { character: 3, copyright: 2.5, artist: 2, species: 1.5, general: 1 };
  function diveWeights() {
    const m = new Map();
    for (const t of dive.post.tags) if (!skipTag(t)) m.set(t.name, DIVE_W[t.type] ?? 1);
    return m;
  }
  const diveIdf = (name) => 1 / Math.sqrt(1 + (get().tagSeen[name] || 0));
  function diveSimilarity(post) {
    const a = diveWeights(), b = new Map();
    for (const t of post.tags) if (!skipTag(t)) b.set(t.name, DIVE_W[t.type] ?? 1);
    let shared = 0, mass = 0, union = 0;
    for (const name of new Set([...a.keys(), ...b.keys()])) {
      const w = diveIdf(name), x = (a.get(name) || 0) * w, y = (b.get(name) || 0) * w;
      shared += Math.min(x, y); mass += x; union += Math.max(x, y);
    }
    return mass ? clamp(0.7 * shared / mass + 0.3 * shared / Math.max(1e-8, union), 0, 1) : 0;
  }
  function diveQuery(i, site, rating, blacklist) {
    const top = [...diveWeights()].map(([name, w]) => ({ name, w: w * diveIdf(name) })).sort((a, b) => b.w - a.w).slice(0, 4).map(x => x.name);
    const sets = top.length > 1 ? [[top[0], top[1]], [top[0]], [top[1]], ...(top[2] ? [[top[2]]] : [])] : [top];
    const inc = sets[i % sets.length], key = inc.join(' ');
    const page = dive.cursor[key] = (dive.cursor[key] ?? -1) + 1;
    return { include: inc, exclude: [], or: [], orGroups: [], rating, sort: 'id', minScore: 0, page, limit: 30, strat: 'dive' };
  }

  return {
    get enabled() { return isOn(); },
    counts() { let likes = 0, dislikes = 0; for (const v of Object.values(get().votes)) v.vote > 0 ? likes++ : dislikes++; return { likes, dislikes }; },
    get dive() { return dive ? { site: dive.site, id: dive.id } : null; },

    startDive({ site, id, post }) {
      if (!isOn()) throw Object.assign(new Error('For you is switched off'), { status: 409 });
      if (!/^[a-z0-9_-]{1,20}$/.test(site) || !Number.isInteger(id) || id < 0) throw Object.assign(new Error('Bad post'), { status: 400 });
      const cp = cleanPost(post);
      if (!cp || !cp.tags.some(t => t.type !== 'meta')) throw Object.assign(new Error('Bad post data'), { status: 400 });
      dive = { site, id, post: cp, cursor: {}, n: 0 };
      markSeen({ id, ...cp }, site); persist();
    },
    endDive() { dive = null; },

    markViewed({ site, id, post, md5 }) {
      const d = get(); if (!isOn()) return false;
      if (!/^[a-z0-9_-]{1,20}$/.test(site) || !Number.isInteger(id) || id < 0) throw Object.assign(new Error('Bad post'), { status: 400 });
      const cp = cleanPost(post); if (!cp) throw Object.assign(new Error('Bad post data'), { status: 400 });
      markSeen({ id, ...cp, md5: /^[0-9a-f]{32}$/.test(md5 || '') ? md5 : '' }, site);
      prune(); persist(); return true;
    },

    listVotes({ filter = 'likes', offset = 0, limit = 20 }) {
      const pick = { likes: v => v > 0, super: v => v === 2, dislikes: v => v < 0, all: () => true }[filter] || (v => v > 0);
      const all = Object.values(get().votes).filter(v => pick(v.vote)).sort((a, b) => b.t - a.t);
      return { total: all.length, items: all.slice(offset, offset + limit).map(v => ({ site: v.site, id: v.id, vote: v.vote, t: v.t })) };
    },

    setPrefs(b) {
      dry.clear();
      const p = get().prefs;
      if (Object.hasOwn(MODES, b.mode)) p.mode = b.mode;
      if (['all', 'image', 'video'].includes(b.media)) p.media = b.media;
      if (Array.isArray(b.ignored)) p.ignored = [...new Set(b.ignored.filter(x => typeof x === 'string').map(x => x.trim().toLowerCase().replace(/\s+/g, '_')).filter(x => x && x.length <= 200))].slice(0, 500);
      if (Array.isArray(b.whitelist)) p.whitelist = [...new Set(b.whitelist.filter(x => typeof x === 'string').map(x => x.trim().toLowerCase().replace(/\s+/g, '_').replace(/%3a/gi, ':').replace(/%3e/gi, '>')).filter(x => x && x.length <= 200 && (SCORE_RULE.test(x) || !/:/.test(x))))].slice(0, 10);
      if (typeof b.ignoreCharacters === 'boolean') p.ignoreCharacters = b.ignoreCharacters;
      if (typeof b.ignoreCopyright === 'boolean') p.ignoreCopyright = b.ignoreCopyright;
      if (typeof b.ignoreArtists === 'boolean') p.ignoreArtists = b.ignoreArtists;
      if (typeof b.ignoreSpecies === 'boolean') p.ignoreSpecies = b.ignoreSpecies;
      if (b.boost && typeof b.boost === 'object' && !Array.isArray(b.boost)) {
        const out = {};
        for (const [k, v] of Object.entries(b.boost).slice(0, 200)) {
          const name = String(k).trim().toLowerCase().replace(/\s+/g, '_'), n = Math.round(Number(v));
          if (name && name.length <= 200 && !/[:*]/.test(name) && n >= -3 && n <= 3 && n !== 0) out[name] = n;
        }
        p.boost = Object.fromEntries(Object.entries(out).slice(0, 50));
        const bt = (b.boostType && typeof b.boostType === 'object') ? b.boostType : (p.boostType || {});
        p.boostType = {};
        for (const k of Object.keys(p.boost)) if (bt[k] === 'artist' || bt[k] === 'character') p.boostType[k] = bt[k];
      }
      if (b.minScore && typeof b.minScore === 'object') {
        p.minScore = { ...(p.minScore || {}) };
        for (const s of ['rule34', 'e621', 'e6ai']) if (Object.hasOwn(b.minScore, s)) { const n = Math.floor(Number(b.minScore[s])); if (n > 0) p.minScore[s] = Math.min(n, 1e6); else delete p.minScore[s]; }
      }
      if (b.weights && typeof b.weights === 'object') {
        const w = { ...DEFAULT_WEIGHTS, ...p.weights };
        for (const k of Object.keys(DEFAULT_WEIGHTS)) if (Number.isFinite(b.weights[k])) w[k] = Math.min(10, Math.max(0, Math.round(b.weights[k] * 100) / 100));
        p.weights = w;
      }
      if (b.resetIgnored === true) p.ignored = [...DEFAULT_IGNORED];
      if (Array.isArray(b.blacklist)) p.blacklist = [...new Set(b.blacklist.filter(x => typeof x === 'string').map(x => x.trim().toLowerCase().replace(/\s+/g, '_')).filter(x => x && x.length <= 200 && !/:/.test(x)))].slice(0, 200);
      persist(); return p;
    },


    state(rankTag) {
      const d = get(), prof = profile();
      const top = (sign, n) => [...prof.tags].filter(([, e]) => sign * e.aff > 0.05)
        .sort((a, b) => sign * (b[1].aff * (CAT_W[b[1].type] ?? 0.4)) - sign * (a[1].aff * (CAT_W[a[1].type] ?? 0.4))).slice(0, n)
        .map(([name, e]) => ({ name, type: e.type, aff: Math.round(e.aff * 100) / 100 }));
      const ign = ignoredSet();
      const wt = (sign, n) => [...prof.tags].filter(([name, e]) => sign * e.aff > 0.05 && e.type !== 'meta' && !ign.has(name))
        .map(([name, e]) => ({ name, type: e.type, aff: Math.round(e.aff * 100) / 100, w: Math.round(Math.abs(e.aff) * (CAT_W[e.type] ?? 0.4) * idf(name) * 100) / 100 }))
        .sort((a, b) => b.w - a.w).slice(0, n);
      const votes = {}; let likes = 0, dislikes = 0;
      for (const [k, v] of Object.entries(d.votes)) { votes[k] = v.vote; v.vote > 0 ? likes++ : dislikes++; }
      const all = Object.values(d.votes).sort((a, b) => a.t - b.t), rate = (a) => ({ n: a.length, rate: a.length ? Math.round(100 * a.filter(v => v.vote > 0).length / a.length) : null });
      const fyv = all.filter(v => v.strat), srv = all.filter(v => !v.strat);
      const insights = { foryou: rate(fyv), search: rate(srv), recent: rate(fyv.slice(-20)), earlier: rate(fyv.slice(0, -20).slice(-20)) };
      let tagRank = undefined;
      if (rankTag) { const nm = String(rankTag).toLowerCase(), ig = ignoredSet(), L = (s) => [...prof.tags].filter(([n, e]) => s * e.aff > 0.05 && e.type !== 'meta' && !ig.has(n)).map(([n, e]) => [n, Math.abs(e.aff) * (CAT_W[e.type] ?? 0.4) * idf(n)]).sort((a, b) => b[1] - a[1]); const lk = L(1), dl = L(-1), i = lk.findIndex(x => x[0] === nm), j = dl.findIndex(x => x[0] === nm); tagRank = { tag: nm, liked: i < 0 ? null : { rank: i + 1, of: lk.length, w: lk[i][1] }, disliked: j < 0 ? null : { rank: j + 1, of: dl.length, w: dl[j][1] }, inProfile: prof.tags.has(nm) }; }
      return { tagRank, enabled: isOn(), prefs: d.prefs, insights, dive: this.dive, likes, dislikes, seen: d.nSeen, votes, likedTags: top(1, 12), dislikedTags: top(-1, 8), weightLiked: wt(1, 30), weightDisliked: wt(-1, 30), bandit: d.bandit };
    },

    setEnabled(on) { if (setEnabled) setEnabled(!!on); else { get().enabled = !!on; persist(); } return isOn(); },

    resetLearning() { const d = get(); dry.clear(); backup('before-reset-learning'); Object.assign(d, { votes: {}, seen: {}, seenMd5: {}, tagSeen: {}, nSeen: 0, bandit: {} }); dive = null; served.clear(); servedMd5.clear(); session.reset(); persist(); },
    reset() { get(); dry.clear(); backup('before-reset'); data = emptyData(); dive = null; served.clear(); servedMd5.clear(); session.reset(); persist(); },

    vote({ site, id, vote, post, strat, md5, dive: inDive }) {
      const d = get();
      if (!isOn()) throw Object.assign(new Error('For you is switched off'), { status: 409 });
      if (!/^[a-z0-9_-]{1,20}$/.test(site) || !Number.isInteger(id) || id < 0) throw Object.assign(new Error('Bad post'), { status: 400 });
      if (![2, 1, -1, -2, 0].includes(vote)) throw Object.assign(new Error('Bad vote'), { status: 400 });
      const k = postKey(site, id);
      if (vote === 0) { delete d.votes[k]; persist(); return 0; }
      const cp = cleanPost(post); if (!cp) throw Object.assign(new Error('Bad post data'), { status: 400 });
      if (Object.keys(d.votes).length >= MAX_VOTES && !d.votes[k]) throw Object.assign(new Error('Too many votes stored'), { status: 400 });
      markSeen({ id, ...cp, md5: /^[0-9a-f]{32}$/.test(md5 || '') ? md5 : '' }, site);
      const pw = session.record(k, cp, Math.sign(vote) * (Math.abs(vote) === 2 ? 3 : 1)), isDive = !!dive && inDive === true;
      const s = STRATS.includes(strat) || strat === 'popular' ? strat : null;
      d.votes[k] = { site, id, vote, t: now(), pw, rating: cp.rating, type: cp.type, strat: s, ...(isDive ? { dive: true } : {}), tags: cp.tags.filter(t => t.type !== 'meta').map(t => [t.name, t.type]) };
      if (s) { const b = d.bandit[s] || (d.bandit[s] = { w: 0, l: 0 }); vote > 0 ? b.w++ : b.l++; if (b.w + b.l > 200) { b.w /= 2; b.l /= 2; } }
      prune(); persist();
      return vote;
    },

    shareVotes() { return Object.entries(get().votes).filter(([, v]) => v.site !== 'paheal'); },
    shareMd5() { return get().seenMd5 || {}; },
    shareSeen() { const d = get(); return { tagSeen: d.tagSeen || {}, nSeen: d.nSeen || 0 }; },
    evalScorer(opts = {}) { const prof = profile(); return (post) => scorePost(post, prof, false, opts.blend === true).score; },

    async feed({ sites, rating = 'all', shape = 'any', n = 20, search, exists }) {
      const d = get();
      if (!isOn()) throw Object.assign(new Error('For you is switched off'), { status: 409 });
      if (!sites.length) throw Object.assign(new Error('No site selected'), { status: 400 });
      const prefs = d.prefs, mode = dive ? 'dive' : prefs.mode, black = makeIgnore(prefs.blacklist);
      let white = prefs.whitelist || [];
      const prof = profile(), profP = sites.includes('paheal') ? profile(true) : prof, pf = (site) => site === 'paheal' ? profP : prof;
      const hasPool = [...prof.tags.values()].some(e => e.aff > 0.05);
      const cands = new Map(), qinfo = new Map(), md5s = new Set(); let firstErr = null, ok = 0;
      const qkey = (site, q) => [site, [...new Set([...white.slice(0, 5), ...q.include])].sort().join(' '), q.page, q.sort, prefs.media].join('|');
      const runJob0 = async (site, q) => {
          q.include = [...new Set([...white.slice(0, 5), ...q.include])];
          q.shape = shape;
          const msite = prefs.minScore?.[site]; if (msite > 0) q.minScore = Math.max(q.minScore || 0, msite + 1);
          const unknown = q.include.filter(t => !t.includes('*')).filter(t => { const e = pf(site).tags.get(t); return !e || !e.sites.has(site) || (e.boost && e.pos + e.neg === 0); });
          const localList = site === 'paheal' ? siteTagSets.get('paheal') : null;
          if (unknown.length && (exists || localList)) {
            const ex = localList ? Object.fromEntries(unknown.map(t => [t, localList.has(t) || localList.has(PAHEAL_SITE[t] || '') ])) : await exists(site, unknown);
            for (const [t, v] of Object.entries(ex)) if (v === false) missing.set(site + '|' + t, now());
            if (white.some(t => ex[t] === false)) return { site, q, posts: [] };
            q.include = q.include.filter(t => ex[t] !== false);
            if (!q.include.length && q.strat !== 'popular') return { site, q, posts: [] };
          }
          const r = await search(site, q);
          return { site, q, posts: r.posts || [] };
      };
      const runJob = async (site, q) => { const key = qkey(site, q); return { ...(await runJob0(site, q)), key }; };
      const collect = async (jobs) => {
        for (const r of await Promise.allSettled(jobs)) {
          if (r.status === 'rejected') { firstErr ||= r.reason; continue; }
          ok++; let fresh = 0;
          for (const p of r.value.posts) {
            if (missing.size) for (const t of p.tags) missing.delete(r.value.site + '|' + t.name.toLowerCase());
            const k = postKey(r.value.site, p.id);
            if (d.seen[k] || served.has(k) || d.votes[k] || cands.has(k)) continue;
            if (white.length && !white.every(w => { const m = SCORE_RULE.exec(w); return m ? (m[1] === '>' ? p.score > +m[2] : p.score >= +m[2])          : (w.includes('*') ? makeIgnore([w]) : { has: n => n === w }).has && p.tags.some(t => (w.includes('*') ? makeIgnore([w]) : { has: n => n === w }).has(t.name.toLowerCase())); })) continue;
            { const ms = prefs.minScore?.[r.value.site]; if (ms > 0 && !(p.score > ms)) continue; }
            if (prefs.blacklist.length && p.tags.some(t => black.has(t.name.toLowerCase()))) continue;
            if (prefs.media === 'video' && p.type !== 'video') continue;
            if (prefs.media === 'image' && p.type === 'video') continue;
            if (p.md5 && ((d.seenMd5 || {})[p.md5] || servedMd5.has(p.md5) || md5s.has(p.md5))) continue;
            if (p.md5) md5s.add(p.md5);
            fresh++; cands.set(k, { ...p, site: r.value.site, strat: r.value.q.strat });
            qinfo.set(k, { top: pool(pf(r.value.site), r.value.site).slice(0, 5).map(x => x.name), q: r.value.q.include.join(' ') || '(popular, no tags)', page: r.value.q.page + 1, sort: r.value.q.sort, ranks: Object.entries(r.value.q.ranks || {}).filter(([t]) => r.value.q.include.includes(t)).map(([t, [n, of]]) => `${t} #${n} of ${of}`).join(', ') });
          }
          if (r.value.key) { if (fresh) dry.delete(r.value.key); else dry.set(r.value.key, now()); }
        }
      };
      const dryNow = (key) => { const t = dry.get(key); return !!t && t > now() - DRY_TTL; };
      const pickQuery = (s, site) => { let q; for (let i = 0; i < 4; i++) { q = mode === 'dive' ? diveQuery(s, site, rating, prefs.blacklist) : makeQuery(s, pf(site), site, rating); if (!dryNow(qkey(site, q))) break; } return q; };
      for (let round = 0; round < (prefs.media === 'all' ? 2 : 3) && cands.size < n * 2; round++) {
        const strats = mode === 'dive' ? [0, 1, 2].map(i => dive.n++) : chooseStrategies(3, hasPool, mode);
        const off = Math.floor(random() * sites.length);
        await collect(strats.map(async (s, i) => { const site = sites[(off + i) % sites.length]; return runJob(site, pickQuery(s, site)); }));
      }
      let why = '', note = '';
      if (!cands.size && mode !== 'dive' && ok) {
        const hadWhite = white.length > 0, round = (trim) => collect(chooseStrategies(3, hasPool, mode).map(async (s, i) => {
          const site = sites[i % sites.length], q = makeQuery(s, pf(site), site, rating); if (trim) q.include = q.include.slice(0, 1);
          return runJob(site, q);
        }));
        if (hadWhite) { white = []; await round(false); if (cands.size) note = 'Nothing matched your must-have tags, so they were ignored for this batch.'; }
        if (!cands.size) { await round(true); if (cands.size) note = hadWhite ? 'Must-have tags ignored and fewer taste tags used for this batch.' : 'Fewer taste tags used for this batch.'; }
        if (!cands.size) { await collect(sites.map(async site => runJob(site, makeQuery('popular', pf(site), site, rating)))); if (cands.size) note = 'Nothing matched your taste, so these are popular posts.'; }
        if (!cands.size) why = `Nothing new on ${sites.join(' / ')}: everything found was already seen, voted, blacklisted or filtered out.`;
      }
      if (!ok && firstErr) throw firstErr;

      const scored = [...cands.values()].map(p => {
        const r = scorePost(p, pf(p.site));
        if (mode === 'dive') { const sim = diveSimilarity(p); r.score = r.score * 0.1 + sim * 0.9; r.parts = []; }
        return { p, ...r };
      }).sort((a, b) => b.score - a.score);
      scored.forEach((x, i) => { x.rank = i + 1; });
      const M = MODES[mode] || { cut: 1, every: 1e9 };
      const cut = Math.max(1, Math.ceil(scored.length * M.cut));
      const ranked = scored.slice(0, cut), disc = scored.slice(cut);
      const out = [];
      while (out.length < n && (ranked.length || disc.length)) {
        const slot = out.length + 1;
        let item;
        if (slot % M.every === 0 && disc.length) item = disc.splice(Math.floor(random() * disc.length), 1)[0];
        else item = ranked.shift() || disc.splice(Math.floor(random() * disc.length), 1)[0];
        item.slot = item.rank <= cut ? 'top' : 'discovery';
        out.push(item);
      }
      const posts = out.map(({ p, score, parts, base, sess, rank, slot, bl, ai }) => {
        const r2 = (x) => Math.round(x * 100) / 100;
        const dbg = {
          strat: p.strat, ...qinfo.get(postKey(p.site, p.id)), rank, of: scored.length, slot, mode, score: r2(score), base: r2(base ?? 0), sess: r2(sess ?? 0), ai: (ai || []).slice(0, 12), bl: bl ? { tag: r2(bl.tag), lr: r2(bl.lr), share: Math.round(bl.share * 100), n: bl.n } : null,
          plus: parts.filter(x => x.c > 0.01).slice(0, 4).map(x => [x.name, r2(x.c)]),
          minus: parts.filter(x => x.c < -0.01).slice(-2).map(x => [x.name, r2(x.c)])
        };
        served.set(postKey(p.site, p.id), now()); if (p.md5) servedMd5.add(p.md5);
        if (served.size > 5000) served.delete(served.keys().next().value);
        const liked = parts.filter(x => x.c > 0.01).slice(0, 3).map(x => x.name);
        if (mode === 'dive') return { ...p, why: { label: `Deep Dive: similar to ${dive.site} #${dive.id}`, tags: [], score: Math.round(score * 100) / 100 }, dbg };
        return { ...p, why: { label: LABELS[p.strat] || '', tags: liked, score: Math.round(score * 100) / 100 }, dbg };
      });
      prune(); persist();
      return { posts, hasMore: true, candidates: cands.size, cold: !hasPool && mode !== 'dive', ...(why ? { why } : {}), ...(note ? { note } : {}) };
    }
  };
}
export const _test = { Session, scorePost: null, beta, pickWeighted };
