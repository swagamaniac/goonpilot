import { createForYou } from '../src/foryou.mjs';
import { handleApi } from '../src/api.mjs';
import assert from 'node:assert/strict';
let mem = null, t = 1e12;
const fy = createForYou({ load: () => mem, save: d => { mem = JSON.parse(JSON.stringify(d)); }, now: () => t });
const mk = (id, names, extra = {}) => ({ id, w: 1, h: 1, type: 'image', rating: 'explicit', tags: names.map(n => ({ name: n, type: n.startsWith('c_') ? 'character' : 'general', count: 0 })), ...extra });
let calls = [];
const search = async (site, q) => { calls.push({ site, q }); const base = 1000 + calls.length * 100;
  return { posts: [mk(base + 1, ['c_alice', 'red']), mk(base + 2, ['c_bob', 'blue']), mk(base + 3, ['c_alice', 'blue']), mk(base + 4, ['c_carl', 'green']), mk(base + 5, ['solo'])] }; };
let f = await fy.feed({ sites: ['rule34'], n: 5, search });
assert(f.cold && calls.every(c => c.q.strat === 'popular'));
for (let i = 0; i < 4; i++) { fy.vote({ site: 'rule34', id: i, vote: 1, post: mk(i, ['c_alice', 'red']), strat: 'anchor' }); t += 20 * 60e3; }
for (let i = 10; i < 14; i++) { fy.vote({ site: 'rule34', id: i, vote: -1, post: mk(i, ['c_bob']) }); t += 20 * 60e3; }
const st = fy.state();
assert(st.likedTags.some(x => x.name === 'c_alice') && st.dislikedTags.some(x => x.name === 'c_bob'), JSON.stringify(st));
assert(st.insights.foryou.n >= 1 && st.insights.foryou.rate === 100, JSON.stringify(st.insights));
calls = []; f = await fy.feed({ sites: ['rule34'], n: 8, search });
assert(!f.cold && calls.some(c => c.q.include.includes('c_alice')) && calls.some(c => c.q.exclude.includes('c_bob')), JSON.stringify(calls.map(c => c.q)));
const ids = f.posts.map(p => p.id); assert.equal(new Set(ids).size, ids.length);
const first = f.posts.filter(p => p.tags.some(x => x.name === 'c_alice')), bob = f.posts.findIndex(p => p.tags.some(x => x.name === 'c_bob'));
console.log('order:', f.posts.map(p => p.tags.map(x => x.name).join('+') + ' ' + p.why.score));
assert(f.posts[0].tags.some(x => x.name === 'c_alice'));
assert(f.posts[0].why.tags.includes('c_alice'));
const f2 = await fy.feed({ sites: ['rule34'], n: 8, search }); assert(!f2.posts.some(p => ids.includes(p.id)));
fy.vote({ site: 'rule34', id: 0, vote: 0 }); assert.equal(fy.state().votes['rule34:0'], undefined);
fy.setEnabled(false); assert.throws(() => fy.vote({ site: 'rule34', id: 99, vote: 1, post: mk(99, ['x']) })); await assert.rejects(fy.feed({ sites: ['rule34'], search }));
fy.setEnabled(true); fy.reset(); assert.equal(fy.state().likes, 0);
assert(!fy.state().likedTags.some(x => x.name === 'solo') && !JSON.stringify(fy.state().prefs.ignored).includes('c_alice'));
fy.setPrefs({ blacklist: ['green'], media: 'video', mode: 'explore' });
const vid = (id, names, md5) => mk(id, names, { type: 'video', md5 });
const s2 = async () => ({ posts: [vid(5001, ['c_alice', 'red'], 'a'.repeat(32)), vid(5002, ['c_alice', 'green'], 'b'.repeat(32)), mk(5003, ['c_alice']), vid(5004, ['c_dup'], 'a'.repeat(32))] });
fy.vote({ site: 'rule34', id: 7, vote: 1, post: mk(7, ['c_alice']) });
let fv = await fy.feed({ sites: ['rule34'], n: 10, search: s2 });
assert.deepEqual(fv.posts.map(p => p.id), [5001], 'media/blacklist/md5 filter');
fy.setPrefs({ media: 'all', blacklist: [], mode: 'comfort' }); calls = [];
await fy.feed({ sites: ['rule34'], n: 5, search }); assert(calls.every(c => ['anchor', 'pivot'].includes(c.q.strat)), 'comfort strategies');
fy.startDive({ site: 'rule34', id: 8001, post: mk(8001, ['c_zed', 'purple']) }); calls = [];
await fy.feed({ sites: ['rule34'], n: 5, search }); assert(calls.every(c => c.q.strat === 'dive' && c.q.include.some(t => ['c_zed', 'purple'].includes(t))), JSON.stringify(calls.map(c => c.q)));
assert(fy.state().dive.id === 8001); fy.endDive(); assert.equal(fy.state().dive, null);
{ let m2 = null; const f2 = createForYou({ load: () => m2, save: d => { m2 = JSON.parse(JSON.stringify(d)); }, now: () => t });
  f2.vote({ site: 'rule34', id: 1, vote: 1, post: mk(1, ['c_one']) }); t += 3600e3 * 10;
  f2.vote({ site: 'rule34', id: 2, vote: 2, post: mk(2, ['c_two']) }); t += 3600e3 * 10;
  f2.vote({ site: 'rule34', id: 3, vote: -1, post: mk(3, ['c_three']) }); t += 3600e3 * 10;
  f2.vote({ site: 'rule34', id: 4, vote: -2, post: mk(4, ['c_four']) });
  const s2 = f2.state(), a = n => [...s2.likedTags, ...s2.dislikedTags].find(x => x.name === n).aff;
  assert(a('c_two') > a('c_one'), 'super like > like'); assert(a('c_four') < a('c_three'), 'super dislike < dislike');
  assert.throws(() => f2.vote({ site: 'rule34', id: 5, vote: 3, post: mk(5, ['x']) })); }
{ let m4 = null; const f4 = createForYou({ load: () => m4, save: d => { m4 = JSON.parse(JSON.stringify(d)); }, now: () => t });
  for (let i = 0; i < 3; i++) { f4.vote({ site: 'rule34', id: 100 + i, vote: 1, post: mk(100 + i, ['c_alice', 'red']) }); t += 3600e3 * 10; }
  f4.setPrefs({ whitelist: ['Red', 'blue', 'x:y'] }); assert.deepEqual(f4.state().prefs.whitelist, ['red', 'blue']);
  let seenQ = []; const wl = async (site, q) => { seenQ.push(q); return { posts: [mk(200 + seenQ.length, ['red', 'blue', 'c_z']), mk(300 + seenQ.length, ['red'])] }; };
  const w = await f4.feed({ sites: ['rule34'], n: 10, search: wl });
  assert(seenQ.every(q => q.include.includes('red') && q.include.includes('blue')), 'whitelist in every query');
  assert(w.posts.length > 0 && w.posts.every(p => p.tags.some(x => x.name === 'red') && p.tags.some(x => x.name === 'blue')), 'only posts with all whitelisted tags');
  f4.setPrefs({ whitelist: [] });
  assert(f4.state().likedTags.some(x => x.name === 'c_alice'));
  f4.setPrefs({ ignoreCharacters: true });
  assert(!f4.state().likedTags.some(x => x.name === 'c_alice') && f4.state().likedTags.some(x => x.name === 'red'), 'characters ignored, other tags kept');
  seenQ = []; await f4.feed({ sites: ['rule34'], n: 5, search: wl });
  assert(seenQ.every(q => !q.include.some(t => t.startsWith('c_'))), 'no character tag in queries');
  f4.setPrefs({ ignoreCharacters: false }); assert(f4.state().likedTags.some(x => x.name === 'c_alice'), 'toggling back restores them (votes untouched)'); }
