// Help & Other — the rebuilt documentation hub (replaces the old ~4700-line #view-docs markup
// + docs-ui.ts). A professional, data-driven hub that owns #view-docs. Features:
//   • TWO parts — "User" (learn every feature) and "Dev" (how BMM works under the hood).
//   • Breadcrumb navigation + a route the LANGUAGE switch preserves (you stay on the same page).
//   • Article media: embed a .bmmreplay (rrweb), an image, or inline SVG to illustrate a point.
//   • Search with TWO modes — classic (substring) and semantic (synonym/keyword expansion),
//     Algolia-style, focusable app-wide with Ctrl/⌘+K.
//   • Deep links INTO the interactive tutorial at the right part+step, INTO any of the 44
//     Mermaid diagrams (reused as-is via window.openDiagram), and OUT to the full mkdocs site.
//   • Rebuilt FAQ; the Settings help buttons (PAT/GitHub, disk I/O) relink here.
//
// Content is co-located bilingual {en, fr} data — no Lang/*.json churn — picked via getLang().

import { getLang, t, getSynonyms } from '../core/i18n.js';
import { diagrams } from './interactive-docs.js';
import { renderDocMarkdown } from './md-lite.js';

// The published mkdocs documentation site (see BMM Docs/mkdocs.yml site_url).
const DOCS_SITE = 'https://freeproject089.github.io/BMM-Docs/';

type L = { en: string; fr: string };
const tr = (s: L): string => (getLang() === 'fr' ? s.fr : s.en);

// ── content model ────────────────────────────────────────────────────────────────
type Part = 'user' | 'dev';
interface Media { kind: 'replay' | 'image' | 'svg'; src?: string; svg?: string; caption?: L; }
interface TutorialLink { id: string; part?: string; step?: string; }
interface Article {
  id: string;
  title: L;
  summary: L;
  body: L;                 // HTML: <p>, <h4>, <ul><li>, <b>, <code>, <pre>
  media?: Media;           // an illustration rendered above the body
  tutorial?: TutorialLink; // deep-link into the interactive tutorial (right part+step)
  diagram?: string;        // diagram registry id → window.openDiagram
  docsPath?: string;       // appended to DOCS_SITE for "Read full docs"
  keywords?: string;       // extra search terms (any language, space separated)
}
interface Category { id: string; part: Part; icon: string; title: L; blurb: L; articles: Article[]; }

