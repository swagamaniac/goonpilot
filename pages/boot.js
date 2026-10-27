// GitHub Pages only: start the service worker that stands in for the local server, then load the app.
const fail = (msg) => { document.body.prepend(Object.assign(document.createElement('p'), { className: 'hint', textContent: msg })); };
(async () => {
  if (!('serviceWorker' in navigator)) return fail('This browser has no service workers, so this version cannot run here. Use the local server version.');
  try { await navigator.storage?.persist?.(); } catch {}
  try {
    // sw.js is bundled into one classic script by the Pages workflow: Firefox fails to install module service workers.
    const register = () => navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
    try { await register(); } catch { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); await register(); }
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(r => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 4000); });
    if (!navigator.serviceWorker.controller) return fail('Not ready yet: reload the page (a hard reload skips the part that makes this work).');
  } catch (e) { return fail('Could not start: ' + (e.message || e)); }
  await import('./app.js');
})();
