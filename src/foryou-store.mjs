import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export function fileStore(dir, name = 'foryou') {
  const file = path.join(dir, name + '.json'), backups = path.join(dir, 'backups');
  mkdirSync(backups, { recursive: true });
  let timer = null, pending = null;

  function flush() {
    timer = null; if (!pending) return;
    const text = JSON.stringify(pending); pending = null;
    const tmp = file + '.tmp';
    writeFileSync(tmp, text); renameSync(tmp, file);
    const day = new Date().toISOString().slice(0, 10), b = path.join(backups, `${name}-${day}.json`);
    if (!existsSync(b)) {
      copyFileSync(file, b);
      const old = readdirSync(backups).filter(f => new RegExp('^' + name + '-\\d{4}-\\d{2}-\\d{2}\\.json$').test(f)).sort().slice(0, -14);
      for (const f of old) try { unlinkSync(path.join(backups, f)); } catch {}
    }
  }
  function snapshot(tag) {
    if (!existsSync(file)) return;
    try {
      copyFileSync(file, path.join(backups, `${name}-${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      const old = readdirSync(backups).filter(f => f.startsWith(`${name}-${tag}-`)).sort().slice(0, -20);
      for (const f of old) try { unlinkSync(path.join(backups, f)); } catch {}
    } catch {}
  }
  let first = true;
  const store = {
    snapshot,
    load() {
      if (first) { first = false; snapshot('start'); }
      try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
    },
    save(d) { pending = d; if (!timer) timer = setTimeout(flush, 500); },
    flush
  };
  process.on('exit', flush);
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { flush(); process.exit(0); });
  return store;
}