const ctx = { foryou: fy }, U = 'http://localhost:8787/api/foryou/';
const R = (path, o = {}) => handleApi(new Request(U + path, o), {}, fetch, ctx);
assert.equal((await R('state')).status, 403);
assert.equal((await R('state', { headers: { 'x-goonpilot': '1' } })).status, 200);
assert.equal((await R('state', { headers: { 'x-goonpilot': '1', origin: 'https://evil.com' } })).status, 403);
assert.equal((await R('reset', { method: 'POST', headers: { 'x-goonpilot': '1', 'content-type': 'text/plain' }, body: '{}' })).status, 415);
assert.equal((await R('reset', { method: 'POST', headers: { 'x-goonpilot': '1', 'content-type': 'application/json' }, body: '{}' })).status, 400);
assert.equal((await R('vote', { method: 'POST', headers: { 'x-goonpilot': '1', 'content-type': 'application/json' }, body: JSON.stringify({ site: 'rule34', id: 5, vote: 1, post: { tags: [{ name: 'a', type: 'zzz' }] } }) })).status, 200);
import { createArtists } from '../src/artists.mjs';
let am = null; const ar = createArtists({ load: () => am, save: d => { am = JSON.parse(JSON.stringify(d)); } });
const AU = 'http://localhost:8787/api/lib/artists', H = { 'x-goonpilot': '1', 'content-type': 'application/json' };
const A = (o = {}) => handleApi(new Request(AU, o), {}, fetch, { artists: ar });
assert.equal((await A()).status, 403);
assert.equal((await A({ method: 'POST', headers: H, body: JSON.stringify({ name: ' Some Artist ', note: 'likes cats' }) })).status, 200);
assert.equal((await A({ method: 'POST', headers: H, body: JSON.stringify({ name: 'order:id' }) })).status, 400);
let lst = await (await A({ headers: H })).json(); assert.equal(lst.artists[0].name, 'some_artist'); assert.equal(lst.artists[0].note, 'likes cats');
await A({ method: 'POST', headers: H, body: JSON.stringify({ name: 'some_artist' }) }); lst = await (await A({ headers: H })).json(); assert.equal(lst.artists[0].note, 'likes cats', 'note kept when omitted');
await A({ method: 'POST', headers: H, body: JSON.stringify({ name: 'some_artist', remove: true }) }); lst = await (await A({ headers: H })).json(); assert.equal(lst.artists.length, 0);
{ let m3 = null; const sv = d => { m3 = JSON.parse(JSON.stringify(d)); };
  const a1 = createForYou({ load: () => m3, save: sv, now: () => t });
  const one = async () => ({ posts: [mk(9001, ['c_x']), mk(9002, ['c_y'])] });
  const r1 = await a1.feed({ sites: ['rule34'], n: 5, search: one }); assert.equal(r1.posts.length, 2);
  const r2 = await a1.feed({ sites: ['rule34'], n: 5, search: one }); assert.equal(r2.posts.length, 0, 'no repeats inside one session');
  assert.equal(Object.keys((m3 || {}).seen || {}).length, 0, 'serving must not mark seen');
  a1.markViewed({ site: 'rule34', id: 9001, post: mk(9001, ['c_x']) }); assert(m3.seen['rule34:9001'] && !m3.seen['rule34:9002']);
  const a2 = createForYou({ load: () => m3, save: sv, now: () => t });
  const r3 = await a2.feed({ sites: ['rule34'], n: 5, search: one }); assert.deepEqual(r3.posts.map(p => p.id), [9002], 'viewed stays hidden, unseen may return');
  a2.vote({ site: 'rule34', id: 1, vote: 1, post: mk(1, ['a']) }); t += 1000; a2.vote({ site: 'e621', id: 2, vote: 2, post: mk(2, ['b']) }); t += 1000; a2.vote({ site: 'rule34', id: 3, vote: -1, post: mk(3, ['c']) });
  assert.deepEqual(a2.listVotes({ filter: 'likes' }).items.map(i => i.id), [2, 1]); assert.deepEqual(a2.listVotes({ filter: 'super' }).items.map(i => i.id), [2]);
  assert.equal(a2.listVotes({ filter: 'all' }).total, 3);
  const before = JSON.stringify(m3.votes); a2.markViewed({ site: 'rule34', id: 1, post: mk(1, ['a']) }); assert.equal(JSON.stringify(m3.votes), before, 'markViewed never changes votes');
  const { createPostCache } = await import('../src/postcache.mjs'); let pm = null;
  const pc = createPostCache({ load: () => pm, save: d => { pm = JSON.parse(JSON.stringify(d)); } });
  const Hh = { 'x-goonpilot': '1', 'content-type': 'application/json' }, ctx2 = { foryou: a2, posts: pc };
  const R2 = (path, o = {}) => handleApi(new Request(U + path, { headers: Hh, ...o }), {}, fetch, ctx2);
  let lj = await (await R2('liked?filter=likes')).json(); assert.equal(lj.total, 2); assert.equal(lj.items[0].post, null);
  const snap = { id: 2, w: 10, h: 20, type: 'image', rating: 'explicit', score: 3, file: '/api/e621/media?u=x', sample: 'javascript:alert(1)', preview: 'https://a/b.jpg', link: 'https://e621.net/posts/2', tags: [{ name: 'b', type: 'general' }] };
  assert.equal((await R2('snap', { method: 'POST', body: JSON.stringify({ site: 'e621', id: 2, post: snap }) })).status, 200);
  lj = await (await R2('liked?filter=likes')).json(); assert.equal(lj.items[0].post.preview, 'https://a/b.jpg'); assert.equal(lj.items[0].post.sample, '', 'unsafe url dropped');
  await R2('snap', { method: 'POST', body: JSON.stringify({ site: 'rule34', id: 1, gone: true }) }); lj = await (await R2('liked?filter=likes')).json(); assert.equal(lj.items[1].gone, true);
  assert.equal((await R2('seen', { method: 'POST', body: JSON.stringify({ site: 'rule34', id: 7, post: { tags: [{ name: 'q' }] } }) })).status, 200);
}
console.log('ALL OK');

