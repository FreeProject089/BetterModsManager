const fs = require('fs');
const path = require('path');

const SECTIONS = [
  { marker: '__SECTION_COMMON__',        pfx: ['common.'] },
  { marker: '__SECTION_NAV__',           pfx: ['nav.', 'dashboard.', 'dashboard'] },
  { marker: '__SECTION_PROF__',          pfx: ['prof.'] },
  { marker: '__SECTION_LIB__',           pfx: ['lib.'] },
  { marker: '__SECTION_MOD__',           pfx: ['mod.', 'mods.'] },
  { marker: '__SECTION_DETAIL__',        pfx: ['detail.'] },
  { marker: '__SECTION_CTX__',           pfx: ['ctx.'] },
  { marker: '__SECTION_MAPPER__',        pfx: ['mapper.'] },
  { marker: '__SECTION_MM__',            pfx: ['mm.'] },
  { marker: '__SECTION_MODPACK__',       pfx: ['modpack.'] },
  { marker: '__SECTION_CONFLICT__',      pfx: ['conflict.'] },
  { marker: '__SECTION_CONFLICT_V2__',   pfx: [] },
  { marker: '__SECTION_REPO__',          pfx: ['repo.', 'admin.', 'admin'] },
  { marker: '__SECTION_SERVER_NOTIF__',  pfx: [] },
  { marker: '__SECTION_SETTINGS__',      pfx: ['settings.', 'theme.', 'theme', '_info', '_synonyms'] },
  { marker: '__SECTION_STORAGE__',       pfx: ['storage.', 'hashes.'] },
  { marker: '__SECTION_BENCHMARK__',     pfx: ['bench.', 'benchmark.'] },
  { marker: '__SECTION_INTEGRITY__',     pfx: ['integrity.'] },
  { marker: '__SECTION_SECURITY__',      pfx: ['security.'] },
  { marker: '__SECTION_CRASH__',         pfx: ['crash.'] },
  { marker: '__SECTION_DEVTOOLS__',      pfx: ['dev.'] },
  { marker: '__SECTION_UPDATE__',        pfx: ['update.', 'history.'] },
  { marker: '__SECTION_ONBOARD__',       pfx: ['onboard.', 'onboarding.'] },
  { marker: '__SECTION_HUB__',           pfx: ['hub.', 'tut.'] },
  { marker: '__SECTION_BETAHUB__',       pfx: ['betahub.'] },
  { marker: '__SECTION_PTB__',           pfx: ['ptb.'] },
  { marker: '__SECTION_CREDITS__',       pfx: ['credits.', 'contributor.'] },
  { marker: '__SECTION_LICENSE__',       pfx: ['license.', 'eula.'] },
  // Diagram sub-sections (listed BEFORE __SECTION_DOCS__ so longer prefixes win)
  { marker: '__SECTION_DIAG_ARCH__',     pfx: ['docs.diagram.arch'] },
  { marker: '__SECTION_DIAG_BACKUP__',   pfx: ['docs.diagram.backup'] },
  { marker: '__SECTION_DIAG_BETAHUB__',  pfx: ['docs.diagram.betahub'] },
  { marker: '__SECTION_DIAG_BTN__',      pfx: ['docs.diagram.btn'] },
  { marker: '__SECTION_DIAG_CACHE__',    pfx: ['docs.diagram.cache'] },
  { marker: '__SECTION_DIAG_CLUSTER__',  pfx: ['docs.diagram.cluster'] },
  { marker: '__SECTION_DIAG_CONFLICT__', pfx: ['docs.diagram.conflict'] },
  { marker: '__SECTION_DIAG_CRASH__',    pfx: ['docs.diagram.crash'] },
  { marker: '__SECTION_DIAG_DISCORD__',  pfx: ['docs.diagram.discordRpc'] },
  { marker: '__SECTION_DIAG_DOCS_LOGIC__', pfx: ['docs.diagram.docsLogic', 'docs.diagram.semanticSearch'] },
  { marker: '__SECTION_DIAG_EDGE__',     pfx: ['docs.diagram.edge'] },
  { marker: '__SECTION_DIAG_FAQ_DEL__',  pfx: ['docs.diagram.faq_del'] },
  { marker: '__SECTION_DIAG_FAQ_DISK__', pfx: ['docs.diagram.faq_disk'] },
  { marker: '__SECTION_DIAG_IMPORT__',   pfx: ['docs.diagram.import'] },
  { marker: '__SECTION_DIAG_INTEGRITY__', pfx: ['docs.diagram.integrity'] },
  { marker: '__SECTION_DIAG_IO__',       pfx: ['docs.diagram.io'] },
  { marker: '__SECTION_DIAG_LABEL__',    pfx: ['docs.diagram.label'] },
  { marker: '__SECTION_DIAG_MAPPER__',   pfx: ['docs.diagram.mapper'] },
  { marker: '__SECTION_DIAG_MECH__',     pfx: ['docs.diagram.mech'] },
  { marker: '__SECTION_DIAG_MODDING__',  pfx: ['docs.diagram.modding', 'docs.diagram.mod_arch', 'docs.diagram.lightweight', 'docs.diagram.modpack.'] },
  { marker: '__SECTION_DIAG_MOD_ARCH__', pfx: [] },
  { marker: '__SECTION_DIAG_MTIME__',    pfx: ['docs.diagram.mtime'] },
  { marker: '__SECTION_DIAG_ONE_CLICK__', pfx: ['docs.diagram.one_click', 'docs.diagram.launchPacks', 'docs.diagram.mcpServer'] },
  { marker: '__SECTION_DIAG_PERF__',     pfx: ['docs.diagram.perf'] },
  { marker: '__SECTION_DIAG_PREMIUM__',  pfx: ['docs.diagram.premium'] },
  { marker: '__SECTION_DIAG_PROFILE__',  pfx: ['docs.diagram.profile', 'docs.diagram.custom'] },
  { marker: '__SECTION_DIAG_RESUMABLE__', pfx: ['docs.diagram.resumableDownloads'] },
  { marker: '__SECTION_DIAG_SECURITY__', pfx: ['docs.diagram.security'] },
  { marker: '__SECTION_DIAG_SEMANTIC__', pfx: [] },
  { marker: '__SECTION_DIAG_SERVER__',   pfx: ['docs.diagram.server', 'docs.diagram.hosting'] },
  { marker: '__SECTION_DIAG_STACK__',    pfx: ['docs.diagram.codeStack'] },
  { marker: '__SECTION_DIAG_SYNC__',     pfx: ['docs.diagram.sync'] },
  { marker: '__SECTION_DIAG_THREADS__',  pfx: ['docs.diagram.engineThreads'] },
  { marker: '__SECTION_DIAG_TIPS__',     pfx: ['docs.diagram.tips', 'docs.diagram.taskyI'] },
  { marker: '__SECTION_DIAG_UPDATE__',   pfx: ['docs.diagram.update'] },
  // General shared diagram keys (after specific ones so they catch leftovers)
  { marker: '__SECTION_DIAGRAMS__',      pfx: ['docs.diagram.'] },
  // General docs (non-diagram) — after DIAGRAMS sections
  { marker: '__SECTION_DOCS__',          pfx: ['docs.'] },
  { marker: '__SECTION_DOCS_GALLERY__',  pfx: [] },
  { marker: '__SECTION_DOCS_VIDEOS__',   pfx: [] },
  { marker: '__SECTION_DIAGRAMS_GENERAL__', pfx: [] },
  { marker: '__SECTION_FAQ__',           pfx: ['faq.'] },
  { marker: '__SECTION_FAQ_BETAHUB__',   pfx: [] },
  { marker: '__SECTION_FAQ_NEW__',       pfx: [] },
];

