const MAX = 20000;
const url = (u) => typeof u === 'string' && u.length <= 2000 && (/^\/api\/[a-z0-9_-]+\/media\?u=/.test(u) || /^https?:\/\//.test(u)) ? u : '';

export function cleanSnapshot(p) {
  if (!p || typeof p !== 'object' || !Number.isInteger(p.id) || !Array.isArray(p.tags)) return null;
  return {
    id: p.id, md5: /^[0-9a-f]{32}$/.test(p.md5 || '') ? p.md5 : '',
    w: Math.max(1, Number(p.w) || 1), h: Math.max(1, Number(p.h) || 1),
    type: ['video', 'gif', 'image'].includes(p.type) ? p.type : 'image',
    rating: ['safe', 'questionable', 'explicit'].includes(p.rating) ? p.rating : 'safe',
    score: Number(p.score) || 0,
    file: url(p.file), sample: url(p.sample), preview: url(p.preview), compat: url(p.compat), mid: url(p.mid),
    ext: typeof p.ext === 'string' ? p.ext.slice(0, 8) : '',
    link: /^https:\/\//.test(p.link || '') && p.link.length <= 500 ? p.link : '',
    tags: p.tags.slice(0, 400).filter(t => t && typeof t.name === 'string' && t.name.length <= 200)
      .map(t => ({ name: t.name, type: ['artist', 'character', 'copyright', 'species', 'general', 'meta'].includes(t.type) ? t.type : 'general', count: Number(t.count) || 0 }))
  };
}

export function createPostCache({ load, save }) {
  let data = null;
  const get = () => data || (data = (() => { const d = load() || {}; return { v: 1, posts: d.posts && typeof d.posts === 'object' ? d.posts : {} }; })());
  return {
    get(key) { return get().posts[key] || null; },
    set(site, id, post) {
      const k = `${site}:${id}`, d = get();
      if (!d.posts[k] && Object.keys(d.posts).length >= MAX) return false;
      d.posts[k] = post ? cleanSnapshot({ ...post, id }) : { gone: true };
      if (post && !d.posts[k]) { delete d.posts[k]; return false; }
      save(d); return true;
    }
  };
}
