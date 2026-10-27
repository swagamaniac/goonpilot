const reportMode = () => { try { fetch('/api/vision/mode?fy=' + (S.mode === 'foryou' ? 1 : 0), { method: 'POST', headers: { 'x-goonpilot': '1' } }).catch(() => {}); } catch {} };
document.addEventListener('visibilitychange', () => { if (!document.hidden) reportMode(); });
addEventListener('load', reportMode);
function timeAgo(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000; if (!(s >= 0)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  if (s < 2629800) return Math.floor(s / 604800) + 'w ago';
  if (s < 31557600) return Math.floor(s / 2629800) + 'mo ago';
  return Math.floor(s / 31557600) + 'y ago';
}
'use strict';

const store = {
  get(k, d) { try { const v = localStorage.getItem('goonpilot:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('goonpilot:' + k, JSON.stringify(v)); } catch {} if (k === 'history' || k === 'saved' || k === 'supers') pushUi(); }
};
let uiTimer = null;
function pushUi() {
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => { lib('ui', { history: S.history, saved: S.saved, supers: S.supers, seen: S.seen }).catch(() => {}); }, 400);
}
async function pullUi() {
  try {
    const { ui } = await lib('ui');
    const first = !store.get('uiMerged', false);
    const uniq = (list, key) => { const seen = new Set(); return list.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
    const mergeKey = { history: x => x.sig, saved: x => JSON.stringify([x.name, x.terms]), supers: x => x.name };
    for (const k of ['history', 'saved', 'supers']) {
      const srv = Array.isArray(ui[k]) ? ui[k] : [];
      S[k] = first ? uniq([...srv, ...S[k]], mergeKey[k]) : srv;
      try { localStorage.setItem('goonpilot:' + k, JSON.stringify(S[k])); } catch {}
    }
    const srvSeen = ui.seen && typeof ui.seen === 'object' ? ui.seen : {};
    for (const [k, v] of Object.entries(srvSeen)) { const cur = S.seen[k] || (S.seen[k] = {}); for (const [site, id] of Object.entries(v)) cur[site] = Math.max(cur[site] || 0, id); }
    store.set('seen', S.seen);
    if (first) { store.set('uiMerged', true); pushUi(); }
    if (!$('sheetRoot').hidden) renderSheet();
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pullUi(); loadArtists(); } });

const BUILTIN_SITES = ['rule34', 'e621', 'e6ai', 'paheal'];
const ALL_SITES = [...BUILTIN_SITES, ...store.get('customSites', []).filter(x => typeof x === 'string' && !BUILTIN_SITES.includes(x))];

const MODS = ['+', '-', '~'];
const MOD_LABEL = { '+': '', '-': '−', '~': '~' };
function normTerm(t) { return { ...t, mod: MODS.includes(t.mod) ? t.mod : (t.neg ? '-' : '+'), neg: undefined }; }
function parsePrefix(text) {
  text = text.trim();
  const c = text[0];
  if (c === '-' || c === '−') return { mod: '-', name: text.slice(1).trim() };
  if (c === '~') return { mod: '~', name: text.slice(1).trim() };
  return { mod: '+', name: text };
}
const nextMod = m => MODS[(MODS.indexOf(m) + 1) % MODS.length];

const legacySite = store.get('site', 'rule34');
const st = store.get('search2', null) || { ...store.get('search:' + legacySite, store.get('search', {})), sites: [legacySite] };
const S = {
  sites: (st.sites || []).filter(s => ALL_SITES.includes(s)),
  terms: (st.terms || []).map(normTerm),
  sort: st.sort || 'id', rating: st.rating || 'all', minScore: st.minScore || 0,
  pageSize: store.get('pageSize', 20),
  aheadScreens: store.get('aheadScreens', 3),
  original: store.get('original', false),
  autoDelay: store.get('autoDelay', 5),
  videoQuality: store.get('videoQuality', 'medium'),
  sound: store.get('sound', false),
  dirty: false,
  active: null,
  feeds: {},
  posts: [], keys: new Set(), loading: false, gen: 0, ctrl: null,
  saved: store.get('saved', []),
  supers: store.get('supers', []),
  seen: store.get('seen', {}), newKey: null, newSince: null,
  status: null,
  vIndex: 0, vOpen: false, auto: false,
  mode: 'search',
  md5s: new Set(), dupes: store.get('dupes', false), hiddenDupes: 0,
  artists: {}, history: store.get('history', []), hk: { like: '8', dislike: '2', superLike: '9', superDislike: '3', hints: 'h', next: 'j', prev: 'k', details: 'arrowright', close: 'escape', search: 'enter', ...store.get('hotkeys', {}) }, hintsOn: store.get('hintsOn', true), capture: null, reported: new Set(), liked: { filter: 'likes' }, fyDebug: store.get('fyDebug', false), autoNext: store.get('autoNext', true), loopVideos: store.get('loopVideos', true), gDouble: store.get('gDouble', true), fillFit: store.get('fillFit', true), directMedia: store.get('directMedia', false), gSwipe: store.get('gSwipe', true), orient: store.get('orient', 'any'), tbarOn: store.get('tbarOn', true), orientDrop: 0, fyBatch: store.get('fyBatch', 10),
  fyOn: false, votes: {}, fy: { error: '' }, fyState: null
};
if (!S.sites.length) S.sites = ['rule34'];
const persistSearch = () => store.set('search2', { sites: S.sites, terms: S.terms, sort: S.sort, rating: S.rating, minScore: S.minScore });

const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});
function toast(msg) { const t = el('div', 'toast', msg); document.body.append(t); setTimeout(() => t.remove(), 2000); }

function makeGate() {
  return {
    minGap: 1000, last: 0, busy: false, total: 0, note: '',
    async run(fn, signal) {
      while (this.busy) await sleep(50, signal);
      this.busy = true; render.status();
      try {
        for (let attempt = 0; ; attempt++) {
          const wait = this.last + this.minGap - Date.now();
          if (wait > 0) await sleep(wait, signal);
          this.last = Date.now(); this.total++;
          try { const r = await fn(signal); this.note = ''; return r; }
          catch (err) {
            if (err.name === 'AbortError') throw err;
            const retryable = err.status === 429 || err.status >= 500 || err.status === 0;
            if (!retryable || attempt >= 3) { this.note = ''; throw err; }
            const backoff = Math.min(16000, 2000 * 2 ** attempt);
            this.note = `${err.status === 429 ? 'rate limited' : 'error'}, retry in ${backoff / 1000} s`;
            render.status();
            await sleep(backoff, signal);
          }
        }
      } finally { this.busy = false; render.status(); }
    }
  };
}
const gates = Object.fromEntries(ALL_SITES.map(s => [s, makeGate()]));
function syncSites(status) {
  const custom = (status?.sources || []).filter(x => x.custom).map(x => x.id);
  ALL_SITES.splice(0, ALL_SITES.length, ...BUILTIN_SITES, ...custom);
  for (const id of custom) gates[id] ||= makeGate();
  store.set('customSites', custom);
  const kept = S.sites.filter(x => ALL_SITES.includes(x));
  if (kept.length !== S.sites.length) { S.sites = kept.length ? kept : ['rule34']; markDirty(); }
}

async function getJson(url, signal) {
  let res;
  try { res = await fetch(url, { signal, headers: { accept: 'application/json' } }); }
  catch (err) { if (err.name === 'AbortError') throw err; throw Object.assign(new Error('Cannot reach the local server. Is it still running?'), { status: 0 }); }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
const SITE_MEDIA = /(^|\.)(rule34\.xxx|e621\.net|e6ai\.net)$/;
function mu(u) {
  if (!S.directMedia || !u) return u;
  const m = /^\/api\/(?:rule34|e621|e6ai)\/media\?u=(.+)$/.exec(u); if (!m) return u;
  try { const d = new URL(decodeURIComponent(m[1])); if (d.protocol === 'https:' && SITE_MEDIA.test(d.hostname)) return d.href; } catch {}
  return u;
}
function setImg(img, u) {
  const d = mu(u); img.src = d;
  if (d !== u) img.addEventListener('error', () => { if (img.src === d) img.src = u; }, { once: true });
  let tries = 0;
  img.addEventListener('error', () => {
    if (d !== u && img.src === d) return;
    if (tries >= 3) return; tries++;
    setTimeout(() => { img.src = u + (u.includes('?') ? '&' : '?') + 'r=' + tries; }, 1500 * tries);
  });
}
const shapeNow = () => (TOUCH.matches && !S.fyNoShape ? S.orient : 'any');
const api = {
  posts(site, q, signal) {
    const p = new URLSearchParams({
      inc: q.include.join(' '), exc: q.exclude.join(' '), or: q.or.join(' '), og: q.orGroups.map(g => g.join(' ')).join('|'), sort: q.sort, rating: q.rating,
      min: String(q.minScore), page: String(q.page), limit: String(q.limit), shape: q.shape || shapeNow(), pr: String(Math.round(innerWidth / innerHeight * 1000) / 1000)
    });
    return getJson(`/api/${site}/posts?${p}`, signal);
  },
  suggest(site, text, signal) { return getJson(`/api/${site}/suggest?q=${encodeURIComponent(text)}`, signal); },
  status() { return getJson('/api/status'); }
};

async function fyJson(path, body, signal, base = '/api/foryou/') {
  const opt = { signal, headers: { accept: 'application/json', 'x-goonpilot': '1' } };
  if (body !== undefined) { opt.method = 'POST'; opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(base + path, opt); }
  catch (err) { if (err.name === 'AbortError') throw err; throw Object.assign(new Error('Cannot reach the local server. Is it still running?'), { status: 0 }); }
  let data = {}; try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

const lib = (path, body) => fyJson(path, body, undefined, '/api/lib/');
const artistKey = n => String(n || '').trim().toLowerCase().replace(/\s+/g, '_');
function loadArtists() {
  return lib('artists').then(r => { S.artists = Object.fromEntries(r.artists.map(a => [a.name, a])); markFavs(); }).catch(() => {});
}
async function toggleArtist(name, kind = 'artist') {
  const k = artistKey(name);
  try {
    if (S.artists[k]) { await lib('artists', { name: k, remove: true }); delete S.artists[k]; toast('Removed ' + k + ' from favorites'); }
    else { const r = await lib('artists', { name: k, kind }); S.artists[k] = r.artist; toast('Added ' + k + ' to favorites'); }
    markFavs(); if (!$('sheetRoot').hidden && tab === 'artists') renderSheet();
    if (S.vOpen) viewer.details();
  } catch (err) { toast(err.message); }
}
function markFavs() {
  document.querySelectorAll('.post [data-artist]').forEach(n => {
    const fav = !!S.artists[artistKey(n.dataset.artist)];
    n.classList.toggle('fav', fav); n.textContent = (fav ? '♥ ' : '') + n.dataset.artist;
  });
}
function checkNew() {
  const names = Object.values(S.artists).sort((a, b) => (b.added || 0) - (a.added || 0)).map(a => a.name);
  if (!names.length) { toast('Add some favorites first'); return; }
  if (names.length > 30) toast('Checking your 30 newest favorites');
  S.terms = names.slice(0, 30).map(n => ({ kind: 'tag', name: n, mod: names.length > 1 ? '~' : '+', type: (S.artists[n].kind || 'artist') === 'tag' ? 'general' : S.artists[n].kind }));
  S.newKey = 'fav'; S.newSort = 'id';
  closeSheet(); syncFilterUi(); newSearch();
}
function trackNew(posts) {
  const N = S.newSince; if (!N) return;
  const cur = S.seen[N.key] || (S.seen[N.key] = {});
  for (const p of posts) {
    if (N.prev[p.site] && p.id > N.prev[p.site]) { p.isNew = true; N.n++; }
    cur[p.site] = Math.max(cur[p.site] || 0, p.id);
  }
  store.set('seen', S.seen); pushUi();
}
function searchArtists(names, kind = 'artist') {
  S.terms = names.map(n => ({ kind: 'tag', name: n, mod: names.length > 1 ? '~' : '+', type: kind === 'tag' ? 'general' : kind }));
  closeSheet(); syncFilterUi(); newSearch();
}

function buildBase() {
  const lists = { '+': [], '-': [], '~': [] }, groups = [];
  const combine = (outer, inner) => outer === '+' ? inner
    : outer === '-' ? (inner === '-' ? '+' : '-')
    : (inner === '-' ? '-' : '~');
  for (const t of S.terms) {
    if (t.kind === 'super') {
      const s = S.supers.find(x => x.name === t.name); if (!s) continue;
      const own = [];
      for (const raw of s.tags) {
        const p = parsePrefix(raw); if (!p.name) continue;
        const m = combine(t.mod, p.mod);
        if (m === '~' && t.mod === '+') own.push(p.name);
        else lists[m].push(p.name);
      }
      if (own.length > 1) groups.push(own); else lists['+'].push(...own);
    } else if (t.name) lists[t.mod].push(t.name);
  }
  const uniq = a => [...new Set(a)];
  return { include: uniq(lists['+']), exclude: uniq(lists['-']), or: uniq(lists['~']), orGroups: groups, sort: S.sort, rating: S.rating, minScore: S.minScore, limit: TOUCH.matches ? 25 : S.pageSize };
}

function markDirty() {
  if (S.mode === 'foryou') { persistSearch(); enterForYou(); return; }
  S.dirty = true; persistSearch();
  render.chips(); render.sites(); render.searchBtn(); render.status();
}
function setMode(m) {
  if (typeof fyPanelKey !== 'undefined' && fyPanelKey) closeFyPanel();
  S.mode = m; reportMode(); if (m !== 'liked' && S.sel) { S.sel = null; renderSel(); }
  const alt = m !== 'search';
  document.body.classList.toggle('foryou', m === 'foryou');
  $('forBtn').classList.toggle('on', m === 'foryou'); $('likedBtn').classList.toggle('on', m === 'liked');
  for (const n of [$('chips'), $('sort').parentElement, $('minScore').parentElement]) n.hidden = alt;
  $('fyBar').hidden = m !== 'foryou'; $('likedBar').hidden = m !== 'liked';
  if (m !== 'foryou') $('fyHelp').hidden = true;
  renderFyBar();
  observeSentinel();
}
function renderLikedBar() { [...$('likedFilter').children].forEach(b => b.classList.toggle('on', b.dataset.f === S.liked.filter)); }
$('likedFilter').onclick = e => { const b = e.target.closest('button'); if (b) enterLiked(b.dataset.f); };
$('likedBtn').onclick = () => enterLiked();
function startDownload(qs) { const x = document.createElement('a'); x.href = 'api/lib/download?' + qs; x.download = ''; document.body.append(x); x.click(); x.remove(); }
function renderSel() {
  const on = !!S.sel;
  $('selBtn').setAttribute('aria-pressed', String(on)); $('selBtn').classList.toggle('on', on); $('selBtn').textContent = on ? '✕ Cancel select' : '☑ Select';
  $('selAllBtn').hidden = !on; $('dlSelBtn').hidden = !on;
  $('dlSelBtn').textContent = '⬇ Download selected' + (on && S.sel.size ? ` (${S.sel.size})` : ''); $('dlSelBtn').disabled = !on || !S.sel.size;
  document.body.classList.toggle('selecting', on);
}
function toggleSel(p, card) { const k = p.site + ':' + p.id; if (S.sel.has(k)) S.sel.delete(k); else S.sel.add(k); card.classList.toggle('selected', S.sel.has(k)); renderSel(); }
$('selBtn').onclick = () => { S.sel = S.sel ? null : new Set(); document.querySelectorAll('.post.selected').forEach(c => c.classList.remove('selected')); renderSel(); };
$('selAllBtn').onclick = () => { S.posts.forEach(p => S.sel.add(p.site + ':' + p.id)); document.querySelectorAll('.post').forEach(c => c.classList.add('selected')); renderSel(); };
$('dlSelBtn').onclick = () => { if (S.sel?.size) { startDownload('items=' + [...S.sel].join(',')); toast(`Downloading ${S.sel.size} file(s)…`); } };
$('dlListBtn').onclick = () => { const x = document.createElement('a'); x.href = 'api/lib/export?filter=' + S.liked.filter; x.download = ''; document.body.append(x); x.click(); x.remove(); toast('Preparing list…'); };
$('dlAllBtn').onclick = () => { startDownload('filter=' + S.liked.filter); toast('Preparing ZIP… posts not saved locally yet are skipped'); };
function enterLiked(filter) {
  S.sel = null; renderSel();
  if (!S.fyOn) return;
  S.ctrl?.abort(); S.ctrl = new AbortController(); S.gen++;
  setMode('liked');
  S.active = { sites: [], liked: true }; S.feeds = {};
  S.posts = []; S.keys = new Set(); S.md5s = new Set(); S.hiddenDupes = 0; S.loading = false; S.dirty = false;
  S.liked = { filter: filter || S.liked.filter || 'likes', offset: 0, total: 0, done: false, error: '', unavailable: 0 };
  $('results').replaceChildren(); render.status(); window.scrollTo(0, 0); renderLikedBar(); render.sites(); render.searchBtn();
  loadMore();
}
async function fetchVoted(it, signal) {
  if (!ALL_SITES.includes(it.site)) return null;
  const q = { include: ['id:' + it.id], exclude: [], or: [], orGroups: [], sort: 'id', rating: 'all', minScore: 0, page: 0, limit: 1 };
  try {
    const res = await gates[it.site].run(sig => api.posts(it.site, q, sig), signal);
    const post = res.posts.find(x => x.id === it.id);
    if (post) { saveSnapshot({ ...post, site: it.site }); return { ...post, site: it.site }; }
    fyJson('snap', { site: it.site, id: it.id, gone: true }).catch(() => {});
    return null;
  } catch (err) { if (err.name === 'AbortError') throw err; return undefined; }
}
async function loadLiked() {
  const L = S.liked;
  if (S.loading || L.done) return;
  S.loading = true; L.error = '';
  const gen = S.gen, signal = S.ctrl.signal;
  render.endState();
  try {
    const r = await fyJson(`liked?filter=${L.filter}&offset=${L.offset}&limit=20`, undefined, signal);
    if (gen !== S.gen) return;
    L.total = r.total; L.offset += r.items.length; if (!r.items.length || L.offset >= r.total) L.done = true;
    const got = await Promise.all(r.items.map(it => it.post ? { ...it.post, site: it.site } : it.gone ? null : fetchVoted(it, signal)));
    if (gen !== S.gen) return;
    L.unavailable += got.filter(x => !x).length;
    const fresh = got.filter(p => p && !S.keys.has(p.site + ':' + p.id));
    fresh.forEach(p => S.keys.add(p.site + ':' + p.id));
    const from = S.posts.length; S.posts.push(...fresh);
    render.appendPosts(from); if (S.vOpen) viewer.appendSlides(from);
  } catch (err) {
    if (err.name === 'AbortError' || gen !== S.gen) return;
    L.error = err.message || 'Something went wrong';
  }
  S.loading = false; render.endState(); render.status();
  requestAnimationFrame(() => { if (!L.done && !L.error && sentinelNear()) loadMore(); });
}

function renderFyBar() {
  const pr = S.fyState?.prefs || { mode: 'balanced', media: 'all' }, dive = S.fyState?.dive;
  [...$('fyMode').children].forEach(b => b.classList.toggle('on', !dive && b.dataset.m === pr.mode));
  [...$('fyMedia').children].forEach(b => b.classList.toggle('on', b.dataset.t === pr.media));
  $('fyMode').style.opacity = dive ? .45 : 1;
  $('fyDive').hidden = !dive;
  const wl = pr.whitelist || [], bl = pr.blacklist || [];
  $('fyWlBtn').textContent = '✓ Must have' + (wl.length ? ` (${wl.length})` : ''); $('fyWlBtn').classList.toggle('on', !!wl.length);
  $('fyBlBtn').textContent = '⛔ Never show' + (bl.length ? ` (${bl.length})` : ''); $('fyBlBtn').classList.toggle('on', !!bl.length);
  $('fyNextBtn').textContent = '⏭ Next after vote: ' + (S.autoNext ? 'on' : 'off'); $('fyNextBtn').classList.toggle('on', S.autoNext);
  $('fyNextBtn').setAttribute('aria-pressed', String(S.autoNext));
  const bN = Object.keys(pr.boost || {}).length;
  $('fyBoostBtn').textContent = '🎯 Favorites' + (bN ? ` (${bN})` : ''); $('fyBoostBtn').classList.toggle('on', bN > 0);
  const msN = Object.keys(pr.minScore || {}).length;
  $('fyScoreBtn').textContent = '▲ Min score' + (msN ? ` (${msN})` : ''); $('fyScoreBtn').classList.toggle('on', msN > 0);
  const nIgn = [pr.ignoreArtists, pr.ignoreCopyright, pr.ignoreCharacters, pr.ignoreSpecies].filter(Boolean).length;
  $('fyIgnBtn').textContent = '🚫 Ignore' + (nIgn ? ` (${nIgn})` : '') + ' ▾'; $('fyIgnBtn').classList.toggle('on', nIgn > 0);
  if (!$('fyPanel').hidden) renderFyPanel();
  if (dive) $('fyDiveText').textContent = `🧭 Deep Dive from ${dive.site} #${dive.id}`;
}
let fyPanelKey = null, fyPanelDirty = false;
const FY_PANELS = {
  whitelist: ['fyWlBtn', 'Must have (up to 10): every For you post contains ALL of these tags:', 'Add must-have tag, press Enter'],
  blacklist: ['fyBlBtn', 'Never show (For you only): posts with any of these tags are skipped:', 'Add tag, press Enter'],
  taste: ['fyTasteBtn'],
  ignore: ['fyIgnBtn'],
  score: ['fyScoreBtn'],
  boost: ['fyBoostBtn']
};
const BOOST_LABEL = { 3: '＋＋＋ Obsessed', 2: '＋＋ A lot more', 1: '＋ A bit more', '-1': '－ A bit less', '-2': '－－ A lot less', '-3': '－－－ Avoid hard' };
function renderBoostPanel(p) {
  const s = S.fyState, cur = { ...(s.prefs.boost || {}) }, types = { ...(s.prefs.boostType || {}) };
  p.append(el('p', 'hint', 'Favorite tags, artists and characters: pick the kind, type the name, and how much to push it. Added on top of what your votes say; it never changes your votes. Something you have never seen is searched for, and must exist on the site. Ignored tags can’t be favorites.'));
  const save = async (next, nt) => { if (await setPrefs({ boost: next, boostType: nt })) { fyPanelDirty = true; renderFyPanel(); } };
  const row = el('div', 'field'), inp = el('input', 'fyinput'), sel = el('select'), ksel = el('select');
  inp.placeholder = 'name, e.g. red_hair'; inp.style.flex = '1';
  for (const [k, t] of [['tag', 'Tag'], ['artist', 'Artist'], ['character', 'Character']]) { const o = el('option', null, t); o.value = k; ksel.append(o); }
  for (const k of [3, 2, 1, -1, -2, -3]) { const o = el('option', null, BOOST_LABEL[k]); o.value = k; if (k === 2) o.selected = true; sel.append(o); }
  const add = el('button', 'btn', 'Add');
  const doAdd = () => { const v = inp.value.trim().toLowerCase().replace(/\s+/g, '_'); if (!v) return; const nt = { ...types }; if (ksel.value === 'tag') delete nt[v]; else nt[v] = ksel.value; save({ ...cur, [v]: Number(sel.value) }, nt); };
  inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); doAdd(); } };
  add.onclick = doAdd; row.append(ksel, inp, sel, add); p.append(row);
  const names = Object.keys(cur);
  if (!names.length) p.append(el('p', 'hint', 'No favorites yet.'));
  for (const [kind, title] of [['character', 'Characters'], ['artist', 'Artists'], ['tag', 'Tags']]) {
    const group = names.filter(n => (types[n] || 'tag') === kind); if (!group.length) continue;
    p.append(el('p', 'hint', title));
    const list = el('div', 'fyblack');
    for (const n of group) {
      const c = el('span', null, `${n} · ${BOOST_LABEL[cur[n]] || cur[n]}`), x = el('button', null, '×');
      x.onclick = () => { const next = { ...cur }, nt = { ...types }; delete next[n]; delete nt[n]; save(next, nt); };
      c.append(x); list.append(c);
    }
    p.append(list);
  }
}
function renderScorePanel(p) {
  const ms = S.fyState.prefs.minScore || {};
  p.append(el('p', 'hint', 'Only show posts with a score GREATER than this, per site (empty or 0 = off). Scores differ a lot between sites, so set them separately.'));
  for (const [site, label] of [['rule34', 'rule34'], ['e621', 'e621'], ['e6ai', 'e6ai']]) {
    const f = el('div', 'field'); f.append(el('span', null, label + ' score >'));
    const inp = el('input', 'fyinput'); inp.type = 'number'; inp.min = '0'; inp.step = '10'; inp.value = ms[site] || ''; inp.placeholder = 'off'; inp.style.width = '110px';
    const save = async () => { if (await setPrefs({ minScore: { [site]: Number(inp.value) || 0 } })) fyPanelDirty = true; };
    inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); save(); } };
    inp.onchange = save;
    f.append(inp); p.append(f);
  }
}
function renderIgnorePanel(p) {
  const pr = S.fyState.prefs;
  p.append(el('p', 'hint', 'Ignored tag types are not learned from, scored or searched. Your votes are kept. Changes apply when you press Done.'));
  for (const [key, label] of [['ignoreArtists', '🎨 Artists'], ['ignoreCopyright', '© Series (copyright)'], ['ignoreCharacters', '👤 Characters'], ['ignoreSpecies', '🐾 Species']]) {
    p.append(segField(label, [true, false], !!pr[key], v => v ? 'Ignored' : 'Used', async v => { if (await setPrefs({ [key]: v })) { fyPanelDirty = true; await loadFyState(); } }));
  }
}
function renderTaste(p) {
  const s = S.fyState, cols = el('div', 'tastecols');
  p.append(el('p', 'hint', 'Heaviest tags in your profile (bar = how much each pushes the score). Press ⊘ to ignore a tag: it stops being learned from and scored.'));
  for (const [title, list, cls] of [['👍 Liked most', s.weightLiked || [], 'pos'], ['👎 Disliked most', s.weightDisliked || [], 'neg']]) {
    const col = el('div'); col.append(el('b', null, title));
    const max = Math.max(0.01, ...list.map(t => t.w));
    if (!list.length) col.append(el('p', 'hint', 'Nothing yet, keep voting.'));
    for (const t of list) {
      const row = el('div', 'tasterow ' + cls);
      const bar = el('i'); bar.style.width = Math.round(100 * t.w / max) + '%';
      const x = el('button', null, '⊘'); x.title = 'Ignore from algorithm'; x.setAttribute('aria-label', 'Ignore ' + t.name);
      x.onclick = async () => { if (await setPrefs({ ignored: [...new Set([...s.prefs.ignored, t.name])] })) { fyPanelDirty = true; await loadFyState(); toast(`Ignoring “${t.name}”`); renderFyPanel(); } };
      row.append(bar, el('span', 'tn', t.name), el('small', null, `${t.type} · ${t.w}`), x); col.append(row);
    }
    cols.append(col);
  }
  p.append(cols);
}
function renderFyPanel() {
  const p = $('fyPanel'), cfg = FY_PANELS[fyPanelKey]; p.replaceChildren();
  if (!cfg || !S.fyState?.prefs) { p.hidden = true; return; }
  p.hidden = false;
  const done = el('button', 'btn', 'Done'); done.onclick = () => closeFyPanel();
  if (fyPanelKey === 'taste') { renderTaste(p); p.append(done); }
  else if (fyPanelKey === 'ignore') { renderIgnorePanel(p); p.append(done); }
  else if (fyPanelKey === 'score') { renderScorePanel(p); p.append(done); }
  else if (fyPanelKey === 'boost') { renderBoostPanel(p); p.append(done); }
  else p.append(tagListEditor(cfg[1], fyPanelKey, cfg[2], S.fyState, () => { fyPanelDirty = true; }), done);
  for (const k in FY_PANELS) $(FY_PANELS[k][0]).setAttribute('aria-expanded', String(k === fyPanelKey));
  const inp = p.querySelector('input'); if (inp && document.activeElement === document.body) inp.focus();
}
function closeFyPanel() {
  fyPanelKey = null; $('fyPanel').hidden = true;
  for (const k in FY_PANELS) $(FY_PANELS[k][0]).setAttribute('aria-expanded', 'false');
  if (fyPanelDirty) { fyPanelDirty = false; enterForYou(); }
}
function toggleFyPanel(k) { if (fyPanelKey === k) closeFyPanel(); else { fyPanelKey = k; renderFyPanel(); } }
$('fyWlBtn').onclick = () => toggleFyPanel('whitelist');
$('fyBlBtn').onclick = () => toggleFyPanel('blacklist');
$('fyIgnBtn').onclick = () => toggleFyPanel('ignore');
$('fyScoreBtn').onclick = () => toggleFyPanel('score');
$('fyBoostBtn').onclick = () => toggleFyPanel('boost');
$('fyTasteBtn').onclick = async () => { if (fyPanelKey !== 'taste') await loadFyState(); toggleFyPanel('taste'); };
$('fyNextBtn').onclick = () => { S.autoNext = !S.autoNext; store.set('autoNext', S.autoNext); renderFyBar(); toast(S.autoNext ? 'Next post after voting: on' : 'Next post after voting: off'); };
async function setPrefs(patch) {
  try { const r = await fyJson('prefs', patch); S.fyState = { ...S.fyState, prefs: r.prefs }; renderFyBar(); return true; }
  catch (err) { toast(err.message); return false; }
}
$('fyMode').onclick = async e => { const b = e.target.closest('button'); if (b && await setPrefs({ mode: b.dataset.m })) enterForYou(); };
$('fyMedia').onclick = async e => { const b = e.target.closest('button'); if (b && await setPrefs({ media: b.dataset.t })) enterForYou(); };
async function startDive(p) {
  if (!S.fyOn || !p) return;
  try {
    const r = await fyJson('dive', { site: p.site, id: p.id, post: { tags: p.tags.map(t => ({ name: t.name, type: t.type })), rating: p.rating, type: p.type } });
    S.fyState = { ...S.fyState, dive: r.dive };
    if (S.vOpen) viewer.close();
    enterForYou();
  } catch (err) { toast(err.message); }
}
$('fyHelpBtn').onclick = () => { const h = $('fyHelp'); h.hidden = !h.hidden; $('fyHelpBtn').setAttribute('aria-expanded', String(!h.hidden)); };
$('fyDiveEnd').onclick = async () => { try { await fyJson('dive', { end: true }); S.fyState = { ...S.fyState, dive: null }; enterForYou(); } catch (err) { toast(err.message); } };
$('vDive').onclick = () => startDive(S.posts[S.vIndex]);
function enterForYou() {
  if (!S.fyOn) return;
  if (!S.sites.length) { toast('Turn on at least one site'); return; }
  S.ctrl?.abort(); S.ctrl = new AbortController(); S.gen++;
  setMode('foryou');
  S.active = { sites: [], foryou: true }; S.feeds = {};
  S.posts = []; S.keys = new Set(); S.md5s = new Set(); S.hiddenDupes = 0; S.loading = false; S.dirty = false; S.fy = { error: '' };
  $('results').replaceChildren();
  render.sites(); render.searchBtn(); render.status(); window.scrollTo(0, 0);
  loadMore();
}
async function loadForYou() {
  if (S.loading) return;
  S.loading = true; S.fy.error = '';
  const gen = S.gen, signal = S.ctrl.signal;
  render.endState();
  let got = 0;
  try {
    const p = new URLSearchParams({ sites: S.sites.join(' '), rating: S.rating, n: String(TOUCH.matches ? (S.posts.length ? 25 : 10) : S.fyBatch), shape: shapeNow() });
    const res = await fyJson('feed?' + p, undefined, signal);
    if (gen !== S.gen) return;
    const fresh = dedupe(res.posts);
    const from = S.posts.length; S.posts.push(...fresh); got = fresh.length;
    await showNew(from, gen);
    if (gen !== S.gen) return;
    if (!got && shapeNow() !== 'any') {
      if (S.orientDrop && (S.fyTries = (S.fyTries || 0) + 1) < 5) { S.loading = false; return loadForYou(); }
      S.fyNoShape = true; S.fyTries = 0; S.loading = false; toast('No posts in that shape, showing all'); return loadForYou();
    }
    S.fyTries = 0;
    if (got && res.note) toast(res.note);
    if (!got) S.fy.error = res.why || 'Nothing new found right now. Try again in a moment.';
    S.fy.cold = !!res.cold;
  } catch (err) {
    if (err.name === 'AbortError' || gen !== S.gen) return;
    S.fy.error = err.message || 'Something went wrong';
  }
  S.loading = false;
  render.endState(); render.status();
  if (got) requestAnimationFrame(() => { if (sentinelNear()) loadMore(); });
}

