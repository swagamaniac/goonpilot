import { createForYou } from './foryou.mjs';

// open(name) returns a { load, save, snapshot, flush } store; has(name) says whether it holds data; retire(name) sets a removed profile's data aside.
export function createProfiles({ open, has, retire, now = Date.now, vision = null, md5Of = null }) {
  const metaStore = open('profiles');
  const fileFor = (id) => id === 'default' ? 'foryou' : 'foryou-' + id;
  const engines = new Map();

  let meta = metaStore.load();
  const fresh = !meta || !Array.isArray(meta.list) || !meta.list.some(p => p.id === 'default');
  const saveMeta = () => metaStore.save(meta);
  const clean = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  const normal = () => meta.list.filter(p => !p.kind || p.kind === 'normal');
  const sharedVotes = () => { const m = new Map(); for (const p of normal()) for (const [k, v] of engine(p.id).fy.shareVotes()) { const o = m.get(k); if (!o || v.t > o.t) m.set(k, v); } return [...m.values()]; };
  const sharedSeen = () => { const tagSeen = {}; let nSeen = 0; for (const p of normal()) { const s = engine(p.id).fy.shareSeen(); nSeen += s.nSeen; for (const [k, v] of Object.entries(s.tagSeen)) tagSeen[k] = (tagSeen[k] || 0) + v; } return { tagSeen, nSeen }; };
  const sharedMd5 = () => { const o = {}; for (const p of normal()) Object.assign(o, engine(p.id).fy.shareMd5()); return o; };

  function engine(id) {
    let e = engines.get(id);
    if (!e) {
      const store = open(fileFor(id));
      const kind = meta.list.find(p => p.id === id)?.kind || 'normal';
      const fy = createForYou({ scope: kind, vision, md5Of, shared: kind === 'paheal-all' ? { votes: sharedVotes, md5: sharedMd5, seen: sharedSeen } : null, load: store.load, save: store.save, backup: store.snapshot, enabled: () => meta.enabled !== false, setEnabled: (v) => { meta.enabled = !!v; saveMeta(); } });
      e = { fy, store }; engines.set(id, e);
    }
    return e;
  }

  if (fresh) {
    const probe = open('foryou').load();
    meta = { v: 1, active: 'default', enabled: probe?.enabled !== false, list: [{ id: 'default', name: 'Default', created: now() }] };
    saveMeta();
  }

  const active = () => engine(meta.active).fy;
  active().counts();
  const current = new Proxy({}, { get: (_, k) => { const e = active(), v = e[k]; return typeof v === 'function' ? v.bind(e) : v; } });
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  const find = (id) => meta.list.find(p => p.id === id);

  return {
    current,
    get active() { return meta.active; },
    list() {
      return { active: meta.active, profiles: meta.list.map(p => ({ id: p.id, name: p.name, ...(p.kind ? { kind: p.kind } : {}), ...engine(p.id).fy.counts() })) };
    },
    create(name, kind = 'normal') {
      name = clean(name); if (!name) throw bad('Give the profile a name');
      if (!['normal', 'paheal-own', 'paheal-all'].includes(kind)) throw bad('Unknown profile type');
      if (meta.list.length >= 12) throw bad('Too many profiles');
      if (meta.list.some(p => p.name.toLowerCase() === name.toLowerCase())) throw bad('A profile with that name exists');
      let id; do { id = 'p' + Math.random().toString(36).slice(2, 8); } while (find(id) || has(fileFor(id)));
      meta.list.push({ id, name, ...(kind !== 'normal' ? { kind } : {}), created: now() }); saveMeta(); return id;
    },
    switchTo(id) {
      if (!find(id)) throw bad('No such profile');
      if (id !== meta.active) {
        const from = active().state().prefs, KEYS = ['ignored', 'ignoreCharacters', 'ignoreCopyright', 'ignoreArtists', 'ignoreSpecies'];
        const carry = {}; for (const k of KEYS) if (from[k] !== undefined) carry[k] = from[k];
        meta.active = id; saveMeta();
        const to = engine(id).fy, cur = to.state().prefs;
        for (const k of Object.keys(carry)) if (JSON.stringify(carry[k]) === JSON.stringify(cur[k])) delete carry[k];
        if (Object.keys(carry).length) to.setPrefs(carry);
      } else { meta.active = id; saveMeta(); engine(id); }
    },
    rename(id, name) {
      name = clean(name); const p = find(id); if (!p || !name) throw bad('Bad name');
      if (meta.list.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw bad('A profile with that name exists');
      p.name = name; saveMeta();
    },
    remove(id) {
      if (id === 'default') throw bad('The default profile can’t be removed');
      if (!find(id)) throw bad('No such profile');
      if (id === meta.active) this.switchTo('default');
      const e = engine(id); e.store.flush(); e.store.snapshot('before-remove');
      engines.delete(id);
      retire(fileFor(id));
      meta.list = meta.list.filter(p => p.id !== id); saveMeta();
    },
    resetAllLearning() { for (const p of meta.list) engine(p.id).fy.resetLearning(); },
    flushAll() { for (const e of engines.values()) e.store.flush(); metaStore.flush(); }
  };
}