fy.setPrefs({ whitelist: ['score:>100', 'Score%3A%3E5', 'score:>=2', 'order:random', 'a*', 'red'] });
assert.deepEqual(fy.state().prefs.whitelist, ['score:>100', 'score:>5', 'score:>=2', 'a*', 'red']);
fy.setPrefs({ whitelist: [] });

fy.setPrefs({ minScore: { rule34: 100, e621: 0, bogus: 5 } });
assert.deepEqual(fy.state().prefs.minScore, { rule34: 100 });
fy.setPrefs({ minScore: { rule34: 0 } });
assert.deepEqual(fy.state().prefs.minScore, {});
{
  fy.setPrefs({ minScore: { rule34: 50 } });
  const seenQ = [];
  const s2 = async (site, q) => { seenQ.push(q); const b = 90000 + seenQ.length * 10; return { posts: [mk(b + 1, ['zz1'], { score: 10 }), mk(b + 2, ['zz2'], { score: 50 }), mk(b + 3, ['zz3'], { score: 51 }), mk(b + 4, ['zz4'], { score: 500 })], hasMore: true }; };
  const ff = await fy.feed({ sites: ['rule34'], n: 10, search: s2 });
  assert(seenQ.every(q => q.minScore >= 51), 'query asks the site for score above the minimum');
  assert(ff.posts.length > 0 && ff.posts.every(p => p.score > 50), 'only scores above 50: ' + ff.posts.map(p => p.score));
  fy.setPrefs({ minScore: { rule34: 0 } });
}