const hovered = { p: null };
const VOTE_BTNS = [['vLike', 1], ['vDislike', -1], ['vSuper', 2], ['vSDislike', -2]];
function voteClasses(card, v) {
  card.classList.toggle('disliked', v < 0);
  for (const [cls, want] of [['up', 1], ['dn', -1], ['sup', 2], ['sdn', -2]]) card.querySelector('.vbtn.' + cls)?.classList.toggle('on', v === want);
}
function refreshVote(p) {
  const i = S.posts.indexOf(p), v = S.votes[p.site + ':' + p.id] || 0;
  const card = $('results').children[i];
  if (card) voteClasses(card, v);
  if (S.vOpen && S.posts[S.vIndex] === p) {
    for (const [id, want] of VOTE_BTNS) $(id).classList.toggle('on', v === want);
  }
}
let voteToastEl, voteToastT;
function voteToast(msg, kind) {
  voteToastEl?.remove(); clearTimeout(voteToastT);
  voteToastEl = el('div', 'votetoast' + (kind === 2 ? ' sup' : kind === -2 ? ' sdn' : kind > 0 ? ' up' : kind < 0 ? ' dn' : ''), msg);
  voteToastEl.setAttribute('role', 'status'); document.body.append(voteToastEl);
  voteToastT = setTimeout(() => voteToastEl?.remove(), 1400);
}
let hoverLockUntil = 0;
function advanceFrom(p) {
  const i = S.posts.indexOf(p); if (i < 0) return;
  if (S.vOpen) {
    if (S.posts[S.vIndex] !== p) return;
    const v = viewer.slides[S.vIndex]?.querySelector('video');
    if (v && !v.loop && !v.ended) { viewer.waitNext = p; return; }
    viewer.step(1, true); return;
  }
  const card = $('results').children[i + 1]; if (!card) { if (S.mode === 'foryou') loadMore(); return; }
  hoverLockUntil = Date.now() + 900; hovered.p = S.posts[i + 1];
  card.scrollIntoView({ block: 'center', behavior: 'instant' });
}
function saveSnapshot(p) {
  const { site, id, md5, w, h, type, rating, score, file, sample, preview, compat, mid, ext, link, tags } = p;
  fyJson('snap', { site, id, post: { id, md5, w, h, type, rating, score, file, sample, preview, compat, mid, ext, link, tags } }).catch(() => {});
}
async function castVote(p, want) {
  if (!S.fyOn || !p) return;
  const k = p.site + ':' + p.id, cur = S.votes[k] || 0, next = cur === want ? 0 : want;
  if (next) S.votes[k] = next; else delete S.votes[k];
  refreshVote(p);
  if (next && S.autoNext) advanceFrom(p);
  const T = { 2: '⭐ Super liked', 1: '👍 Liked', '-1': '👎 Disliked', '-2': '⛔ Super disliked' };
  voteToast(next ? T[next] : ({ 2: 'Super like removed', 1: 'Like removed', '-1': 'Dislike removed', '-2': 'Super dislike removed' })[cur], next);
  const token = (castVote.n = (castVote.n || 0) + 1); (castVote.last ||= new Map()).set(k, token);
  const body = { site: p.site, id: p.id, vote: next, strat: p.strat, md5: p.md5 || '', dive: S.mode === 'foryou' && !!S.fyState?.dive, post: { tags: p.tags.map(t => ({ name: t.name, type: t.type })), rating: p.rating, type: p.type } };
  const WAITS = [1500, 3000, 6000, 10000, 15000, 20000];
  try {
    if (next) saveSnapshot(p);
    if (next && S.peek && S.fyOn && S.mode === 'foryou') reportViewed(p, true);
    for (let i = 0; ; i++) {
      try { await fyJson('vote', body); if (i) toast('Vote saved'); break; }
      catch (err) {
        if (err.status !== 0 || i >= WAITS.length) throw err;
        if (i === 0) toast('Connection dropped, retrying the vote...');
        await new Promise(r => setTimeout(r, WAITS[i]));
        if (castVote.last.get(k) !== token) return;
      }
    }
  } catch (err) {
    if (castVote.last.get(k) !== token) return;
    if (cur) S.votes[k] = cur; else delete S.votes[k];
    refreshVote(p); toast('Vote not saved: ' + err.message);
  }
}
function reportViewed(p, force = false) {
  if (S.peek && !force) return;
  const k = p.site + ':' + p.id; if (S.reported.has(k) || (!force && (!S.vOpen || S.posts[S.vIndex] !== p))) return;
  S.reported.add(k);
  fyJson('seen', { site: p.site, id: p.id, md5: p.md5 || '', post: { tags: p.tags.map(t => ({ name: t.name, type: t.type })), rating: p.rating, type: p.type } }).catch(() => S.reported.delete(k));
}
function applyFyUi() {
  document.body.classList.toggle('fy-on', S.fyOn); renderHints(); applyGestures();
  $('forBtn').hidden = !S.fyOn;
  if (!S.fyOn && S.mode === 'foryou') newSearch();
  S.posts.forEach(refreshVote);
}
function loadFyState() {
  return fyJson('state').then(s => { S.fyState = s; S.profiles = s.profileList || null; S.fyOn = s.enabled; S.votes = s.votes || {}; applyFyUi(); renderFyBar(); renderProfileSel(); }).catch(() => {});
}
const activeProfile = () => S.profiles?.profiles.find(p => p.id === S.profiles.active);
function renderProfileSel() {
  const sel = $('profileSel'); sel.replaceChildren();
  if (!S.profiles) { sel.hidden = true; return; }
  sel.hidden = false;
  for (const p of S.profiles.profiles) { const o = el('option', null, p.name); o.value = p.id; o.selected = p.id === S.profiles.active; sel.append(o); }
  const m = el('option', null, '＋ New / manage…'); m.value = '__manage'; sel.append(m);
}
async function profileAction(body) {
  try { S.profiles = await fyJson('profile', body); return true; } catch (err) { toast(err.message); return false; }
}
async function switchProfile(id) {
  if (id === S.profiles?.active) return;
  if (!await profileAction({ action: 'switch', id })) { renderProfileSel(); return; }
  S.reported = new Set(); await loadFyState();
  toast('Profile: ' + (activeProfile()?.name || ''));
  if (S.mode === 'foryou') enterForYou(); else if (S.mode === 'liked') enterLiked(); else S.posts.forEach(refreshVote);
  if (!$('sheetRoot').hidden && tab === 'settings') renderSheet();
}
$('profileSel').onchange = e => { const v = e.target.value; if (v === '__manage') { renderProfileSel(); openSheet('settings'); } else switchProfile(v); };
$('forBtn').onclick = () => enterForYou();
$('vLike').onclick = () => castVote(S.posts[S.vIndex], 1);
$('vDislike').onclick = () => castVote(S.posts[S.vIndex], -1);
$('vSuper').onclick = () => castVote(S.posts[S.vIndex], 2);
$('vSDislike').onclick = () => castVote(S.posts[S.vIndex], -2);
$('results').addEventListener('mouseover', e => {
  if (Date.now() < hoverLockUntil) return;
  const c = e.target.closest?.('.post'); hovered.p = c ? S.posts[+c.dataset.i] : null;
});
$('results').addEventListener('mouseleave', () => { hovered.p = null; });
const HK_LABEL = { like: 'Like', dislike: 'Dislike', superLike: 'Super like', superDislike: 'Super dislike', hints: 'Show / hide the hotkey bar', next: 'Next post (fullscreen)', prev: 'Previous post (fullscreen)', details: 'Details panel (fullscreen)', close: 'Close fullscreen', search: 'Search' };
const HK_DEFAULT = { like: '8', dislike: '2', superLike: '9', superDislike: '3', hints: 'h', next: 'j', prev: 'k', details: 'arrowright', close: 'escape', search: 'enter' };
const HK_VALUE = { like: 1, dislike: -1, superLike: 2, superDislike: -2 };
const HK_FIXED = [['↓ / ↑', 'Also next / previous post (fullscreen)'], ['←', 'Also details panel (fullscreen)']];
const HK_NAME = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', escape: 'Esc', enter: 'Enter', backspace: 'Backspace', delete: 'Del', home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn' };
const keyName = k => HK_NAME[k] || k.toUpperCase();
const hkAction = key => Object.keys(HK_LABEL).find(a => S.hk[a] === key);
document.addEventListener('keydown', e => {
  if (!S.capture) return;
  e.preventDefault(); e.stopPropagation();
  const act = S.capture, key = e.key.toLowerCase();
  if (['shift', 'control', 'alt', 'meta'].includes(key)) return;
  if ((e.key.length !== 1 && !HK_NAME[key]) || e.key === ' ') { toast('Use a letter, digit, symbol, arrow, Enter or Esc'); return; }
  const fixed = { arrowdown: 'next', arrowup: 'prev', arrowleft: 'details' }[key];
  if (fixed && fixed !== act) { toast(`“${keyName(key)}” is reserved for: ${HK_LABEL[fixed]}`); return; }
  const other = hkAction(key);
  if (other && other !== act) { toast(`“${keyName(key)}” is already used for: ${HK_LABEL[other]}`); return; }
  S.hk[act] = key; store.set('hotkeys', S.hk); S.capture = null; renderSheet(); renderHints();
}, true);
document.addEventListener('keydown', e => {
  if (S.capture || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.target.closest?.('input, textarea, select') || !$('sheetRoot').hidden) return;
  const act = hkAction(e.key.toLowerCase()); if (!act) return;
  if (act === 'hints') { if (S.fyOn) { e.preventDefault(); setHints(!S.hintsOn); } return; }
  if (!S.fyOn || !(act in HK_VALUE)) return;
  const p = S.vOpen ? S.posts[S.vIndex] : hovered.p;
  if (!p) return;
  e.preventDefault(); castVote(p, HK_VALUE[act]);
});

