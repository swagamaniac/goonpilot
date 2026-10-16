const MAX = 2000;
export const artistKey = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, '_');

export function createArtists({ load, save, now = Date.now }) {
  let data = null;
  const get = () => data || (data = (() => { const d = load() || {}; return { v: 1, artists: d.artists && typeof d.artists === 'object' ? d.artists : {}, ui: d.ui && typeof d.ui === 'object' ? d.ui : {} }; })());
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  return {
    list() { return Object.values(get().artists).sort((a, b) => a.name.localeCompare(b.name)); },
    set({ name, note, kind }) {
      const k = artistKey(name);
      if (!k || k.length > 200 || /[:*]/.test(k) || k.startsWith('-') || k.startsWith('~')) throw bad('Bad artist tag');
      const a = get().artists;
      if (!a[k] && Object.keys(a).length >= MAX) throw bad('Too many artists');
      const cur = a[k] || { name: k, note: '', added: now(), kind: 'artist' };
      if (kind === 'artist' || kind === 'character' || kind === 'tag') cur.kind = kind;
      if (typeof note === 'string') cur.note = note.slice(0, 500);
      a[k] = cur; save(get()); return cur;
    },
    getUi() { return get().ui; },
    setUi(b) {
      const cap = { history: 20, saved: 500, supers: 200 }, ui = get().ui;
      for (const k of Object.keys(cap)) if (Array.isArray(b[k])) ui[k] = b[k].filter(x => x && typeof x === 'object').slice(0, cap[k]);
      save(get()); return ui;
    },
    remove(name) { delete get().artists[artistKey(name)]; save(get()); }
  };
}
