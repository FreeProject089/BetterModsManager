// README version refresh (pure). Only the parts that name the CURRENT version move: the badge,
// the hero image's alt text, the « What's new in X » heading / link and the changelog file
// links. « (new in 1.0.2) » next to a feature is history, not the current version: untouched.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * text, from = version the README states now, to = new version.
 * opts.changelog = true when Update/changelog_v<to>_*.md exists (links and « what's new » move
 * only then, so a README never links a changelog that is not there).
 * Returns { text, changes: [label] }.
 */
export function updateReadme(text, from, to, { changelog = true } = {}) {
  if (!from || from === to) return { text, changes: [] };
  const F = esc(from);
  const changes = [];
  let t = text;
  const apply = (label, re, rep) => {
    const n = t.replace(re, rep);
    if (n !== t) { changes.push(label); t = n; }
  };
  apply('version badge', new RegExp(`(img\\.shields\\.io/badge/version-)${F}(-)`, 'g'), `$1${to}$2`);
  apply('hero alt text', new RegExp(`(alt="Better Mods? Manager )${F}(")`, 'g'), `$1${to}$2`);
  if (changelog) {
    apply('changelog links', new RegExp(`(changelog_v)${F}(_(?:EN|FR)\\.md)`, 'g'), `$1${to}$2`);
    // [ \t]* and the \r kept: `\s*$` would eat the CRLF and the blank lines after the heading.
    apply("what's new heading", new RegExp(`^(#+ (?:What's new in|Nouveautés de la) )${F}([ \\t]*\\r?)$`, 'gm'), `$1${to}$2`);
    apply("what's new link text", new RegExp(`(\\[(?:What's new in|Nouveautés de la) )${F}(\\])`, 'g'), `$1${to}$2`);
    apply('changelog link text', new RegExp(`(\\[(?:the )?)${F}( changelog\\]|\\])(?=\\(Update/changelog_v)`, 'g'), `$1${to}$2`);
    apply('changelog link text (fr)', new RegExp(`(journal des modifications )${F}(\\])`, 'g'), `$1${to}$2`);
  }
  return { text: t, changes };
}

/** The version a README states in its badge, or null. */
export function readmeVersion(text) {
  return /img\.shields\.io\/badge\/version-(\d+\.\d+\.\d+(?:--?[0-9A-Za-z.]+)?)-/.exec(text)?.[1] ?? null;
}