const TOUCH = window.matchMedia('(hover: none) and (pointer: coarse)');
function renderHints() {
  const b = $('hintBar'), on = S.fyOn && S.hintsOn && !TOUCH.matches;
  document.body.classList.toggle('hints-on', on); b.hidden = !on; b.replaceChildren();
  if (!on) return;
  const add = (key, text) => { const sp = el('span'); sp.append(el('kbd', null, keyName(key)), document.createTextNode(' ' + text)); b.append(sp); };
  add(S.hk.like, 'like'); add(S.hk.dislike, 'dislike'); add(S.hk.superLike, '⭐ super'); add(S.hk.superDislike, '⛔ super'); add(S.hk.hints, 'hide');
}
function setHints(on) { S.hintsOn = on; store.set('hintsOn', on); renderHints(); }
$('hintBar').onclick = () => setHints(false);
$('hintBtn').onclick = () => setHints(!S.hintsOn);
$('vHint').onclick = () => setHints(!S.hintsOn);

const HISTORY_MAX = 20;
function recordHistory() {
  if (!S.terms.length) return;
  const e = { sites: [...S.sites], terms: structuredClone(S.terms), sort: S.sort, rating: S.rating, minScore: S.minScore, t: Date.now() };
  const sig = JSON.stringify([e.sites, e.terms.map(t => [t.kind, t.name, t.mod]), e.sort, e.rating, e.minScore]);
  S.history = [{ ...e, sig }, ...S.history.filter(h => h.sig !== sig)].slice(0, HISTORY_MAX);
  store.set('history', S.history);
}
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
}
function newSearch(remember = true) {
  setMode('search');
  commitTyped();
  if (!S.sites.length) { toast('Turn on at least one site'); return; }
  S.ctrl?.abort(); S.ctrl = new AbortController();
  S.gen++; S.fyNoShape = false;
  S.active = { sites: [...S.sites], base: buildBase() };
  if (S.newSort) S.active.base.sort = S.newSort;
  S.newSince = S.newKey ? { key: S.newKey, prev: { ...(S.seen[S.newKey] || {}) }, n: 0 } : null;
  S.newKey = null; S.newSort = null;
  if (remember) recordHistory();
  S.feeds = Object.fromEntries(S.active.sites.map(s => [s, { page: 0, hasMore: true, error: '', hidden: 0 }]));
  S.posts = []; S.keys = new Set(); S.md5s = new Set(); S.hiddenDupes = 0; S.loading = false; S.dirty = false;
  persistSearch();
  $('results').replaceChildren();
  render.chips(); render.sites(); render.searchBtn(); render.status();
  window.scrollTo(0, 0);
  loadMore();
}
function dedupe(list) {
  const out = [];
  S.orientDrop = 0;
  for (const p of list) {
    if (shapeNow() !== 'any' && !S.feeds?.[p.site]?.noShape && p.w && p.h && ((p.h >= p.w * 0.9) !== (shapeNow() === 'portrait'))) { S.orientDrop++; continue; }
    const k = p.site + ':' + p.id;
    if (S.keys.has(k)) continue;
    if (p.md5 && !S.dupes) {
      if (S.md5s.has(p.md5)) { S.hiddenDupes++; continue; }
      S.md5s.add(p.md5);
    }
    S.keys.add(k); out.push(p);
  }
  return out;
}
function withoutTags(base, skip) {
  if (!skip?.size) return base;
  const keep = a => a.filter(t => !skip.has(t));
  return { ...base, include: keep(base.include), exclude: keep(base.exclude), or: keep(base.or), orGroups: base.orGroups.map(keep).filter(g => g.length) };
}
async function checkMissing(site, gen) {
  const b = S.active.base, names = [...new Set([...b.include, ...b.or, ...b.orGroups.flat()])].slice(0, 12);
  if (!names.length) return;
  try {
    const { exists } = await getJson(`/api/${site}/tagcheck?names=${encodeURIComponent(names.join(' '))}`);
    if (gen !== S.gen) return;
    const missing = names.filter(n => exists[n] === false);
    if (missing.length && missing.length < names.length + 1) { S.feeds[site].missing = missing; render.endState(); }
  } catch {}
}
async function loadMore() {
  if (!S.active || S.loading) return;
  if (S.mode === 'foryou') return loadForYou();
  if (S.mode === 'liked') return loadLiked();
  const live = S.active.sites.filter(s => S.feeds[s].hasMore && !S.feeds[s].error);
  if (!live.length) { render.endState(); return; }
  S.loading = true;
  const gen = S.gen, signal = S.ctrl.signal;
  render.endState();
  const batches = await Promise.all(live.map(async site => {
    const f = S.feeds[site];
    try {
      const get = () => gates[site].run(sig => api.posts(site, { ...withoutTags(S.active.base, f.skip), page: f.page, shape: f.noShape ? 'any' : undefined }, sig), signal);
      let res = await get();
      if (!res || !Array.isArray(res.posts)) { console.warn('empty answer from', site, res); res = await get(); }
      if (!res || !Array.isArray(res.posts)) throw new Error('empty answer, tap retry');
      if (gen !== S.gen) return [];
      if (f.page === 0 && !res.posts.length && shapeNow() !== 'any' && !f.noShape) { f.noShape = true; toast(`${site}: no posts in that shape, showing all`); return []; }
      if (f.page === 0 && !res.posts.length && !f.skip) checkMissing(site, gen);
      f.page++; f.hasMore = !!res.hasMore; f.hidden += res.hidden || 0;
      return res.posts.map(p => ({ ...p, site }));
    } catch (err) {
      if (err.name !== 'AbortError' && gen === S.gen) f.error = err.message || 'Something went wrong';
      return [];
    }
  }));
  if (gen !== S.gen) return;
  const merged = [], longest = Math.max(0, ...batches.map(b => b.length));
  for (let i = 0; i < longest; i++) for (const b of batches) if (b[i]) merged.push(b[i]);
  const fresh = dedupe(merged);
  trackNew(fresh);
  const from = S.posts.length;
  S.posts.push(...fresh);
  await showNew(from, gen);
  if (gen !== S.gen) return;
  S.loading = false;
  render.endState(); render.status();
  requestAnimationFrame(() => { if (sentinelNear()) loadMore(); });
}

