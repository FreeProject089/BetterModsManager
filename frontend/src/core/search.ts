// App-wide search: the ranking, and the registry of things that can be searched.
//
// The palette used to search commands only, and it ranked by "how many query words appear
// anywhere in the haystack". That has two consequences worth naming, because they are the
// whole reason this file exists:
//
//   - Typing "prof" matched a command whose KEYWORDS mention profiles just as strongly as
//     the command literally called "Profiles" — every hit scored 1.
//   - Nothing outside the command registry was reachable. A mod you have installed, a
//     profile you made, a page of the documentation: none of it could be found.
//
// So: a real scorer (exact → prefix → word-start → substring → subsequence, with the field
// it matched weighted), and providers that contribute results from anywhere in the app.
//
// Kept free of DOM and of app imports so it can be exercised directly in node — the ranking
// is the part most likely to be wrong in a way that only shows up as "the results feel off",
// which is exactly the kind of thing that needs measuring rather than eyeballing.

export type HitKind = 'command' | 'mod' | 'profile' | 'doc' | 'theme' | 'plugin' | 'setting' | 'app';

export interface SearchHit {
  id: string;
  kind: HitKind;
  title: string;
  /** Second line: a path, an author, a version — whatever identifies it among namesakes. */
  sub?: string;
  /** Extra text to match against but not to show (tags, synonyms, ids). */
  keywords?: string;
  /** Multiplier applied to the computed score. Use sparingly; 1 is the default. */
  boost?: number;
  run: () => void;
}

/** A provider returns candidates for a query. Sync or async; failures are contained. */
export type SearchProvider = (query: string) => SearchHit[] | Promise<SearchHit[]>;

const _providers = new Map<string, SearchProvider>();
/** Register (or replace) a source of results. Replacing by id keeps re-registration safe. */
export function registerSearchProvider(id: string, fn: SearchProvider): void { _providers.set(id, fn); }
export function searchProviderIds(): string[] { return [..._providers.keys()]; }

// ── normalisation ──────────────────────────────────────────────────────────────────────
// Diacritics are folded, so "thème" is found by typing "theme" and vice versa. That matters
// here specifically: the UI is bilingual and half the French titles carry accents the user
// will not type when searching in a hurry.
// U+0300..U+036F is the combining-diacritics block. Written as escapes rather than literal
// combining marks, which are invisible in an editor and trivially corrupted by a copy-paste.
const fold = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Split a query into terms. Empty query = no terms, which every caller reads as "match all". */
export function terms(q: string): string[] {
  return fold(q).split(/[\s_/\\-]+/).filter(Boolean);
}

// ── scoring one term against one string ────────────────────────────────────────────────
//
// The tiers are ordered by how much the match tells you about intent. An exact title is
// certain; a subsequence ("dpl" in "deploy") is a guess, useful but never allowed to
// outrank a real prefix.
const EXACT = 1000, PREFIX = 700, WORD = 500, SUBSTR = 300, FUZZY = 120;

export function scoreTerm(term: string, textFolded: string): number {
  if (!term || !textFolded) return 0;
  if (textFolded === term) return EXACT;
  if (textFolded.startsWith(term)) {
    // A prefix of a SHORT string is a stronger signal than a prefix of a long one: "mod"
    // against "Mods" means more than "mod" against "Mod deployment troubleshooting".
    return PREFIX + Math.max(0, 60 - textFolded.length);
  }
  // Start of any word inside the string.
  const at = textFolded.indexOf(term);
  if (at > 0 && /[\s_/\\.-]/.test(textFolded[at - 1])) return WORD;
  if (at >= 0) return SUBSTR;
  // Subsequence: every character of the term appears in order. Scored by density, so a term
  // whose letters sit close together beats one scattered across the whole string.
  let i = 0, first = -1, last = -1;
  for (let j = 0; j < textFolded.length && i < term.length; j++) {
    if (textFolded[j] === term[i]) { if (first < 0) first = j; last = j; i++; }
  }
  if (i < term.length) return 0;
  const span = last - first + 1;
  return FUZZY + Math.round((term.length / span) * 60);
}

// Field weights. The title is what the user is looking at; keywords are a safety net, and a
// match there should never beat a title match of the same quality.
const W_TITLE = 1, W_SUB = 0.55, W_KEYWORDS = 0.4;

/** Score one hit against a query's terms. 0 means "does not match" — callers must drop it.
 *
 *  EVERY term must match somewhere, which is what makes a multi-word query narrow rather
 *  than widen the result set. Scoring by "how many terms matched" did the opposite: adding a
 *  word to your query brought in MORE results, each one weaker. */
export function scoreHit(hit: SearchHit, qTerms: string[]): number {
  if (!qTerms.length) return 1; // no query: everything is a candidate, order left to callers
  const title = fold(hit.title || '');
  const sub = fold(hit.sub || '');
  const kw = fold(hit.keywords || '');
  let total = 0;
  for (const term of qTerms) {
    const best = Math.max(
      scoreTerm(term, title) * W_TITLE,
      scoreTerm(term, sub) * W_SUB,
      scoreTerm(term, kw) * W_KEYWORDS,
    );
    if (!best) return 0;          // one unmatched term disqualifies the hit
    total += best;
  }
  // Average, so a two-word query is comparable to a one-word query rather than scoring twice
  // as high just for being longer.
  return (total / qTerms.length) * (hit.boost ?? 1);
}

/** Rank a set of hits. Ties break on title length then alphabetically, so the order is
 *  stable between runs — a list that reshuffles under an unchanged query looks broken. */
export function rank(hits: SearchHit[], q: string, limit = 50): SearchHit[] {
  const qTerms = terms(q);
  const scored: { h: SearchHit; s: number }[] = [];
  for (const h of hits) {
    const s = scoreHit(h, qTerms);
    if (s > 0) scored.push({ h, s });
  }
  scored.sort((a, b) => b.s - a.s
    || a.h.title.length - b.h.title.length
    || a.h.title.localeCompare(b.h.title));
  return scored.slice(0, limit).map((x) => x.h);
}

/** Ask every provider, in parallel, and rank the union.
 *
 *  A provider that throws or hangs must not take the palette with it: each is wrapped, and
 *  the whole run is bounded. A search box that stops responding because one source is slow
 *  is worse than one that shows partial results. */
export async function searchAll(q: string, limit = 50, timeoutMs = 1500): Promise<SearchHit[]> {
  const jobs = [..._providers.values()].map(async (fn) => {
    try { return (await fn(q)) || []; } catch { return []; }
  });
  const guard = new Promise<SearchHit[][]>((resolve) => setTimeout(() => resolve([]), timeoutMs));
  const settled = await Promise.race([Promise.all(jobs), guard]);
  return rank(settled.flat(), q, limit);
}
