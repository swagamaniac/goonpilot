import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { lookFeatures, dHash, hamming, createVision, LOOK_DIM } from '../src/vision.mjs';
import { createForYou } from '../src/foryou.mjs';

test('look numbers: right size, sane values', () => {
  const dark = lookFeatures(new Uint8Array(32 * 32 * 3).fill(10)), light = lookFeatures(new Uint8Array(32 * 32 * 3).fill(240));
  assert.equal(dark.length, LOOK_DIM); assert.ok(dark[16] < 0.1 && light[16] > 0.9); assert.equal(dark[22], 1); assert.equal(light[23], 1);
});
test('dHash / hamming', () => {
  const g = new Uint8Array(72).map((_, i) => (9 - (i % 9)) * 20), h = dHash(g), flat = dHash(new Uint8Array(72).fill(5));
  assert.equal(h.length, 16); assert.equal(hamming(h, h), 0); assert.ok(hamming(h, flat) > 0);
});
test('vision off / not installed: pictures pass through untouched, nothing breaks', async () => {
  const v = createVision({ dir: mkdtempSync(path.join(tmpdir(), 'vision-')) });
  const res = new Response('abc', { status: 200, headers: { 'content-type': 'image/jpeg' } });
  assert.equal(v.tap(res, 'https://x/a/' + 'a'.repeat(32) + '.jpg'), res);
  assert.equal(v.importTags({ ['b'.repeat(32)]: ['x', 'y'] }), 1); assert.deepEqual(v.tags('b'.repeat(32)), ['x', 'y']); assert.equal(v.z([1]), null);
});
test('AI tags are learned from votes and used when scoring (type ai)', () => {
  const md5 = 'c'.repeat(32), d = { v: 1, votes: {} }, e = 'e'.repeat(32), items = { [md5]: ['ai_only_tag'], [e]: ['ai_only_tag'] };
  const vision = { enabled: () => true, tags: (m) => items[m] || null, look: () => null, count: () => Object.keys(items).length, stats: () => ({ n: 0 }), z: () => null };
  const fy = createForYou({ load: () => d, save() {}, enabled: () => true, setEnabled() {}, vision, md5Of: (s, id) => id === 1 ? md5 : null });
  const post = (md5x) => ({ site: 'rule34', rating: 'explicit', type: 'image', score: 0, md5: md5x, tags: [{ name: 'plain', type: 'general' }] });
  fy.vote({ site: 'rule34', id: 1, vote: 1, post: post(md5), md5 });
  const sc = fy.evalScorer();
  assert.ok(sc(post(e)) > sc(post('d'.repeat(32))), 'a candidate whose picture shows a liked AI tag should rank higher');
});
