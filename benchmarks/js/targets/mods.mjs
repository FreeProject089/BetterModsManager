// Faithful mirror of frontend/src/features/mods/mods-list.ts `getFilteredMods`,
// plus an optimized variant, so the benchmark can quantify the cost of the
// per-mod `userTags.find(...)` inner loop and `localeCompare` sorting.

/**
 * EXACT port of the shipped getFilteredMods() filter+sort logic.
 * `S` carries: allMods, currentFilter, currentTagFilter, searchQuery (lowercased),
 * userTags, currentSort.
 */
export function getFilteredMods_shipped(S) {
  let filtered = S.allMods.filter((m) => {
    const matchFilter =
      S.currentFilter === 'all' ||
      (S.currentFilter === 'enabled' && m.enabled) ||
      (S.currentFilter === 'disabled' && !m.enabled);

    const matchTag = !S.currentTagFilter || S.currentTagFilter === 'all' || (m.tags && m.tags.includes(S.currentTagFilter));

    let matchSearch = !S.searchQuery || m.name.toLowerCase().includes(S.searchQuery);
    if (!matchSearch && S.searchQuery && m.tags && m.tags.length > 0) {
      matchSearch = m.tags.some((tid) => {
        const tDef = S.userTags.find((t) => t.id === tid); // O(tags) per mod-tag
        return tDef && tDef.name.toLowerCase().includes(S.searchQuery);
      });
    }
    return matchFilter && matchSearch && matchTag;
  });

  filtered.sort((a, b) => {
    if (S.currentSort === 'name_asc') return a.name.localeCompare(b.name);
    if (S.currentSort === 'name_desc') return b.name.localeCompare(a.name);
    if (S.currentSort === 'status') {
      if (a.enabled === b.enabled) return a.name.localeCompare(b.name);
      return a.enabled ? -1 : 1;
    }
    if (S.currentSort === 'activation_order') {
      if (!a.enabled && !b.enabled) return a.name.localeCompare(b.name);
      if (!a.enabled) return 1;
      if (!b.enabled) return -1;
      return a.activation_order - b.activation_order;
    }
    return 0;
  });

  return filtered;
}

/**
 * Optimized variant: hoist a tagId→tagDef Map (O(1) lookup instead of .find),
 * precompute lowercased names once, and use Intl.Collator for sorting.
 * Produces an identical result set/order.
 */
export function getFilteredMods_optimized(S) {
  const tagById = S._tagByIdCache || (S._tagByIdCache = new Map(S.userTags.map((t) => [t.id, t])));
  const q = S.searchQuery;

  let filtered = S.allMods.filter((m) => {
    const matchFilter =
      S.currentFilter === 'all' ||
      (S.currentFilter === 'enabled' && m.enabled) ||
      (S.currentFilter === 'disabled' && !m.enabled);
    if (!matchFilter) return false;

    const matchTag = !S.currentTagFilter || S.currentTagFilter === 'all' || (m.tags && m.tags.includes(S.currentTagFilter));
    if (!matchTag) return false;

    if (!q) return true;
    if ((m._lname || (m._lname = m.name.toLowerCase())).includes(q)) return true;
    if (m.tags) {
      for (const tid of m.tags) {
        const tDef = tagById.get(tid);
        if (tDef && tDef.name.toLowerCase().includes(q)) return true;
      }
    }
    return false;
  });

  const collator = S._collator || (S._collator = new Intl.Collator());
  filtered.sort((a, b) => {
    if (S.currentSort === 'name_asc') return collator.compare(a.name, b.name);
    if (S.currentSort === 'name_desc') return collator.compare(b.name, a.name);
    if (S.currentSort === 'status') {
      if (a.enabled === b.enabled) return collator.compare(a.name, b.name);
      return a.enabled ? -1 : 1;
    }
    if (S.currentSort === 'activation_order') {
      if (!a.enabled && !b.enabled) return collator.compare(a.name, b.name);
      if (!a.enabled) return 1;
      if (!b.enabled) return -1;
      return a.activation_order - b.activation_order;
    }
    return 0;
  });

  return filtered;
}