const HOW = { anchor: 'searched your top tags', pivot: 'searched a top tag plus a mid-ranked one', reach: 'searched a tag from further down your list', wildcard: 'random-order search on one of your tags', popular: 'popular starter search (no taste data yet)', dive: 'Deep Dive search' };
function dbgLine(d) {
  const e = el('div', 'dbgline'); if (!d) return e;
  const pc = (x) => Math.round(x * 100) + '%';
  const t = [`#${d.rank} of ${d.of}`, `${pc(d.score)} match`];
  if (d.plus?.length) t.push('likes: ' + d.plus.map(x => x[0]).join(', '));
  if (d.minus?.length) t.push('dislikes: ' + d.minus.map(x => x[0]).join(', '));
  if (d.bl) t.push(`learned model: ${pc((d.bl.lr + 1) / 2)} (${d.bl.share}% of score)`);
  if (d.ai?.length) t.push('AI tags added: ' + d.ai.join(', '));
  t.push(`found by: ${HOW[d.strat] || d.strat}${d.ranks ? ' (' + d.ranks + ')' : d.q ? ' (' + d.q + ')' : ''}`);
  if (d.top?.length) t.push('your top tags: ' + d.top.join(', '));
  e.textContent = t.join(' · '); return e;
}
function setDebug(on) {
  S.fyDebug = on; store.set('fyDebug', on);
  document.body.classList.toggle('fy-debug', on);
  $('fyDebugBtn').classList.toggle('on', on); $('fyDebugBtn').setAttribute('aria-pressed', String(on));
}
$('fyDebugBtn').onclick = () => setDebug(!S.fyDebug);
function setPeek(on) {
  S.peek = on; try { sessionStorage.setItem('fyPeek', on ? '1' : ''); } catch {}
  $('fyPeekBtn').classList.toggle('on', on); $('fyPeekBtn').setAttribute('aria-pressed', String(on));
  toast(on ? 'Peek on: posts are not marked as seen' : 'Peek off');
}
$('fyPeekBtn').onclick = () => setPeek(!S.peek);
try { if (sessionStorage.getItem('fyPeek')) { S.peek = true; $('fyPeekBtn').classList.add('on'); $('fyPeekBtn').setAttribute('aria-pressed', 'true'); } } catch {}
function whyLine(w) {
  const d = el('div', 'why');
  d.append(el('b', null, '✦ ' + (w.label || 'For you')));
  if (w.tags?.length) d.append(document.createTextNode(' · likes: ' + w.tags.join(', ')));
  return d;
}

const render = {
  status() {
    const s = $('status'); s.replaceChildren();
    if (S.mode === 'liked') s.append(el('span', 'pill', `♥ Your votes: ${S.posts.length} of ${S.liked.total}`));
    else if (S.mode === 'foryou') s.append(el('span', 'pill', '✦ For you (beta): separate from search'));
    else if (S.dirty) s.append(el('span', 'pill busy', 'Not searched yet: press Search or Enter'));
    else if (S.newSince) s.append(el('span', 'pill', Object.keys(S.newSince.prev).length ? `${S.newSince.n} new since last time` : 'First check: next time, new posts get a NEW badge'));
    const sites = S.active ? S.active.sites : [];
    for (const site of sites) {
      const f = S.feeds[site], g = gates[site];
      const src = S.status?.sources?.find(x => x.id === site);
      const n = S.posts.reduce((a, p) => a + (p.site === site), 0);
      let state = g.note || (g.busy ? 'loading' : f.error ? 'error' : f.hasMore ? 'idle' : 'done');
      const pill = el('span', 'pill' + (g.note || f.error || (src && !src.configured) ? ' warn' : g.busy ? ' busy' : ''),
        `${site} · ${n}${f.hidden ? ` (+${f.hidden} hidden)` : ''} · ${state}`);
      if (src) pill.title = src.auth;
      s.append(pill);
    }
    const total = ALL_SITES.reduce((a, k) => a + gates[k].total, 0);
    if (S.hiddenDupes) s.append(el('span', 'pill', `${S.hiddenDupes} duplicates hidden`));
    s.append(el('span', 'pill', `${total} requests`));
  },
  sites() {
    const g = $('sites'); g.replaceChildren();
    for (const site of ALL_SITES) {
      const src = S.status?.sources?.find(x => x.id === site);
      const b = el('button', S.sites.includes(site) ? 'on' : null, site); b.type = 'button';
      b.setAttribute('aria-pressed', String(S.sites.includes(site)));
      if (src && !src.configured) b.title = `${site}: ${src.auth}`;
      b.onclick = () => {
        S.sites = S.sites.includes(site) ? S.sites.filter(x => x !== site) : ALL_SITES.filter(x => x === site || S.sites.includes(x));
        markDirty();
      };
      g.append(b);
    }
  },
  searchBtn() {
    const b = $('searchBtn');
    b.classList.toggle('pending', S.dirty);
    b.disabled = !S.sites.length;
  },
  chips() {
    const c = $('chips'); c.replaceChildren();
    S.terms.forEach((t, i) => {
      const chip = el('span', 'chip' + (t.mod === '-' ? ' neg' : t.mod === '~' ? ' or' : '') + (t.kind === 'super' ? ' super' : ''));
      const d = el('span', 'dot t-' + (t.kind === 'super' ? 'super' : (t.type || 'general')));
      const nm = el('button', 'nm', t.name); nm.title = 'Tap or right-click: include → exclude (−) → OR (~)';
      const cycle = e => { e.preventDefault(); t.mod = nextMod(t.mod); markDirty(); };
      nm.onclick = cycle; nm.oncontextmenu = cycle;
      const x = el('button', 'x', '×'); x.setAttribute('aria-label', 'Remove ' + t.name);
      x.onclick = () => { S.terms.splice(i, 1); markDirty(); };
      chip.append(d, nm);
      const si = t.kind === 'super' ? S.supers.findIndex(s => s.name === t.name) : -1;
      if (si >= 0) {
        const ed = el('button', 'x', '✎'); ed.title = 'Edit supertag'; ed.setAttribute('aria-label', 'Edit supertag ' + t.name);
        ed.onclick = () => { stEdit = { index: si, name: S.supers[si].name, tags: toTagObjs(S.supers[si].tags) }; openSheet('super'); };
        chip.append(ed);
      }
      chip.append(x); c.append(chip);
    });
    if (S.terms.length) {
      const clr = el('button', 'clearall', 'Hold to clear all'); clr.type = 'button'; clr.title = 'Press and hold for a second to remove all tags from this search';
      let t = null; const stop = () => { clearTimeout(t); t = null; clr.classList.remove('holding'); };
      clr.addEventListener('pointerdown', e => { if (e.button) return; clr.classList.add('holding'); t = setTimeout(() => { stop(); S.terms.length = 0; markDirty(); }, 900); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) clr.addEventListener(ev, stop);
      clr.addEventListener('contextmenu', e => e.preventDefault());
      c.append(clr);
    }
  },
  appendPosts(from, to = S.posts.length) {
    const r = $('results'), frag = document.createDocumentFragment();
    const multi = S.mode === 'foryou' || (S.active && S.active.sites.length > 1);
    for (let i = from; i < to; i++) {
      const p = S.posts[i];
      const card = el('article', 'post'); card.dataset.i = i;
      const media = el('button', 'media'); media.setAttribute('aria-label', `Open ${p.site} post ${p.id}`);
      media.style.aspectRatio = `${p.w} / ${p.h}`;
      const img = new Image(); img.loading = TOUCH.matches && i < 10 ? 'eager' : 'lazy'; img.decoding = 'async'; img.alt = '';
      img.referrerPolicy = 'no-referrer';
      setImg(img, p.type === 'image' && !(TOUCH.matches && p.preview) ? p.sample : p.preview);
      media.append(img);
      if (p.type !== 'image') media.append(el('span', 'badge', p.type));
      if (p.isNew) media.append(el('span', 'badge new', 'new'));
      media.onclick = () => { if (S.sel) toggleSel(p, card); else viewer.open(i); };
      if (S.sel?.has(p.site + ':' + p.id)) card.classList.add('selected');
      const meta = el('div', 'meta');
      if (multi) meta.append(el('span', 'sitetag', p.site));
      const artist = p.tags.find(t => t.type === 'artist');
      meta.append(el('span', null, '▲ ' + p.score), el('span', 'r', p.rating));
      if (artist) { const an = el('button', 'artistlink', (S.artists[artistKey(artist.name)] ? '♥ ' : '') + artist.name); an.dataset.artist = artist.name; an.title = 'Tap: add/remove favourite artist'; an.onclick = () => toggleArtist(artist.name); meta.append(an); }
      if (p.date) { const sp = el('span', null, timeAgo(p.date)); sp.title = p.date.slice(0, 10) + '  #' + p.id; meta.append(sp); }
      const up = el('button', 'vbtn up fy-only', '👍'), dn = el('button', 'vbtn dn fy-only', '👎');
      const sup = el('button', 'vbtn sup fy-only', '⭐'), sdn = el('button', 'vbtn sdn fy-only', '⛔');
      sup.type = sdn.type = 'button'; sup.title = 'Super like (9)'; sdn.title = 'Super dislike (3)';
      sup.onclick = () => castVote(p, 2); sdn.onclick = () => castVote(p, -2);
      up.type = dn.type = 'button'; up.title = 'Like (8)'; dn.title = 'Dislike (2)';
      up.onclick = () => castVote(p, 1); dn.onclick = () => castVote(p, -1);
      const dv = el('button', 'vbtn fy-only', '🧭'); dv.type = 'button'; dv.title = 'Deep Dive: more like this post'; dv.onclick = () => startDive(p);
      for (const b of [dv, sdn, dn, up, sup]) b.setAttribute('aria-label', b.title);
      meta.append(dv, sdn, dn, up, sup);
      card.append(media, meta);
      if (p.why) card.append(whyLine(p.why), dbgLine(p.dbg));
      const v = S.votes[p.site + ':' + p.id] || 0;
      if (v) voteClasses(card, v);
      frag.append(card);
    }
    r.append(frag);
    render.status();
  },
  endState() {
    const end = $('end'); end.replaceChildren(); end.hidden = false;
    $('vLoad').hidden = !(S.vOpen && S.loading);
    if (S.mode === 'liked') {
      const L = S.liked;
      if (L.error) { end.append(el('div', 'err', L.error)); const r = el('button', 'btn', 'Try again'); r.onclick = () => { L.error = ''; loadMore(); }; end.append(r); }
      else if (S.loading) end.append(el('div', null, S.posts.length ? 'Loading…' : 'Loading your votes…'));
      else if (L.done) end.append(el('div', null, S.posts.length ? `End · ${S.posts.length} posts${L.unavailable ? ` (${L.unavailable} no longer available or not loaded)` : ''}` : 'Nothing here yet. Vote on some posts first.'));
      else end.hidden = true;
      return;
    }
    if (S.mode === 'foryou') {
      if (S.fy.error) {
        end.append(el('div', 'err', S.fy.error));
        const r = el('button', 'btn', 'Try again'); r.onclick = () => { S.fy.error = ''; loadMore(); }; end.append(r);
      } else if (S.loading) end.append(el('div', null, S.posts.length ? 'Loading…' : 'Finding posts for you…'));
      else end.hidden = true;
      return;
    }
    if (!S.active) { end.textContent = 'Add tags, pick sites, then press Search (or Enter).'; return; }
    const errs = S.active.sites.filter(s => S.feeds[s].error);
    for (const site of errs) {
      const row = el('div', 'err', `${site}: ${S.feeds[site].error}`);
      const retry = el('button', 'btn', `Retry ${site}`);
      retry.onclick = () => { S.feeds[site].error = ''; loadMore(); };
      end.append(row, retry);
    }
    for (const site of S.active.sites) {
      const f = S.feeds[site]; if (!f.missing?.length) continue;
      const row = el('div', 'err', `${site}: no results. ${f.missing.join(', ')} ${f.missing.length > 1 ? "don't" : "doesn't"} exist on ${site} (tags are named differently per site).`);
      const go = el('button', 'btn', `Search ${site} without ${f.missing.length > 1 ? 'them' : 'it'}`);
      go.onclick = () => { f.skip = new Set(f.missing); f.missing = null; f.page = 0; f.hasMore = true; f.error = ''; loadMore(); };
      end.append(row, go); end.hidden = false;
    }
    const live = S.active.sites.some(s => S.feeds[s].hasMore && !S.feeds[s].error);
    if (S.loading) end.append(el('div', null, 'Loading…'));
    else if (!live && !errs.length) end.append(el('div', null, S.posts.length ? `End of results · ${S.posts.length} posts` : 'No results'));
    else if (!errs.length && !S.active.sites.some(x => S.feeds[x].missing?.length)) end.hidden = true;
  }
};

const q = $('q'), sug = $('suggest');
let sugItems = [], hl = -1, sugTimer, sugCtrl, sugMod = '+';
q.addEventListener('input', () => { clearTimeout(sugTimer); sugTimer = setTimeout(showSuggest, 300); });
async function showSuggest() {
  const { mod, name: text } = parsePrefix(q.value);
  sugMod = mod;
  if (!text) { showHistory(); return; }
  const supers = S.supers.filter(s => s.name.includes(text.toLowerCase())).map(s => ({ name: s.name, type: 'super', count: null }));
  drawSuggest(supers);
  if (text.length < 2) return;
  const site = S.sites[0] || 'rule34';
  sugCtrl?.abort(); sugCtrl = new AbortController();
  try {
    const { suggestions } = await api.suggest(site, text, sugCtrl.signal);
    if (parsePrefix(q.value).name !== text) return;
    drawSuggest([...supers, ...suggestions].slice(0, 10));
  } catch (err) { if (err.name !== 'AbortError') drawSuggest(supers); }
}
function drawSuggest(items) {
  sugItems = items; hl = -1; sug.replaceChildren();
  items.forEach(t => {
    const b = el('button'); b.type = 'button';
    b.append(el('span', 'dot t-' + t.type), el('span', null, MOD_LABEL[sugMod] + t.name),
      el('span', 'cnt', t.count == null ? 'supertag' : fmt(t.count)));
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => { pick(t, sugMod); q.focus(); };
    sug.append(b);
  });
  sug.hidden = !items.length || document.activeElement !== q;
}
function pick(t, mod = '+') {
  const kind = t.type === 'super' ? 'super' : 'tag';
  const existing = S.terms.find(x => x.name === t.name && x.kind === kind);
  if (existing) existing.mod = mod;
  else S.terms.push({ kind, name: t.name, mod, type: kind === 'tag' ? t.type : undefined });
  q.value = ''; sug.hidden = true; sugItems = []; markDirty();
}
function commitTyped() {
  const { mod, name } = parsePrefix(q.value);
  if (name) pick({ name: name.replace(/\s+/g, '_').toLowerCase(), type: 'general' }, mod);
}
q.addEventListener('keydown', e => {
  const btns = [...sug.children];
  if (e.key === 'ArrowDown' && btns.length) { e.preventDefault(); hl = (hl + 1) % btns.length; }
  else if (e.key === 'ArrowUp' && btns.length) { e.preventDefault(); hl = (hl - 1 + btns.length) % btns.length; }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const { mod, name: text } = parsePrefix(q.value);
    if (e.ctrlKey || e.metaKey) { newSearch(); return; }
    if (hl >= 0 && sugItems[hl] && !sug.hidden) pick(sugItems[hl], mod);
    else if (text) pick({ name: text.replace(/\s+/g, '_').toLowerCase(), type: 'general' }, mod);
    else newSearch();
    return;
  } else if (e.key === 'Escape') { sug.hidden = true; return; }
  btns.forEach((b, i) => b.classList.toggle('hl', i === hl));
});
function runHistory(hh) {
  closeSheet(); sug.hidden = true;
  S.sites = hh.sites.filter(x => ALL_SITES.includes(x)); S.terms = structuredClone(hh.terms).map(normTerm);
  S.sort = hh.sort; S.rating = hh.rating; S.minScore = hh.minScore; syncFilterUi(); newSearch();
}
function showHistory() {
  if (q.value.trim() || !S.history.length) { if (!q.value.trim()) sug.hidden = true; return; }
  sugItems = []; hl = -1; sug.replaceChildren();
  S.history.forEach(hh => {
    const b = el('button'); b.type = 'button'; b.append(el('span', null, '🕘 ' + hh.terms.map(termLabel).join(' ')), el('span', 'cnt', ago(hh.t)));
    b.onmousedown = e => e.preventDefault(); b.onclick = () => runHistory(hh); sug.append(b);
  });
  sug.hidden = document.activeElement !== q;
}
q.addEventListener('focus', showHistory); q.addEventListener('click', showHistory);
q.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 120));
$('searchBtn').onclick = () => newSearch();

