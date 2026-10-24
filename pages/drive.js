// Optional Google Drive sync for the Pages build. Loaded only when someone presses the sign-in button.
// Stores one file, goonpilot.json, in the app's hidden Drive folder (drive.appdata scope: it can't see anything else).
// Set CLIENT_ID to your own OAuth client ID (see the wiki); empty means the button explains that sync isn't set up.
export const CLIENT_ID = '';

const API = 'https://www.googleapis.com/drive/v3/files', UP = 'https://www.googleapis.com/upload/drive/v3/files', NAME = 'goonpilot.json';
let token = null, expires = 0, fileId = null, lastSent = '', timer = null;

const loadGis = () => window.google?.accounts?.oauth2 ? Promise.resolve() : new Promise((resolve, reject) => {
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = resolve; s.onerror = () => reject(new Error('Could not load Google sign-in')); document.head.append(s);
});
async function drive(url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { ...opt.headers, Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error(`Google Drive answered ${r.status}`);
  return r;
}
const local = async () => { const b = await (await fetch('api/pages/backup')).json(); delete b.at; return JSON.stringify(b); };

export const signedIn = () => !!token && Date.now() < expires;

export async function signIn() {
  if (!CLIENT_ID) throw new Error('Google sync is not set up in this copy (no OAuth client ID)');
  await loadGis();
  const t = await new Promise((resolve, reject) => google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.appdata',
    callback: (r) => r.error ? reject(new Error(r.error)) : resolve(r), error_callback: (e) => reject(new Error(e.message || 'Sign-in cancelled'))
  }).requestAccessToken());
  token = t.access_token; expires = Date.now() + (Number(t.expires_in) - 60) * 1000;
  const q = new URLSearchParams({ spaces: 'appDataFolder', q: `name='${NAME}'`, fields: 'files(id,modifiedTime)' });
  const f = (await (await drive(`${API}?${q}`)).json()).files?.[0];
  fileId = f?.id || null;
  return f ? { remoteAt: f.modifiedTime } : null;
}

// Replaces this browser's data with the Drive copy.
export async function pull() {
  const b = await (await drive(`${API}/${fileId}?alt=media`)).json();
  const r = await fetch('api/pages/backup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goonpilot': '1' }, body: JSON.stringify(b) });
  if (!r.ok) throw new Error('The Drive copy could not be restored');
  lastSent = await local();
}

// Uploads this browser's data if it changed since the last upload.
export async function push() {
  if (!signedIn()) { stop(); return false; }
  const text = await local(); if (text === lastSent) return true;
  if (fileId) await drive(`${UP}/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: text });
  else {
    const b = 'gp' + Math.random().toString(36).slice(2), part = (body) => `--${b}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${body}\r\n`;
    const body = part(JSON.stringify({ name: NAME, parents: ['appDataFolder'] })) + part(text) + `--${b}--`;
    fileId = (await (await drive(`${UP}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${b}` }, body })).json()).id;
  }
  lastSent = text; return true;
}

export function start(onError) {
  stop();
  const tick = () => push().catch(onError);
  timer = setInterval(tick, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', tick);
  start.tick = tick;
}
export function stop() {
  clearInterval(timer); timer = null;
  if (start.tick) document.removeEventListener('visibilitychange', start.tick);
}
export function signOut() { stop(); if (token) window.google?.accounts?.oauth2?.revoke(token); token = null; expires = 0; fileId = null; lastSent = ''; }
