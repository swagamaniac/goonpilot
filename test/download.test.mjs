import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const snaps = {
  'rule34:1': { id: 1, ext: 'jpg', file: 'https://wimg.rule34.xxx/a/1.jpg' },
  'rule34:2': { id: 2, ext: 'mp4', file: 'https://wimg.rule34.xxx/a/2.mp4' },
  'e621:3': { id: 3, ext: 'png', file: '/api/e621/media?u=' + encodeURIComponent('https://static1.e621.net/x/3.png') },
  'rule34:4': { id: 4, ext: 'jpg', file: 'https://evil.example/4.jpg' },
};
const posts = { get: k => snaps[k] || null };
const fy = { listVotes: () => ({ items: [{ site: 'rule34', id: 1 }, { site: 'rule34', id: 2 }, { site: 'e621', id: 3 }, { site: 'rule34', id: 9 }] }) };
const big = Buffer.alloc(300000, 7);
const fetchImpl = async (u) => new Response(String(u).includes('/2.mp4') ? big : Buffer.from('file:' + u), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
const req = (qs, sfs = 'same-origin') => new Request('http://localhost:8787/api/lib/download?' + qs, { headers: { 'sec-fetch-site': sfs } });
const env = { E621_USERNAME: 'u', E621_API_KEY: 'k' };

test('download', async () => {
  assert.equal((await handleApi(req('items=rule34:1', 'cross-site'), env, fetchImpl, { foryou: fy, posts })).status, 403);
  assert.equal((await handleApi(req('items=rule34:1', 'none'), env, fetchImpl, { foryou: fy, posts })).status, 403);
  const one = await handleApi(req('items=rule34:1'), env, fetchImpl, { foryou: fy, posts });
  assert.equal(one.status, 200); assert.match(one.headers.get('content-disposition'), /rule34_1\.jpg/);
  assert.equal(await one.text(), 'file:https://wimg.rule34.xxx/a/1.jpg');
  assert.equal((await handleApi(req('items=rule34:4'), env, fetchImpl, { foryou: fy, posts })).status, 502, 'foreign host refused');
  const zip = await handleApi(req('filter=super'), env, fetchImpl, { foryou: fy, posts });
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  const dir = mkdtempSync(path.join(tmpdir(), 'z-')), f = path.join(dir, 't.zip');
  writeFileSync(f, Buffer.from(await zip.arrayBuffer()));
  const list = execFileSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(sorted((i.filename,i.file_size) for i in z.infolist()))', f]).toString();
  assert.match(list, /^None/); assert.match(list, /rule34_1\.jpg/); assert.match(list, /rule34_2\.mp4', 300000/); assert.match(list, /e621_3\.png/); assert(!list.includes('_9'));
});

test('rule34 media goes through this server', async () => {
  const { _test, rule34, proxifyPost } = await import('../src/sources/rule34.mjs');
  const p = _test.normalizePost({ id: 5, file_url: 'https://wimg.rule34.xxx/a/5.mp4', sample_url: 'https://wimg.rule34.xxx/s/5.jpg', preview_url: 'https://api-cdn.rule34.xxx/t/5.jpg', tags: 'a b', rating: 'explicit' });
  for (const k of ['file', 'sample', 'preview']) assert.match(p[k], /^\/api\/rule34\/media\?u=https%3A%2F%2F/);
  assert.equal(proxifyPost({ file: 'https://wimg.rule34.xxx/x.jpg', sample: '/api/rule34/media?u=already', preview: '' }).file.startsWith('/api/rule34/media'), true);
  assert.equal((await rule34.media('https://evil.example/x.jpg', new Request('http://l/'), {}, async () => { throw new Error('should not fetch'); })).status, 403);
  let seen; const r = await rule34.media('https://wimg.rule34.xxx/x.mp4', new Request('http://l/', { headers: { range: 'bytes=0-9' } }), {}, async (u, o) => { seen = o.headers.Range; return new Response('x', { status: 206, headers: { 'content-range': 'bytes 0-0/9' } }); });
  assert.equal(seen, 'bytes=0-9'); assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), 'bytes 0-0/9');
});