{
  const { GENERIC_R34, createForYou: mkFy } = await import('../src/foryou.mjs');
  assert(!GENERIC_R34.includes('futanari') && !GENERIC_R34.includes('anthro'));
  let mem2 = { v: 1, prefs: { mode: 'balanced', ignored: ['mine'] }, votes: { 'rule34:1': { vote: 1, site: 'rule34', id: 1, t: 1, tags: [] } }, seen: {}, seenMd5: {}, tagSeen: {}, nSeen: 0, bandit: {} };
  const keep = JSON.stringify(mem2.votes);
  const f2 = mkFy({ load: () => mem2, save: d => { mem2 = JSON.parse(JSON.stringify(d)); }, now: () => 1e12 });
  const ig = f2.state().prefs.ignored;
  assert(ig.includes('mine') && ig.includes('nipples') && !ig.includes('futanari'));
  assert.equal(JSON.stringify(mem2.votes), keep, 'votes untouched');
  f2.setPrefs({ ignored: ['mine'] });
  const f3 = mkFy({ load: () => mem2, save: d => { mem2 = JSON.parse(JSON.stringify(d)); }, now: () => 1e12 });
  assert.deepEqual(f3.state().prefs.ignored, ['mine'], 'not re-added after you removed them');
}

{
  fy.setPrefs({ boost: { Magic_Wand: 3, 'bad:tag': 2, hated: -3, zero: 0, big: 9 } });
  assert.deepEqual(fy.state().prefs.boost, { magic_wand: 3, hated: -3 });
  const qs = [];
  const s3 = async (site, q) => { qs.push(q); const b = 70000 + qs.length * 10; return { posts: [mk(b + 1, ['magic_wand', 'qq1']), mk(b + 2, ['hated', 'qq2']), mk(b + 3, ['qq3'])], hasMore: true }; };
  const fb = await fy.feed({ sites: ['rule34'], n: 6, search: s3, exists: async (site, names) => Object.fromEntries(names.map(n => [n, true])) });
  assert(qs.some(q => q.include.includes('magic_wand')), 'boosted tag is used in searches');
  const idx = (tag) => fb.posts.findIndex(p => p.tags.some(t => t.name === tag));
  if (idx('magic_wand') >= 0 && idx('hated') >= 0) assert(idx('magic_wand') < idx('hated'), 'boosted ranks above avoided');
  fy.setPrefs({ boost: {} });
}
