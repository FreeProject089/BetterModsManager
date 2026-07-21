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
        body: {
          en: '<p>A <b>profile</b> is an isolated set of mods. Keep a "clean" profile, a "multiplayer" profile and an experimental one — and swap between them in seconds.</p><h4>Steps</h4><ul><li>Open <b>Profiles</b> → <b>New profile</b>.</li><li>Set the game / mods folder BMM should manage.</li><li>Give it a name and colour so it’s easy to recognise.</li></ul><p>Switching re-links only what changed, so it stays instant even with large collections.</p>',
          fr: '<p>Un <b>profil</b> est un ensemble isolé de mods. Gardez un profil « propre », un profil « multijoueur » et un profil expérimental — et basculez entre eux en quelques secondes.</p><h4>Étapes</h4><ul><li>Ouvrez <b>Profils</b> → <b>Nouveau profil</b>.</li><li>Définissez le dossier de jeu / mods que BMM doit gérer.</li><li>Donnez-lui un nom et une couleur pour le reconnaître.</li></ul><p>Changer de profil ne re-lie que ce qui a changé : instantané même avec de grandes collections.</p>',
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
        body: {
          en: '<p>BMM stores your mods and applies them to the game non-destructively (the same idea as OvGME). For that to work, each mod must contain the <b>full folder tree</b> as it should appear in the game — not just the loose files.</p><h4>Set up a profile per target</h4><p>The cleanest setup is one profile per destination:</p><ul><li><b>Install folder</b> profile → <code>Program Files\\Eagle Dynamics\\DCS World</code></li><li><b>Saved Games</b> profile → <code>C:\\Users\\&lt;you&gt;\\Saved Games\\DCS</code></li></ul><p>The <b>Configuration → mods folder</b> is the storage folder for that profile’s mods (one per profile).</p><h4>The tree a stored mod needs</h4><p>When you store a mod, make sure the whole path under the game root is present. Example for an aircraft mod:</p><pre class="dh-tree">\\My Awesome Mod\n   |_ Mods\n        |_ aircraft\n             |_ MyAircraft</pre><p>So <code>My Awesome Mod</code> is the mod, and inside it the exact tree (<code>Mods/aircraft/MyAircraft</code>) that the file needs to land in. If your download is missing those parent folders, don’t reshape it by hand — use the <b>mod mapper</b> to drag files into place and save that mapping, so every re-install is one click.</p>',
          fr: '<p>BMM stocke vos mods et les applique au jeu de façon non destructive (le même principe qu’OvGME). Pour cela, chaque mod doit contenir l’<b>arborescence complète</b> telle qu’elle doit apparaître dans le jeu — pas seulement les fichiers en vrac.</p><h4>Créer un profil par cible</h4><p>Le plus propre est un profil par destination :</p><ul><li>profil <b>dossier d’install</b> → <code>Program Files\\Eagle Dynamics\\DCS World</code></li><li>profil <b>Saved Games</b> → <code>C:\\Users\\&lt;toi&gt;\\Saved Games\\DCS</code></li></ul><p>La ligne <b>Configuration → dossier des mods</b> est le dossier de stockage des mods de ce profil (un par profil).</p><h4>L’arborescence d’un mod stocké</h4><p>Quand on stocke un mod, il faut s’assurer que tout le chemin sous la racine du jeu est présent. Exemple pour un mod d’avion :</p><pre class="dh-tree">\\Mon Mod Génial\n   |_ Mods\n        |_ aircraft\n             |_ MonAvion</pre><p>Donc <code>Mon Mod Génial</code> est le mod, et à l’intérieur l’arborescence exacte (<code>Mods/aircraft/MonAvion</code>) où le fichier doit atterrir. Si votre téléchargement n’a pas ces dossiers parents, ne le réorganisez pas à la main — utilisez le <b>mappeur de mods</b> pour glisser les fichiers au bon endroit et enregistrer ce mapping : chaque réinstallation se fait en un clic.</p>',
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
    blurb: { en: 'Isolated setups, shared storage and safety nets.', fr: 'Configurations isolées, stockage partagé et filets de sécurité.' },
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
        summary: { en: 'Publish a profile so a whole group installs it in one click.', fr: 'Publiez un profil pour qu’un groupe entier l’installe en un clic.' },
        keywords: 'server repo host publish group community sync dépôt hébergement',
        body: {
          en: '<p>A server repo turns a profile into a hosted source. Members point BMM at its link and get the exact same mods, versions and settings — and stay in sync as you update it.</p><ul><li>Access can be public, email- or password-gated.</li><li>Each repo has a fingerprint so members can verify authenticity.</li></ul>',
          fr: '<p>Un dépôt serveur transforme un profil en source hébergée. Les membres pointent BMM sur son lien et obtiennent exactement les mêmes mods, versions et réglages — et restent synchronisés à mesure que vous le mettez à jour.</p><ul><li>L’accès peut être public, protégé par e-mail ou mot de passe.</li><li>Chaque dépôt a une empreinte pour vérifier son authenticité.</li></ul>',
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
    blurb: { en: 'Plugins, custom pages, scheduler and benchmarks.', fr: 'Plugins, pages personnalisées, planificateur et benchmarks.' },
    articles: [
      {
        id: 'custom-pages', diagram: 'premium-interactions',
        title: { en: 'Custom pages', fr: 'Pages personnalisées' },
        summary: { en: 'Add your own sandboxed pages to the navbar.', fr: 'Ajoutez vos propres pages sandbox à la barre de navigation.' },
        keywords: 'custom pages navbar bmmpage sandbox pages personnalisées',
        body: {
          en: '<p>Build a sandboxed <code>bmmpage://</code> page — a mini app inside BMM — and pin it to the navbar with scoped permissions.</p>',
          fr: '<p>Créez une page <code>bmmpage://</code> en sandbox — une mini-application dans BMM — et épinglez-la à la barre de navigation avec des permissions cadrées.</p>',
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
      devArticle('code-stack', { en: 'The tech stack', fr: 'La stack technique' }, { en: 'Tauri shell, a native Rust core and a TypeScript UI — and why.', fr: 'Coquille Tauri, cœur natif Rust et UI TypeScript — et pourquoi.' }, 'stack rust tauri typescript'),
      devArticle('lightweight-architecture', { en: 'Lightweight architecture', fr: 'Architecture légère' }, { en: 'Why BMM stays small and fast where an Electron app would be heavy.', fr: 'Pourquoi BMM reste léger et rapide là où un Electron serait lourd.' }, 'lightweight memory ram léger'),
      devArticle('engine-threads', { en: 'Engine & threads', fr: 'Moteur et threads' }, { en: 'How work is split across threads to keep the UI responsive.', fr: 'Comment le travail est réparti sur les threads pour garder l’UI réactive.' }, 'threads async engine concurrency'),
      devArticle('mod-architecture', { en: 'Mod data model', fr: 'Modèle de données des mods' }, { en: 'How a mod, its files and its metadata are represented.', fr: 'Comment un mod, ses fichiers et ses métadonnées sont représentés.' }, 'model data mod files'),
    ],
  },
  {
    id: 'engine', part: 'dev', icon: 'bolt',
    title: { en: 'Core engine', fr: 'Moteur central' },
    blurb: { en: 'Hashing, integrity, caching and I/O throttling.', fr: 'Hachage, intégrité, cache et limitation d’E/S.' },
    articles: [
      devArticle('blake3-hashing', { en: 'BLAKE3 hashing', fr: 'Hachage BLAKE3' }, { en: 'The fast content hash behind change detection and integrity.', fr: 'Le hachage de contenu rapide derrière la détection de changement et l’intégrité.' }, 'blake3 hash sha checksum'),
      devArticle('integrity-engine', { en: 'Integrity engine', fr: 'Moteur d’intégrité' }, { en: 'How every file is verified before it reaches your game.', fr: 'Comment chaque fichier est vérifié avant d’atteindre le jeu.' }, 'integrity verify corrupt intégrité'),
      devArticle('mtime-cache', { en: 'mtime cache', fr: 'Cache mtime' }, { en: 'Skip re-hashing unchanged files using modification times.', fr: 'Éviter de re-hacher les fichiers inchangés via les dates de modification.' }, 'mtime cache incremental'),
      devArticle('disk-io-limiter', { en: 'Disk I/O limiter', fr: 'Limiteur d’E/S disque' }, { en: 'Keep the app responsive during big copies.', fr: 'Garder l’app réactive pendant les grosses copies.' }, 'io disk throttle limiter'),
      devArticle('semantic-search', { en: 'Semantic search', fr: 'Recherche sémantique' }, { en: 'How the fuzzy/synonym search matches what you mean.', fr: 'Comment la recherche floue/synonymes comprend votre intention.' }, 'search semantic fuzzy synonym'),
    ],
  },
  {
    id: 'sync', part: 'dev', icon: 'db',
    title: { en: 'Data & sync', fr: 'Données et synchro' },
    blurb: { en: 'Profiles, syncing, resumable downloads and updates.', fr: 'Profils, synchro, téléchargements repris et mises à jour.' },
    articles: [
      devArticle('profile-system', { en: 'Profile system', fr: 'Système de profils' }, { en: 'How isolated profiles are modelled and switched.', fr: 'Comment les profils isolés sont modélisés et basculés.' }, 'profile system switch'),
      devArticle('mod-sync', { en: 'Mod sync', fr: 'Synchro des mods' }, { en: 'Reconciling on-disk mods with the index.', fr: 'Réconcilier les mods sur disque avec l’index.' }, 'sync reconcile index'),
      devArticle('resumable-downloads', { en: 'Resumable downloads', fr: 'Téléchargements repris' }, { en: 'How interrupted downloads pick up where they left off.', fr: 'Comment un téléchargement interrompu reprend où il s’est arrêté.' }, 'download resume range'),
      devArticle('update-system', { en: 'Update system', fr: 'Système de mise à jour' }, { en: 'How BMM and mods check for and apply updates.', fr: 'Comment BMM et les mods vérifient et appliquent les mises à jour.' }, 'update version release'),
      devArticle('mod-updates', { en: 'Mod updates', fr: 'Mises à jour des mods' }, { en: 'Detecting and staging new mod versions.', fr: 'Détecter et préparer les nouvelles versions de mods.' }, 'mod update version'),
    ],
  },
  {
    id: 'extend', part: 'dev', icon: 'puzzle',
    title: { en: 'Extending BMM', fr: 'Étendre BMM' },
    blurb: { en: 'Plugins, the API, MCP, custom pages and catalogs.', fr: 'Plugins, API, MCP, pages personnalisées et catalogues.' },
    articles: [
      devArticle('mcp-server', { en: 'MCP server & local API', fr: 'Serveur MCP et API locale' }, { en: 'Drive BMM from scripts or an AI client.', fr: 'Piloter BMM depuis des scripts ou un client IA.' }, 'mcp api plugin automation endpoint', ''),
      devArticle('app-catalog', { en: 'App catalog', fr: 'Catalogue d’applis' }, { en: 'How catalog feeds are fetched and installed.', fr: 'Comment les flux de catalogue sont récupérés et installés.' }, 'catalog feed install'),
      devArticle('launch-packs', { en: 'Launch packs', fr: 'Launch packs' }, { en: 'Bundling a launchable setup.', fr: 'Regrouper une configuration lançable.' }, 'launch pack bundle'),
      devArticle('theme-system', { en: 'Theme system', fr: 'Système de thèmes' }, { en: 'How themes and the editor tokenise the UI.', fr: 'Comment les thèmes et l’éditeur tokenisent l’UI.' }, 'theme editor tokens css'),
      devArticle('one-click-install', { en: 'One-click install', fr: 'Installation en un clic' }, { en: 'The deeplink flow behind install buttons.', fr: 'Le flux deeplink derrière les boutons d’installation.' }, 'deeplink install oneclick'),
    ],
  },
  {
    id: 'ops', part: 'dev', icon: 'server',
    title: { en: 'Deploy & operations', fr: 'Déploiement et exploitation' },
    blurb: { en: 'Hosting, Docker, security, telemetry and reporting.', fr: 'Hébergement, Docker, sécurité, télémétrie et rapports.' },
    articles: [
      devArticle('security-system', { en: 'Security model', fr: 'Modèle de sécurité' }, { en: 'Trust boundaries, path guards and signed payloads.', fr: 'Frontières de confiance, gardes de chemins et charges signées.' }, 'security cwe path signing sécurité', ''),
      devArticle('docker-deployment', { en: 'Docker deployment', fr: 'Déploiement Docker' }, { en: 'Running the community/server pieces in containers.', fr: 'Exécuter les briques communauté/serveur en conteneurs.' }, 'docker deploy container'),
      devArticle('dedicated-hosting', { en: 'Dedicated hosting', fr: 'Hébergement dédié' }, { en: 'How a hosted repo is served.', fr: 'Comment un dépôt hébergé est servi.' }, 'hosting dedicated server'),
      devArticle('hosting-flow', { en: 'Hosting flow', fr: 'Flux d’hébergement' }, { en: 'The end-to-end publish → subscribe path.', fr: 'Le chemin complet publier → s’abonner.' }, 'hosting flow publish subscribe'),
      devArticle('crash-reporting', { en: 'Crash reporting', fr: 'Rapports de plantage' }, { en: 'What a report contains and how it’s built.', fr: 'Ce que contient un rapport et comment il est construit.' }, 'crash report diagnostics'),
      devArticle('discord-rpc', { en: 'Discord RPC', fr: 'Discord RPC' }, { en: 'Rich presence integration.', fr: 'Intégration de la rich presence.' }, 'discord rpc presence'),
      devArticle('betahub-reporting', { en: 'BetaHub reporting', fr: 'Rapports BetaHub' }, { en: 'In-app bug reporting pipeline.', fr: 'Pipeline de signalement de bugs intégré.' }, 'betahub bug report'),
    ],
  },
];

// A compact factory for the Dev "diagram articles": concept intro + open-diagram + full-docs.
// (Depth lives in the diagram itself and the mkdocs site, so these stay short by design.)
function devArticle(diagramId: string, title: L, summary: L, keywords: string, docsPath = '#'): Article {
  return {
    id: diagramId, title, summary, diagram: diagramId, docsPath: docsPath === '#' ? undefined : docsPath, keywords,
    body: {
      en: `<p>${summary.en}</p><p>Open the interactive diagram to explore the flow — pan, zoom and hover each node for a live explanation. For the full technical write-up, see the online documentation.</p>`,
      fr: `<p>${summary.fr}</p><p>Ouvrez le diagramme interactif pour explorer le flux — déplacez, zoomez et survolez chaque nœud pour une explication en direct. Pour l’analyse technique complète, voir la documentation en ligne.</p>`,
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
      <div class="dh-content">${tr(a.body)}</div>
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