function syncFilterUi() {
  $('sort').value = S.sort; $('minScore').value = S.minScore;
  [...$('rating').children].forEach(x => x.classList.toggle('on', x.dataset.r === S.rating));
  [...$('orient').children].forEach(x => x.classList.toggle('on', x.dataset.o === S.orient));
  render.sites();
}
$('sort').onchange = e => { S.sort = e.target.value; markDirty(); };
$('rating').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  S.rating = b.dataset.r; syncFilterUi(); markDirty();
};
$('orient').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  S.orient = b.dataset.o; store.set('orient', S.orient); syncFilterUi(); markDirty();
};
$('minScore').oninput = e => { S.minScore = Math.max(0, +e.target.value || 0); markDirty(); };
$('minScore').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); newSearch(); } };

document.addEventListener('keydown', e => {
  if (S.capture || hkAction(e.key.toLowerCase()) !== 'search' || S.vOpen || !$('sheetRoot').hidden) return;
  const t = e.target;
  if (t.closest && t.closest('input, textarea, select, button, a')) return;
  e.preventDefault(); newSearch();
});

let sentinelVisible = false, sentinelObs;
function sentinelNear() {
  const margin = window.innerHeight * S.aheadScreens;
  return $('sentinel').getBoundingClientRect().top < window.innerHeight + margin;
}
let tailObs = null;
function watchTail() {
  tailObs?.disconnect(); tailObs = null;
  if (!TOUCH.matches || S.mode === 'liked') return;
  const cards = $('results').children, c = cards[Math.max(0, cards.length - 10)]; if (!c) return;
  tailObs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { tailObs.disconnect(); loadMore(); } });
  tailObs.observe(c);
}
async function showNew(from, gen) {
  if (!(TOUCH.matches && from === 0 && S.posts.length)) { render.appendPosts(from); if (S.vOpen) viewer.appendSlides(from); watchTail(); return; }
  const k = Math.min(10, S.posts.length);
  render.appendPosts(0, k);
  const imgs = [...$('results').querySelectorAll('img')].slice(0, 10).filter(i => !i.complete);
  if (imgs.length) await new Promise(res => {
    let n = imgs.length; const t = setTimeout(res, 20000), done = () => { if (--n <= 0) { clearTimeout(t); res(); } };
    for (const i of imgs) { i.addEventListener('load', done, { once: true }); i.addEventListener('error', done, { once: true }); }
  });
  if (gen !== S.gen) return;
  if (S.posts.length > k) render.appendPosts(k);
  if (S.vOpen) viewer.appendSlides(0);
  watchTail();
}
function observeSentinel() {
  sentinelObs?.disconnect(); sentinelVisible = false;
  sentinelObs = new IntersectionObserver(([e]) => { sentinelVisible = e.isIntersecting; if (sentinelVisible) loadMore(); },
    { rootMargin: `${Math.round(window.innerHeight * S.aheadScreens)}px 0px` });
  sentinelObs.observe($('sentinel'));
}
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(observeSentinel, 300); });

let tab = 'saved';
function openSheet(t) {
  tab = t; $('sheetRoot').hidden = false;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  renderSheet();
}
const closeSheet = () => { $('sheetRoot').hidden = true; stEdit = null; S.capture = null; };
$('libBtn').onclick = () => openSheet(tab === 'settings' ? 'saved' : tab);
$('setBtn').onclick = () => { openSheet('settings'); lib('library').then(r => { S.lib = r; if (!$('sheetRoot').hidden && tab === 'settings') renderSheet(); }).catch(() => {}); loadFyState().then(() => { if (!$('sheetRoot').hidden && tab === 'settings') renderSheet(); }); };
$('sheetBg').onclick = closeSheet;
document.querySelector('.tabs').onclick = e => { const b = e.target.closest('button'); if (b) { stEdit = null; openSheet(b.dataset.tab); } };
const termLabel = t => MOD_LABEL[t.mod] + (t.kind === 'super' ? '★' : '') + t.name;

function segField(label, opts, cur, fmtOpt, onpick) {
  const f = el('div', 'field'); f.append(el('span', null, label));
  const g = el('div', 'seg');
  opts.forEach(v => {
    const b = el('button', v === cur ? 'on' : null, fmtOpt(v)); b.type = 'button';
    b.onclick = () => { onpick(v); renderSheet(); render.status(); };
    g.append(b);
  });
  f.append(g); return f;
}

let stEdit = null;
const toTagObjs = arr => arr.map(raw => parsePrefix(raw)).filter(t => t.name);
const toTagStrings = arr => arr.map(t => (t.mod === '+' ? '' : t.mod) + t.name);

function renderSupertags(body) {
  if (stEdit) return renderSupertagEditor(body);
  const newBtn = el('button', 'btn', 'New supertag');
  newBtn.onclick = () => { stEdit = { index: -1, name: '', tags: [] }; renderSheet(); };
  body.append(newBtn, el('p', 'hint', 'A supertag is a named bundle of tags. Add it like a tag (it shows up in autocomplete); it expands when searching. Its ~ tags form their own OR group.'));
  const list = el('div', 'list');
  S.supers.forEach((s, i) => {
    const it = el('div', 'item'), g = el('button', 'grow');
    g.title = 'Add to search';
    g.append(el('div', 't', '★ ' + s.name), el('div', 's', s.tags.join(' ')));
    g.onclick = () => { closeSheet(); pick({ name: s.name, type: 'super' }, '+'); };
    const edit = el('button', 'iconbtn', 'Edit');
    edit.onclick = () => { stEdit = { index: i, name: s.name, tags: toTagObjs(s.tags) }; renderSheet(); };
    it.append(g, edit); list.append(it);
  });
  if (!S.supers.length) body.append(el('p', 'hint', 'No supertags yet.'));
  body.append(list);
}

function renderSupertagEditor(body) {
  const e = stEdit;
  body.append(el('h3', 'sheet-title', e.index < 0 ? 'New supertag' : 'Edit supertag'));
  const nameField = el('label', 'field', 'Name');
  const nm = el('input'); nm.id = 'stName'; nm.autocomplete = 'off'; nm.placeholder = 'e.g. favourite_artists'; nm.value = e.name;
  nm.oninput = () => { e.name = nm.value; };
  nameField.append(nm);

  const chips = el('div', 'chips st-chips');
  const drawChips = () => {
    chips.replaceChildren();
    if (!e.tags.length) chips.append(el('span', 'hint', 'No tags yet. Add some below.'));
    e.tags.forEach((t, i) => {
      const chip = el('span', 'chip' + (t.mod === '-' ? ' neg' : t.mod === '~' ? ' or' : ''));
      const nmb = el('button', 'nm', t.name); nmb.type = 'button'; nmb.title = 'Tap or right-click: include → exclude (−) → OR (~)';
      const cycle = ev => { ev.preventDefault(); t.mod = nextMod(t.mod); drawChips(); };
      nmb.onclick = cycle; nmb.oncontextmenu = cycle;
      const x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remove ' + t.name);
      x.onclick = () => { e.tags.splice(i, 1); drawChips(); };
      chip.append(nmb, x); chips.append(chip);
    });
  };
  drawChips();

  const addField = el('label', 'field', 'Add tag');
  const add = el('input'); add.id = 'stAdd'; add.autocomplete = 'off'; add.placeholder = 'tag, -tag or ~tag, then Enter';
  add.setAttribute('autocapitalize', 'off'); add.spellcheck = false;
  const dl = el('datalist'); dl.id = 'stSuggest'; add.setAttribute('list', 'stSuggest');
  let t1, ctrl;
  add.oninput = () => {
    clearTimeout(t1);
    t1 = setTimeout(async () => {
      const { mod, name } = parsePrefix(add.value);
      if (name.length < 2) return;
      ctrl?.abort(); ctrl = new AbortController();
      try {
        const { suggestions } = await api.suggest(S.sites[0] || 'rule34', name, ctrl.signal);
        dl.replaceChildren(...suggestions.map(sg => { const o = el('option'); o.value = MOD_LABEL[mod].replace('−', '-') + sg.name; o.label = fmt(sg.count); return o; }));
      } catch {}
    }, 300);
  };
  const addTag = () => {
    for (const raw of add.value.split(/\s+/)) {
      const t = parsePrefix(raw); if (!t.name) continue;
      t.name = t.name.toLowerCase();
      const ex = e.tags.find(x => x.name === t.name);
      if (ex) ex.mod = t.mod; else e.tags.push(t);
    }
    add.value = ''; dl.replaceChildren(); drawChips(); add.focus();
  };
  add.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); addTag(); } };
  const addBtn = el('button', 'btn ghost', 'Add'); addBtn.type = 'button'; addBtn.onclick = addTag;
  const line = el('div', 'inline'); line.append(add, addBtn);
  addField.append(line, dl);

  const fromSearch = el('button', 'btn ghost', 'Add tags from current search'); fromSearch.type = 'button';
  fromSearch.disabled = !S.terms.some(t => t.kind === 'tag');
  fromSearch.onclick = () => {
    for (const t of S.terms) if (t.kind === 'tag' && !e.tags.some(x => x.name === t.name)) e.tags.push({ mod: t.mod, name: t.name });
    drawChips();
  };

  const err = el('p', 'err');
  const save = el('button', 'btn', 'Save'); save.type = 'button';
  save.onclick = () => {
    const name = e.name.trim().replace(/\s+/g, '_').toLowerCase();
    if (add.value.trim()) addTag();
    if (!name) { err.textContent = 'Give it a name.'; return; }
    if (!e.tags.length) { err.textContent = 'Add at least one tag.'; return; }
    if (S.supers.some((s, i) => s.name === name && i !== e.index)) { err.textContent = `A supertag called "${name}" already exists.`; return; }
    const entry = { name, tags: toTagStrings(e.tags) };
    if (e.index < 0) S.supers.unshift(entry);
    else {
      const old = S.supers[e.index].name;
      S.supers[e.index] = entry;
      if (old !== name) S.terms.forEach(t => { if (t.kind === 'super' && t.name === old) t.name = name; });
    }
    store.set('supers', S.supers);
    if (S.terms.some(t => t.kind === 'super' && t.name === name)) markDirty();
    stEdit = null; renderSheet(); toast('Supertag saved');
  };
  const cancel = el('button', 'btn ghost', 'Cancel'); cancel.type = 'button';
  cancel.onclick = () => { stEdit = null; renderSheet(); };
  const btns = el('div', 'inline'); btns.append(save, cancel);
  if (e.index >= 0) {
    const del = el('button', 'btn ghost danger', 'Delete'); del.type = 'button';
    let armed = false;
    del.onclick = () => {
      if (!armed) { armed = true; del.textContent = 'Tap again to delete'; return; }
      const old = S.supers[e.index].name;
      S.supers.splice(e.index, 1); store.set('supers', S.supers);
      if (S.terms.some(t => t.kind === 'super' && t.name === old)) { S.terms = S.terms.filter(t => !(t.kind === 'super' && t.name === old)); markDirty(); }
      stEdit = null; renderSheet(); toast('Supertag deleted');
    };
    btns.append(del);
  }
  body.append(nameField, el('div', 'field', 'Tags'), chips, addField, fromSearch, err, btns);
  if (e.index < 0) nm.focus();
}

function renderSheet() {
  const body = $('sheetBody'); body.replaceChildren();
  const list = el('div', 'list');
  if (tab === 'saved') {
    const save = el('button', 'btn', 'Save current search'); save.disabled = !S.terms.length;
    save.onclick = () => {
      S.saved.unshift({ sites: [...S.sites], name: S.terms.map(termLabel).join(' '), terms: structuredClone(S.terms), sort: S.sort, rating: S.rating, minScore: S.minScore });
      store.set('saved', S.saved); renderSheet(); toast('Search saved');
    };
    body.append(save);
    if (!S.saved.length) body.append(el('p', 'hint', 'No saved searches yet. Add some tags, then save.'));
    S.saved.forEach((s, i) => {
      const sites = s.sites || [s.site || 'rule34'];
      const it = el('div', 'item'), g = el('button', 'grow');
      g.append(el('div', 't', s.name), el('div', 's', `${sites.join(' + ')} · ${s.sort} · ${s.rating}${s.minScore ? ' · score ≥ ' + s.minScore : ''}`));
      g.onclick = () => {
        closeSheet();
        S.sites = sites.filter(x => ALL_SITES.includes(x));
        S.terms = structuredClone(s.terms).map(normTerm); S.sort = s.sort; S.rating = s.rating; S.minScore = s.minScore;
        S.newKey = 'saved:' + JSON.stringify([s.name, s.terms]);
        syncFilterUi(); newSearch();
      };
      const del = el('button', 'iconbtn', 'Delete');
      del.onclick = () => { S.saved.splice(i, 1); store.set('saved', S.saved); renderSheet(); };
      it.append(g, del); list.append(it);
    });
    body.append(list, el('p', 'hint', 'Stored only in this browser. Opening a saved search runs it right away.'));
  } else if (tab === 'history') {
    if (!S.history.length) body.append(el('p', 'hint', 'No searches yet. Your last 20 searches show up here, even after closing the app.'));
    else { const clr = el('button', 'btn ghost', 'Clear history'); clr.onclick = () => { S.history = []; store.set('history', []); renderSheet(); }; body.append(clr); }
    S.history.forEach(hh => {
      const it = el('div', 'item'), g = el('button', 'grow');
      g.append(el('div', 't', hh.terms.map(termLabel).join(' ')), el('div', 's', `${hh.sites.join(' + ')} · ${hh.sort} · ${hh.rating}${hh.minScore ? ' · score ≥ ' + hh.minScore : ''} · ${ago(hh.t)}`));
      g.onclick = () => runHistory(hh);
      const sv = el('button', 'iconbtn', 'Save'); sv.title = 'Keep in Saved searches';
      sv.onclick = () => { S.saved.unshift({ sites: hh.sites, name: hh.terms.map(termLabel).join(' '), terms: structuredClone(hh.terms), sort: hh.sort, rating: hh.rating, minScore: hh.minScore }); store.set('saved', S.saved); toast('Saved'); };
      it.append(g, sv); body.append(it);
    });
  } else if (tab === 'artists') {
    renderArtists(body);
  } else if (tab === 'super') {
    renderSupertags(body);
  } else {
    body.append(
      segField('Posts per request (per site)', [10, 20, 50, 100], S.pageSize, String, v => { S.pageSize = v; store.set('pageSize', v); markDirty(); }),
      el('p', 'hint', 'Applies from your next search.'),
      segField('Start loading more', [1, 2, 3, 5], S.aheadScreens, v => v + (v === 1 ? ' screen' : ' screens'), v => { S.aheadScreens = v; store.set('aheadScreens', v); observeSentinel(); }),
      el('p', 'hint', 'How far before the bottom of the feed the next page is requested. In fullscreen it loads when 5 posts remain.'),
      segField('Fullscreen image quality', [false, true], S.original, v => v ? 'Original' : 'Sample', v => { S.original = v; store.set('original', v); }),
      el('p', 'hint', 'Original files can be several MB each. Sample is plenty for a phone.'),
      segField('Duplicate posts (same file, e.g. on two sites)', [false, true], S.dupes, v => v ? 'Show' : 'Hide', v => { S.dupes = v; store.set('dupes', v); markDirty(); }),
      el('p', 'hint', 'Detected by the file checksum (MD5). Applies from your next search.'),
      segField('Auto-advance delay (images)', [3, 5, 8, 12], S.autoDelay, v => v + ' s', v => { S.autoDelay = v; store.set('autoDelay', v); }),
      segField('Loop videos', [true, false], S.loopVideos, v => v ? 'On' : 'Off', v => { S.loopVideos = v; store.set('loopVideos', v); const cur = viewer.slides[S.vIndex]?.querySelector('video'); if (cur) cur.loop = v && !S.auto; }),
      el('p', 'hint', 'Off: a video stops at the end, and "next after vote" waits for it to finish before moving on. Auto-advance never loops.'),
      segField('Video quality (e621 / e6ai)', ['medium', 'auto', 'original', 'compatible'], S.videoQuality, v => ({ medium: 'Medium (720p)', auto: 'Auto', original: 'Original only', compatible: 'Compatible' })[v], v => { S.videoQuality = v; store.set('videoQuality', v); }),
      el('p', 'hint', 'Auto: the original (webm/VP9, full quality) when your browser can play it, otherwise the mp4 copy (max 1080p, 3 Mbit/s). Original only: always the original, never the copy, even if it fails to play. Compatible: always the mp4 copy.')
    );
    const pages = !!S.status?.pages;
    if (!pages) body.append(
      segField('Keep liked pictures on this computer', [false, true], !!S.lib?.enabled, v => v ? 'On' : 'Off', async v => { try { S.lib = await lib('library', { enabled: v }); } catch (err) { toast(err.message); } renderSheet(); }),
      el('p', 'hint', `When on, a post you like is saved to data/library/ using the copy already loaded on screen (nothing is downloaded twice), and is shown from disk after that. Off: nothing new is saved; saved files stay and are still used.${S.lib ? ` Saved so far: ${S.lib.count}.` : ''}`)
    );
    body.append(renderForYouSettings());
    for (const src of S.status?.sources || []) {
      body.append(el('p', src.configured ? 'ok' : 'hint', `${src.label}: ${src.auth}`));
      if (!src.keys?.length) continue;
      const inputs = src.keys.map(k => { const i = el('input'); i.type = 'password'; i.autocomplete = 'off'; i.placeholder = `${k.name} (${k.set ? 'set' : 'not set'})`; i.dataset.k = k.name; return i; });
      const save = el('button', 'btn', 'Save');
      save.onclick = async () => {
        const vals = Object.fromEntries(inputs.filter(i => i.value.trim()).map(i => [i.dataset.k, i.value.trim()]));
        if (!Object.keys(vals).length) return;
        try { await fyJson('keys', vals, undefined, '/api/'); S.status = await api.status(); toast(`${src.label} login saved${pages ? ' in this browser' : ' to .dev.vars'}`); } catch (err) { toast(err.message); }
        renderSheet();
      };
      const row = el('div', 'field'); row.append(...inputs, save); body.append(row);
    }
    body.append(renderCustomSites());
    if (pages) { body.append(el('p', 'hint', 'Saved in this browser only, like everything else here. Leave a field empty to keep its current value.')); body.append(renderBackup()); return; }
    body.append(el('p', 'hint', 'Saved to .dev.vars on the computer running the server (only from that computer). Leave a field empty to keep its current value. Restart the server if a site still ignores a new login.'));
    body.append(el('p', 'hint', 'e621 and e6ai images are loaded through your local server with your login.'));
    const rs = el('button', 'btn', '↻ Restart server (start-phone.bat)');
    rs.onclick = async () => {
      if (!rs.dataset.sure) {
        rs.dataset.sure = '1'; rs.textContent = 'Tap again to restart (app is down a few seconds)';
        setTimeout(() => { delete rs.dataset.sure; if (!rs.disabled) rs.textContent = '↻ Restart server (start-phone.bat)'; }, 4000); return;
      }
      rs.disabled = true; rs.textContent = 'Restarting…';
      try { await lib('restart', {}); } catch (err) { toast(err.message); rs.disabled = false; rs.textContent = '↻ Restart server (start-phone.bat)'; return; }
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try { const r = await fetch('/api/status', { cache: 'no-store' }); if (r.ok) { location.reload(); return; } } catch {}
      }
      rs.textContent = 'Server did not come back. Check the PC.';
    };
    body.append(rs);
  }
}