function assignSection(key) {
  if (key.startsWith('__')) return null;
  let best = null, bestLen = -1;
  for (const sec of SECTIONS) {
    for (const p of sec.pfx) {
      if (key.startsWith(p) && p.length > bestLen) {
        best = sec.marker;
        bestLen = p.length;
      }
    }
  }
  return best;
}

function reorganize(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const obj = JSON.parse(raw);

  const sectionValues = {};
  const regularKeys = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('__')) sectionValues[k] = v;
    else regularKeys.push(k);
  }

  const sectionBuckets = {};
  const unassigned = [];
  SECTIONS.forEach(s => { sectionBuckets[s.marker] = []; });

  for (const key of regularKeys) {
    const sec = assignSection(key);
    if (sec) sectionBuckets[sec].push(key);
    else unassigned.push(key);
  }

  for (const marker of Object.keys(sectionBuckets)) sectionBuckets[marker].sort();
  unassigned.sort();

  const out = {};
  for (const sec of SECTIONS) {
    const { marker } = sec;
    const bucket = sectionBuckets[marker] || [];
    if (bucket.length === 0) continue; // skip empty sections entirely
    if (sectionValues[marker] !== undefined) out[marker] = sectionValues[marker];
    for (const k of bucket) out[k] = obj[k];
  }

  if (unassigned.length > 0) {
    out['__SECTION_MISC__'] = '--- MISC / UNASSIGNED ---';
    for (const k of unassigned) out[k] = obj[k];
  }

  const assigned = Object.values(sectionBuckets).reduce((a, b) => a + b.length, 0);
  console.log(`${path.basename(filePath)}: ${regularKeys.length} total, ${assigned} assigned, ${unassigned.length} unassigned`);
  if (unassigned.length > 0) console.log('  Unassigned:', unassigned.join(', '));

  fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
}

reorganize('frontend/Lang/en.json');
reorganize('frontend/Lang/fr.json');
console.log('Done.');
