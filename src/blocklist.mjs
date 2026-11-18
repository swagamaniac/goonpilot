// Blocklist. Every tag of a blocked group is added to each search as -tag.
// Bigger groups hit site tag limits sooner. Wildcards (*) are passed through as-is and may not work on every site.

// Order shown in Settings.
export const GROUPS = ['AI-generated', 'Animal-related', 'Non-consensual', 'Gore', 'Scat', 'Vore', 'Incest'];

// Tags per group, used on every site unless SITE_TAGS says otherwise.
export const TAGS = {
  'AI-generated': ['ai_generated'],
  'Animal-related': ['zoophilia', 'zoo', 'canine*', 'equine*', '*feral*', 'bestiality', 'animal'],
  'Non-consensual': ['captive', 'captured', 'defeated', 'rape', '*_slave', 'no_consent', 'molestation', 'non-con*', 'scared', 'forced'],
  'Gore': ['gore', 'necrophilia', 'amputee', 'guro', 'blood'],
  'Scat': ['scat', 'diaper', 'fart'],
  'Vore': ['vore'],
  'Incest': ['incest', '*incest*', 'incest*', '*incest', 'stepmother', 'stepfather', 'stepsister', 'stepbrother']
};

// Per-site replacements. An empty list means nothing is added on that site.
export const SITE_TAGS = {
  sankaku: { 'AI-generated': ['ai-created'] },
  e621: { 'AI-generated': [] },
  e6ai: { 'AI-generated': [] }
};

// Default state: nothing blocked.
export const DEFAULT_BLOCKED = Object.fromEntries(GROUPS.map(g => [g, false]));

// Adds the tags of the blocked groups to query.exclude (no duplicates). Returns the same query.
// extra = the user's own tags from Settings.
export function applyBlocklist(site, query, groups, extra = []) {
  if (!query || (!groups.length && !extra.length)) return query;
  const tags = [...groups.flatMap(g => SITE_TAGS[site]?.[g] ?? TAGS[g] ?? []), ...extra];
  const add = [...new Set(tags)].filter(t => !query.exclude?.includes(t));
  if (add.length) query.exclude = [...(query.exclude || []), ...add];
  return query;
}