function renderBackup() {
  const box = el('div');
  box.append(el('h3', null, 'Backup'));
  box.append(el('p', 'hint', 'This version keeps your likes, profiles, saved searches and sites in this browser only. Clearing site data deletes them, and iOS clears it after 7 days without a visit unless the page is added to the home screen. Save a backup file now and then (logins are not included).'));
  const save = el('button', 'btn', 'Save backup file');
  save.onclick = () => { const x = document.createElement('a'); x.href = 'api/pages/backup'; x.download = ''; document.body.append(x); x.click(); x.remove(); };
  const pick = el('input'); pick.type = 'file'; pick.accept = '.json,application/json'; pick.hidden = true;
  const load = el('button', 'btn', 'Restore from file');
  load.onclick = () => {
    if (!load.dataset.sure) { load.dataset.sure = '1'; load.textContent = 'Tap again: replaces everything stored here'; setTimeout(() => { delete load.dataset.sure; load.textContent = 'Restore from file'; }, 4000); return; }
    pick.click();
  };
  pick.onchange = async () => {
    const f = pick.files?.[0]; if (!f) return;
    try { const b = JSON.parse(await f.text()); await fyJson('backup', b, undefined, 'api/pages/'); location.reload(); } catch (err) { toast(err.message || 'Not a backup file'); }
  };
  const row = el('div', 'field'); row.append(save, load, pick); box.append(row);
  box.append(renderDrive());
  return box;
}

let driveMod = null;
function renderDrive() {
  const box = el('div');
  const signedIn = driveMod?.signedIn();
  box.append(el('p', 'hint', signedIn
    ? 'Syncing to your Google Drive every few minutes and when you leave the page (one file in a hidden app folder; logins are not included). Sign in again after a reload or after an hour.'
    : 'Optional: keep a copy in your own Google Drive. Off until you sign in; nothing is sent to Google before that.'));
  const row = el('div', 'field');
  const fail = (err) => toast(err.message || 'Google Drive sync failed');
  if (!signedIn) {
    const b = el('button', 'btn', 'Sign in with Google to sync');
    b.onclick = async () => {
      try {
        driveMod ||= await import('./drive.js');
        const remote = await driveMod.signIn();
        if (remote && confirm(`Google Drive has a copy from ${new Date(remote.remoteAt).toLocaleString()}.\n\nOK: use the Drive copy (replaces what this browser has).\nCancel: keep this browser's data and overwrite the Drive copy.`)) { await driveMod.pull(); location.reload(); return; }
        await driveMod.push(); driveMod.start(fail); toast('Synced to Google Drive');
      } catch (err) { fail(err); }
      renderSheet();
    };
    row.append(b);
  } else {
    const now = el('button', 'btn', 'Sync now');
    now.onclick = async () => { try { toast(await driveMod.push() ? 'Synced to Google Drive' : 'Signed out: sign in again'); } catch (err) { fail(err); } renderSheet(); };
    const out = el('button', 'btn', 'Sign out');
    out.onclick = () => { driveMod.signOut(); renderSheet(); };
    row.append(now, out);
  }
  box.append(row);
  return box;
}

function renderArtists(body) {
  const names = Object.keys(S.artists).sort();
  const row = el('div', 'field'), kind = el('select');
  for (const [k, t] of [['artist', 'Artist'], ['character', 'Character'], ['tag', 'Tag']]) { const o = el('option', null, t); o.value = k; kind.append(o); }
  const add = el('input'); add.className = 'fyinput'; add.placeholder = 'Add favorite (e.g. some_artist), Enter'; add.autocomplete = 'off'; add.spellcheck = false; add.style.flex = '1';
  add.onkeydown = ev => {
    if (ev.key !== 'Enter') { ev.stopPropagation(); return; }
    ev.preventDefault(); ev.stopPropagation();
    const k = artistKey(add.value); if (!k) return;
    if (S.artists[k]) toast('Already in your list'); else toggleArtist(k, kind.value);
  };
  row.append(kind, add); body.append(row);
  if (names.length) {
    const nb = el('button', 'btn', '🔔 What’s new from my favorites'); nb.onclick = checkNew; body.append(nb);
    body.append(el('p', 'hint', 'Shows the latest posts from your favorites in one search. Anything posted since you last checked gets a NEW badge. Saved searches do the same when you open them. Remembered only on this computer.'));
  }
  if (!names.length) body.append(el('p', 'hint', 'No favorites yet. Tap an artist name on a post, or ♡ next to any tag in the tag list, or add one above.'));
  for (const [k, title] of [['artist', 'Artists'], ['character', 'Characters'], ['tag', 'Tags']]) {
    const group = names.filter(n => (S.artists[n].kind || 'artist') === k); if (!group.length) continue;
    body.append(el('h3', null, title));
    if (group.length > 1) { const all = el('button', 'btn', `Search all ${group.length} (any of them)`); all.onclick = () => searchArtists(group, k); body.append(all); }
    const list = el('div', 'list');
    for (const n of group) {
      const a = S.artists[n], it = el('div', 'item artist');
      const g = el('button', 'grow'); g.append(el('div', 't', n)); g.onclick = () => searchArtists([n], k); g.title = 'Search this';
      const note = el('input'); note.className = 'fyinput note'; note.value = a.note || ''; note.placeholder = 'note…'; note.maxLength = 500;
      const saveNote = async () => { if (note.value === (a.note || '')) return; try { const r = await lib('artists', { name: n, note: note.value }); S.artists[n] = r.artist; toast('Note saved'); } catch (err) { toast(err.message); } };
      note.onblur = saveNote; note.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); note.blur(); } };
      const del = el('button', 'iconbtn', '×'); del.title = 'Remove'; del.onclick = () => toggleArtist(n);
      it.append(g, note, del); list.append(it);
    }
    body.append(list);
  }
  body.append(el('p', 'hint', 'Stored only on this computer (data/artists.json). Searched as tags; tag names can differ between sites.'));
}

function renderProfiles() {
  const d = el('div', 'fybox'); d.append(el('h3', null, '👤 Profiles'));
  d.append(el('p', 'hint', 'Each profile learns from its own likes and dislikes. “Default” is your original data and is never changed by other profiles.'));
  const P = S.profiles; if (!P) return d;
  for (const p of P.profiles) {
    const row = el('div', 'profrow'), on = p.id === P.active;
    row.append(el('span', 'grow', `${on ? '● ' : ''}${p.name}${p.kind === 'paheal-all' ? ' (Paheal · from other sites)' : p.kind === 'paheal-own' ? ' (Paheal · own likes only)' : ''} · ${p.likes} 👍 ${p.dislikes} 👎`));
    if (!on) { const b = el('button', 'mini', 'Switch'); b.onclick = () => switchProfile(p.id); row.append(b); }
    const rn = el('button', 'mini', 'Rename'); rn.onclick = () => {
      const inp = el('input'); inp.className = 'fyinput'; inp.value = p.name; inp.maxLength = 40; row.replaceChildren(inp); inp.focus();
      inp.onkeydown = async ev => { ev.stopPropagation(); if (ev.key === 'Enter') { if (await profileAction({ action: 'rename', id: p.id, name: inp.value })) { await loadFyState(); renderSheet(); } } else if (ev.key === 'Escape') renderSheet(); };
    };
    row.append(rn);
    if (p.id !== 'default') {
      const del = el('button', 'mini', 'Remove'); let armed = null;
      del.onclick = async () => {
        if (!armed) { del.textContent = 'Click again'; armed = setTimeout(() => { armed = null; del.textContent = 'Remove'; }, 4000); return; }
        clearTimeout(armed); if (await profileAction({ action: 'delete', id: p.id, confirm: true })) { S.reported = new Set(); await loadFyState(); renderSheet(); toast('Profile removed (its file is kept on disk)'); if (on) { if (S.mode === 'foryou') enterForYou(); else if (S.mode === 'liked') enterLiked(); else S.posts.forEach(refreshVote); } }
      };
      row.append(del);
    }
    d.append(row);
  }
  const inp = el('input'); inp.className = 'fyinput'; inp.placeholder = 'New profile name, press Enter'; inp.maxLength = 40;
  inp.onkeydown = async ev => {
    ev.stopPropagation(); if (ev.key !== 'Enter') return; ev.preventDefault();
    if (await profileAction({ action: 'create', name: inp.value, switch: true })) { S.reported = new Set(); await loadFyState(); toast('Profile created and selected'); if (S.mode === 'foryou') enterForYou(); else if (S.mode === 'liked') enterLiked(); else S.posts.forEach(refreshVote); renderSheet(); }
  };
  d.append(inp);
  d.append(el('p', 'hint', 'Paheal profiles: “from other sites” learns from your likes on rule34 / e621 / e6ai (read only, they are never changed) plus what you like on Paheal. “Own” learns only from what you like on Paheal.'));
  for (const [kind, label, dflt] of [['paheal-all', '+ Paheal profile (from other sites)', 'Paheal (from other sites)'], ['paheal-own', '+ Paheal profile (own likes only)', 'Paheal (own)']]) {
    const b = el('button', 'mini', label); b.type = 'button';
    b.onclick = async () => {
      if (await profileAction({ action: 'create', name: inp.value.trim() || dflt, kind, switch: true })) { S.reported = new Set(); await loadFyState(); toast('Profile created and selected'); if (S.mode === 'foryou') enterForYou(); else if (S.mode === 'liked') enterLiked(); else S.posts.forEach(refreshVote); renderSheet(); }
    };
    d.append(b);
  }
  return d;
}
function renderCustomSites() {
  const d = el('div', 'fybox'); d.append(el('h3', null, '＋ Custom sites'));
  d.append(el('p', 'hint', 'Add another booru by its address and API type. Only the sites you add are contacted. The list is saved in data/boorus.json and its login fields appear above after adding. Untested.'));
  const refresh = async () => { try { S.status = await api.status(); syncSites(S.status); render.sites(); } catch {} renderSheet(); };
  const call = async (body) => { try { await fyJson('boorus', body, undefined, '/api/'); await refresh(); } catch (err) { toast(err.message); } };
  for (const src of (S.status?.sources || []).filter(x => x.custom)) {
    const row = el('div', 'field'); row.append(el('span', 'grow', `${src.label} · ${src.base} · ${S.status.types?.[src.type] || src.type}`));
    const rm = el('button', 'btn ghost', 'Remove');
    rm.onclick = () => { if (!rm.dataset.sure) { rm.dataset.sure = '1'; rm.textContent = 'Tap again to remove'; return; } call({ action: 'remove', id: src.id }); };
    row.append(rm); d.append(row);
  }
  const name = el('input', 'fyinput'); name.placeholder = 'Name'; name.maxLength = 30; name.setAttribute('aria-label', 'Site name');
  const base = el('input', 'fyinput'); base.placeholder = 'https://example.org'; base.type = 'url'; base.setAttribute('aria-label', 'Site address');
  const type = el('select', 'fyinput'); type.setAttribute('aria-label', 'API type');
  for (const [k, v] of Object.entries(S.status?.types || {})) { const o = el('option', null, v); o.value = k; type.append(o); }
  for (const i of [name, base]) i.onkeydown = ev => ev.stopPropagation();
  const add = el('button', 'btn', 'Add');
  add.onclick = () => { if (name.value.trim() && base.value.trim()) call({ action: 'add', label: name.value, base: base.value, type: type.value }); };
  const row = el('div', 'field'); row.append(name, base, type, add); d.append(row);
  return d;
}
function renderHotkeys() {
  const d = el('div', 'fybox hk-box'); d.append(el('h3', null, '⌨ Hotkeys'));
  d.append(el('p', 'hint', 'Click a key, then press the new one. Click it again to cancel. Numpad keys count as the same digit.'));
  for (const a of Object.keys(HK_LABEL)) {
    const row = el('div', 'hkrow'); row.append(el('span', null, HK_LABEL[a]));
    const b = el('button', 'hkkey' + (S.capture === a ? ' capturing' : ''), S.capture === a ? 'press a key…' : keyName(S.hk[a]));
    b.onclick = () => { S.capture = S.capture === a ? null : a; renderSheet(); };
    row.append(b); d.append(row);
  }
  for (const [k, t] of HK_FIXED) { const row = el('div', 'hkrow'); row.append(el('span', null, t), el('kbd', null, k)); d.append(row); }
  const reset = el('button', 'btn ghost', 'Reset hotkeys to default');
  reset.onclick = () => { S.hk = { ...HK_DEFAULT }; store.set('hotkeys', S.hk); S.capture = null; renderSheet(); renderHints(); };
  d.append(reset, segField('Hotkey bar', [true, false], S.hintsOn, v => v ? 'Shown' : 'Hidden', v => setHints(v)));
  return d;
}
function tagListEditor(title, key, placeholder, s, after) {
  const wrap = el('div'); wrap.append(el('p', 'hint', title));
  const list = el('div', 'fyblack');
  const save = async arr => { if (await setPrefs({ [key]: arr })) (after || renderSheet)(); };
  s.prefs[key].forEach(t => { const c = el('span', null, t); const x = el('button', null, '×'); x.onclick = () => save(s.prefs[key].filter(y => y !== t)); c.append(x); list.append(c); });
  const inp = el('input'); inp.placeholder = placeholder; inp.className = 'fyinput';
  inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); const v = inp.value.trim(); if (v) save([...s.prefs[key], v]); } };
  wrap.append(list, inp); return wrap;
}
function renderInsights(s) {
  const d = el('div', 'fybox'), i = s.insights, pct = x => x.rate == null ? '–' : x.rate + '%  (' + x.n + ')';
  d.append(el('h3', null, 'Is it working?'));
  const t = el('table', 'fytable');
  for (const [a, b] of [['Likes among For you picks', pct(i.foryou)], ['Likes among normal search posts', pct(i.search)], ['Your last 20 For you votes', pct(i.recent)], ['The 20 before that', pct(i.earlier)]]) {
    const r = el('tr'); r.append(el('td', null, a), el('td', null, b)); t.append(r);
  }
  d.append(t);
  const st = Object.entries(s.bandit || {});
  if (st.length) {
    d.append(el('p', 'hint', 'Which kinds of suggestions you like (likes / dislikes):'));
    const t2 = el('table', 'fytable');
    for (const [k, v] of st) { const r = el('tr'); r.append(el('td', null, k), el('td', null, `${Math.round(v.w)} / ${Math.round(v.l)}`)); t2.append(r); }
    d.append(t2);
  }
  d.append(el('p', 'hint', 'It is working if the first number beats the second (needs ~20+ votes of each) and the last 20 are at least as good as the ones before. "You like / You avoid" below should look like your taste.'));
  return d;
}

