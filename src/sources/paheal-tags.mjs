import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const BASE = 'https://rule34.paheal.net', UA = { 'User-Agent': 'Goonpilot/1.0 (personal)' };
const MAX_AGE = 30 * 864e5, DAY = 864e5, PAGES = [...'abcdefghijklmnopqrstuvwxyz0123456789.'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clean = (raw) => { try { return decodeURIComponent(raw).toLowerCase().replace(/\s+/g, '_'); } catch { return ''; } };
const LINK = String.raw`href\s*=\s*["']?(?:https?:\/\/rule34\.paheal\.net)?\/?post\/list\/([^\/"'?#\s>]+)\/1`;

export function parseTags(html) {
  const out = [], re = new RegExp(LINK, 'gi'); let m;
  while ((m = re.exec(html))) { const n = clean(m[1]); if (n) out.push(n); }
  return out;
}
export function parseCounted(html) {
  const out = new Map(), re = new RegExp(LINK + String.raw`[^>]*>[^<]*<\/a>(?:\s|&nbsp;|<[^>]*>)*\(\s*(\d+)\s*\)`, 'gi'); let m;
  while ((m = re.exec(html))) { const n = clean(m[1]); if (n) out.set(n, Number(m[2])); }
  return out;
}

export function ensurePahealTags({ file, onLoad, fetchImpl = fetch, log = console.log, base = BASE }) {
  let have = null; try { have = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  if (have && Array.isArray(have.tags) && have.tags.length) onLoad(have.tags, have.v === 2 ? have.counts : null);
  const age = have ? Date.now() - have.t : Infinity;
  const needCounts = have && have.v !== 2 && !(have.countsTried > Date.now() - DAY);
  if (have && age < MAX_AGE && !needCounts) return;

  const save = (obj) => { const tmp = file + '.tmp'; writeFileSync(tmp, JSON.stringify(obj)); renameSync(tmp, file); };
  (async () => {
    log('  paheal: downloading the tag list with counts in the background (one big page, once a month)...');
    let counted = new Map(), shown = false, full = false;
    for (const q of ['?mincount=1', '']) {
      try {
        const res = await fetchImpl(`${base}/tags/popularity${q}`, { headers: UA, signal: AbortSignal.timeout(240000) });
        const text = res.ok ? await res.text() : '';
        counted = parseCounted(text);
        if (counted.size >= 500) { full = q !== ''; break; }
        log(`  paheal: popularity page "${q || 'plain'}" answered ${res.status}, ${text.length} chars, ${counted.size} tags with counts found. Start of it: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
      } catch (e) { log(`  paheal: popularity page "${q || 'plain'}" request failed: ` + (e && e.message)); }
    }
    if (counted.size >= 500) {
      const names = [...new Set([...counted.keys(), ...(have && Array.isArray(have.tags) ? have.tags : [])])];
      const counts = names.map(n => counted.get(n) ?? 1);
      save({ v: 2, t: Date.now(), partial: !full, tags: names, counts });
      onLoad(names, counts); log(`  paheal: tag list with counts saved (${names.length} tags, ${counted.size} with real counts)`); return;
    }
    if (have && Array.isArray(have.tags) && have.tags.length) { save({ ...have, countsTried: Date.now() }); log('  paheal: no counts this time, keeping the saved list'); return; }
    log('  paheal: trying the names-only pages instead (about 40 requests)...');
    const set = new Set();
    for (const ch of PAGES) {
      let found = [];
      for (const extra of ['&mincount=1', '']) {
        try {
          const res = await fetchImpl(`${base}/tags/alphabetic?starts_with=${encodeURIComponent(ch)}${extra}`, { headers: UA, signal: AbortSignal.timeout(30000) });
          if (res.ok) found = parseTags(await res.text());
        } catch (e) { if (!shown) { shown = true; log('  paheal: tag page request failed: ' + (e && e.message)); } }
        if (found.length) break;
      }
      for (const t of found) set.add(t);
      await sleep(1000);
    }
    if (set.size < 500) { log(`  paheal: the tag list looked wrong (${set.size} tags), not saved. Paheal may be blocking this connection (it blocks some VPN addresses).`); return; }
    const tags = [...set].sort(); save({ v: 1, t: Date.now(), countsTried: Date.now(), tags }); onLoad(tags, null); log(`  paheal: tag list saved (${tags.length} tags, no counts)`);
  })().catch(e => log('  paheal: tag list download failed: ' + (e && e.message)));
}
