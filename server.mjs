import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync, statSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { handleApi, buildLikedCsv, setApiLog, upstreamUrl, setCustomSources } from './src/api.mjs';
import { fileStore } from './src/foryou-store.mjs';
import { createProfiles } from './src/profiles.mjs';
import { createVision } from './src/vision.mjs';
import { tagMissing, siteTags } from './src/foryou.mjs';
import { ensurePahealTags } from './src/sources/paheal-tags.mjs';
import { createArtists } from './src/artists.mjs';
import { createPostCache } from './src/postcache.mjs';
import { createLibrary } from './src/library.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 8787;
const HOST = '127.0.0.1';

function loadVars() {
  const env = {};
  const file = path.join(ROOT, '.dev.vars');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  for (const k of Object.keys(process.env)) if (/^(RULE34|E621|E6AI|GELBOORU|DANBOORU|SANKAKU|CUSTOM)_/.test(k)) env[k] = process.env[k];
  return env;
}
const env = loadVars();
function saveVars(vals) {
  const file = path.join(ROOT, '.dev.vars');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split(/\r?\n/) : [];
  for (const [k, v] of Object.entries(vals)) {
    const i = lines.findIndex(l => new RegExp(`^\\s*${k}\\s*=`).test(l));
    if (i >= 0) lines[i] = `${k}=${v}`; else lines.push(`${k}=${v}`);
    env[k] = v;
  }
  writeFileSync(file, lines.join('\n') + '\n');
}
const BOORUS = path.join(ROOT, 'data', 'boorus.json');
try { if (existsSync(BOORUS)) setCustomSources(JSON.parse(readFileSync(BOORUS, 'utf8'))); } catch (e) { console.log('  data/boorus.json could not be read: ' + e.message); }
function saveBoorus(list) {
  mkdirSync(path.dirname(BOORUS), { recursive: true });
  writeFileSync(BOORUS + '.tmp', JSON.stringify(list, null, 2)); renameSync(BOORUS + '.tmp', BOORUS);
  setCustomSources(list);
}
const vision = createVision({ dir: path.join(ROOT, 'data'), fetchImpl: (u, o) => timedFetch(u, o), log: (type, msg) => logLine(`${String(type).padEnd(7)} ${msg}`) });
const visionImport = () => {
  const f = path.join(ROOT, 'data', 'ai-tags-import.json'); if (!existsSync(f)) return 0;
  const src = JSON.parse(readFileSync(f, 'utf8')), byMd5 = {};
  for (const [k, t] of Object.entries(src)) { const md5 = posts.get(k)?.md5; if (md5 && Array.isArray(t)) byMd5[md5] = t; }
  const n = vision.importTags(byMd5); renameSync(f, f + '.done'); return n;
};
const visionVotes = () => {
  const out = { liked: 0, disliked: 0, superLiked: 0, superDisliked: 0, analysedNotVoted: 0 }, voted = new Set();
  try {
    for (const [k, v] of foryou.shareVotes()) {
      const md5 = posts.get(k)?.md5; if (!md5 || !vision.has(md5)) continue; voted.add(md5);
      if (v.vote === 2) out.superLiked++; else if (v.vote > 0) out.liked++; else if (v.vote === -2) out.superDisliked++; else if (v.vote < 0) out.disliked++;
    }
  } catch {}
  out.analysedNotVoted = Math.max(0, vision.count() - voted.size);
  return out;
};
const DATA = path.join(ROOT, 'data'), dataFile = (name) => path.join(DATA, name + '.json');
const profiles = createProfiles({
  open: (name) => fileStore(DATA, name),
  has: (name) => existsSync(dataFile(name)),
  retire: (name) => { if (existsSync(dataFile(name))) renameSync(dataFile(name), path.join(DATA, `${name}.removed-${Date.now()}.json`)); },
  vision, md5Of: (site, id) => posts.get(`${site}:${id}`)?.md5 || null });
