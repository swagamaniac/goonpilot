import { createInterface } from 'node:readline/promises';
const BASE = 'http://localhost:8787', H = { 'x-goonpilot': '1', 'content-type': 'application/json' }, sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('This wipes ALL likes, dislikes and the seen log of ALL profiles (settings are kept; a backup is made first).');
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ans = (await rl.question('Type RESET and press Enter to continue (anything else cancels): ')).trim(); rl.close();
if (ans !== 'RESET') { console.log('Cancelled. Nothing changed.'); process.exit(0); }
async function go() { return fetch(BASE + '/api/foryou/reset-learning', { method: 'POST', headers: H, body: JSON.stringify({ confirm: 'RESET' }) }); }
let r;
try { r = await go(); } catch { console.log('The server is not running. Start it, then run this again.'); process.exit(1); }
if (r.status === 404 || r.status === 400 || r.status === 405) {
  console.log('Restarting the server so it loads the new code...');
  const rr = await fetch(BASE + '/api/lib/restart', { method: 'POST', headers: H }).catch(() => null);
  if (!rr || rr.status !== 200) { console.log('The server could not restart itself. Close its window, start it again, then run this again.'); process.exit(1); }
  for (let i = 0; i < 45; i++) { await sleep(2000); try { r = await go(); if (r.status === 200) break; } catch {} }
}
console.log(r.status === 200 ? 'Done. Fresh start for all profiles (backups are in data\\backups). Refresh the page on your phone.' : 'Failed (' + r.status + '). Nothing was changed if the message above says so; tell Claude.');
