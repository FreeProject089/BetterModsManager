// ── The blog's tags, read off the feed ───────────────────────────────────────────
// The in-app blog used to filter on a fixed list of "spaces" written into community.ts
// (BMM, All, BSM, Installer, Community). The list and the feed were two separate facts:
// a space nobody had posted in still got a pill that led to an empty page, and a post
// on a showcase page (a project that is not one of the four) was filed under "Community"
// with no way to find it by its own name.
//
// Here the tags ARE the feed: every option is a tag some loaded post carries, with the
// number of posts carrying it. A tag no post carries cannot appear, because nothing
// produces it.
//
// The labels and the precedence are BCWEB's (apps/web/src/pages/blog.jsx, TypeTag):
// a post on a showcase page is tagged with that page (its name, its icon); otherwise with
// its project; a post with neither is Community. The logos are BMM's own bundled marks —
// the ones the listing already draws on a post that has no cover.
//
// Pure data, no DOM and no i18n, so it is tested against the compiled module
// (tests/blog-tags.test.mjs). community.ts turns it into markup.

export type TagSource = {
  project?: { key?: string | null; name?: string | null } | null;
  showcaseProject?: { slug?: string | null; name?: string | null; icon?: string | null } | null;
};

export type BlogTag = {
  /** Filter value. A project's key (`bmm`), or `page:<slug>` for a showcase page. */
  key: string;
  /** The project key the tag's colours and bundled logo belong to (`community` for a page). */
  projectKey: string;
  /** Display name. `null` means "Community", which the caller translates. */
  label: string | null;
  /** A picture for the tag: a bundled logo path, or the page's own icon URL as the feed gave it. */
  logo: string;
  count: number;
};

/** The filter value that means "every tag". Never produced by tagOf. */
export const ALL_TAGS = 'all';

/** The bundled project marks (the white rounded-chip logos of the coverless cards). */
export const PROJ_LOGO: Record<string, string> = {
  community: 'assets/BC_white.webp',
  bmm: 'assets/BMm_white.webp',
  installer: 'assets/bi.svg',
};

// BCWEB's TYPE_TAG labels. `community` is left out on purpose: it is the one label that is a
// word rather than a name, so it is translated where it is shown.
const PROJ_LABEL: Record<string, string> = { bmm: 'BMM', bsm: 'BSM', installer: 'BetterInstaller' };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The one tag a post carries. */
export function tagOf(p: TagSource | null | undefined): Omit<BlogTag, 'count'> {
  const page = p?.showcaseProject;
  const slug = str(page?.slug);
  if (page && slug) {
    return { key: `page:${slug}`, projectKey: 'community', label: str(page.name) || slug, logo: str(page.icon) };
  }
  const key = str(p?.project?.key).toLowerCase();
  if (key && key !== 'community') {
    // A project keyed "all" would otherwise share its filter value with "every tag".
    return { key: key === ALL_TAGS ? `project:${key}` : key, projectKey: key, label: PROJ_LABEL[key] || str(p?.project?.name) || key.toUpperCase(), logo: PROJ_LOGO[key] || '' };
  }
  return { key: 'community', projectKey: 'community', label: null, logo: PROJ_LOGO.community };
}

/**
 * Every tag the posts carry, each once, with its post count — most posts first, then by
 * name, so the order holds still between two loads of the same feed.
 */
export function blogTags(posts: readonly TagSource[] | null | undefined): BlogTag[] {
  const byKey = new Map<string, BlogTag>();
  for (const p of posts || []) {
    const tag = tagOf(p);
    const seen = byKey.get(tag.key);
    if (seen) seen.count += 1;
    else byKey.set(tag.key, { ...tag, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || (a.label || '').localeCompare(b.label || '') || a.key.localeCompare(b.key));
}

/**
 * The filter to apply, given the one remembered and the tags that exist now. A remembered
 * tag that the feed no longer carries falls back to All: keeping it would filter on an
 * option the dropdown cannot show, and the page would sit empty under a control that
 * claims "All". While there is no feed (loading, offline) the remembered tag is kept, so
 * it applies again once the posts arrive.
 */
export function effectiveTag(remembered: string, tags: readonly BlogTag[] | null): string {
  if (tags === null || remembered === ALL_TAGS) return remembered;
  return tags.some((t) => t.key === remembered) ? remembered : ALL_TAGS;
}