const foryou = profiles.current;
const postStore = fileStore(path.join(ROOT, 'data'), 'posts');
const posts = createPostCache({ load: postStore.load, save: postStore.save });
const artistStore = fileStore(path.join(ROOT, 'data'), 'artists');
const artists = createArtists({ load: artistStore.load, save: artistStore.save });
const library = createLibrary({ dir: path.join(ROOT, 'data'), upstream: upstreamUrl });
const missStore = fileStore(path.join(ROOT, 'data'), 'tagmiss');
tagMissing.load(missStore.load());
const saveMissing = () => { try { missStore.save(tagMissing.dump()); missStore.flush(); } catch {} };
setInterval(saveMissing, 60 * 1000).unref();
process.on('exit', saveMissing);
ensurePahealTags({ file: path.join(ROOT, 'data', 'paheal-tags.json'), onLoad: (names, counts) => siteTags.set('paheal', names, counts) });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json'
};

const MEDIA_HOSTS = 'https://*.rule34.xxx https://rule34.xxx https://static1.e621.net https://*.e621.net https://*.e6ai.net';
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: ${MEDIA_HOSTS}`,
    `media-src 'self' ${MEDIA_HOSTS}`,
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(PUBLIC, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, {}, 'Forbidden');
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    send(res, 200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, body);
  } catch {
    send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
  }
}

const ACCESS_LOG = path.join(ROOT, 'data', 'phone-access.log');
function logAccess(verdict, req, host, pathname) {
  const line = `${new Date().toISOString()}  ${verdict.padEnd(7)}  host=${host.slice(0, 80)}  who=${String(req.headers['tailscale-user-login'] || '-').slice(0, 80)}  ${req.method} ${pathname.slice(0, 100)}  ua=${String(req.headers['user-agent'] || '-').slice(0, 90)}  from=${req.socket.remoteAddress}  proto=${req.headers['x-forwarded-proto'] || '-'}${verdict === 'BLOCKED' ? '  headers=' + Object.keys(req.headers).filter(k => !/^(cookie|authorization)$/.test(k)).join(',').slice(0, 300) : ''}`;
  console.log('  [phone] ' + line);
  try { mkdirSync(path.dirname(ACCESS_LOG), { recursive: true }); appendFileSync(ACCESS_LOG, line + '\n'); } catch {}
}


const SERVER_LOG = path.join(ROOT, 'data', 'server.log');
let logBuf = [];
const logLine = (s) => { logBuf.push(`${new Date().toISOString().slice(11, 23)} ${s}`); };
const flushLog = () => {
  if (!logBuf.length) return;
  const text = logBuf.join('\n') + '\n'; logBuf = [];
  try {
    mkdirSync(path.dirname(SERVER_LOG), { recursive: true });
    try { if (statSync(SERVER_LOG).size > 5_000_000) renameSync(SERVER_LOG, SERVER_LOG + '.1'); } catch {}
    appendFileSync(SERVER_LOG, text);
  } catch {}
};
setInterval(flushLog, 2000).unref();
process.on('exit', flushLog);
setApiLog(logLine);
let lastBeat = Date.now(), beats = 0;
setInterval(() => {
  const now = Date.now(), gap = now - lastBeat; lastBeat = now;
  if (gap > 8000) logLine(`stall   server was paused ${Math.round(gap / 1000)}s (expected 5s): PC sleep, power throttling or a blocked loop`);
  else if (++beats % 60 === 0) logLine('alive   ' + Math.round(process.memoryUsage().rss / 1048576) + 'MB');
}, 5000).unref();
logLine(`start   pid=${process.pid} node=${process.version} phone=${process.env.PHONE_MODE === '1'}`);
const timedFetch = async (input, init) => {
  const t0 = Date.now(); let u; try { u = new URL(typeof input === 'string' ? input : (input.url || String(input))); } catch {}
  const what = u ? `${u.host}${u.pathname}${u.pathname.includes('find_posts') || u.pathname.includes('index.php') || u.pathname.includes('posts.json') ? u.search.replace(/([?&])(api_key|user_id|login|password_hash)=[^&]*/gi, '$1$2=XXX').slice(0, 160) : ''}` : '?';
  try { const r = await fetch(input, init); logLine(`up      ${r.status} ${Date.now() - t0}ms ${what}`); return r; }
  catch (e) { logLine(`up      FAIL ${Date.now() - t0}ms ${what} ${String(e?.cause?.code || e?.message || e).slice(0, 80)}`); throw e; }
};

const server = http.createServer(async (req, res) => {
  try {
    const host = (req.headers.host || '').split(':')[0];
    const viaTailscale = process.env.PHONE_MODE === '1' && host.endsWith('.ts.net') && !!req.headers['tailscale-user-login'];
    const local = ['localhost', '127.0.0.1'].includes(host);
    if (!local) {
      let pn = req.url || '/'; try { pn = new URL(req.url, 'http://x').pathname; } catch {}
      if (!viaTailscale) { logAccess('BLOCKED', req, host, pn); return send(res, 403, {}, 'Forbidden'); }
    }

    const url = new URL(req.url, `${viaTailscale ? 'https' : 'http'}://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const fwd = { accept: req.headers.accept || '*/*' };
      if (req.headers.range) fwd.range = req.headers.range;
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      let body;
      if (req.method === 'POST') {
        for (const h of ['content-type', 'origin', 'x-goonpilot', 'sec-fetch-site']) if (req.headers[h]) fwd[h] = req.headers[h];
        const chunks = []; let size = 0;
        for await (const c of req) { size += c.length; if (size > 1_000_000) return send(res, 413, {}, 'Too large'); chunks.push(c); }
        body = Buffer.concat(chunks);
      }
      for (const h of ['origin', 'x-goonpilot', 'sec-fetch-site']) if (req.headers[h]) fwd[h] = req.headers[h];
      const request = new Request(url, { method: req.method, headers: fwd, body, signal: ac.signal });
      const t0 = Date.now(), tag = url.pathname.replace(/^\/api\//, '').slice(0, 60) + (/media$/.test(url.pathname) ? ' ' + (() => { try { return new URL(url.searchParams.get('u')).host; } catch { return ''; } })() : '');
      const response = await handleApi(request, env, timedFetch, { vision, visionImport, visionVotes, foryou, artists, posts, profiles, library, saveVars: local ? saveVars : null, saveBoorus: local ? saveBoorus : null, restart: (process.env.PHONE_MODE === '1' || process.env.RESTARTABLE === '1') ? () => setTimeout(() => process.exit(75), 400) : null });
      res.writeHead(response.status, { ...SECURITY_HEADERS, ...Object.fromEntries(response.headers) });
      const ttfb = Date.now() - t0; let bytes = 0;
      res.on('close', () => logLine(`api     ${response.status} ttfb=${ttfb}ms total=${Date.now() - t0}ms ${(bytes / 1024) | 0}KB ${req.method} ${tag}${res.writableFinished ? '' : ' ABORTED'}`));
      if (response.status >= 400) { try { logLine(`err     ${tag} ${(await response.clone().text()).slice(0, 200)}`); } catch {} }
      if (!response.body || req.method === 'HEAD') return res.end();
      return Readable.fromWeb(response.body).on('data', c => { bytes += c.length; }).on('error', () => res.destroy()).pipe(res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {}, 'Method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    send(res, 500, { 'Content-Type': 'text/plain' }, 'Server error');
  }
});

