import { existsSync, copyFileSync } from 'node:fs';
const BASE = 'http://localhost:8787', H = { 'x-goonpilot': '1' }, sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function call(p, method = 'GET') { const r = await fetch(BASE + p, { method, headers: H }); return { status: r.status, json: await r.json().catch(() => null) }; }
const say = (s) => console.log(s);
let st;
try { st = await call('/api/vision/status'); } catch { say('The server is not running. Start it (start-phone.bat or start.bat), then run this again.'); process.exit(1); }

const arg = process.argv[2];
if (st.status === 200 && arg === 'backfill') {
  const r = await call('/api/vision/backfill', 'POST'); if (r.json?.error) { say('Backfill failed: ' + r.json.error); process.exit(1); }
  say(`Tagging ${r.json.queued} of ${r.json.files} pictures from your offline library (local files only, nothing is downloaded).`);
  for (;;) { await sleep(5000); const s2 = (await call('/api/vision/status')).json; process.stdout.write(`\r${s2.queued} left, ${s2.analysed} analysed, ${s2.failed} failed   `); if (!s2.queued) break; }
  say('\nDone.'); process.exit(0);
}
if (st.status === 200 && (arg === 'on' || arg === 'off')) { st = await call('/api/vision/toggle?on=' + (arg === 'on' ? 1 : 0)); say('Image analysis is now ' + (st.json.enabled ? 'ON' : 'OFF')); process.exit(0); }


if (st.status !== 200) {
  say('Restarting the server so it loads the new code...');
  const r = await call('/api/lib/restart', 'POST');
  if (r.status !== 200) { say('The server could not restart itself. Close its window, start it again (start-phone.bat), then run this again.'); process.exit(1); }
  for (let i = 0; i < 45; i++) { await sleep(2000); try { st = await call('/api/vision/status'); if (st.status === 200) break; } catch {} }
  if (st.status !== 200) { say('The server did not come back. Start it by hand and run this again.'); process.exit(1); }
}
if (arg === 'forget' || arg === 'clear') { const r = await call('/api/vision/forget-imported' + (arg === 'clear' ? '?all=1' : '')); if (r.status === 200) { say(arg === 'clear' ? `Cleared everything: ${r.json.removed} entries removed. Fresh start. (Votes and backups untouched.)` : `Removed ${r.json.removed} imported test entries.`); process.exit(0); } }
if (!st.json.packages) { say('The packages are not installed: ' + (st.json.packagesError || 'run npm install') + '\nRun maintenance\\setup-vision.bat again (it runs npm install first).'); process.exit(1); }


if (!st.json.model) {
  say('Downloading the AI model (about 470 MB, once)...');
  await call('/api/vision/setup');
  for (;;) {
    await sleep(3000); st = await call('/api/vision/status'); const s = st.json.setup;
    process.stdout.write(`\r  ${s.state} ${s.pct}%   `);
    if (s.state === 'error') { say('\nFailed: ' + s.error + '\nRun this again to retry (it continues where the files are complete).'); process.exit(1); }
    if (st.json.model && st.json.ready) break;
    if (s.state === 'done') break;
  }
  say('');
}
st = await call('/api/vision/status');
say(st.json.ready ? `Done. Image analysis is ON and ready (${st.json.analysed} pictures analysed so far). It learns as you browse; no extra downloads.` : 'Model is downloaded but not ready yet: ' + (st.json.error || 'restart the server once and check /api/vision/status'));
