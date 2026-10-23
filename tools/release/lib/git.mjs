// Git reads for the release tool. Read-only: nothing here commits, stashes, resets, checks out
// or tags (the working tree is shared; the lead commits).
//
// Finding where the previous version starts is the tricky part in this repository: the v1.0.1
// and v1.0.2 tags point at a main commit whose package.json says 0.9.9, so a tag is only trusted
// when it is an ancestor of HEAD AND its package.json states that version. Otherwise:
//   2. the GitHub release of that version (gh, read-only): the last HEAD commit before it was
//      published;
//   3. the last commit whose package.json still said the previous version.

import { capture } from './exec.mjs';
import { parseVersion, previousVersion, compareVersions, isVersion } from './version.mjs';

export const git = (args, cwd) => capture('git', args, { cwd });

export function gitOk(cwd) { return git(['rev-parse', '--git-dir'], cwd) !== null; }

export function headInfo(cwd) {
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    commit: git(['rev-parse', 'HEAD'], cwd),
    short: git(['rev-parse', '--short', 'HEAD'], cwd),
    date: git(['log', '-1', '--format=%aI'], cwd),
  };
}

/** Porcelain status lines (empty array = clean). */
export function statusLines(cwd) {
  const s = git(['status', '--porcelain'], cwd);
  return s ? s.split(/\r?\n/).filter(Boolean) : [];
}

export function versionAt(cwd, ref) {
  const t = git(['show', `${ref}:package.json`], cwd);
  if (!t) return null;
  try { return JSON.parse(t).version ?? null; } catch { return null; }
}

/** Every tag that looks like a version: [{ tag, version, commit }]. */
export function versionTags(cwd) {
  const out = git(['tag', '--list'], cwd);
  if (!out) return [];
  return out.split(/\r?\n/).filter((t) => isVersion(t)).map((tag) => ({
    tag, version: tag.replace(/^[vV]/, ''), commit: git(['rev-list', '-n', '1', tag], cwd),
  }));
}

const isAncestor = (cwd, a, b = 'HEAD') => capture('git', ['merge-base', '--is-ancestor', a, b], { cwd }) !== null;

/** Published GitHub releases (read-only gh call). [] when gh is missing or offline. */
export function githubReleases(cwd) {
  const out = capture('gh', ['release', 'list', '--limit', '50', '--json', 'tagName,publishedAt,isPrerelease,isDraft'], { cwd });
  try { return out ? JSON.parse(out) : []; } catch { return []; }
}

/**
 * The previous version and the commit its history ends at.
 * Returns { previous, fromRef, how, candidates } (fromRef null when nothing could be found).
 */
export function detectPrevious(cwd, version, { from = null, previous = null, useGh = true } = {}) {
  const tags = versionTags(cwd);
  const releases = useGh ? githubReleases(cwd) : [];
  const known = [...new Set([...tags.map((t) => t.version), ...releases.map((r) => r.tagName.replace(/^[vV]/, '')).filter(isVersion)])];
  const prev = previous ?? previousVersion(known, version);
  if (from) {
    const c = git(['rev-parse', from], cwd);
    return { previous: prev, fromRef: c, how: `given ref ${from}`, candidates: known };
  }
  if (!prev) return { previous: null, fromRef: null, how: 'no earlier version found', candidates: known };

  const notes = [];
  for (const t of tags.filter((x) => x.version === prev)) {
    const v = versionAt(cwd, t.commit);
    if (t.commit && isAncestor(cwd, t.commit) && v === prev) return { previous: prev, fromRef: t.commit, how: `tag ${t.tag}`, candidates: known };
    notes.push(`tag ${t.tag} ignored (${v ? `its package.json says ${v}` : 'unreadable'}${t.commit && !isAncestor(cwd, t.commit) ? ', not an ancestor of HEAD' : ''})`);
  }
  const rel = releases.find((r) => r.tagName.replace(/^[vV]/, '') === prev && r.publishedAt);
  if (rel) {
    const c = git(['rev-list', '-n', '1', '--first-parent', `--before=${rel.publishedAt}`, 'HEAD'], cwd);
    if (c) return { previous: prev, fromRef: c, how: [...notes, `last commit before the GitHub release v${prev} (${rel.publishedAt})`].join('; '), candidates: known };
  }
  const bumps = git(['log', '--format=%H', '-G', '"version": "', '--', 'package.json'], cwd);
  for (const c of (bumps || '').split(/\r?\n/).filter(Boolean)) {
    const v = versionAt(cwd, c);
    if (v && compareVersions(v, version) < 0) {
      return { previous: prev, fromRef: c, how: [...notes, `last commit whose package.json says ${v}`].join('; '), candidates: known };
    }
  }
  return { previous: prev, fromRef: null, how: [...notes, 'no start commit found'].join('; '), candidates: known };
}

const SEP = '\x1f', REC = '\x1e';
/** Commits in range (newest first): [{ hash, short, date, author, subject }]. Names only, no e-mails. */
export function logRange(cwd, range, { firstParent = false, noMerges = true } = {}) {
  const args = ['log', `--format=%H${SEP}%h${SEP}%aI${SEP}%an${SEP}%s${REC}`];
  if (noMerges) args.push('--no-merges');
  if (firstParent) args.push('--first-parent');
  args.push(range);
  const out = git(args, cwd);
  if (!out) return [];
  return out.split(REC).map((r) => r.trim()).filter(Boolean).map((r) => {
    const [hash, short, date, author, subject] = r.split(SEP);
    return { hash, short, date, author, subject };
  });
}

/** Gitlinks recorded in a tree: { path: sha }. */
export function gitlinks(cwd, ref = 'HEAD') {
  const out = git(['ls-tree', '-r', ref], cwd);
  const map = {};
  for (const line of (out || '').split(/\r?\n/)) {
    const m = /^160000 commit ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (m) map[m[2]] = m[1];
  }
  return map;
}

export function hasCommit(cwd, sha) { return git(['cat-file', '-e', `${sha}^{commit}`], cwd) !== null; }

export function remoteUrl(cwd) {
  const u = git(['remote', 'get-url', 'origin'], cwd);
  if (!u) return null;
  const m = /github\.com[:/](.+?)(\.git)?$/.exec(u);
  return m ? `https://github.com/${m[1]}` : null;
}

export { parseVersion };