const LIKED_CSV = path.join(ROOT, 'data', 'liked-list.csv');
function writeLikedList() { try { mkdirSync(path.dirname(LIKED_CSV), { recursive: true }); writeFileSync(LIKED_CSV, buildLikedCsv(foryou, posts, 'likes')); } catch {} }
writeLikedList(); setInterval(writeLikedList, 30 * 60 * 1000).unref();

vision.init().catch((e) => logLine(`err     vision init ${e.message}`));
server.listen(PORT, HOST, () => {
  const ok = env.RULE34_API_KEY && env.RULE34_USER_ID;
  console.log(`\n  Goonpilot running at  http://localhost:${PORT}  (this computer only)\n`);
  console.log(ok ? '  rule34: API key loaded' : '  rule34: no API key. rule34 requires one: add RULE34_API_KEY and RULE34_USER_ID in Settings or .dev.vars');
  for (const [p, n] of [['E621', 'e621'], ['E6AI', 'e6ai']]) {
    console.log(env[p + '_USERNAME'] && env[p + '_API_KEY'] ? `  ${n.padEnd(7)} logged in as ${env[p + '_USERNAME']}` : `  ${n.padEnd(7)} no login, using public access (optional: ${p}_USERNAME and ${p}_API_KEY in .dev.vars)`);
  }
  console.log('  Stop with Ctrl+C\n');
});