function renderForYouSettings() {
  const det = el('details', 'fydrop');
  det.open = !!S.fyOpen;
  det.addEventListener('toggle', () => { S.fyOpen = det.open; });
  det.append(el('summary', null, '✦ For you (beta) settings'));
  const box = el('div', 'fybox');
  det.append(box);
  box.append(renderProfiles());
  box.append(segField('Recommendations', [true, false], S.fyOn, v => v ? 'On' : 'Off', async v => {
    try { const r = await fyJson('enabled', { enabled: v }); S.fyOn = r.enabled; await loadFyState(); applyFyUi(); renderSheet(); }
    catch (err) { toast(err.message); }
  }));
  box.append(el('p', 'hint', 'Learns from posts you like (8), dislike (2), super like (9, counts 3x) or super dislike (3) on the numpad (or the number row). Everything stays in a file on this computer (data/foryou.json). Nothing is sent to any site, and it never affects normal search. Off: the button disappears and nothing is learned.'));
  box.append(renderHotkeys());
  box.append(
    segField('After voting, go to next post', [true, false], S.autoNext, v => v ? 'On' : 'Off', v => { S.autoNext = v; store.set('autoNext', v); }),
    segField('Fullscreen: fill the screen when it crops only a little', [true, false], S.fillFit, v => v ? 'On' : 'Off', v => { S.fillFit = v; store.set('fillFit', v); }),
    segField('Images & videos: load directly from the site (faster, but your network can see which sites)', [false, true], S.directMedia, v => v ? 'Directly' : 'Via my PC', v => { S.directMedia = v; store.set('directMedia', v); }),
    segField('Phone: double-tap to like', [true, false], S.gDouble, v => v ? 'On' : 'Off', v => { S.gDouble = v; store.set('gDouble', v); applyGestures(); }),
    segField('Phone: swipe right = dislike, left = tags', [true, false], S.gSwipe, v => v ? 'On' : 'Off', v => { S.gSwipe = v; store.set('gSwipe', v); applyGestures(); }),
    segField('Debug: explain why each post was picked', [true, false], S.fyDebug, v => v ? 'On' : 'Off', v => setDebug(v)),
    segField('Posts per batch', [5, 10, 15, 20], S.fyBatch, String, v => { S.fyBatch = v; store.set('fyBatch', v); }),
    el('p', 'hint', 'Small batches mean each vote improves the next batch (it fetches more candidates behind the scenes and shows you only the best few). The next batch loads when you reach the end.'));
  const s = S.fyState;
  if (S.fyOn && s?.insights) box.append(renderInsights(s));
  if (S.fyOn && s) {
    box.append(el('p', 'hint', `${s.likes} likes · ${s.dislikes} dislikes · ${s.seen} posts seen`));
    for (const [title, tags] of [['You like', s.likedTags], ['You avoid', s.dislikedTags]]) {
      if (!tags?.length) continue;
      const row = el('div', 'fytags'); row.append(el('b', null, title + ': '));
      tags.forEach(t => {
        const c = el('span', 'ignorable', t.name); c.title = 'Click to ignore this tag (stop learning from it)';
        const x = el('button', null, '⊘'); x.title = 'Ignore from algorithm'; x.setAttribute('aria-label', 'Ignore ' + t.name);
        x.onclick = async () => { if (await setPrefs({ ignored: [...new Set([...s.prefs.ignored, t.name])] })) { await loadFyState(); toast(`Ignoring “${t.name}”`); renderSheet(); } };
        c.append(x); row.append(c);
      });
      box.append(row);
    }
  }
  if (S.fyOn && s?.prefs) {
    box.append(el('p', 'hint', 'Tip: press ⊘ on any “You like / You avoid” tag above to ignore it. Ignored tags: too generic to say anything about taste, so they are not learned from. Edit freely:'));
    const ig = el('div', 'fyblack');
    const saveIg = async list => { if (await setPrefs({ ignored: list })) renderSheet(); };
    s.prefs.ignored.forEach(t => { const c = el('span', null, t); const x = el('button', null, '×'); x.onclick = () => saveIg(s.prefs.ignored.filter(y => y !== t)); c.append(x); ig.append(c); });
    const ii = el('input'); ii.placeholder = 'Ignore another tag, press Enter'; ii.className = 'fyinput';
    ii.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); const v = ii.value.trim(); if (v) saveIg([...s.prefs.ignored, v]); } };
    const rs = el('button', 'btn', 'Restore default ignored tags'); rs.onclick = async () => { if (await setPrefs({ resetIgnored: true })) renderSheet(); };
    const det = el('details'); det.append(el('summary', null, `Ignored tags (${s.prefs.ignored.length})`), ig, ii, rs); box.append(det);
    box.append(el('p', 'hint', 'Must have, Never show and Characters are in the For you bar at the top.'));
  }
  const resetLabel = `Reset “${activeProfile()?.name || 'for you'}” data`;
  const reset = el('button', 'btn danger', resetLabel); let armed = null;
  reset.onclick = async () => {
    if (!armed) { reset.textContent = 'Click again to erase everything'; armed = setTimeout(() => { armed = null; reset.textContent = resetLabel; }, 4000); return; }
    clearTimeout(armed);
    try { await fyJson('reset', { confirm: true }); S.votes = {}; await loadFyState(); toast("'For you' data erased"); renderSheet(); } catch (err) { toast(err.message); }
  };
  box.append(reset);
  return det;
}

const MIME = { webm: 'video/webm; codecs="vp9, opus"', mp4: 'video/mp4' };
function videoSrc(p) {
  if (S.videoQuality === 'medium' && p.mid) return p.mid;
  if (!p.compat || p.compat === p.file || S.videoQuality === 'original') return p.file;
  if (S.videoQuality === 'compatible') return p.compat;
  const probe = document.createElement('video');
  return probe.canPlayType(MIME[p.ext] || ('video/' + p.ext)) ? p.file : p.compat;
}

function loadVideo(v, p) {
  if (v.getAttribute('src')) return;
  const src = v._fellBack ? p.compat : videoSrc(p);
  if (v._t) v.addEventListener('loadedmetadata', () => { try { v.currentTime = v._t; } catch {} }, { once: true });
  if (mu(src) !== src) v.addEventListener('error', ev => { if (!v._dfb && v.getAttribute('src') === mu(src)) { v._dfb = true; ev.stopImmediatePropagation(); v.src = src; } });
  if (S.videoQuality === 'auto' && p.compat && src !== p.compat && !v._fb) {
    v._fb = true;
    v.addEventListener('error', () => {
      if (!v.getAttribute('src') || v._fellBack) return;
      v._fellBack = true;
      v.src = mu(p.compat);
      if (v === viewer.slides[S.vIndex]?.querySelector('video')) playVideo(v);
    });
  }
  v.src = mu(src);
}
function unloadVideo(v) {
  if (!v.getAttribute('src')) return;
  v._t = v.currentTime || 0;
  v.pause();
  v.removeAttribute('src');
  v.load();
}