// small inline icon set (stroke, currentColor)
const ICON: Record<string, string> = {
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>',
  bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  diagram: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M14 6h4a2 2 0 0 1 2 2v3M10 18H6a2 2 0 0 1-2-2v-3"/>',
  life: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.9" y1="4.9" x2="9.2" y2="9.2"/><line x1="14.8" y1="14.8" x2="19.1" y2="19.1"/><line x1="14.8" y1="9.2" x2="19.1" y2="4.9"/><line x1="9.2" y1="14.8" x2="4.9" y2="19.1"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  puzzle: '<path d="M4 7h3a1 1 0 0 0 1-1V5a2 2 0 1 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 1 1 0 4h-1a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-1a2 2 0 1 0-4 0v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a2 2 0 1 0 0-4H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/>',
  server: '<rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><line x1="6" y1="6.5" x2="6.01" y2="6.5"/><line x1="6" y1="17.5" x2="6.01" y2="17.5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
};
const svg = (name: string, size = 20): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ''}</svg>`;

// A folder-tree illustration for the "how a mod must be structured" article — a stored mod
// carries the full path the game expects, from the game root down. Theme-aware via CSS vars.
const FOLDER = 'M2 4.2A1.6 1.6 0 0 1 3.6 2.6h4.2L9.6 4.2h6.8A1.6 1.6 0 0 1 18 5.8v8.6A1.6 1.6 0 0 1 16.4 16H3.6A1.6 1.6 0 0 1 2 14.4z';
function folderRow(x: number, y: number, label: string, opts: { root?: boolean; leaf?: boolean } = {}): string {
  const color = opts.leaf ? 'var(--bmm-accent, #3b82f6)' : (opts.root ? 'var(--bmm-text-primary, #e6edf3)' : 'var(--bmm-text-secondary, #a3adba)');
  const weight = opts.root || opts.leaf ? 700 : 600;
  return `<g transform="translate(${x},${y})">
    <path d="${FOLDER}" fill="${color}" opacity="${opts.leaf ? 1 : 0.9}"/>
    <text x="26" y="13" font-family="var(--bmm-font-mono, monospace)" font-size="14" font-weight="${weight}" fill="${color}">${label}</text>
  </g>`;
}
const MOD_TREE_SVG = `<svg viewBox="0 0 480 236" width="100%" role="img" aria-label="Nested folder structure of a stored mod">
  <style>.tw{stroke:var(--bmm-border,#2a3242);stroke-width:2;fill:none;}</style>
  <path class="tw" d="M12 34 V196 M12 76 H40 M52 76 V196 M52 118 H80 M92 118 V196 M92 160 H120"/>
  ${folderRow(4, 18, 'My Awesome Mod', { root: true })}
  ${folderRow(44, 60, 'Mods')}
  ${folderRow(84, 102, 'aircraft')}
  ${folderRow(124, 144, 'MyAircraft', { leaf: true })}
  <text x="150" y="182" font-family="var(--bmm-font-sans, system-ui)" font-size="12" fill="var(--bmm-accent, #3b82f6)">↑ your files land here</text>
  <text x="4" y="222" font-family="var(--bmm-font-sans, system-ui)" font-size="12.5" fill="var(--bmm-text-muted, #7c8698)">The mod = the top folder; inside it, the exact tree the game expects (Mods / aircraft / …).</text>
</svg>`;

// ── the documentation content ────────────────────────────────────────────────────
const CATEGORIES: Category[] = [
  // ═══════════════════════ USER PART ═══════════════════════
  {
    id: 'start', part: 'user', icon: 'rocket',
    title: { en: 'Getting started', fr: 'Prise en main' },
    blurb: { en: 'Install, first launch, and your first profile.', fr: 'Installation, premier lancement et premier profil.' },
    articles: [
      {
        id: 'what-is-bmm', tutorial: { id: 'basics' }, docsPath: '',
        title: { en: 'What is BetterModsManager?', fr: 'Qu’est-ce que BetterModsManager ?' },
        summary: { en: 'A fast, safe mod manager built around profiles, integrity checks and one-click sharing.', fr: 'Un gestionnaire de mods rapide et sûr, bâti autour des profils, des vérifications d’intégrité et du partage en un clic.' },
        keywords: 'bmm overview intro presentation aperçu',
        body: {
          en: '<p>BetterModsManager (BMM) organises your mods into <b>profiles</b> you can switch between instantly, verifies every file with cryptographic hashing, and lets you share a whole setup with one link.</p><h4>Why it’s different</h4><ul><li><b>Non-destructive</b> — activating a profile never touches your originals; BMM links or copies as needed.</li><li><b>Fast</b> — a native Rust core scans thousands of files in seconds.</li><li><b>Safe</b> — BLAKE3/SHA integrity catches a corrupted download before it reaches your game.</li></ul>',
          fr: '<p>BetterModsManager (BMM) organise vos mods en <b>profils</b> interchangeables en un instant, vérifie chaque fichier par hachage cryptographique et vous permet de partager une configuration complète avec un seul lien.</p><h4>Ce qui le distingue</h4><ul><li><b>Non destructif</b> — activer un profil ne touche jamais vos originaux ; BMM lie ou copie selon le besoin.</li><li><b>Rapide</b> — un cœur natif en Rust scanne des milliers de fichiers en quelques secondes.</li><li><b>Sûr</b> — l’intégrité BLAKE3/SHA détecte un téléchargement corrompu avant qu’il n’atteigne le jeu.</li></ul>',
        },
      },
      {
        id: 'first-profile', tutorial: { id: 'basics', part: 'profiles', step: 's1' }, diagram: 'profile-system',
        title: { en: 'Create your first profile', fr: 'Créer votre premier profil' },
        summary: { en: 'Point BMM at your game folder and set up an isolated mod profile.', fr: 'Indiquez à BMM votre dossier de jeu et créez un profil de mods isolé.' },
        keywords: 'profile setup game path folder create profil',
        // Authored in md-lite (the BCWEB-style directive markdown) — steps + a tip callout.
        body: {
          en: `A **profile** is an isolated set of mods. Keep a "clean" profile, a "multiplayer" profile and an experimental one — and swap between them in seconds.

:::steps
:::step[Open Profiles → New profile]
Head to the **Profiles** screen and choose **New profile**.
:::
:::step[Point it at your game folder]
Set the game / mods folder BMM should manage for this profile.
:::
:::step[Name & colour it]
Give it a name and a colour so it's easy to recognise at a glance.
:::
:::

:::tip[Switching is instant]
Switching profiles re-links only what changed, so it stays instant even with large collections.
:::`,
          fr: `Un **profil** est un ensemble isolé de mods. Gardez un profil « propre », un profil « multijoueur » et un profil expérimental — et basculez entre eux en quelques secondes.

:::steps
:::step[Ouvrez Profils → Nouveau profil]
Allez sur l'écran **Profils** et choisissez **Nouveau profil**.
:::
:::step[Indiquez le dossier du jeu]
Définissez le dossier de jeu / mods que BMM doit gérer pour ce profil.
:::
:::step[Nommez-le et donnez une couleur]
Donnez-lui un nom et une couleur pour le reconnaître d'un coup d'œil.
:::
:::

:::tip[Changement instantané]
Changer de profil ne re-lie que ce qui a changé : instantané même avec de grandes collections.
:::`,
        },
      },
      {
        id: 'scan', tutorial: { id: 'basics', part: 'scan', step: 's0' }, diagram: 'mod-sync',
        title: { en: 'Scan & sync your mods', fr: 'Scanner et synchroniser vos mods' },
        summary: { en: 'Let BMM index what you already have and keep it up to date.', fr: 'Laissez BMM indexer ce que vous avez déjà et le tenir à jour.' },
        keywords: 'scan sync index refresh detect scanner',
        body: {
          en: '<p>The first scan reads your mods folder and builds an index — names, versions, sizes and a content hash per file.</p><ul><li>Re-scans are <b>incremental</b>: only changed files are re-hashed.</li><li>Anything unrecognised is listed so you can name or map it.</li><li>The scan is read-only — it never modifies your files.</li></ul>',
          fr: '<p>Le premier scan lit votre dossier de mods et construit un index — noms, versions, tailles et un hachage de contenu par fichier.</p><ul><li>Les re-scans sont <b>incrémentaux</b> : seuls les fichiers modifiés sont re-hachés.</li><li>Tout élément non reconnu est listé pour le nommer ou le mapper.</li><li>Le scan est en lecture seule — il ne modifie jamais vos fichiers.</li></ul>',
        },
      },
      {
        id: 'staying-updated', diagram: 'update-system',
        title: { en: 'Staying up to date', fr: 'Rester à jour' },
        summary: { en: 'How BMM and your mods keep current — safely.', fr: 'Comment BMM et vos mods restent à jour — en toute sécurité.' },
        keywords: 'update updates version upgrade current mise à jour mettre',
        body: {
          en: '<p>BMM checks for new versions of itself and of any mod with a known source, and only fetches when something actually changed.</p><ul><li><b>Mods</b> — when an update is available BMM stages the new files and lets you review before applying; nothing is forced, and the rest of your profile is untouched.</li><li><b>The app</b> — its own updates are cryptographically <b>signed</b> and checked before installing, so a tampered build can’t sneak in.</li><li>Want it hands-off? The <b>Scheduler</b> can run update checks on a timer.</li></ul><p>Curious how the check works? See <b>Developer → Update system</b>.</p>',
          fr: '<p>BMM vérifie les nouvelles versions de lui-même et de tout mod ayant une source connue, et ne télécharge que si quelque chose a réellement changé.</p><ul><li><b>Les mods</b> — quand une mise à jour est dispo, BMM prépare les nouveaux fichiers et vous laisse vérifier avant d’appliquer ; rien n’est forcé, et le reste du profil n’est pas touché.</li><li><b>L’app</b> — ses propres mises à jour sont <b>signées</b> cryptographiquement et vérifiées avant installation, donc une version altérée ne peut pas se glisser.</li><li>Vous voulez que ce soit automatique ? Le <b>Planificateur</b> peut lancer les vérifs à intervalle régulier.</li></ul><p>Curieux du fonctionnement ? Voir <b>Développeur → Système de mise à jour</b>.</p>',
        },
      },
    ],
  },
  {
    id: 'mods', part: 'user', icon: 'layers',
    title: { en: 'Managing mods', fr: 'Gérer les mods' },
    blurb: { en: 'Structure, activate, resolve conflicts, map and bundle.', fr: 'Structurer, activer, résoudre les conflits, mapper et regrouper.' },
    articles: [
      {
        id: 'mod-structure', tutorial: { id: 'basics', part: 'map' }, diagram: 'mod-mapper',
        title: { en: 'How a mod must be structured', fr: 'Comment un mod doit être structuré' },
        summary: { en: 'Give each mod the full folder tree your game expects — and use the mapper when it doesn’t.', fr: 'Donnez à chaque mod l’arborescence complète attendue par le jeu — et utilisez le mappeur sinon.' },
        keywords: 'structure ovgme folder tree config mapper arborescence dossier configuration store',
        media: { kind: 'svg', svg: MOD_TREE_SVG, caption: { en: 'A stored mod carries the full path the game expects, from the game root down.', fr: 'Un mod stocké porte le chemin complet attendu par le jeu, depuis la racine du jeu.' } },
        body: {
          en: '<p>BMM stores your mods and applies them to the game non-destructively (the same idea as OvGME). For that to work, each mod must contain the <b>full folder tree</b> as it should appear in the game — not just the loose files. The diagram above shows the shape: the top folder is the mod, and everything under it is the exact path a file must land in.</p><h4>Set up a profile per target</h4><p>The cleanest setup is one profile per destination:</p><ul><li><b>Install folder</b> profile → <code>Program Files\\Eagle Dynamics\\DCS World</code></li><li><b>Saved Games</b> profile → <code>C:\\Users\\&lt;you&gt;\\Saved Games\\DCS</code></li></ul><p>The <b>Configuration → mods folder</b> is the storage folder for that profile’s mods — one per profile.</p><h4>When a download has the wrong shape</h4><p>Many archives ship the files loose, or zipped from the wrong folder, so those parent folders (<code>Mods/aircraft/…</code>) are missing. Don’t reshape it by hand in Explorer — open the <b>mod mapper</b>, drag the files to where they belong, and save that mapping. It’s stored with the mod, so re-installs and future versions with the same layout apply in one click.</p>',
          fr: '<p>BMM stocke vos mods et les applique au jeu de façon non destructive (le même principe qu’OvGME). Pour cela, chaque mod doit contenir l’<b>arborescence complète</b> telle qu’elle doit apparaître dans le jeu — pas seulement les fichiers en vrac. Le diagramme ci-dessus montre la forme : le dossier du haut est le mod, et tout ce qui est en dessous est le chemin exact où un fichier doit atterrir.</p><h4>Créer un profil par cible</h4><p>Le plus propre est un profil par destination :</p><ul><li>profil <b>dossier d’install</b> → <code>Program Files\\Eagle Dynamics\\DCS World</code></li><li>profil <b>Saved Games</b> → <code>C:\\Users\\&lt;toi&gt;\\Saved Games\\DCS</code></li></ul><p>La ligne <b>Configuration → dossier des mods</b> est le dossier de stockage des mods de ce profil — un par profil.</p><h4>Quand un téléchargement a la mauvaise forme</h4><p>Beaucoup d’archives livrent les fichiers en vrac, ou zippés depuis le mauvais dossier, si bien que les dossiers parents (<code>Mods/aircraft/…</code>) manquent. Ne réorganisez pas à la main dans l’Explorateur — ouvrez le <b>mappeur de mods</b>, glissez les fichiers à leur place, et enregistrez ce mapping. Il est stocké avec le mod : les réinstallations et les futures versions au même agencement s’appliquent en un clic.</p>',
        },
      },
      {
        id: 'activation', tutorial: { id: 'basics', part: 'activate' }, diagram: 'mod-activation',
        title: { en: 'Activate & deactivate mods', fr: 'Activer et désactiver des mods' },
        summary: { en: 'Toggle mods on or off per profile without moving files by hand.', fr: 'Activez ou désactivez des mods par profil sans déplacer les fichiers à la main.' },
        keywords: 'activate enable disable toggle deploy activer désactiver',
        body: {
          en: '<p>Toggling a mod stages it into the active profile. BMM tracks exactly which files belong to which mod, so deactivating removes only those — cleanly, every time.</p><ul><li>Batch-toggle a whole category at once.</li><li>Activation is transactional: an interrupted deploy rolls back instead of leaving a half-state.</li></ul>',
          fr: '<p>Activer un mod le met en place dans le profil actif. BMM sait exactement quels fichiers appartiennent à quel mod : la désactivation ne retire que ceux-là — proprement.</p><ul><li>Activez/désactivez toute une catégorie d’un coup.</li><li>L’activation est transactionnelle : un déploiement interrompu est annulé au lieu de laisser un état incomplet.</li></ul>',
        },
      },
      {
        id: 'conflicts', tutorial: { id: 'basics', part: 'conflicts' }, diagram: 'conflict-management',
        title: { en: 'Resolve conflicts', fr: 'Résoudre les conflits' },
        summary: { en: 'See exactly which mods fight over the same file and choose a winner.', fr: 'Voyez quels mods se disputent le même fichier et choisissez un gagnant.' },
        keywords: 'conflict overwrite priority order resolve conflit priorité',
        body: {
          en: '<p>When two mods provide the same file, BMM surfaces the conflict with a clear side-by-side view instead of silently letting one win.</p><ul><li>Pick a winner per file, or set a priority order.</li><li>Choices are remembered per profile.</li></ul>',
          fr: '<p>Quand deux mods fournissent le même fichier, BMM met le conflit en évidence avec une vue comparative claire, au lieu de laisser l’un gagner en silence.</p><ul><li>Choisissez un gagnant par fichier, ou un ordre de priorité.</li><li>Les choix sont mémorisés par profil.</li></ul>',
        },
      },
      {
        id: 'modpacks', tutorial: { id: 'basics', part: 'modpacks' }, diagram: 'modpack-flow',
        title: { en: 'Modpacks', fr: 'Modpacks' },
        summary: { en: 'Bundle a curated set of mods into one shareable pack.', fr: 'Regroupez un ensemble de mods sélectionnés en un pack partageable.' },
        keywords: 'modpack bundle collection pack export import',
        body: {
          en: '<p>A modpack captures a whole set of mods (and their order/choices) into a single artefact you can export, re-import, or share with friends.</p>',
          fr: '<p>Un modpack capture tout un ensemble de mods (et leur ordre/choix) dans un seul artefact que vous pouvez exporter, réimporter ou partager.</p>',
        },
      },
    ],
  },
  {
    id: 'profiles', part: 'user', icon: 'save',
    title: { en: 'Profiles & backups', fr: 'Profils et sauvegardes' },
    blurb: { en: 'Isolated setups, shared storage, backups and launch packs.', fr: 'Configurations isolées, stockage partagé, sauvegardes et launch packs.' },
    articles: [
      {
        id: 'shared-storage', diagram: 'profile-customization',
        title: { en: 'Shared storage', fr: 'Stockage partagé' },
        summary: { en: 'Keep one copy of a mod on disk, used by many profiles.', fr: 'Gardez une seule copie d’un mod sur le disque, utilisée par plusieurs profils.' },
        keywords: 'shared storage dedupe link space disk stockage partagé espace',
        body: {
          en: '<p>Instead of duplicating a mod in every profile, BMM keeps one copy and links it where needed — saving disk space without giving up isolation.</p>',
          fr: '<p>Au lieu de dupliquer un mod dans chaque profil, BMM garde une copie unique et la lie là où c’est nécessaire — pour économiser l’espace disque sans perdre l’isolation.</p>',
        },
      },
      {
        id: 'backups', diagram: 'backup-system',
        title: { en: 'Backups', fr: 'Sauvegardes' },
        summary: { en: 'Snapshot a profile so you can always roll back.', fr: 'Prenez un instantané d’un profil pour pouvoir toujours revenir en arrière.' },
        keywords: 'backup snapshot restore rollback safety sauvegarde restaurer',
        body: {
          en: '<p>Take a snapshot before a big change. If something goes wrong, restore the profile exactly how it was — mods, order and choices included.</p>',
          fr: '<p>Prenez un instantané avant un grand changement. En cas de problème, restaurez le profil exactement comme il était — mods, ordre et choix compris.</p>',
        },
      },
      {
        id: 'launch-packs', diagram: 'launch-packs',
        title: { en: 'Launch packs', fr: 'Launch packs' },
        summary: { en: 'Bundle a ready-to-run setup — mods, order and launch — into one thing.', fr: 'Regroupez une configuration prête à lancer — mods, ordre et lancement — en une seule chose.' },
        keywords: 'launch pack bundle run start launcher lançable',
        body: {
          en: '<p>A <b>launch pack</b> captures a whole ready-to-run setup — the mods, their order, and the action that launches the game — as a single unit. It’s handy when you want to jump straight in, or hand a friend a configuration they can run without reassembling it by hand.</p><p>Curious how it’s bundled? See <b>Developer → Launch packs</b>.</p>',
          fr: '<p>Un <b>launch pack</b> capture toute une configuration prête à lancer — les mods, leur ordre, et l’action qui lance le jeu — en une seule unité. Pratique pour démarrer directement, ou pour donner à un ami une configuration qu’il peut lancer sans la réassembler à la main.</p><p>Curieux de l’assemblage ? Voir <b>Développeur → Launch packs</b>.</p>',
        },
      },
    ],
  },
  {
    id: 'share', part: 'user', icon: 'share',
    title: { en: 'Sharing & hosting', fr: 'Partage et hébergement' },
    blurb: { en: 'Server repos, catalogs and the BetterCommunity hub.', fr: 'Dépôts serveur, catalogues et le hub BetterCommunity.' },
    articles: [
      {
        id: 'server-repo', diagram: 'server-mode', docsPath: '',
        title: { en: 'Server repositories', fr: 'Dépôts serveur' },
        summary: { en: 'Publish a profile so a whole group installs and stays in sync in one click.', fr: 'Publiez un profil pour qu’un groupe entier l’installe et reste synchronisé en un clic.' },
        keywords: 'server repo host publish group community sync dépôt hébergement squadron',
        body: {
          en: '<p>A server repo turns a profile into a <b>hosted source of truth</b>. You publish once; everyone who subscribes gets the exact same mods, versions and load order — and stays converged as you update it. It\'s the tool for a squadron, a community, or just keeping your own machines identical.</p>'
            + '<h4>Publishing one</h4><ul><li>Open <b>Server Repo</b> and point it at the profile you want to share.</li><li>BMM builds a <b>manifest</b> — the list of files with their hashes — and gives you a link to hand out.</li><li>Update it any time; subscribers see the change on their next sync.</li></ul>'
            + '<h4>How members stay in sync</h4><p>A subscriber\'s BMM never blindly re-downloads. It fetches the manifest, compares it to what it already has, and pulls <b>only the difference</b> — then verifies every transferred file by hash before deploying. That\'s why a small change to a 10&nbsp;GB collection costs a few MB and a few seconds.</p>'
            + '<h4>Access & authenticity</h4><ul><li><b>Public</b> — anyone with the link.</li><li><b>Email-gated</b> — only whitelisted accounts.</li><li><b>Password-gated</b> — only password holders.</li></ul><p>Every repo carries a stable <b>fingerprint</b> (<code>BCR-XXXX-XXXX</code>) so members can confirm they\'re subscribed to the genuine source, not an impostor. Hosting can be your own machine or dedicated hosting via BetterCommunity.</p>',
          fr: '<p>Un dépôt serveur transforme un profil en <b>source de vérité hébergée</b>. Vous publiez une fois ; tous les abonnés obtiennent exactement les mêmes mods, versions et ordre de chargement — et restent alignés à mesure que vous mettez à jour. C\'est l\'outil pour une escadrille, une communauté, ou simplement garder vos propres machines identiques.</p>'
            + '<h4>En publier un</h4><ul><li>Ouvrez <b>Dépôt Serveur</b> et pointez-le sur le profil à partager.</li><li>BMM construit un <b>manifeste</b> — la liste des fichiers avec leurs hachages — et vous donne un lien à distribuer.</li><li>Mettez-le à jour quand vous voulez ; les abonnés voient le changement à leur prochaine synchro.</li></ul>'
            + '<h4>Comment les membres restent synchronisés</h4><p>Le BMM d\'un abonné ne re-télécharge jamais à l\'aveugle. Il récupère le manifeste, le compare à ce qu\'il possède déjà, et ne tire que la <b>différence</b> — puis vérifie chaque fichier transféré par hachage avant de déployer. D\'où le coût de quelques Mo et quelques secondes pour un petit changement dans une collection de 10&nbsp;Go.</p>'
            + '<h4>Accès & authenticité</h4><ul><li><b>Public</b> — quiconque a le lien.</li><li><b>Par e-mail</b> — seulement les comptes en liste blanche.</li><li><b>Par mot de passe</b> — seulement les détenteurs du mot de passe.</li></ul><p>Chaque dépôt porte une <b>empreinte</b> stable (<code>BCR-XXXX-XXXX</code>) pour que les membres confirment qu\'ils sont abonnés à la vraie source, pas un imposteur. L\'hébergement peut être votre propre machine ou un hébergement dédié via BetterCommunity.</p>',
        },
      },
      {
        id: 'catalogs', diagram: 'app-catalog',
        title: { en: 'Catalogs & BetterCommunity', fr: 'Catalogues et BetterCommunity' },
        summary: { en: 'Browse and install mods, apps and themes from community catalogs.', fr: 'Parcourez et installez mods, applis et thèmes depuis les catalogues.' },
        keywords: 'catalog community bettercommunity browse install apps themes catalogue',
        body: {
          en: '<p>Catalogs are curated feeds of mods, apps and themes. Install straight from them, and publish your own through the BetterCommunity hub.</p>',
          fr: '<p>Les catalogues sont des flux sélectionnés de mods, applis et thèmes. Installez directement depuis eux, et publiez les vôtres via le hub BetterCommunity.</p>',
        },
      },
    ],
  },
  {
    id: 'power', part: 'user', icon: 'bolt',
    title: { en: 'Power features', fr: 'Fonctions avancées' },
    blurb: { en: 'Themes, plugins & API, custom pages, integrations, scheduler.', fr: 'Thèmes, plugins & API, pages personnalisées, intégrations, planificateur.' },
    articles: [
      {
        id: 'themes', diagram: 'theme-system',
        title: { en: 'Themes & appearance', fr: 'Thèmes et apparence' },
        summary: { en: 'Recolour BMM — pick a built-in theme or design and share your own.', fr: 'Recolorez BMM — choisissez un thème intégré ou créez et partagez le vôtre.' },
        keywords: 'theme appearance color dark light editor custom thème apparence couleur',
        body: {
          en: '<p>BMM ships <b>seven themes</b> (light and dark) — switch in <b>Settings → Appearance</b>. If none fits, the built-in <b>theme editor</b> lets you recolour every part of the UI live and save it as your own.</p><ul><li>Start from any built-in theme and tweak colours, accents and radii.</li><li>Save, name, and <b>export/share</b> your theme — or import one someone sent you.</li><li>Themes are just data, so they never affect your mods or profiles.</li></ul><p>Curious how it works under the hood? See <b>Developer → Theme system</b>.</p>',
          fr: '<p>BMM livre <b>sept thèmes</b> (clairs et sombres) — changez dans <b>Réglages → Apparence</b>. Si aucun ne convient, l\'<b>éditeur de thèmes</b> intégré vous laisse recolorer chaque partie de l\'UI en direct et l\'enregistrer comme le vôtre.</p><ul><li>Partez d\'un thème intégré et ajustez couleurs, accents et rayons.</li><li>Enregistrez, nommez et <b>exportez/partagez</b> votre thème — ou importez celui qu\'on vous a envoyé.</li><li>Les thèmes ne sont que des données : ils n\'affectent jamais vos mods ni vos profils.</li></ul><p>Curieux du fonctionnement ? Voir <b>Développeur → Système de thèmes</b>.</p>',
        },
      },
      {
        id: 'plugins', diagram: 'mcp-server', docsPath: '',
        title: { en: 'Plugins & the API', fr: 'Plugins et API' },
        summary: { en: 'Add features BMM doesn’t ship — and automate it from scripts or an AI assistant.', fr: 'Ajoutez des fonctions que BMM ne fournit pas — et automatisez-le depuis des scripts ou une IA.' },
        keywords: 'plugin api mcp automation script install extend plugins étendre',
        body: {
          en: '<p>Not everything is built in — and it doesn’t have to be. The <b>Plugins &amp; API</b> screen lets you install plugins that add new features, and add plugin sources so you can find more.</p><ul><li><b>Install a plugin</b> from a catalog or a file; enable or disable it any time.</li><li>Power users: BMM also exposes a <b>local API</b> and an <b>MCP server</b>, so scripts — or an AI assistant — can drive it (scan, activate, build packs…).</li></ul><p>Curious how that works? See <b>Developer → MCP server &amp; local API</b>, or the full endpoint reference in the online docs.</p>',
          fr: '<p>Tout n’est pas intégré — et ça n’a pas à l’être. L’écran <b>Plugins &amp; API</b> vous laisse installer des plugins qui ajoutent des fonctions, et ajouter des sources de plugins pour en trouver d’autres.</p><ul><li><b>Installez un plugin</b> depuis un catalogue ou un fichier ; activez-le ou désactivez-le quand vous voulez.</li><li>Utilisateurs avancés : BMM expose aussi une <b>API locale</b> et un <b>serveur MCP</b>, pour que des scripts — ou une IA — le pilotent (scanner, activer, construire des packs…).</li></ul><p>Curieux du fonctionnement ? Voir <b>Développeur → Serveur MCP et API locale</b>, ou la référence complète des endpoints dans la doc en ligne.</p>',
        },
      },
      {
        id: 'custom-pages', diagram: 'premium-interactions',
        title: { en: 'Custom pages', fr: 'Pages personnalisées' },
        summary: { en: 'Add your own sandboxed pages to the navbar.', fr: 'Ajoutez vos propres pages sandbox à la barre de navigation.' },
        keywords: 'custom pages navbar bmmpage sandbox pages personnalisées',
        body: {
          en: '<p>Build a sandboxed <code>bmmpage://</code> page — a mini app inside BMM — and pin it to the navbar. Each page only gets the permissions you grant it, so it can’t reach anything you didn’t allow. Great for a personal dashboard, a launcher, or a tool the community shares.</p><p>Curious how the sandbox works? See <b>Developer → Extending BMM</b>.</p>',
          fr: '<p>Créez une page <code>bmmpage://</code> en sandbox — une mini-application dans BMM — et épinglez-la à la barre de navigation. Chaque page n’obtient que les permissions que vous accordez, elle ne peut donc rien atteindre que vous n’avez pas autorisé. Idéal pour un tableau de bord perso, un lanceur, ou un outil partagé par la communauté.</p><p>Curieux du fonctionnement du sandbox ? Voir <b>Développeur → Étendre BMM</b>.</p>',
        },
      },
      {
        id: 'integrations', diagram: 'discord-rpc',
        title: { en: 'Discord & integrations', fr: 'Discord et intégrations' },
        summary: { en: 'Show what you’re doing on Discord, and other optional hooks.', fr: 'Affichez votre activité sur Discord, et autres intégrations optionnelles.' },
        keywords: 'discord rpc rich presence integration integrations intégration',
        body: {
          en: '<p>BMM can display your current activity as <b>Discord rich presence</b> — updating as you switch profiles or work. It’s optional and off by default; turn it on in <b>Settings</b>. Only the activity text you’d expect is ever sent.</p>',
          fr: '<p>BMM peut afficher votre activité en cours en <b>rich presence Discord</b> — mise à jour quand vous changez de profil ou travaillez. C’est optionnel et désactivé par défaut ; activez-le dans les <b>Réglages</b>. Seul le texte d’activité attendu est envoyé.</p>',
        },
      },
      {
        id: 'scheduler', diagram: 'scheduler',
        title: { en: 'Scheduler', fr: 'Planificateur' },
        summary: { en: 'Run actions on a schedule — updates, backups, syncs.', fr: 'Exécutez des actions planifiées — mises à jour, sauvegardes, synchros.' },
        keywords: 'scheduler cron automate task timer planificateur automatiser',
        body: {
          en: '<p>Schedule recurring actions (update checks, backups, repo syncs) so BMM keeps your setup fresh without you lifting a finger.</p>',
          fr: '<p>Planifiez des actions récurrentes (vérifs de mise à jour, sauvegardes, synchros de dépôts) pour que BMM garde votre configuration à jour sans effort.</p>',
        },
      },
      {
        id: 'benchmarks', diagram: 'blake3-hashing',
        title: { en: 'Benchmarks & performance', fr: 'Benchmarks et performances' },
        summary: { en: 'Measure how fast BMM scans, hashes and deploys on your machine.', fr: 'Mesurez la vitesse de scan, de hachage et de déploiement sur votre machine.' },
        keywords: 'benchmark performance speed hash blake3 measure performances vitesse',
        body: {
          en: '<p>The built-in benchmark suite measures scanning, hashing and copy throughput so you can see exactly how BMM performs on your hardware.</p>',
          fr: '<p>La suite de benchmarks intégrée mesure le débit de scan, de hachage et de copie pour voir exactement comment BMM se comporte sur votre matériel.</p>',
        },
      },
    ],
  },
  {
    id: 'faq', part: 'user', icon: 'life',
    title: { en: 'FAQ & troubleshooting', fr: 'FAQ et dépannage' },
    blurb: { en: 'Common questions and quick fixes.', fr: 'Questions fréquentes et solutions rapides.' },
    articles: [
      {
        id: 'faq-pat', docsPath: '',
        title: { en: 'GitHub rate limits & Personal Access Token (PAT)', fr: 'Limites GitHub et jeton d’accès personnel (PAT)' },
        summary: { en: 'Why some GitHub actions hit a limit, and how a PAT raises it.', fr: 'Pourquoi certaines actions GitHub atteignent une limite, et comment un PAT l’augmente.' },
        keywords: 'pat github token rate limit api 403 jeton limite',
        body: {
          en: '<p>Unauthenticated GitHub requests are capped at ~60/hour. Adding a <b>Personal Access Token (PAT)</b> raises this to 5 000/hour.</p><h4>Create one</h4><ul><li>On GitHub → <b>Settings → Developer settings → Personal access tokens</b>.</li><li>A <b>read-only</b>, public-scope token is enough — BMM only reads public releases/catalogs.</li><li>Paste it in BMM <b>Settings</b>; it’s stored locally and never shared.</li></ul>',
          fr: '<p>Les requêtes GitHub non authentifiées sont limitées à ~60/heure. Ajouter un <b>jeton d’accès personnel (PAT)</b> monte cette limite à 5 000/heure.</p><h4>En créer un</h4><ul><li>Sur GitHub → <b>Settings → Developer settings → Personal access tokens</b>.</li><li>Un jeton <b>en lecture seule</b>, portée publique, suffit — BMM ne lit que des releases/catalogues publics.</li><li>Collez-le dans les <b>Réglages</b> de BMM ; il est stocké localement et jamais partagé.</li></ul>',
        },
      },
      {
        id: 'faq-disk-full', diagram: 'faq-disk-full',
        title: { en: 'My disk is filling up', fr: 'Mon disque se remplit' },
        summary: { en: 'Where BMM stores data and how to reclaim space safely.', fr: 'Où BMM stocke ses données et comment récupérer de l’espace en sécurité.' },
        keywords: 'disk full space cache clean storage io disque espace cache',
        body: {
          en: '<p>Enable <b>shared storage</b> to keep one copy of each mod, and clear old caches from Settings. Backups also accumulate — prune the ones you no longer need.</p><p>BMM also throttles heavy disk I/O so a big deploy stays responsive (see the disk-I/O limiter diagram).</p>',
          fr: '<p>Activez le <b>stockage partagé</b> pour garder une seule copie de chaque mod, et videz les anciens caches depuis les Réglages. Les sauvegardes s’accumulent aussi — supprimez celles inutiles.</p><p>BMM limite aussi les E/S disque intensives pour qu’un gros déploiement reste réactif (voir le diagramme du limiteur d’E/S).</p>',
        },
      },
      {
        id: 'faq-deleted-mod', diagram: 'faq-deleted-mod',
        title: { en: 'I deleted a mod by mistake', fr: 'J’ai supprimé un mod par erreur' },
        summary: { en: 'How to recover, and why profiles make this rare.', fr: 'Comment récupérer, et pourquoi les profils rendent cela rare.' },
        keywords: 'deleted recover restore mistake backup supprimé récupérer',
        body: {
          en: '<p>If you have a backup, or the mod is still in shared storage or a server repo, restore it in a click. Because activation is non-destructive, deleting from a profile rarely removes the only copy.</p>',
          fr: '<p>Si vous avez une sauvegarde, ou si le mod est encore dans le stockage partagé ou un dépôt serveur, restaurez-le en un clic. Comme l’activation est non destructive, supprimer d’un profil retire rarement la seule copie.</p>',
        },
      },
      {
        id: 'faq-crash', diagram: 'crash-reporting',
        title: { en: 'Reporting a crash', fr: 'Signaler un plantage' },
        summary: { en: 'What BMM collects, where reports live, and how to share one.', fr: 'Ce que BMM collecte, où sont les rapports et comment en partager un.' },
        keywords: 'crash report bug log support diagnostics plantage rapport',
        body: {
          en: '<p>On a crash BMM writes a self-contained report (logs, system info, a session recording) you can review and share. A clean exit writes a lightweight session log too.</p>',
          fr: '<p>En cas de plantage, BMM écrit un rapport autonome (journaux, infos système, enregistrement de session) que vous pouvez relire et partager. Une fermeture propre écrit aussi un journal de session léger.</p>',
        },
      },
    ],
  },

  // ═══════════════════════ DEV PART ═══════════════════════
  {
    id: 'arch', part: 'dev', icon: 'cpu',
    title: { en: 'Architecture', fr: 'Architecture' },
    blurb: { en: 'How BMM is built — the stack, threads and layout.', fr: 'Comment BMM est bâti — stack, threads et découpage.' },
    articles: [
      devArticle('code-stack', { en: 'The tech stack', fr: 'La stack technique' }, { en: 'Tauri shell, a native Rust core and a TypeScript UI — and why.', fr: 'Coquille Tauri, cœur natif Rust et UI TypeScript — et pourquoi.' }, 'stack rust tauri typescript', {
        en: '<p>BMM is a <b>Tauri</b> app: the UI is TypeScript running in the OS\'s native webview, and every real operation — scanning, hashing, copying, networking — is a compiled <b>Rust</b> core. The UI never touches the disk directly; it calls the core over a single typed <code>invoke()</code> channel, and all state lives in the core. That split is why BMM launches fast and stays lean where a JavaScript-everywhere app would be heavy.</p>',
        fr: '<p>BMM est une app <b>Tauri</b> : l\'interface est en TypeScript dans la webview native de l\'OS, et chaque opération réelle — scan, hachage, copie, réseau — est un cœur <b>Rust</b> compilé. L\'interface ne touche jamais le disque directement ; elle appelle le cœur via un unique canal typé <code>invoke()</code>, et tout l\'état vit dans le cœur. Ce découpage explique pourquoi BMM démarre vite et reste léger là où une app tout-JavaScript serait lourde.</p>',
      }),
      devArticle('lightweight-architecture', { en: 'Lightweight architecture', fr: 'Architecture légère' }, { en: 'Why BMM stays small and fast where an Electron app would be heavy.', fr: 'Pourquoi BMM reste léger et rapide là où un Electron serait lourd.' }, 'lightweight memory ram léger', {
        en: '<p>An Electron app ships a whole copy of Chromium (~150&nbsp;MB) and runs its logic in JavaScript. BMM reuses the OS webview and does the heavy lifting in native Rust, so it idles at a few dozen MB and runs file operations at native speed. Because state lives in the core, the UI can be reloaded at any time without losing your session.</p>',
        fr: '<p>Une app Electron embarque une copie complète de Chromium (~150&nbsp;Mo) et exécute sa logique en JavaScript. BMM réutilise la webview de l\'OS et fait le gros du travail en Rust natif : il tourne au repos à quelques dizaines de Mo et exécute les opérations fichier à vitesse native. Comme l\'état vit dans le cœur, l\'interface peut être rechargée à tout moment sans perdre votre session.</p>',
      }),
      devArticle('engine-threads', { en: 'Engine & threads', fr: 'Moteur et threads' }, { en: 'How work is split across threads to keep the UI responsive.', fr: 'Comment le travail est réparti sur les threads pour garder l’UI réactive.' }, 'threads async engine concurrency', {
        en: '<p>Long jobs never run on the UI thread. A scan or a deploy is handed to a <b>worker</b> that streams progress back, so the interface stays live and cancellable. The very heaviest file operations can even run in a short-lived <b>subprocess</b> whose memory is reclaimed the instant it exits — so a spike or a rare crash there can\'t take the whole app down.</p>',
        fr: '<p>Les longues tâches ne tournent jamais sur le thread de l\'interface. Un scan ou un déploiement est confié à un <b>worker</b> qui renvoie la progression en flux, pour que l\'interface reste vivante et annulable. Les opérations les plus lourdes peuvent même tourner dans un <b>sous-processus</b> éphémère dont la mémoire est récupérée dès qu\'il se termine — un pic ou un rare plantage là ne peut pas emporter toute l\'app.</p>',
      }),
      devArticle('mod-architecture', { en: 'Mod data model', fr: 'Modèle de données des mods' }, { en: 'How a mod, its files and its metadata are represented.', fr: 'Comment un mod, ses fichiers et ses métadonnées sont représentés.' }, 'model data mod files', {
        en: '<p>A mod is modelled as a set of files — each with a destination path, size, modification time and content hash — plus metadata (name, version, author, source). Everything else in BMM (conflict detection, integrity, sync) reads that model rather than re-walking the disk, which is what makes those operations cheap.</p>',
        fr: '<p>Un mod est modélisé comme un ensemble de fichiers — chacun avec un chemin de destination, une taille, une date de modification et un hachage de contenu — plus des métadonnées (nom, version, auteur, source). Tout le reste dans BMM (détection de conflits, intégrité, synchro) lit ce modèle au lieu de reparcourir le disque, ce qui rend ces opérations peu coûteuses.</p>',
      }),
    ],
  },
  {
    id: 'engine', part: 'dev', icon: 'bolt',
    title: { en: 'Core engine', fr: 'Moteur central' },
    blurb: { en: 'Hashing, integrity, caching and I/O throttling.', fr: 'Hachage, intégrité, cache et limitation d’E/S.' },
    articles: [
      devArticle('blake3-hashing', { en: 'BLAKE3 hashing', fr: 'Hachage BLAKE3' }, { en: 'The fast content hash behind change detection and integrity.', fr: 'Le hachage de contenu rapide derrière la détection de changement et l’intégrité.' }, 'blake3 hash sha checksum', {
        en: '<p>Every file gets a <b>BLAKE3</b> content fingerprint — a short value that changes completely if a single byte does. BLAKE3 is cryptographically strong and parallelises across CPU cores, so hashing a large mod is limited by your disk, not the algorithm. That one fingerprint powers change detection, integrity checks and server-repo sync alike.</p>',
        fr: '<p>Chaque fichier reçoit une empreinte de contenu <b>BLAKE3</b> — une valeur courte qui change complètement si un seul octet change. BLAKE3 est cryptographiquement solide et se parallélise sur les cœurs du CPU : hacher un gros mod est limité par votre disque, pas par l\'algorithme. Cette empreinte unique alimente la détection de changement, les contrôles d\'intégrité et la synchro des dépôts.</p>',
      }),
      devArticle('integrity-engine', { en: 'Integrity engine', fr: 'Moteur d’intégrité' }, { en: 'How every file is verified before it reaches your game.', fr: 'Comment chaque fichier est vérifié avant d’atteindre le jeu.' }, 'integrity verify corrupt intégrité', {
        en: '<p>The fingerprint is checked at every boundary: after a download (does it match what the source promised?), before a deploy (is the Library copy still intact?), and during repo sync. A file that doesn\'t match is blocked before it can reach your game — catching corruption that no filename or size check ever would.</p>',
        fr: '<p>L\'empreinte est vérifiée à chaque frontière : après un téléchargement (correspond-il à ce que la source a promis ?), avant un déploiement (la copie de la Bibliothèque est-elle intacte ?), et pendant la synchro d\'un dépôt. Un fichier qui ne correspond pas est bloqué avant d\'atteindre le jeu — détectant une corruption qu\'aucun contrôle de nom ou de taille ne verrait.</p>',
      }),
      devArticle('mtime-cache', { en: 'mtime cache', fr: 'Cache mtime' }, { en: 'Skip re-hashing unchanged files using modification times.', fr: 'Éviter de re-hacher les fichiers inchangés via les dates de modification.' }, 'mtime cache incremental', {
        en: '<p>Re-hashing gigabytes on every launch would be pointless — almost nothing changes between runs. BMM uses the filesystem\'s modification time and size as a cheap "did this change?" filter, and only re-hashes files that fail it. A warm re-scan therefore reads metadata only and spends real I/O solely on what actually moved.</p>',
        fr: '<p>Re-hacher des gigaoctets à chaque lancement serait inutile — presque rien ne change entre deux sessions. BMM utilise la date de modification et la taille du système de fichiers comme filtre bon marché « est-ce que ça a changé ? », et ne re-hache que les fichiers qui échouent. Un re-scan à chaud ne lit donc que les métadonnées et ne dépense de vraies E/S que sur ce qui a bougé.</p>',
      }),
      devArticle('disk-io-limiter', { en: 'Disk I/O limiter', fr: 'Limiteur d’E/S disque' }, { en: 'Keep the app responsive during big copies.', fr: 'Garder l’app réactive pendant les grosses copies.' }, 'io disk throttle limiter', {
        en: '<p>Copying at full tilt can peg a drive and make the whole system stutter — BMM included. Copies run through a <b>per-disk rate limiter</b> you set: under the cap they run flat out, near it BMM paces itself so the drive and the app stay responsive. "Smart I/O" also picks the cheapest correct operation — a hard-link when possible (instant, zero bytes copied), a real copy only when it must.</p>',
        fr: '<p>Copier à fond peut monopoliser un disque et faire saccader tout le système — BMM compris. Les copies passent par un <b>limiteur de débit par disque</b> que vous réglez : sous le plafond elles vont à fond, à l\'approche BMM se régule pour que le disque et l\'app restent réactifs. Le « Smart I/O » choisit aussi l\'opération correcte la moins coûteuse — un lien physique si possible (instantané, zéro octet copié), une vraie copie seulement quand il le faut.</p>',
      }),
      devArticle('semantic-search', { en: 'Semantic search', fr: 'Recherche sémantique' }, { en: 'How the fuzzy/synonym search matches what you mean.', fr: 'Comment la recherche floue/synonymes comprend votre intention.' }, 'search semantic fuzzy synonym', {
        en: '<p>Beyond exact matches, semantic mode expands your query with synonyms and tolerates typos, so "delete" also finds "remove" and "uninstall". Results are scored by how many of the expanded terms they contain, so the closest matches rank first — the same engine powers the docs search and the Ctrl+K command palette.</p>',
        fr: '<p>Au-delà des correspondances exactes, le mode sémantique étend votre requête avec des synonymes et tolère les fautes de frappe : « supprimer » trouve aussi « retirer » et « désinstaller ». Les résultats sont classés selon le nombre de termes étendus qu\'ils contiennent, donc les plus proches remontent en premier — le même moteur alimente la recherche de la doc et la palette Ctrl+K.</p>',
      }),
    ],
  },
  {
    id: 'sync', part: 'dev', icon: 'db',
    title: { en: 'Data & sync', fr: 'Données et synchro' },
    blurb: { en: 'Profiles, syncing, resumable downloads and updates.', fr: 'Profils, synchro, téléchargements repris et mises à jour.' },
    articles: [
      devArticle('profile-system', { en: 'Profile system', fr: 'Système de profils' }, { en: 'How isolated profiles are modelled and switched.', fr: 'Comment les profils isolés sont modélisés et basculés.' }, 'profile system switch', {
        en: '<p>A profile is a small record — a name, a target folder, and an ordered list of which mods are on. It stores no files, so you can keep a dozen for almost nothing. Switching one reconciles only the <b>difference</b> between the current game folder and the profile\'s list, which is why it\'s instant even with hundreds of mods.</p>',
        fr: '<p>Un profil est un petit enregistrement — un nom, un dossier cible et une liste ordonnée des mods actifs. Il ne stocke aucun fichier, vous pouvez donc en garder une douzaine pour presque rien. Changer de profil ne réconcilie que la <b>différence</b> entre le dossier du jeu actuel et la liste du profil, d\'où l\'instantanéité même avec des centaines de mods.</p>',
      }),
      devArticle('mod-sync', { en: 'Mod sync', fr: 'Synchro des mods' }, { en: 'Reconciling on-disk mods with the index.', fr: 'Réconcilier les mods sur disque avec l’index.' }, 'sync reconcile index', {
        en: '<p>Sync reconciles what\'s on disk with the index: new files are hashed and added, changed ones re-hashed, missing ones flagged. It\'s incremental (it leans on the mtime cache) and strictly read-only — it builds knowledge, it never rewrites your mods.</p>',
        fr: '<p>La synchro réconcilie ce qui est sur le disque avec l\'index : les nouveaux fichiers sont hachés et ajoutés, les modifiés re-hachés, les manquants signalés. Elle est incrémentale (elle s\'appuie sur le cache mtime) et strictement en lecture seule — elle construit une connaissance, elle ne réécrit jamais vos mods.</p>',
      }),
      devArticle('resumable-downloads', { en: 'Resumable downloads', fr: 'Téléchargements repris' }, { en: 'How interrupted downloads pick up where they left off.', fr: 'Comment un téléchargement interrompu reprend où il s’est arrêté.' }, 'download resume range', {
        en: '<p>A download records how many bytes it already holds. If it\'s interrupted, it asks the server for the <b>remaining range</b> instead of starting over — so a dropped connection on a large mod costs seconds, not the whole file. The finished file is then hash-verified before it\'s trusted.</p>',
        fr: '<p>Un téléchargement note combien d\'octets il possède déjà. S\'il est interrompu, il demande au serveur la <b>plage restante</b> au lieu de tout recommencer — une connexion coupée sur un gros mod coûte des secondes, pas le fichier entier. Le fichier terminé est ensuite vérifié par hachage avant d\'être considéré fiable.</p>',
      }),
      devArticle('update-system', { en: 'Update system', fr: 'Système de mise à jour' }, { en: 'How BMM and mods check for and apply updates.', fr: 'Comment BMM et les mods vérifient et appliquent les mises à jour.' }, 'update version release', {
        en: '<p>BMM compares a source\'s published version with what you have and only fetches when they differ. Downloaded updates are hash-verified before they\'re applied, and the app\'s own updates are cryptographically <b>signed</b> and checked — so an intercepted download can\'t install a tampered build.</p>',
        fr: '<p>BMM compare la version publiée d\'une source avec la vôtre et ne télécharge que si elles diffèrent. Les mises à jour téléchargées sont vérifiées par hachage avant application, et les mises à jour de l\'app elle-même sont <b>signées</b> cryptographiquement et vérifiées — un téléchargement intercepté ne peut pas installer une version altérée.</p>',
      }),
      devArticle('mod-updates', { en: 'Mod updates', fr: 'Mises à jour des mods' }, { en: 'Detecting and staging new mod versions.', fr: 'Détecter et préparer les nouvelles versions de mods.' }, 'mod update version', {
        en: '<p>For each mod with a known source, BMM compares the source\'s latest version to your installed one and stages the new files without disturbing the rest of the profile. You review what changed and apply it — the update is non-destructive like everything else.</p>',
        fr: '<p>Pour chaque mod ayant une source connue, BMM compare la dernière version de la source à celle installée et prépare les nouveaux fichiers sans toucher au reste du profil. Vous examinez ce qui change et l\'appliquez — la mise à jour est non destructive comme le reste.</p>',
      }),
    ],
  },
  {
    id: 'extend', part: 'dev', icon: 'puzzle',
    title: { en: 'Extending BMM', fr: 'Étendre BMM' },
    blurb: { en: 'Plugins, the API, MCP, custom pages and catalogs.', fr: 'Plugins, API, MCP, pages personnalisées et catalogues.' },
    articles: [
      devArticle('mcp-server', { en: 'MCP server & local API', fr: 'Serveur MCP et API locale' }, { en: 'Drive BMM from scripts or an AI client.', fr: 'Piloter BMM depuis des scripts ou un client IA.' }, 'mcp api plugin automation endpoint', {
        en: '<p>Everything the UI can do, it does by asking the core. That same core is exposed as a <b>local HTTP API</b> (bound to localhost) and as an <b>MCP server</b> (over stdio, not a public port), so plugins, scripts and AI assistants can scan, activate, build packs and more. The full endpoint reference lives in the online docs.</p>',
        fr: '<p>Tout ce que l\'interface sait faire, elle le fait en demandant au cœur. Ce même cœur est exposé comme <b>API HTTP locale</b> (sur localhost) et comme <b>serveur MCP</b> (via stdio, pas un port public), donc plugins, scripts et assistants IA peuvent scanner, activer, construire des packs, etc. La référence complète des endpoints est dans la documentation en ligne.</p>',
      }, ''),
      devArticle('app-catalog', { en: 'App catalog', fr: 'Catalogue d’applis' }, { en: 'How catalog feeds are fetched and installed.', fr: 'Comment les flux de catalogue sont récupérés et installés.' }, 'catalog feed install', {
        en: '<p>A catalog is a JSON feed of installable items (apps, tools). BMM fetches it, shows the entries, and installs straight from them — the same pipeline whether the feed is official or community-hosted, and every download is hash-checked before it lands.</p>',
        fr: '<p>Un catalogue est un flux JSON d\'éléments installables (applis, outils). BMM le récupère, affiche les entrées et installe directement depuis elles — le même pipeline que le flux soit officiel ou communautaire, et chaque téléchargement est vérifié par hachage avant d\'atterrir.</p>',
      }),
      devArticle('launch-packs', { en: 'Launch packs', fr: 'Launch packs' }, { en: 'Bundling a launchable setup.', fr: 'Regrouper une configuration lançable.' }, 'launch pack bundle', {
        en: '<p>A launch pack bundles a ready-to-run setup — the mods, their order and the launch action — into one unit, so a full configuration can be launched (and handed to someone) as a single thing rather than reassembled by hand.</p>',
        fr: '<p>Un launch pack regroupe une configuration prête à lancer — les mods, leur ordre et l\'action de lancement — en une seule unité, pour qu\'une configuration complète se lance (et se transmette) d\'un bloc au lieu d\'être réassemblée à la main.</p>',
      }),
      devArticle('theme-system', { en: 'Theme system', fr: 'Système de thèmes' }, { en: 'How themes tokenise the UI — and how you make your own.', fr: 'Comment les thèmes tokenisent l’UI — et comment créer le vôtre.' }, 'theme editor tokens css couleurs', {
        en: '<p>The whole UI is drawn from CSS <b>design tokens</b> (colours, radii, fonts). A theme is simply a set of token values, so seven ship by default and the built-in editor lets you change them live. This isn\'t dev-only: <b>you can create and save your own theme</b> and share it — see <em>Themes &amp; appearance</em> in the user guide for the hands-on side.</p>',
        fr: '<p>Toute l\'interface est dessinée à partir de <b>tokens</b> CSS (couleurs, rayons, polices). Un thème n\'est qu\'un jeu de valeurs de tokens : sept sont livrés par défaut et l\'éditeur intégré permet de les changer en direct. Ce n\'est pas réservé aux devs : <b>vous pouvez créer et enregistrer votre propre thème</b> et le partager — voir <em>Thèmes &amp; apparence</em> dans le guide utilisateur pour la pratique.</p>',
      }),
      devArticle('one-click-install', { en: 'One-click install', fr: 'Installation en un clic' }, { en: 'The deeplink flow behind install buttons.', fr: 'Le flux deeplink derrière les boutons d’installation.' }, 'deeplink install oneclick', {
        en: '<p>Install buttons on the web use a <code>bmm://</code> <b>deeplink</b> the app registers with the OS. Clicking one hands the request to the running app, which confirms with you before acting — so an install is one click, with no copy-pasting URLs and no silent action.</p>',
        fr: '<p>Les boutons d\'installation sur le web utilisent un <b>deeplink</b> <code>bmm://</code> que l\'app enregistre auprès de l\'OS. Cliquer sur l\'un transmet la requête à l\'app en cours, qui confirme avec vous avant d\'agir — une installation en un clic, sans copier-coller d\'URL ni action silencieuse.</p>',
      }),
    ],
  },
  {
    id: 'ops', part: 'dev', icon: 'server',
    title: { en: 'Deploy & operations', fr: 'Déploiement et exploitation' },
    blurb: { en: 'Hosting, Docker, security, telemetry and reporting.', fr: 'Hébergement, Docker, sécurité, télémétrie et rapports.' },
    articles: [
      devArticle('security-system', { en: 'Security model', fr: 'Modèle de sécurité' }, { en: 'Trust boundaries, path guards and signed payloads.', fr: 'Frontières de confiance, gardes de chemins et charges signées.' }, 'security cwe path signing sécurité', {
        en: '<p>BMM treats the UI and anything from the network as <b>untrusted</b> and verifies at the core. Path operations reject <code>..</code> / absolute escapes and stay confined to their target folder; downloads are hash-checked before deploy; app and package updates must pass a <b>signature</b> check. Extensions are confined too — custom pages via a permission broker, MCP over stdio, the API on localhost.</p>',
        fr: '<p>BMM considère l\'interface et tout ce qui vient du réseau comme <b>non fiable</b> et vérifie au cœur. Les opérations de chemin rejettent <code>..</code> / les échappements absolus et restent confinées à leur dossier cible ; les téléchargements sont vérifiés par hachage avant déploiement ; les mises à jour de l\'app et des paquets doivent passer un contrôle de <b>signature</b>. Les extensions sont aussi confinées — pages perso via un courtier de permissions, MCP via stdio, API sur localhost.</p>',
      }, ''),
      devArticle('docker-deployment', { en: 'Docker deployment', fr: 'Déploiement Docker' }, { en: 'Running the community/server pieces in containers.', fr: 'Exécuter les briques communauté/serveur en conteneurs.' }, 'docker deploy container', {
        en: '<p>The community and server-side pieces (the web hub, repo hosting) run as containers via Docker Compose, so a host can bring the whole stack up reproducibly and update it in place. This is for people self-hosting the infrastructure, not for using BMM itself.</p>',
        fr: '<p>Les briques communauté et côté serveur (le hub web, l\'hébergement de dépôts) tournent en conteneurs via Docker Compose : un hébergeur peut monter toute la stack de façon reproductible et la mettre à jour sur place. C\'est pour ceux qui auto-hébergent l\'infrastructure, pas pour utiliser BMM lui-même.</p>',
      }),
      devArticle('dedicated-hosting', { en: 'Dedicated hosting', fr: 'Hébergement dédié' }, { en: 'How a hosted repo is served.', fr: 'Comment un dépôt hébergé est servi.' }, 'hosting dedicated server', {
        en: '<p>A hosted repo serves a <b>manifest</b> (files + their hashes) and the files themselves. A client diffs the manifest against what it already has and pulls only the difference, verifying each transferred file by hash — which is why a small update to a huge collection costs a few MB.</p>',
        fr: '<p>Un dépôt hébergé sert un <b>manifeste</b> (fichiers + leurs hachages) et les fichiers eux-mêmes. Un client compare le manifeste à ce qu\'il possède déjà et ne tire que la différence, en vérifiant chaque fichier transféré par hachage — d\'où le coût de quelques Mo pour une petite mise à jour d\'une énorme collection.</p>',
      }),
      devArticle('hosting-flow', { en: 'Hosting flow', fr: 'Flux d’hébergement' }, { en: 'The end-to-end publish → subscribe path.', fr: 'Le chemin complet publier → s’abonner.' }, 'hosting flow publish subscribe', {
        en: '<p>Publishing turns a profile into a repo with a manifest and access rules; subscribing points a client at its link, which then diffs and syncs and stays in sync as the owner updates. This is the end-to-end path from one person\'s setup to a whole group running the exact same thing.</p>',
        fr: '<p>Publier transforme un profil en dépôt avec un manifeste et des règles d\'accès ; s\'abonner pointe un client sur son lien, qui compare, synchronise et reste synchronisé à mesure que le propriétaire met à jour. C\'est le chemin complet, de la configuration d\'une personne à tout un groupe faisant exactement la même chose.</p>',
      }),
      devArticle('crash-reporting', { en: 'Crash reporting', fr: 'Rapports de plantage' }, { en: 'What a report contains and how it’s built.', fr: 'Ce que contient un rapport et comment il est construit.' }, 'crash report diagnostics', {
        en: '<p>On a crash BMM writes a self-contained zip — logs, system info, and the rolling session recording — that you can review and share. A clean exit writes a lighter session log; the expensive parts (a full system snapshot, the recording) are collected only for real crashes, so closing the app stays fast.</p>',
        fr: '<p>En cas de plantage, BMM écrit un zip autonome — journaux, infos système et l\'enregistrement de session glissant — que vous pouvez relire et partager. Une fermeture propre écrit un journal plus léger ; les parties coûteuses (instantané système complet, enregistrement) ne sont collectées que pour de vrais plantages, pour que fermer l\'app reste rapide.</p>',
      }),
      devArticle('discord-rpc', { en: 'Discord RPC', fr: 'Discord RPC' }, { en: 'Rich presence integration.', fr: 'Intégration de la rich presence.' }, 'discord rpc presence', {
        en: '<p>BMM can show your current activity as Discord <b>rich presence</b>, updating as you switch profiles or work. It\'s an optional integration you turn on in Settings — off by default, and it sends only the activity text you\'d expect.</p>',
        fr: '<p>BMM peut afficher votre activité en cours en <b>rich presence</b> Discord, mise à jour quand vous changez de profil ou travaillez. C\'est une intégration optionnelle activée dans les Réglages — désactivée par défaut, et elle n\'envoie que le texte d\'activité attendu.</p>',
      }),
      devArticle('betahub-reporting', { en: 'BetaHub reporting', fr: 'Rapports BetaHub' }, { en: 'In-app bug reporting pipeline.', fr: 'Pipeline de signalement de bugs intégré.' }, 'betahub bug report', {
        en: '<p>The in-app bug reporter packages your description plus context — and optionally a session recording — and sends it through the BetaHub pipeline, so a report arrives with enough to reproduce the issue instead of a bare "it broke".</p>',
        fr: '<p>Le rapporteur de bugs intégré empaquette votre description plus le contexte — et éventuellement un enregistrement de session — et l\'envoie via le pipeline BetaHub, pour qu\'un rapport arrive avec de quoi reproduire le problème au lieu d\'un simple « ça a planté ».</p>',
      }),
    ],
  },
];

// Factory for the Dev articles. Each carries a REAL explanation (`body`); we only append a short
// pointer to the matching interactive diagram — never a placeholder, and never a repeat of the
// summary shown above the article.
function devArticle(diagramId: string, title: L, summary: L, keywords: string, body: L, docsPath = '#'): Article {
  return {
    id: diagramId, title, summary, diagram: diagramId, docsPath: docsPath === '#' ? undefined : docsPath, keywords,
    body: {
      en: `${body.en}<p class="dh-diagnote">Open the interactive diagram (button below) to follow this step by step — pan, zoom and hover each node.</p>`,
      fr: `${body.fr}<p class="dh-diagnote">Ouvrez le diagramme interactif (bouton ci-dessous) pour suivre étape par étape — déplacez, zoomez et survolez chaque nœud.</p>`,
    },
  };
}

// ── state + host ─────────────────────────────────────────────────────────────────
type View = 'hub' | 'cat' | 'art' | 'diagrams' | 'search';
type SearchMode = 'classic' | 'semantic';
interface Route { view: View; part: Part; catId?: string; artId?: string; q?: string; mode: SearchMode; }
let host: HTMLElement | null = null;
let route: Route = { view: 'hub', part: 'user', mode: 'classic' };

const catsOf = (part: Part) => CATEGORIES.filter((c) => c.part === part);
const findArticle = (id: string): { cat: Category; art: Article } | null => {
  for (const cat of CATEGORIES) { const art = cat.articles.find((a) => a.id === id); if (art) return { cat, art }; }
  return null;
};

// Diagram gallery entries, built from the shared registry (title from each module's titleKey).
function diagramList(): { id: string; title: string }[] {
  const reg = diagrams as Record<string, any>;
  return Object.keys(reg).map((id) => {
    const key = reg[id]?.titleKey as string | undefined;
    const title = (key && t(key)) || id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return { id, title };
  }).sort((a, b) => a.title.localeCompare(b.title));
}

// ── rendering: chrome (header, part toggle, search) ────────────────────────────────
function chrome(): string {
  const seg = (p: Part, label: L, sub: L) =>
    `<button class="dh-seg ${route.part === p ? 'on' : ''}" data-part="${p}"><span>${tr(label)}</span><small>${tr(sub)}</small></button>`;
  return `
  <div class="dh">
    <div class="dh-top">
      <div class="dh-heading">
        <h1>${tr({ en: 'Help & documentation', fr: 'Aide et documentation' })}</h1>
        <p>${tr({ en: 'Everything about BMM — searchable, with hands-on tutorials and interactive diagrams.', fr: 'Tout sur BMM — recherchable, avec des tutoriels guidés et des diagrammes interactifs.' })}</p>
      </div>
      <div class="dh-actions">
        <button class="dh-btn dh-btn-primary" data-act="tutorial">${svg('play', 16)} ${tr({ en: 'Interactive tutorial', fr: 'Tutoriel interactif' })}</button>
        <a class="dh-btn" href="${DOCS_SITE}" target="_blank" rel="noreferrer">${svg('ext', 16)} ${tr({ en: 'Full docs', fr: 'Docs complètes' })}</a>
      </div>
    </div>
    <div class="dh-parts">
      ${seg('user', { en: 'User guide', fr: 'Guide utilisateur' }, { en: 'Use every feature', fr: 'Utiliser chaque fonction' })}
      ${seg('dev', { en: 'Developer', fr: 'Développeur' }, { en: 'How it works inside', fr: 'Comment ça marche' })}
    </div>
    <div class="dh-searchbar">
      ${svg('search', 18)}
      <input type="search" class="dh-search" placeholder="${tr({ en: 'Search the docs…', fr: 'Rechercher dans la doc…' })}" autocomplete="off" spellcheck="false">
      <div class="dh-modes">
        <button class="dh-mode ${route.mode === 'classic' ? 'on' : ''}" data-mode="classic" title="${tr({ en: 'Exact text match', fr: 'Correspondance exacte' })}">${tr({ en: 'Classic', fr: 'Classique' })}</button>
        <button class="dh-mode ${route.mode === 'semantic' ? 'on' : ''}" data-mode="semantic" title="${tr({ en: 'Match meaning & synonyms', fr: 'Sens et synonymes' })}">${tr({ en: 'Semantic', fr: 'Sémantique' })}</button>
      </div>
      <kbd class="dh-kbd">Ctrl K</kbd>
    </div>
    <div class="dh-crumbs"></div>
    <div class="dh-body"></div>
  </div>`;
}

function crumbs(): string {
  const home = `<button class="dh-crumb" data-view2="hub">${tr({ en: 'Help', fr: 'Aide' })}</button>`;
  const partName: L = route.part === 'dev' ? { en: 'Developer', fr: 'Développeur' } : { en: 'User guide', fr: 'Guide utilisateur' };
  const sep = `<span class="dh-crumb-sep">${svg('arrow', 12)}</span>`;
  const parts: string[] = [home];
  if (route.view === 'search') { parts.push(sep, `<span class="dh-crumb on">${tr({ en: 'Search', fr: 'Recherche' })}</span>`); return parts.join(''); }
  parts.push(sep, `<button class="dh-crumb" data-view2="hub" data-part="${route.part}">${tr(partName)}</button>`);
  if (route.view === 'diagrams') { parts.push(sep, `<span class="dh-crumb on">${tr({ en: 'Diagrams', fr: 'Diagrammes' })}</span>`); return parts.join(''); }
  const cat = route.catId ? CATEGORIES.find((c) => c.id === route.catId) : null;
  if (cat) {
    const last = route.view === 'cat';
    parts.push(sep, last ? `<span class="dh-crumb on">${tr(cat.title)}</span>` : `<button class="dh-crumb" data-cat="${cat.id}">${tr(cat.title)}</button>`);
  }
  if (route.view === 'art' && route.artId) {
    const found = findArticle(route.artId);
    if (found) parts.push(sep, `<span class="dh-crumb on">${tr(found.art.title)}</span>`);
  }
  return parts.join('');
}

function hubView(): string {
  const cards = catsOf(route.part).map((c) => `
    <button class="dh-cat" data-cat="${c.id}">
      <span class="dh-cat-ic">${svg(c.icon, 22)}</span>
      <span class="dh-cat-tx">
        <span class="dh-cat-t">${tr(c.title)}</span>
        <span class="dh-cat-b">${tr(c.blurb)}</span>
        <span class="dh-cat-n">${c.articles.length} ${tr({ en: 'articles', fr: 'articles' })} ${svg('arrow', 14)}</span>
      </span>
    </button>`).join('');
  const diag = `
    <button class="dh-cat dh-cat-diagram" data-view2="diagrams">
      <span class="dh-cat-ic">${svg('diagram', 22)}</span>
      <span class="dh-cat-tx">
        <span class="dh-cat-t">${tr({ en: 'Interactive diagrams', fr: 'Diagrammes interactifs' })}</span>
        <span class="dh-cat-b">${tr({ en: 'Explore how BMM works, visually.', fr: 'Explorez le fonctionnement de BMM, visuellement.' })}</span>
        <span class="dh-cat-n">${Object.keys(diagrams).length} ${tr({ en: 'diagrams', fr: 'diagrammes' })} ${svg('arrow', 14)}</span>
      </span>
    </button>`;
  return `<div class="dh-grid">${cards}${diag}</div>`;
}

function articleCard(a: Article): string {
  return `
    <button class="dh-art" data-art="${a.id}">
      <span class="dh-art-t">${tr(a.title)}</span>
      <span class="dh-art-s">${tr(a.summary)}</span>
      <span class="dh-art-tags">
        ${a.tutorial ? `<span class="dh-tag dh-tag-tut">${svg('play', 11)} ${tr({ en: 'Tutorial', fr: 'Tutoriel' })}</span>` : ''}
        ${a.diagram ? `<span class="dh-tag dh-tag-dia">${svg('diagram', 11)} ${tr({ en: 'Diagram', fr: 'Diagramme' })}</span>` : ''}
        ${a.media ? `<span class="dh-tag dh-tag-med">${svg('play', 11)} ${tr({ en: 'Demo', fr: 'Démo' })}</span>` : ''}
      </span>
    </button>`;
}

function categoryView(c: Category): string {
  return `
    <div class="dh-cat-head">${svg(c.icon, 24)}<div><h2>${tr(c.title)}</h2><p>${tr(c.blurb)}</p></div></div>
    <div class="dh-arts">${c.articles.map(articleCard).join('')}</div>`;
}

function mediaBlock(m: Media): string {
  const cap = m.caption ? `<figcaption class="dh-media-cap">${tr(m.caption)}</figcaption>` : '';
  if (m.kind === 'image' && m.src) return `<figure class="dh-media"><img class="dh-media-img" src="${m.src}" alt="${m.caption ? tr(m.caption) : ''}" loading="lazy">${cap}</figure>`;
  if (m.kind === 'svg' && m.svg) return `<figure class="dh-media dh-media-svg">${m.svg}${cap}</figure>`;
  if (m.kind === 'replay' && m.src) return `<figure class="dh-media"><button class="dh-replay" data-replay="${m.src}">${svg('play', 20)} <span>${tr({ en: 'Play session recording', fr: 'Lire l’enregistrement' })}</span></button>${cap}</figure>`;
  return '';
}

function articleView(cat: Category, a: Article): string {
  const rel = [
    a.tutorial ? `<button class="dh-rel dh-rel-tut" data-tut="${a.tutorial.id}" data-tut-part="${a.tutorial.part || ''}" data-tut-step="${a.tutorial.step || ''}">${svg('play', 15)} ${tr({ en: 'Try it in the tutorial', fr: 'Essayer dans le tutoriel' })}</button>` : '',
    a.diagram ? `<button class="dh-rel dh-rel-dia" data-diagram="${a.diagram}">${svg('diagram', 15)} ${tr({ en: 'Open the diagram', fr: 'Ouvrir le diagramme' })}</button>` : '',
    `<a class="dh-rel dh-rel-ext" href="${DOCS_SITE}${a.docsPath || ''}" target="_blank" rel="noreferrer">${svg('ext', 15)} ${tr({ en: 'Read full docs', fr: 'Lire la doc complète' })}</a>`,
  ].filter(Boolean).join('');
  return `
    <article class="dh-article">
      <h2>${tr(a.title)}</h2>
      <p class="dh-lead">${tr(a.summary)}</p>
      ${a.media ? mediaBlock(a.media) : ''}
      <div class="dh-content">${renderDocMarkdown(tr(a.body))}</div>
      <div class="dh-rels">${rel}</div>
    </article>`;
}

function diagramsView(): string {
  const items = diagramList().map((d) => `
    <button class="dh-dia" data-diagram="${d.id}">
      <span class="dh-dia-ic">${svg('diagram', 18)}</span>
      <span class="dh-dia-t">${d.title}</span>
    </button>`).join('');
  return `
    <div class="dh-cat-head">${svg('diagram', 24)}<div><h2>${tr({ en: 'Interactive diagrams', fr: 'Diagrammes interactifs' })}</h2><p>${tr({ en: 'Click any diagram to explore it — pan, zoom and hover the nodes.', fr: 'Cliquez un diagramme pour l’explorer — déplacez, zoomez et survolez les nœuds.' })}</p></div></div>
    <div class="dh-dias">${items}</div>`;
}

// ── search (classic + semantic) ────────────────────────────────────────────────────
function expandTerms(q: string): string[] {
  const base = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (route.mode === 'classic') return base;
  // Semantic: add synonyms for each token (Algolia-ish query expansion).
  const syn = getSynonyms() || {};
  const set = new Set(base);
  for (const tok of base) {
    for (const [k, list] of Object.entries(syn)) {
      if (k.toLowerCase() === tok || (list || []).some((s) => s.toLowerCase() === tok)) {
        set.add(k.toLowerCase()); (list || []).forEach((s) => set.add(s.toLowerCase()));
      }
    }
  }
  return [...set];
}
function scoreHay(hay: string, terms: string[]): number {
  let s = 0; for (const t2 of terms) if (t2 && hay.includes(t2)) s += 1; return s;
}
function searchView(q: string): string {
  const terms = expandTerms(q);
  const arts: { cat: Category; art: Article; s: number }[] = [];
  for (const cat of CATEGORIES) for (const art of cat.articles) {
    const hay = `${tr(art.title)} ${tr(art.summary)} ${art.keywords || ''} ${art.title.en} ${art.title.fr} ${art.summary.en} ${art.summary.fr}`.toLowerCase();
    const s = scoreHay(hay, terms);
    if (s > 0) arts.push({ cat, art, s });
  }
  arts.sort((a, b) => b.s - a.s);
  const dias = diagramList().filter((d) => scoreHay((d.title + ' ' + d.id).toLowerCase(), terms) > 0);
  if (!arts.length && !dias.length) {
    return `<div class="dh-empty">${svg('search', 26)}<p>${tr({ en: 'No results for', fr: 'Aucun résultat pour' })} “${escapeHtml(q)}”.</p><p class="dh-empty-sub">${route.mode === 'classic' ? tr({ en: 'Try Semantic mode, the full docs, or the tutorial.', fr: 'Essayez le mode Sémantique, la doc complète ou le tutoriel.' }) : tr({ en: 'Try the full documentation or the interactive tutorial.', fr: 'Essayez la documentation complète ou le tutoriel interactif.' })}</p></div>`;
  }
  const artHtml = arts.length ? `<div class="dh-sec-h">${tr({ en: 'Articles', fr: 'Articles' })} · ${arts.length}</div><div class="dh-arts">${arts.map(({ art }) => articleCard(art)).join('')}</div>` : '';
  const diaHtml = dias.length ? `<div class="dh-sec-h">${tr({ en: 'Diagrams', fr: 'Diagrammes' })} · ${dias.length}</div><div class="dh-dias">${dias.map((d) => `<button class="dh-dia" data-diagram="${d.id}"><span class="dh-dia-ic">${svg('diagram', 18)}</span><span class="dh-dia-t">${d.title}</span></button>`).join('')}</div>` : '';
  return artHtml + diaHtml;
}

function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── controller ───────────────────────────────────────────────────────────────────
function bodyHtml(): string {
  switch (route.view) {
    case 'search': return searchView(route.q || '');
    case 'diagrams': return diagramsView();
    case 'cat': { const c = CATEGORIES.find((x) => x.id === route.catId); return c ? categoryView(c) : hubView(); }
    case 'art': { const f = route.artId ? findArticle(route.artId) : null; return f ? articleView(f.cat, f.art) : hubView(); }
    default: return hubView();
  }
}
function paint() {
  const body = host?.querySelector('.dh-body') as HTMLElement | null;
  const cr = host?.querySelector('.dh-crumbs') as HTMLElement | null;
  if (body) body.innerHTML = bodyHtml();
  if (cr) cr.innerHTML = crumbs();
  // keep the search input in sync (e.g. after a lang re-render)
  const input = host?.querySelector('.dh-search') as HTMLInputElement | null;
  if (input && route.view === 'search' && input.value !== (route.q || '')) input.value = route.q || '';
}
function renderAll() {
  if (!host) return;
  host.innerHTML = chrome();
  wireSearch();
  paint();
}
function go(next: Partial<Route>) { route = { ...route, ...next }; paint(); }

function wireSearch() {
  const input = host?.querySelector('.dh-search') as HTMLInputElement | null;
  if (!input) return;
  if (route.view === 'search') input.value = route.q || '';
  let deb: number | null = null;
  input.addEventListener('input', () => {
    if (deb != null) window.clearTimeout(deb);
    deb = window.setTimeout(() => {
      const q = input.value.trim();
      if (q.length >= 2) go({ view: 'search', q });
      else go({ view: 'hub', q: '' });
    }, 120);
  });
}

function onClick(e: Event) {
  const el = e.target as HTMLElement;
  const hit = (sel: string) => el.closest(sel) as HTMLElement | null;

  const modeBtn = hit('[data-mode]');
  if (modeBtn) {
    route.mode = (modeBtn.getAttribute('data-mode') as SearchMode) || 'classic';
    host?.querySelectorAll('.dh-mode').forEach((m) => m.classList.toggle('on', m.getAttribute('data-mode') === route.mode));
    if (route.view === 'search' && route.q) paint();
    return;
  }
  const partBtn = hit('[data-part]');
  if (partBtn && (partBtn.hasAttribute('data-part')) && (partBtn.classList.contains('dh-seg') || partBtn.classList.contains('dh-crumb'))) {
    const p = partBtn.getAttribute('data-part') as Part;
    host?.querySelectorAll('.dh-seg').forEach((s) => s.classList.toggle('on', s.getAttribute('data-part') === p));
    go({ part: p, view: 'hub', catId: undefined, artId: undefined });
    return;
  }
  const rep = hit('[data-replay]');
  if (rep) { playReplay(rep.getAttribute('data-replay') || ''); return; }

  const tutBtn = hit('[data-tut]');
  if (tutBtn) { launchTutorial(tutBtn.getAttribute('data-tut') || '', tutBtn.getAttribute('data-tut-part') || '', tutBtn.getAttribute('data-tut-step') || ''); return; }
  if (hit('[data-act="tutorial"]')) { launchTutorial('', '', ''); return; }

  const dia = hit('[data-diagram]');
  if (dia) { const id = dia.getAttribute('data-diagram'); if (id && typeof (window as any).openDiagram === 'function') (window as any).openDiagram(id); return; }

  const v2 = hit('[data-view2]');
  if (v2) { go({ view: v2.getAttribute('data-view2') === 'diagrams' ? 'diagrams' : 'hub', q: '' }); return; }

  const catBtn = hit('[data-cat]');
  if (catBtn) { const c = CATEGORIES.find((x) => x.id === catBtn.getAttribute('data-cat')); if (c) go({ view: 'cat', part: c.part, catId: c.id }); return; }

  const artBtn = hit('[data-art]');
  if (artBtn) { const f = findArticle(artBtn.getAttribute('data-art') || ''); if (f) go({ view: 'art', part: f.cat.part, catId: f.cat.id, artId: f.art.id }); return; }
}

async function playReplay(url: string) {
  if (!url) return;
  try { const m = await import('../features/settings/replay-watcher.js'); (m as any).playReplayFromUrl?.(url); } catch { /* ignore */ }
}

async function launchTutorial(id: string, part: string, step: string) {
  // Deep-link straight into the requested tutorial/part/step when we have it.
  if (id) {
    try {
      const [{ startTutorialEngine }, { TUTORIALS }] = await Promise.all([import('../ui/tutorial-engine.js') as any, import('../ui/tutorial-data.js') as any]);
      const tut = (TUTORIALS || []).find((x: any) => x.id === id);
      if (tut && startTutorialEngine) { startTutorialEngine(tut, part || undefined, step || undefined, () => {}); return; }
    } catch { /* fall through to the hub */ }
  }
  try { const hub = await import('../ui/tutorial-hub.js'); (hub as any).openTutorialHub?.(); } catch { /* ignore */ }
}

// Navigate the docs view + open a specific place. Exposed on window so Settings (and anywhere)
// can deep-link here — replaces the old openHelpTo(faq.*) that targeted the removed markup.
function showDocs() { const n = document.querySelector('.nav-item[data-view="docs"]') as HTMLElement | null; n?.click(); }
function openArticle(catId: string, artId: string) {
  const c = CATEGORIES.find((x) => x.id === catId); const f = findArticle(artId);
  if (c && f) route = { ...route, view: 'art', part: c.part, catId, artId };
  showDocs(); paint();
}
// Map the old openHelpTo(faq.*) keys onto the rebuilt FAQ articles.
const LEGACY_HELP: Record<string, [string, string]> = {
  'faq.qPat': ['faq', 'faq-pat'],
  'faq.qIo': ['faq', 'faq-disk-full'],
  'faq.qDiskFull': ['faq', 'faq-disk-full'],
  'faq.qDeleted': ['faq', 'faq-deleted-mod'],
};

/** Build the whole Help & Other page into #view-docs. Called once at app startup. */
export function initDocsHub() {
  host = document.getElementById('view-docs');
  if (!host) return;
  renderAll();
  host.addEventListener('click', onClick);
  // Re-render on language switch — but KEEP the current route so you stay on the same page.
  document.addEventListener('langChanged', () => renderAll());

  // (Ctrl/⌘+K now opens the app-wide command palette — see core/commands.ts — which includes a
  // "Search the documentation" command that focuses this search.)

  // Public deep-link hooks (used by Settings' FAQ/PAT/disk buttons; supersedes old openHelpTo).
  (window as any).openDocsArticle = openArticle;
  (window as any).openDocsHome = () => { route = { ...route, view: 'hub', catId: undefined, artId: undefined }; showDocs(); paint(); };
  (window as any).openHelpTo = (key: string) => {
    const map = LEGACY_HELP[key];
    if (map) openArticle(map[0], map[1]); else (window as any).openDocsHome();
  };
}