const WINDOW = 3;
let autoTimer = null;
function applyGestures() { document.body.classList.toggle('swipe-votes', TOUCH.matches && S.fyOn && S.gSwipe); }
(function gestures() {
  const area = $('vscroll'); let g = null, lastTap = null;
  const burst = (x, y, txt) => { const h = el('span', 'heartburst', txt); h.style.left = x + 'px'; h.style.top = y + 'px'; document.body.append(h); setTimeout(() => h.remove(), 800); };
  area.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' || !TOUCH.matches || !S.fyOn) return; g = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId }; });
  area.addEventListener('pointercancel', () => { g = null; });
  area.addEventListener('pointerup', e => {
    if (!g || e.pointerId !== g.id) return;
    if (swiped) { g = null; return; }
    const dx = e.clientX - g.x, dy = e.clientY - g.y, dt = Date.now() - g.t, start = g; g = null;
    const p = S.posts[S.vIndex]; if (!p || !S.vOpen) return;
    if (S.gSwipe && Math.abs(dx) >= 18 && Math.abs(dx) > 0.8 * Math.abs(dy) && dt < 1500) {
      lastTap = null;
      if (dx < 0) viewer.outer.scrollTo({ left: viewer.outer.clientWidth, behavior: 'smooth' });
      else castVote(p, -1);
      return;
    }
    if (S.gDouble && Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 350) {
      if (lastTap && Date.now() - lastTap.t < 350 && Math.abs(start.x - lastTap.x) < 48 && Math.abs(start.y - lastTap.y) < 48) {
        lastTap = null; burst(e.clientX, e.clientY, '❤'); castVote(p, 1);
      } else lastTap = { t: Date.now(), x: start.x, y: start.y };
    }
  });
  let ts = null, swiped = false;
  area.addEventListener('touchstart', e => { swiped = false; ts = (TOUCH.matches && S.fyOn && S.gSwipe && S.vOpen && e.touches.length === 1) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  area.addEventListener('touchmove', e => {
    if (!ts || swiped) return;
    const dx = e.touches[0].clientX - ts.x, dy = e.touches[0].clientY - ts.y;
    if (Math.abs(dx) < 14 || Math.abs(dx) < 1.3 * Math.abs(dy)) return;
    swiped = true; lastTap = null; if (e.cancelable) e.preventDefault();
    const p = S.posts[S.vIndex]; if (!p) return;
    if (dx < 0) viewer.outer.scrollTo({ left: viewer.outer.clientWidth, behavior: 'smooth' }); else castVote(p, -1);
  }, { passive: false });
  area.addEventListener('touchend', () => { ts = null; }, { passive: true });
  let pd = null;
  const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  const setFit = fill => { window.setFill?.(fill); };
  area.addEventListener('touchstart', e => { pd = (TOUCH.matches && S.vOpen && e.touches.length === 2) ? { d: dist(e), done: false } : null; if (pd) ts = null; }, { passive: false });
  area.addEventListener('touchmove', e => {
    if (!pd || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    if (pd.done) return;
    const r = dist(e) / pd.d;
    if (r < 0.85) { pd.done = true; setFit(false); } else if (r > 1.18) { pd.done = true; setFit(true); }
  }, { passive: false });
  area.addEventListener('touchend', () => { pd = null; }, { passive: true });
  area.addEventListener('gesturestart', e => { if (TOUCH.matches && S.vOpen) e.preventDefault(); });
  area.addEventListener('gesturechange', e => { if (TOUCH.matches && S.vOpen) e.preventDefault(); });
  let dg = null; const det = $('details');
  det.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' && TOUCH.matches && S.gSwipe) dg = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
  det.addEventListener('pointercancel', () => { dg = null; });
  let ds = null, dback = false;
  det.addEventListener('touchstart', e => { dback = false; ds = (TOUCH.matches && S.gSwipe && e.touches.length === 1) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  det.addEventListener('touchmove', e => {
    if (!ds || dback) return;
    const dx = e.touches[0].clientX - ds.x, dy = e.touches[0].clientY - ds.y;
    if (dx >= 14 && Math.abs(dx) > 1.3 * Math.abs(dy)) { dback = true; if (e.cancelable) e.preventDefault(); viewer.outer.scrollTo({ left: 0, behavior: 'smooth' }); }
  }, { passive: false });
  det.addEventListener('pointerup', e => { if (!dg || e.pointerId !== dg.id) return; const dx = e.clientX - dg.x, dy = e.clientY - dg.y; dg = null; if (dx >= 20 && Math.abs(dx) > Math.abs(dy)) viewer.outer.scrollTo({ left: 0, behavior: 'smooth' }); });
  TOUCH.addEventListener?.('change', applyGestures); applyGestures();
})();

function renderGestHelp() {
  const b = $('gestHelp'), open = !b.hidden;
  b.replaceChildren(el('b', null, 'Gestures'));
  for (const [on, k, t] of [[S.gDouble, '❤ Double-tap', 'like'], [S.gSwipe, '→ Swipe right', 'dislike'], [S.gSwipe, '← Swipe left', 'tags & details']]) {
    const r = el('div', on ? null : 'off'); r.append(el('span', null, k), el('span', null, on ? t : 'off')); b.append(r);
  }
  b.append(el('div', null, 'Swipe up / down: next / previous'), el('div', null, 'Swipe right on tags: back to post'), el('small', null, 'Tap to close · switch on/off in Settings'));
  $('vGest').setAttribute('aria-expanded', String(open));
}
$('vGest').onclick = () => { const b = $('gestHelp'); b.hidden = !b.hidden; renderGestHelp(); };
$('gestHelp').onclick = () => { $('gestHelp').hidden = true; renderGestHelp(); };

function fitMedia(node, w, h) {
  if (S.fill) { node.style.objectFit = 'fill'; return; }
  if (!w || !h) return;
  const ar = w / h, sr = window.innerWidth / Math.max(1, window.innerHeight);
  node.style.objectFit = S.fillFit && Math.abs(ar / sr - 1) < 0.15 ? 'cover' : 'contain';
}
const viewer = {
  root: $('viewerRoot'), outer: $('viewer'), vs: $('vscroll'), slides: [], adjusting: false,
  open(i) {
    S.vOpen = true; S.vIndex = i; this.root.hidden = false; updTouchBar(); document.body.style.overflow = 'hidden';
    this.vs.replaceChildren(); this.slides = [];
    this.appendSlides(0);
    this.outer.scrollLeft = 0;
    this.pin(); this.sync();
    this.lock(true);
    history.pushState({ viewer: true }, '');
  },
  close(fromHistory = false) {
    if (!S.vOpen) return;
    S.vOpen = false; this.root.hidden = true; updTouchBar(); document.body.style.overflow = '';
    this.setAuto(false); this.lock(false); clearTimeout(this.viewT);
    this.slides.forEach(s => { s.querySelectorAll('video').forEach(unloadVideo); s.replaceChildren(); });
    const card = $('results').children[S.vIndex]; card?.scrollIntoView({ block: 'center' });
    if (!fromHistory && history.state?.viewer) history.back();
  },
  async lock(on) { try { if (on) this.wake = await navigator.wakeLock?.request('screen'); else await this.wake?.release(); } catch {} },
  appendSlides(from) {
    const frag = document.createDocumentFragment();
    for (let i = from; i < S.posts.length; i++) { const s = el('div', 'slide'); this.slides.push(s); frag.append(s); }
    this.vs.append(frag); this.sync();
  },
  h() { return this.vs.clientHeight || 1; },
  pin() { this.adjusting = true; this.vs.scrollTop = S.vIndex * this.h(); requestAnimationFrame(() => { this.adjusting = false; }); },
  sync() {
    const at = S.vIndex, rank = i => i === at ? -1 : i > at ? i - at : 1000 + (at - i);
    const order = this.slides.map((_, i) => i).sort((x, y) => rank(x) - rank(y));
    for (const i of order) {
      const s = this.slides[i], near = Math.abs(i - S.vIndex) <= (S.posts[i]?.site === 'paheal' ? 1 : WINDOW);
      if (near && !s.firstChild) { s.append(this.media(S.posts[i])); this.backdrop(s, S.posts[i]); }
      else if (!near && s.firstChild) { s.querySelectorAll('video').forEach(unloadVideo); s.replaceChildren(); }
      const v = s.querySelector('video');
      if (v) {
        if (i === S.vIndex) { loadVideo(v, S.posts[i]); v.loop = S.loopVideos && !S.auto; playVideo(v); }
        else unloadVideo(v);
      }
    }
    this.upgrade();
    document.querySelector('.tbar')?.classList.toggle('isvid', S.posts[S.vIndex]?.type === 'video');
    $('vCount').textContent = `${S.vIndex + 1} / ${S.posts.length}${S.active?.sites.some(s => S.feeds[s].hasMore && !S.feeds[s].error) ? '+' : ''}`;
    this.details(); if (S.posts[S.vIndex]) refreshVote(S.posts[S.vIndex]);
    window.updFill?.();
    clearTimeout(this.viewT); const cur = S.posts[S.vIndex];
    if (S.fyOn && S.mode === 'foryou' && cur) this.viewT = setTimeout(() => reportViewed(cur), 1500);
    if (S.vIndex >= S.posts.length - (TOUCH.matches ? 10 : S.mode === 'foryou' ? 2 : 6)) loadMore();
    render.endState();
    if (S.auto) this.scheduleAuto();
  },
  upgrade() {
    const at = S.vIndex, imgs = this.slides.slice(Math.max(0, at - WINDOW), at + WINDOW + 1).map(s => s.querySelector('img')).filter(Boolean);
    const cur = S.posts[at], pending = cur?.site === 'paheal' ? [] : imgs.filter(im => !im.complete);
    if (pending.length) {
      for (const im of pending) if (!im._w) { im._w = true; const f = () => { im._w = false; this.upgrade(); }; im.addEventListener('load', f, { once: true }); im.addEventListener('error', f, { once: true }); }
      return;
    }
    const p = S.posts[at], im = this.slides[at]?.querySelector('img');
    if (!p || !im || im._up || p.type !== 'image' || S.original || !p.file || p.file === p.sample) return;
    im._up = true; const big = new Image(), full = p.file; big.referrerPolicy = 'no-referrer'; big.decoding = 'async';
    big.onload = () => { if (im.isConnected) im.src = big.src; }; setImg(big, full);
  },
  backdrop(s, p) {
    const m = s.firstChild; if (!m || !TOUCH.matches) return;
    const contain = m.style.objectFit !== 'cover' && m.style.objectFit !== 'fill'; s.classList.toggle('bdrop', contain);
    const u = p.preview ? mu(p.preview) : (p.type === 'video' ? m.poster : m.src);
    if (contain && u) s.style.setProperty('--bg', `url("${u}")`);
  },
  media(p) {
    if (p.type === 'video') {
      const v = document.createElement('video');
      v.poster = mu(p.preview);
      v.playsInline = true; setMuted(v, true); v.loop = S.loopVideos;
      v.controls = true; v.preload = 'auto';
      v.setAttribute('playsinline', ''); v.disableRemotePlayback = true;
      v.addEventListener('ended', () => { const w = this.waitNext; this.waitNext = null; if (S.auto || w === S.posts[S.vIndex]) this.step(1); });
      fitMedia(v, p.w, p.h);
      return v;
    }
    const img = new Image(); img.decoding = 'async'; img.alt = 'Post ' + p.id; img.referrerPolicy = 'no-referrer';
    setImg(img, p.type === 'gif' || S.original ? p.file : p.sample);
    fitMedia(img, p.w, p.h);
    return img;
  },
  details() {
    const p = S.posts[S.vIndex], d = $('details'); if (!p) return;
    d.replaceChildren();
    d.append(el('h2', null, `${p.site} #${p.id}`));
    if (p.why) d.append(whyLine(p.why), dbgLine(p.dbg));
    const m = el('div', 'meta'); m.style.padding = '0';
    m.append(el('span', null, '▲ ' + p.score), el('span', 'r', p.rating), el('span', null, p.type), el('span', null, `${p.w}×${p.h}`));
    d.append(m);
    const link = el('a', 'extlink', `Open on ${p.site} ↗`); link.href = p.link; link.target = '_blank'; link.rel = 'noopener noreferrer';
    d.append(link);
    if (p.dbg && p.md5) {
      const sec = el('section'), box = el('div', 'aitags', 'analysing...'); sec.append(el('h3', null, 'AI tags'), box); d.append(sec);
      const load = (tries) => fetch('/api/vision/tags?md5=' + p.md5, { headers: { 'x-goonpilot': '1' } }).then(r => r.json()).then(j => {
        if (!box.isConnected) return;
        if (j.tags?.length) box.textContent = j.tags.join(', ');
        else if (tries > 0) setTimeout(() => load(tries - 1), 2000);
        else box.textContent = 'none yet (analysis off, or still waiting for it)';
      }).catch(() => { box.textContent = ''; });
      load(4);
    }
    for (const type of ['artist', 'character', 'copyright', 'species', 'general', 'meta']) {
      const tags = p.tags.filter(t => t.type === type); if (!tags.length) continue;
      const sec = el('section'); sec.append(el('h3', null, type));
      tags.forEach(t => {
        const row = el('span', 'tagrow');
        const nb = el('button', 'tagname'); nb.title = 'Search only this tag (on this site)';
        nb.append(el('span', 'dot t-' + type), el('span', null, t.name));
        nb.onclick = () => { this.close(); S.sites = [p.site]; S.terms = [{ kind: 'tag', name: t.name, mod: '+', type }]; syncFilterUi(); newSearch(); };
        const cnt = t.count ? el('span', 'tagcnt', fmt(t.count)) : null;
        const plus = el('button', 'mini', '+'); plus.title = 'Add to search'; plus.setAttribute('aria-label', 'Add ' + t.name);
        plus.onclick = () => addTerm(t, '+', type);
        const minus = el('button', 'mini minus', '−'); minus.title = 'Exclude from search'; minus.setAttribute('aria-label', 'Exclude ' + t.name);
        minus.onclick = () => addTerm(t, '-', type);
        const or = el('button', 'mini or', '~'); or.title = 'Add as OR'; or.setAttribute('aria-label', 'Add ' + t.name + ' as OR');
        or.onclick = () => addTerm(t, '~', type);
        row.append(nb); if (cnt) row.append(cnt);
        if (type !== 'meta') {
          const fav = !!S.artists[artistKey(t.name)], heart = el('button', 'mini' + (fav ? ' on' : ''), fav ? '♥' : '♡');
          heart.title = fav ? 'Remove from favorites' : 'Add to favorites'; heart.onclick = () => toggleArtist(t.name, type === 'artist' ? 'artist' : type === 'character' ? 'character' : 'tag'); row.append(heart);
        }
        const bl = S.fyState?.prefs?.blacklist || [], blocked = bl.includes(t.name.toLowerCase());
        const never = el('button', 'mini' + (blocked ? ' on' : ''), '⛔'); never.title = blocked ? 'Already in Never show' : 'Never show posts with this tag (For you)'; never.setAttribute('aria-label', 'Never show ' + t.name);
        never.onclick = async () => { if (blocked) return toast(t.name + ' is already in Never show'); if (await setPrefs({ blacklist: [...bl, t.name.toLowerCase()] })) { never.classList.add('on'); toast('Never show: ' + t.name + '. Posts with it are hidden from For you'); } };
        row.append(plus, minus, or, never);
        sec.append(row);
      });
      d.append(sec);
    }
    const back = el('button', 'btn ghost', '← Back to post'); back.onclick = () => this.outer.scrollTo({ left: 0, behavior: 'smooth' });
    d.append(back);
  },
  setAuto(on) {
    S.auto = on; $('vAuto').classList.toggle('on', on);
    clearTimeout(autoTimer);
    const v = this.slides[S.vIndex]?.querySelector('video'); if (v) v.loop = S.loopVideos && !on;
    if (on) this.scheduleAuto();
  },
  scheduleAuto() {
    clearTimeout(autoTimer);
    const p = S.posts[S.vIndex]; if (!p || p.type === 'video') return;
    autoTimer = setTimeout(() => this.step(1), S.autoDelay * 1000);
  },
  step(dir, instant = false) {
    const target = Math.max(0, Math.min(S.posts.length - 1, S.vIndex + dir));
    this.vs.scrollTo({ top: target * this.h(), behavior: instant ? 'instant' : 'smooth' });
  }
};
function addTerm(t, mod, type) {
  const existing = S.terms.find(x => x.kind === 'tag' && x.name === t.name);
  if (existing) existing.mod = mod; else S.terms.push({ kind: 'tag', name: t.name, mod, type });
  markDirty();
  toast(({ '+': 'Added ', '-': 'Excluding ', '~': 'Added as OR: ' })[mod] + t.name + '. Press Search to apply');
}

viewer.vs.addEventListener('scroll', () => {
  if (viewer.adjusting || Date.now() - (viewer.lastResize || 0) < 600) return;
  const i = Math.max(0, Math.min(S.posts.length - 1, Math.round(viewer.vs.scrollTop / viewer.h())));
  if (i !== S.vIndex) { S.vIndex = i; viewer.sync(); }
}, { passive: true });
let rePinT;
new ResizeObserver(() => {
  if (!S.vOpen) return;
  viewer.lastResize = Date.now();
  viewer.pin();
  clearTimeout(rePinT); rePinT = setTimeout(() => { if (S.vOpen) { viewer.lastResize = Date.now(); viewer.pin(); } }, 350);
  const onDetails = viewer.outer.scrollLeft > viewer.outer.clientWidth / 2;
  viewer.outer.scrollLeft = onDetails ? viewer.outer.clientWidth : 0;
}).observe(viewer.vs);
$('vClose').onclick = () => viewer.close();
$('vAuto').onclick = () => viewer.setAuto(!S.auto);
function setMuted(v, m) { if (v.muted !== m) { v._own = (v._own || 0) + 1; v.muted = m; } }
function playVideo(v) {
  setMuted(v, !S.sound);
  v.play().catch(err => {
    if (v.muted || err.name !== 'NotAllowedError') return;
    setMuted(v, true);
    v.play().catch(() => {});
    toast('Browser blocked sound. Tap 🔊 to turn it on');
  });
}
const soundIcon = () => { $('vSound').textContent = S.sound ? '🔊' : '🔇'; };
$('vSound').onclick = () => {
  S.sound = !S.sound; store.set('sound', S.sound); soundIcon();
  const v = viewer.slides[S.vIndex]?.querySelector('video');
  if (v) { setMuted(v, !S.sound); v.play().catch(() => {}); }
};
document.addEventListener('volumechange', e => {
  const v = e.target;
  if (!(v instanceof HTMLVideoElement)) return;
  if (v._own) { v._own--; return; }
  if (!S.vOpen || v !== viewer.slides[S.vIndex]?.querySelector('video')) return;
  if (S.sound !== !v.muted) { S.sound = !v.muted; store.set('sound', S.sound); soundIcon(); }
}, true);
$('vInfo').onclick = () => {
  const onDetails = viewer.outer.scrollLeft > viewer.outer.clientWidth / 2;
  viewer.outer.scrollTo({ left: onDetails ? 0 : viewer.outer.clientWidth, behavior: 'smooth' });
};
window.addEventListener('popstate', () => { if (S.vOpen) viewer.close(true); });
document.addEventListener('keydown', e => {
  if (!S.vOpen || S.capture || e.ctrlKey || e.metaKey || e.altKey) return;
  const act = hkAction(e.key.toLowerCase());
  if (act === 'close') viewer.close();
  else if (act === 'next' || e.key === 'ArrowDown') { e.preventDefault(); viewer.step(1); }
  else if (act === 'prev' || e.key === 'ArrowUp') { e.preventDefault(); viewer.step(-1); }
  else if (act === 'details' || e.key === 'ArrowLeft') { e.preventDefault(); $('vInfo').click(); }
});

soundIcon(); syncFilterUi(); render.chips(); render.searchBtn(); render.status(); render.endState(); observeSentinel();
api.status().then(s => { S.status = s; syncSites(s); render.sites(); render.status(); }).catch(() => {});
setDebug(S.fyDebug); renderHints(); loadFyState(); loadArtists(); pullUi();
newSearch(false);

(function autoHideBar() {
  const bar = document.querySelector('header.bar'); let last = window.scrollY, ticking = false;
  const update = () => {
    ticking = false; const y = window.scrollY, d = y - last;
    if (S.vOpen || !$('sheetRoot').hidden || bar.contains(document.activeElement) || !$('suggest').hidden || !$('fyPanel').hidden) { bar.classList.remove('bar-hidden'); last = y; return; }
    if (y < 60 || d < -6) bar.classList.remove('bar-hidden');
    else if (d > 6) bar.classList.add('bar-hidden');
    if (Math.abs(d) > 6 || y < 60) last = y;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
})();

(function autoHideHud() {
  const hud = document.querySelector('#viewerRoot .hud'), vs = $('vscroll'); let last = 0, ticking = false;
  const show = () => hud.classList.remove('hud-hidden');
  const update = () => {
    ticking = false; const y = vs.scrollTop, d = y - last;
    if (y < 40 || d < -6) show(); else if (d > 6) hud.classList.add('hud-hidden');
    if (Math.abs(d) > 6 || y < 40) last = y;
  };
  vs.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  new MutationObserver(() => { if ($('viewerRoot').hidden) { show(); last = 0; } else last = vs.scrollTop; }).observe($('viewerRoot'), { attributes: true, attributeFilter: ['hidden'] });
})();

const tbar = el('div', 'tbar'); tbar.hidden = true;
[['👎', () => castVote(S.posts[S.vIndex], -1)], ['🏷', () => $('vInfo').click()], ['Fill', () => window.setFill?.(!S.fill), 'fillb'], ['⭐', () => castVote(S.posts[S.vIndex], 2)], ['⛶', () => { const v = viewer.slides[S.vIndex]?.querySelector('video'); if (v) (v.webkitEnterFullscreen ? v.webkitEnterFullscreen() : v.requestFullscreen?.()); }, 'fsb'], ['👍', () => castVote(S.posts[S.vIndex], 1)]]
  .forEach(([t, f, cls]) => { const b = el('button', cls || '', t); b.onclick = f; tbar.append(b); });
document.body.append(tbar);
S.fill = !!store.get('fill', false);
window.updFill = () => { const b = tbar.querySelector('.fillb'); if (b) b.textContent = S.fill ? 'Fit' : 'Fill'; };
window.setFill = (on) => {
  S.fill = !!on; store.set('fill', S.fill);
  viewer.slides.forEach((sl, i) => { const m = sl.firstChild, p = S.posts[i]; if (m && p) { fitMedia(m, p.w, p.h); viewer.backdrop(sl, p); } });
  window.updFill();
};
function updTouchBar() { tbar.hidden = !(TOUCH.matches && S.fyOn && S.vOpen && S.tbarOn); document.body.classList.toggle('tbar-vis', !tbar.hidden); $('vBar').setAttribute('aria-pressed', String(S.tbarOn)); $('vBar').classList.toggle('on', S.tbarOn); }
$('vBar').onclick = () => { S.tbarOn = !S.tbarOn; store.set('tbarOn', S.tbarOn); updTouchBar(); };

