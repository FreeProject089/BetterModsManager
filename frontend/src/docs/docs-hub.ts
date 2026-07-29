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
  view?: string;           // a nav data-view → "Open in BMM" button that jumps to that screen
  keywords?: string;       // extra search terms (any language, space separated)
}
// The displayed label of a live navbar item (custom names + current language), for the
// "Open in BMM" button; falls back to the view id.
function navLabel(view: string): string {
  const el = document.querySelector(`.nav-item[data-view="${view}"] .nav-label`) as HTMLElement | null;
  return (el?.textContent || view).trim();
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
          en: '<p>BetterModsManager (BMM) organises your mods into <b>profiles</b> you can switch between instantly, verifies every file with cryptographic hashing, and lets you share a whole setup with one link. It’s game-agnostic: any game you can mod by placing files can be managed.</p><h4>Why it’s different</h4><ul><li><b>Non-destructive</b> — activating a profile never touches your originals; BMM links or copies as needed, and backs up anything it replaces.</li><li><b>Fast</b> — a native Rust core scans thousands of files in seconds.</li><li><b>Safe</b> — BLAKE3/SHA integrity catches a corrupted download before it reaches your game.</li></ul>'
            + '<h4>The screens, in one glance</h4><ul><li><b>Library</b> — your mods: add, enable/disable, verify, history.</li><li><b>Profiles</b> — one per game setup; switching swaps what’s deployed.</li><li><b>Modpacks</b> — saved recipes of mods to apply in one click.</li><li><b>Mapper</b> — fix mods whose folder shape doesn’t match the game.</li><li><b>Server Repo</b> — subscribe to someone’s repo, or host your own.</li><li><b>.MM Lists</b> — import/export a mod list as a file.</li><li><b>App Catalog / Plugins</b> — install apps, themes and plugins; automate via the API.</li><li><b>Settings</b> — appearance, shortcuts, scheduler, launch packs, privacy, storage.</li></ul><p>Press <kbd>Ctrl/⌘+K</kbd> anywhere to search all of it.</p>',
          fr: '<p>BetterModsManager (BMM) organise vos mods en <b>profils</b> interchangeables en un instant, vérifie chaque fichier par hachage cryptographique et vous permet de partager une configuration complète avec un seul lien. Il est agnostique du jeu : tout jeu moddable en plaçant des fichiers peut être géré.</p><h4>Ce qui le distingue</h4><ul><li><b>Non destructif</b> — activer un profil ne touche jamais vos originaux ; BMM lie ou copie selon le besoin, et sauvegarde ce qu’il remplace.</li><li><b>Rapide</b> — un cœur natif en Rust scanne des milliers de fichiers en quelques secondes.</li><li><b>Sûr</b> — l’intégrité BLAKE3/SHA détecte un téléchargement corrompu avant qu’il n’atteigne le jeu.</li></ul>'
            + '<h4>Les écrans, en un coup d’œil</h4><ul><li><b>Bibliothèque</b> — vos mods : ajouter, activer/désactiver, vérifier, historique.</li><li><b>Profils</b> — un par configuration de jeu ; changer échange ce qui est déployé.</li><li><b>Modpacks</b> — des recettes de mods enregistrées, applicables en un clic.</li><li><b>Mapper</b> — corriger les mods dont l’arborescence ne correspond pas au jeu.</li><li><b>Dépôt Serveur</b> — s’abonner au dépôt de quelqu’un, ou héberger le vôtre.</li><li><b>Listes .MM</b> — importer/exporter une liste de mods en fichier.</li><li><b>App Catalog / Plugins</b> — installer applis, thèmes et plugins ; automatiser via l’API.</li><li><b>Réglages</b> — apparence, raccourcis, planificateur, launch packs, confidentialité, stockage.</li></ul><p>Appuyez sur <kbd>Ctrl/⌘+K</kbd> n’importe où pour chercher dans tout ça.</p>',
        },
      },
      {
        id: 'first-profile', view: 'profiles', tutorial: { id: 'basics', part: 'profiles', step: 's1' }, diagram: 'profile-system',
        title: { en: 'Create your first profile', fr: 'Créer votre premier profil' },
        summary: { en: 'A profile = one game folder + the exact mods enabled in it. Here are the three folders it needs.', fr: 'Un profil = un dossier de jeu + les mods exacts qui y sont activés. Voici les trois dossiers qu’il demande.' },
        keywords: 'profile setup game path mods backup folder create profil dossier',
        // Authored in md-lite (the BCWEB-style directive markdown) — steps + a tip callout.
        body: {
          en: `A **profile** ties one game folder to the exact set of mods you enable in it. Keep a clean
profile, a multiplayer one, and an experimental one side by side — each remembers its own enabled mods.

:::steps
:::step[Open Profiles → New profile]
Go to the **Profiles** screen and click **New profile**.
:::
:::step[Fill in the three folders]
A profile keeps your library, your game, and your safety net in separate places, so you point it at three paths:
- **Game folder** — where the game actually reads its files (this is where enabled mods get deployed).
- **Mods folder** — where BMM keeps this profile's mod library on disk.
- **Backup folder** — where BMM stashes any original file it has to overwrite, so every change is reversible.

Also give it a **name** and a **game name** (the game name is what groups several profiles of the same game together).
:::
:::step[Pick a colour, then create]
Choose a colour and icon and confirm. BMM creates the profile and makes it **active** right away.
:::
:::

:::tip[What switching a profile really does]
Switching the active profile **moves no files** — it only changes which profile you're working in. Mods
you've already enabled **stay deployed** in the game; switching away never undeploys them. The one thing that
touches files is **enabling or disabling a mod** (it copies the files into the game and backs up whatever it
replaces, or removes them again). Your downloaded mods are never edited in place — BMM only links or copies them.
:::`,
          fr: `Un **profil** relie un dossier de jeu à l'ensemble exact des mods que vous y activez. Gardez un profil
propre, un profil multijoueur et un profil expérimental côte à côte — chacun mémorise ses propres mods activés.

:::steps
:::step[Ouvrez Profils → Nouveau profil]
Allez sur l'écran **Profils** et cliquez **Nouveau profil**.
:::
:::step[Renseignez les trois dossiers]
Un profil garde votre bibliothèque, votre jeu et votre filet de sécurité à des endroits distincts ; vous indiquez donc trois chemins :
- **Dossier du jeu** — là où le jeu lit réellement ses fichiers (c'est là que les mods activés sont déployés).
- **Dossier des mods** — là où BMM stocke sur le disque la bibliothèque de mods de ce profil.
- **Dossier de backup** — là où BMM met de côté chaque fichier original qu'il doit écraser, pour que tout changement soit réversible.

Donnez-lui aussi un **nom** et un **nom de jeu** (le nom de jeu regroupe plusieurs profils d'un même jeu).
:::
:::step[Choisissez une couleur, puis créez]
Choisissez une couleur et une icône, puis confirmez. BMM crée le profil et le rend **actif** aussitôt.
:::
:::

:::tip[Ce que fait vraiment le changement de profil]
Changer de profil actif **ne déplace aucun fichier** — ça change seulement le profil dans lequel vous travaillez.
Les mods déjà activés **restent déployés** dans le jeu ; revenir en arrière ne les retire jamais. La seule chose
qui touche aux fichiers, c'est **activer ou désactiver un mod** (ça copie les fichiers dans le jeu et sauvegarde
ce qu'il remplace, ou les retire). Vos mods téléchargés ne sont jamais modifiés sur place — BMM ne fait que les lier ou les copier.
:::`,
        },
      },
      {
        id: 'scan', view: 'library', tutorial: { id: 'basics', part: 'scan', step: 's0' }, diagram: 'mod-sync',
        title: { en: 'Scan & sync your mods', fr: 'Scanner et synchroniser vos mods' },
        summary: { en: 'Let BMM index what you already have and keep it up to date.', fr: 'Laissez BMM indexer ce que vous avez déjà et le tenir à jour.' },
        keywords: 'scan sync index refresh detect scanner',
        body: {
          en: '<p>The first scan reads your mods folder and builds an index — names, versions, sizes and a <b>BLAKE3 content hash</b> per file. That index is what makes everything else fast: conflicts, integrity and sync all read it instead of re-walking the disk.</p><ul><li>Re-scans are <b>incremental</b>: a file whose size and modification time haven’t changed keeps its cached hash (the <i>mtime cache</i>), so re-scanning thousands of files takes seconds.</li><li>Anything unrecognised is listed so you can name or map it.</li><li>The scan is <b>read-only</b> — it never modifies your files.</li><li>Run it any time from the Library (<b>Scan</b> button, or <kbd>Ctrl</kbd>+<kbd>K</kbd> → “scan”); <b>Verify integrity</b> goes further and re-hashes content to catch silent corruption.</li></ul>'
            + '<h4>Adding a mod — the ways in</h4><ul><li><b>Drag &amp; drop</b> a <code>.zip</code>/<code>.7z</code>/<code>.rar</code> archive or a folder straight onto the window.</li><li><b>Add a mod</b> button in the Library (or <kbd>Ctrl</kbd>+<kbd>M</kbd>) → pick an archive or folder.</li><li><b>From a catalog</b> (App Catalog / BetterCommunity) — one click installs it.</li><li><b>From a server repo</b> — subscribe and sync; the mods come with it.</li></ul><p>Example: you download <code>HD-Texture-Pack.zip</code>. Drop it on BMM → it appears in the Library (disabled). <b>Double-click the card</b> (or single-click the toggle) to enable it — see <button type="button" class="dh-xref" data-art="activation">Activate &amp; deactivate mods</button>. If the game acts like it isn’t there, the archive was zipped from the wrong folder — fix it once with the <button type="button" class="dh-xref" data-art="mod-structure">Mapper</button>.</p>',
          fr: '<p>Le premier scan lit votre dossier de mods et construit un index — noms, versions, tailles et un <b>hachage de contenu BLAKE3</b> par fichier. Cet index rend tout le reste rapide : conflits, intégrité et synchro le lisent au lieu de reparcourir le disque.</p><ul><li>Les re-scans sont <b>incrémentaux</b> : un fichier dont la taille et la date de modification n’ont pas changé garde son hachage en cache (le <i>cache mtime</i>) — re-scanner des milliers de fichiers prend quelques secondes.</li><li>Tout élément non reconnu est listé pour le nommer ou le mapper.</li><li>Le scan est en <b>lecture seule</b> — il ne modifie jamais vos fichiers.</li><li>Lancez-le quand vous voulez depuis la Bibliothèque (bouton <b>Scanner</b>, ou <kbd>Ctrl</kbd>+<kbd>K</kbd> → « scan ») ; <b>Vérifier l’intégrité</b> va plus loin et re-hache le contenu pour détecter une corruption silencieuse.</li></ul>'
            + '<h4>Ajouter un mod — les entrées</h4><ul><li><b>Glisser-déposer</b> une archive <code>.zip</code>/<code>.7z</code>/<code>.rar</code> ou un dossier directement sur la fenêtre.</li><li>Bouton <b>Ajouter un mod</b> dans la Bibliothèque (ou <kbd>Ctrl</kbd>+<kbd>M</kbd>) → choisissez une archive ou un dossier.</li><li><b>Depuis un catalogue</b> (App Catalog / BetterCommunity) — un clic l’installe.</li><li><b>Depuis un dépôt serveur</b> — abonnez-vous et synchronisez ; les mods arrivent avec.</li></ul><p>Exemple : vous téléchargez <code>Pack-Textures-HD.zip</code>. Déposez-le sur BMM → il apparaît dans la Bibliothèque (désactivé). <b>Double-cliquez la carte</b> (ou cliquez l’interrupteur) pour l’activer — voir <button type="button" class="dh-xref" data-art="activation">Activer et désactiver des mods</button>. Si le jeu fait comme s’il n’était pas là, l’archive a été zippée depuis le mauvais dossier — corrigez-le une fois avec le <button type="button" class="dh-xref" data-art="mod-structure">Mapper</button>.</p>',
        },
      },
      {
        id: 'staying-updated', diagram: 'update-system',
        title: { en: 'Staying up to date', fr: 'Rester à jour' },
        summary: { en: 'How BMM and your mods keep current — safely.', fr: 'Comment BMM et vos mods restent à jour — en toute sécurité.' },
        keywords: 'update updates version upgrade current mise à jour mettre',
        body: {
          en: '<p>BMM checks for new versions of itself and of any mod with a known source, and only fetches when something actually changed.</p><ul><li><b>Mods</b> — when an update is available BMM stages the new files and lets you review before applying; nothing is forced, and the rest of your profile is untouched.</li><li><b>The app</b> — its own updates are cryptographically <b>signed</b> and checked before installing, so a tampered build can’t sneak in.</li><li>Want it hands-off? The <b>Scheduler</b> can run update checks on a timer.</li></ul><p>Curious how the check works? See <button type="button" class="dh-xref" data-art="update-system">Updates (app &amp; mods)</button>.</p>',
          fr: '<p>BMM vérifie les nouvelles versions de lui-même et de tout mod ayant une source connue, et ne télécharge que si quelque chose a réellement changé.</p><ul><li><b>Les mods</b> — quand une mise à jour est dispo, BMM prépare les nouveaux fichiers et vous laisse vérifier avant d’appliquer ; rien n’est forcé, et le reste du profil n’est pas touché.</li><li><b>L’app</b> — ses propres mises à jour sont <b>signées</b> cryptographiquement et vérifiées avant installation, donc une version altérée ne peut pas se glisser.</li><li>Vous voulez que ce soit automatique ? Le <b>Planificateur</b> peut lancer les vérifs à intervalle régulier.</li></ul><p>Curieux du fonctionnement ? Voir <button type="button" class="dh-xref" data-art="update-system">Mises à jour (app &amp; mods)</button>.</p>',
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
        id: 'mod-structure', tutorial: { id: 'basics', part: 'map' }, diagram: 'mod-mapper', view: 'mapper',
        title: { en: 'How a mod must be structured', fr: 'Comment un mod doit être structuré' },
        summary: { en: 'A mod is a folder that copies the game’s own folder tree — here’s what that means.', fr: 'Un mod est un dossier qui copie l’arborescence du jeu — voici ce que ça veut dire.' },
        keywords: 'structure ovgme folder tree config mapper arborescence dossier configuration store mirror',
        body: {
          en: `<p>BMM applies your mods <b>without ever moving your originals</b> (the same idea as OvGME). The trick that makes that possible: <b>a mod is just a folder that mirrors the game’s own folder tree.</b> Whatever path a file needs inside the game, your mod recreates that exact path — so BMM can lay one straight over the other.</p>
<div class="dh-treecmp">
  <div class="dh-treecol">
    <div class="dh-treecol-h">① The game folder — what your game already has</div>
    <div class="dh-tree-list">
      <div class="dh-fld dh-fld-0"><span class="fi">📁</span> Your Game <small>game root</small></div>
      <div class="dh-fld dh-fld-1"><span class="fi">📁</span> Data</div>
      <div class="dh-fld dh-fld-2"><span class="fi">📁</span> Textures</div>
      <div class="dh-fld dh-fld-3 dh-fld-mut"><span class="fi">📄</span> the game’s own textures…</div>
    </div>
  </div>
  <div class="dh-treecol dh-treecol-accent">
    <div class="dh-treecol-h">② Your mod — the very same shape</div>
    <div class="dh-tree-list">
      <div class="dh-fld dh-fld-0"><span class="fi">📁</span> HD Texture Pack <small>= the mod</small></div>
      <div class="dh-fld dh-fld-1"><span class="fi">📁</span> Data</div>
      <div class="dh-fld dh-fld-2"><span class="fi">📁</span> Textures</div>
      <div class="dh-fld dh-fld-3 dh-fld-hit"><span class="fi">📁</span> HD Texture Pack <small>slots in here</small></div>
    </div>
  </div>
</div>
<div class="dh-treecmp-note">↔ the <code>Data / Textures</code> path is the same on both sides — so your mod drops straight onto the game.</div>
<p class="dh-diagnote">The exact folder names (<code>Data</code>, <code>Textures</code>, …) are whatever <b>your</b> game uses — the rule is simply that your mod recreates that same path, from the game root down.</p>
<h4>Set up a profile per target folder</h4>
<p>Some games read mods from more than one place — often the <b>install folder</b> and a separate <b>user / config folder</b>. Give each one its own profile pointing at that folder.</p>
<p>Each profile also has its own <b>mods folder</b> (the “Configuration → mods folder” line) where BMM stores that profile’s mods.</p>
<h4>When a download has the wrong shape</h4>
<p>Plenty of archives ship the files loose, or zipped one folder too deep, so the parent folders the game expects are missing. Don’t rebuild them by hand — open the <b>Mapper</b>, drag each file to where it belongs, and save. The mapping travels with the mod, so the next install (or a new version with the same layout) is one click.</p>`,
          fr: `<p>BMM applique vos mods <b>sans jamais déplacer vos originaux</b> (le même principe qu’OvGME). L’astuce qui rend ça possible : <b>un mod n’est qu’un dossier qui copie l’arborescence du jeu.</b> Quel que soit le chemin dont un fichier a besoin dans le jeu, votre mod recrée ce chemin exact — BMM peut alors poser l’un directement sur l’autre.</p>
<div class="dh-treecmp">
  <div class="dh-treecol">
    <div class="dh-treecol-h">① Le dossier du jeu — ce que votre jeu a déjà</div>
    <div class="dh-tree-list">
      <div class="dh-fld dh-fld-0"><span class="fi">📁</span> Votre Jeu <small>racine du jeu</small></div>
      <div class="dh-fld dh-fld-1"><span class="fi">📁</span> Data</div>
      <div class="dh-fld dh-fld-2"><span class="fi">📁</span> Textures</div>
      <div class="dh-fld dh-fld-3 dh-fld-mut"><span class="fi">📄</span> les textures d’origine du jeu…</div>
    </div>
  </div>
  <div class="dh-treecol dh-treecol-accent">
    <div class="dh-treecol-h">② Votre mod — exactement la même forme</div>
    <div class="dh-tree-list">
      <div class="dh-fld dh-fld-0"><span class="fi">📁</span> Pack de Textures HD <small>= le mod</small></div>
      <div class="dh-fld dh-fld-1"><span class="fi">📁</span> Data</div>
      <div class="dh-fld dh-fld-2"><span class="fi">📁</span> Textures</div>
      <div class="dh-fld dh-fld-3 dh-fld-hit"><span class="fi">📁</span> Pack de Textures HD <small>se glisse ici</small></div>
    </div>
  </div>
</div>
<div class="dh-treecmp-note">↔ le chemin <code>Data / Textures</code> est identique des deux côtés — votre mod se pose donc directement sur le jeu.</div>
<p class="dh-diagnote">Les noms de dossiers exacts (<code>Data</code>, <code>Textures</code>, …) sont ceux que <b>votre</b> jeu utilise — la règle est simplement que votre mod recrée ce même chemin, depuis la racine du jeu.</p>
<h4>Un profil par dossier cible</h4>
<p>Certains jeux lisent les mods à plusieurs endroits — souvent le <b>dossier d’installation</b> et un <b>dossier utilisateur / config</b> séparé. Donnez à chacun son propre profil pointant sur ce dossier.</p>
<p>Chaque profil a aussi son propre <b>dossier des mods</b> (la ligne « Configuration → dossier des mods ») où BMM stocke les mods de ce profil.</p>
<h4>Quand un téléchargement a la mauvaise forme</h4>
<p>Beaucoup d’archives livrent les fichiers en vrac, ou zippés un dossier trop bas, si bien que les dossiers parents attendus par le jeu manquent. Ne les reconstruisez pas à la main — ouvrez le <b>Mappeur</b>, glissez chaque fichier à sa place, et enregistrez. Le mapping voyage avec le mod : la prochaine installation (ou une nouvelle version au même agencement) se fait en un clic.</p>`,
        },
      },
      {
        id: 'activation', view: 'library', tutorial: { id: 'basics', part: 'activate' }, diagram: 'mod-activation',
        title: { en: 'Activate & deactivate mods', fr: 'Activer et désactiver des mods' },
        summary: { en: 'Toggle mods on or off per profile without moving files by hand.', fr: 'Activez ou désactivez des mods par profil sans déplacer les fichiers à la main.' },
        keywords: 'activate enable disable toggle deploy activer désactiver',
        body: {
          en: '<p>Toggling a mod stages it into the active profile: its files are linked or copied into the game folder, and any game file it replaces is <b>backed up first</b>. BMM tracks exactly which files belong to which mod, so deactivating removes only those — and puts the backed-up originals (or the next mod’s file) back. Cleanly, every time.</p><ul><li>Enable with a single click or a <b>double-click on the card</b>; batch-toggle a whole category, or everything, at once.</li><li>Activation is <b>transactional</b>: an interrupted deploy rolls back instead of leaving a half-state.</li><li>If two enabled mods ship the same file, the one you enabled <b>last</b> wins — see <button class="dh-xref" data-art="conflicts">Conflicts (who wins)</button>.</li></ul><h4>Enabling ≠ switching profiles</h4><p><b>Enabling/disabling a mod is the only thing that moves files.</b> Changing the active profile does not — it just picks which profile you’re working in; whatever is already enabled stays deployed in the game. And profiles that point at the <b>same game + mods folders share their enabled mods</b> (so a mod can’t be enabled in two of them at once); profiles with <i>different</i> folders are fully independent setups.</p>',
          fr: '<p>Activer un mod le met en place dans le profil actif : ses fichiers sont liés ou copiés dans le dossier du jeu, et tout fichier du jeu qu’il remplace est <b>d’abord sauvegardé</b>. BMM sait exactement quels fichiers appartiennent à quel mod : la désactivation ne retire que ceux-là — et remet les originaux sauvegardés (ou le fichier du mod suivant). Proprement, à chaque fois.</p><ul><li>Activez d’un clic ou d’un <b>double-clic sur la carte</b> ; basculez toute une catégorie, ou tout, d’un coup.</li><li>L’activation est <b>transactionnelle</b> : un déploiement interrompu est annulé au lieu de laisser un état incomplet.</li><li>Si deux mods activés fournissent le même fichier, le dernier activé <b>gagne</b> — voir <button class="dh-xref" data-art="conflicts">Conflits (qui gagne)</button>.</li></ul><h4>Activer ≠ changer de profil</h4><p><b>Activer/désactiver un mod est la seule chose qui déplace des fichiers.</b> Changer de profil actif, non — ça choisit juste le profil dans lequel vous travaillez ; ce qui est déjà activé reste déployé dans le jeu. Et les profils qui pointent vers les <b>mêmes dossiers jeu + mods partagent leurs mods activés</b> (un mod ne peut donc pas être activé dans deux d’entre eux à la fois) ; les profils avec des dossiers <i>différents</i> sont des configurations totalement indépendantes.</p>',
        },
      },
      {
        id: 'conflicts', view: 'library', tutorial: { id: 'basics', part: 'conflicts' }, diagram: 'conflict-management',
        title: { en: 'Conflicts (who wins)', fr: 'Conflits (qui gagne)' },
        summary: { en: 'Two mods sharing a file: the one you enable LAST wins. BMM warns you first.', fr: 'Deux mods partageant un fichier : le dernier activé gagne. BMM vous prévient avant.' },
        keywords: 'conflict overwrite order last enable resolve conflit ordre écrase',
        body: {
          en: '<p>Two mods are in <b>conflict</b> when they ship the same file. BMM doesn’t hide it: before it deploys, it detects the overlap and shows you exactly which files two mods share.</p><h4>Who wins?</h4><p>The rule is simple — <b>whichever mod you enable last wins</b>. Its file overwrites the earlier one in the game folder. So your control is the <b>order you enable mods in</b>: enable the one you want to win last.</p><ul><li>BMM warns you when you activate and lists the overlapping files (you can open them to compare).</li><li>Nothing is lost: your original game files are backed up, and if you later disable the winning mod, BMM puts back the file from the next mod that provides it — or the original game file.</li></ul><p>There is <b>no per-file winner picker and no priority list</b> — it’s the enable order, tracked per profile.</p>',
          fr: '<p>Deux mods sont en <b>conflit</b> quand ils fournissent le même fichier. BMM ne le cache pas : avant de déployer, il détecte le chevauchement et vous montre exactement quels fichiers deux mods partagent.</p><h4>Qui gagne ?</h4><p>La règle est simple — <b>le dernier mod que vous activez gagne</b>. Son fichier écrase le précédent dans le dossier du jeu. Votre levier, c’est donc l’<b>ordre dans lequel vous activez les mods</b> : activez en dernier celui qui doit gagner.</p><ul><li>BMM vous avertit à l’activation et liste les fichiers qui se chevauchent (vous pouvez les ouvrir pour comparer).</li><li>Rien n’est perdu : vos fichiers de jeu d’origine sont sauvegardés, et si vous désactivez ensuite le mod gagnant, BMM remet le fichier du mod suivant qui le fournit — ou le fichier de jeu d’origine.</li></ul><p>Il n’y a <b>pas de sélecteur de gagnant par fichier ni de liste de priorité</b> — c’est l’ordre d’activation, mémorisé par profil.</p>',
        },
      },
      {
        id: 'modpacks', view: 'modpacks', tutorial: { id: 'basics', part: 'modpacks' }, diagram: 'modpack-flow',
        title: { en: 'Modpacks', fr: 'Modpacks' },
        summary: { en: 'Bundle a curated set of mods into one shareable pack.', fr: 'Regroupez un ensemble de mods sélectionnés en un pack partageable.' },
        keywords: 'modpack bundle collection pack export import',
        body: {
          en: '<p>A modpack is a saved recipe: a named set of mods, kept in the order and with the choices you picked. Apply it to a profile and BMM enables exactly those mods — nothing else in the profile is touched.</p><ul><li><b>Create</b> one from the Modpacks screen (or capture what you have enabled right now), then <b>quick-apply</b> it to any profile in one click.</li><li><b>Share</b> it — export the pack, or attach it to a server repo so subscribers can pull it; when hosted you choose who may download it (public, or a whitelist).</li><li>A modpack <b>references</b> mods, it doesn’t re-bundle their files — so it stays tiny and always resolves to the current version of each mod.</li></ul>',
          fr: '<p>Un modpack est une recette enregistrée : un ensemble de mods nommé, dans l’ordre et avec les choix que vous avez faits. Appliquez-le à un profil et BMM active exactement ces mods — rien d’autre dans le profil n’est modifié.</p><ul><li><b>Créez</b>-en un depuis l’écran Modpacks (ou capturez ce que vous avez activé maintenant), puis <b>appliquez-le</b> à n’importe quel profil en un clic.</li><li><b>Partagez</b>-le — exportez le pack, ou attachez-le à un dépôt serveur pour que les abonnés le récupèrent ; une fois hébergé, vous choisissez qui peut le télécharger (public ou liste blanche).</li><li>Un modpack <b>référence</b> les mods, il ne re-empaquette pas leurs fichiers — il reste minuscule et pointe toujours vers la version actuelle de chaque mod.</li></ul>',
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
        id: 'shared-storage',
        title: { en: 'Shared storage', fr: 'Stockage partagé' },
        summary: { en: 'Keep one copy of a mod on disk, used by many profiles.', fr: 'Gardez une seule copie d’un mod sur le disque, utilisée par plusieurs profils.' },
        keywords: 'shared storage dedupe link space disk stockage partagé espace',
        body: {
          en: '<p>Enable the same mod in three profiles and BMM still keeps <b>one</b> copy of its files on disk — each profile links to that shared copy instead of duplicating it. You get per-profile isolation without paying for it three times in space.</p><ul><li>Deduplication is by <b>content</b>: two mods (or two versions) that contain identical files share the stored bytes.</li><li>Editing or removing a mod in one profile never touches the others — each keeps its own view.</li><li>Open <b>Storage &amp; disk usage</b> in Settings to see how much space this is saving you.</li></ul>',
          fr: '<p>Activez le même mod dans trois profils et BMM ne garde qu’<b>une</b> copie de ses fichiers sur le disque — chaque profil pointe vers cette copie partagée au lieu de la dupliquer. Vous gardez l’isolation par profil sans la payer trois fois en espace.</p><ul><li>La déduplication se fait par <b>contenu</b> : deux mods (ou deux versions) contenant des fichiers identiques partagent les octets stockés.</li><li>Modifier ou supprimer un mod dans un profil ne touche jamais les autres — chacun garde sa propre vue.</li><li>Ouvrez <b>Stockage &amp; espace disque</b> dans les Paramètres pour voir l’espace ainsi économisé.</li></ul>',
        },
      },
      {
        id: 'backups', view: 'profiles', diagram: 'backup-system',
        title: { en: 'Backups', fr: 'Sauvegardes' },
        summary: { en: 'Snapshot a profile so you can always roll back.', fr: 'Prenez un instantané d’un profil pour pouvoir toujours revenir en arrière.' },
        keywords: 'backup snapshot restore rollback safety sauvegarde restaurer',
        body: {
          en: '<p>Every profile has a <b>backup folder</b> (the third path you set when creating it). Two things use it:</p><ul><li><b>Automatic</b> — whenever deploying a mod would overwrite an existing game file, BMM copies the original into the backup folder first. That’s what makes disabling a mod a clean, exact undo.</li><li><b>Manual snapshots</b> — take a snapshot before a big change; if it goes wrong, restore the profile exactly how it was, mods, order and choices included.</li></ul>',
          fr: '<p>Chaque profil a un <b>dossier de backup</b> (le troisième chemin que vous définissez à sa création). Deux choses l’utilisent :</p><ul><li><b>Automatique</b> — dès que déployer un mod écraserait un fichier de jeu existant, BMM copie d’abord l’original dans le dossier de backup. C’est ce qui fait de la désactivation d’un mod une annulation propre et exacte.</li><li><b>Instantanés manuels</b> — prenez un instantané avant un grand changement ; en cas de problème, restaurez le profil exactement comme il était, mods, ordre et choix compris.</li></ul>',
        },
      },
      {
        id: 'launch-packs', view: 'settings', diagram: 'launch-packs',
        title: { en: 'Launch packs', fr: 'Launch packs' },
        summary: { en: 'Group several apps into one silent, one-click launcher — with its own desktop shortcut.', fr: 'Groupez plusieurs applis en un lanceur silencieux à un clic — avec son propre raccourci bureau.' },
        keywords: 'launch pack apps group launcher shortcut exe start lanceur',
        body: {
          en: '<p>A <b>launch pack</b> is a named group of <b>applications</b> started together in one click — your game plus the companion tools you always open with it (a voice app, a tracker, a head-tracking tool…).</p><ul><li><b>Create</b> one in Settings: name it, then add executables (<code>.exe</code>, <code>.bat</code>, <code>.ps1</code>, <code>.cmd</code>, <code>.lnk</code>) via file picker or the built-in <b>app picker</b> that lists your installed programs, Steam-style. Add a custom icon if you like.</li><li><b>Run</b> it from the card — every app starts <b>silently</b> (no console windows flashing).</li><li>Each pack also gets its own <b>shortcut</b>, so you can launch it straight from the desktop without opening BMM.</li></ul><p>Curious how it’s bundled? See <b>Developer → Launch packs</b>.</p>',
          fr: '<p>Un <b>launch pack</b> est un groupe nommé d’<b>applications</b> lancées ensemble en un clic — votre jeu plus les outils compagnons que vous ouvrez toujours avec (une appli vocale, un tracker, un outil de head-tracking…).</p><ul><li><b>Créez</b>-en un dans les Réglages : nommez-le, puis ajoutez des exécutables (<code>.exe</code>, <code>.bat</code>, <code>.ps1</code>, <code>.cmd</code>, <code>.lnk</code>) via le sélecteur de fichiers ou le <b>sélecteur d’applis</b> intégré qui liste vos programmes installés, façon Steam. Ajoutez une icône si vous voulez.</li><li><b>Lancez</b>-le depuis sa carte — chaque appli démarre <b>silencieusement</b> (aucune fenêtre de console qui clignote).</li><li>Chaque pack reçoit aussi son propre <b>raccourci</b>, pour le lancer depuis le bureau sans ouvrir BMM.</li></ul><p>Curieux de l’assemblage ? Voir <b>Développeur → Launch packs</b>.</p>',
        },
      },
    ],
  },
  {
    id: 'share', part: 'user', icon: 'share',
    title: { en: 'Sharing & hosting', fr: 'Partage et hébergement' },
    blurb: { en: 'Host a repo, subscribe & sync, catalogs and BetterCommunity.', fr: 'Héberger un dépôt, s’abonner & synchro, catalogues et BetterCommunity.' },
    articles: [
      {
        id: 'server-host', view: 'repo', diagram: 'hosting-flow', docsPath: '',
        title: { en: 'Host your own repository', fr: 'Héberger votre propre dépôt' },
        summary: { en: 'Turn a profile into a hosted source others can subscribe to.', fr: 'Transformez un profil en source hébergée à laquelle d’autres peuvent s’abonner.' },
        keywords: 'server repo host publish self-host manifest hosting dépôt héberger squadron',
        body: {
          en: '<p>Hosting turns a profile into a <b>source of truth</b> others subscribe to — a squadron, a community, or just keeping your own machines identical.</p>'
            + '<h4>What BMM builds</h4><ul><li>A <b>manifest</b> (<code>repo.json</code>) listing every file with its <b>SHA-256</b> hash (plus 4&nbsp;MB chunk hashes, for efficient updates).</li><li>A cryptographic <b>signature</b> tied to your identity (an author id + ed25519 signature), so subscribers can confirm a repo really came from you.</li></ul>'
            + '<h4>Serving it</h4><p>Open <b>Server Repo</b> and pick the profile to share. Then either run BMM’s <b>built-in mini-server</b>, or generate a small standalone server (Node, or a <code>.bat</code>/<code>.sh</code> script) to run on a dedicated machine. Serve it over HTTP — <b>HTTPS is strongly recommended</b>. Hand out the resulting link.</p>'
            + '<h4>Who can download it</h4><p>A self-hosted repo is <b>public by default</b>. You can restrict it two ways: a <b>whitelist / ban list</b>, matched automatically against a subscriber’s linked account or device identity; and an optional <b>download password</b> — set it when generating the server, and subscribers are asked for it the first time they connect (BMM remembers it for later syncs). Leave it blank for an open repo. Keep this separate from the <b>admin password</b>, which protects only <b>your</b> server’s admin panel (pushing new versions) and is not a subscriber gate.</p>'
            + '<h4>BetterCommunity is different</h4><p>The BetterCommunity hub adds things a repo you host yourself does <b>not</b> have: a <code>BCR-XXXX-XXXX</code> repo fingerprint, account-based (email / password) access, and managed hosting. Don’t confuse the two.</p>',
          fr: '<p>Héberger transforme un profil en <b>source de vérité</b> à laquelle d’autres s’abonnent — une escadrille, une communauté, ou juste garder vos propres machines identiques.</p>'
            + '<h4>Ce que BMM construit</h4><ul><li>Un <b>manifeste</b> (<code>repo.json</code>) listant chaque fichier avec son hachage <b>SHA-256</b> (plus des hachages de blocs de 4&nbsp;Mo, pour des mises à jour efficaces).</li><li>Une <b>signature</b> cryptographique liée à votre identité (un author id + signature ed25519), pour que les abonnés confirment qu’un dépôt vient bien de vous.</li></ul>'
            + '<h4>Le servir</h4><p>Ouvrez <b>Dépôt Serveur</b> et choisissez le profil à partager. Puis lancez le <b>mini-serveur intégré</b> de BMM, ou générez un petit serveur autonome (Node, ou un script <code>.bat</code>/<code>.sh</code>) à exécuter sur une machine dédiée. Servez-le en HTTP — <b>le HTTPS est fortement recommandé</b>. Distribuez le lien obtenu.</p>'
            + '<h4>Qui peut le télécharger</h4><p>Un dépôt auto-hébergé est <b>public par défaut</b>. Vous pouvez le restreindre de deux façons : une <b>liste blanche / liste de bannis</b>, comparée automatiquement au compte lié ou à l’identité d’appareil d’un abonné ; et un <b>mot de passe de téléchargement</b> optionnel — définissez-le à la génération du serveur, et les abonnés se le voient demander à la première connexion (BMM le retient pour les synchros suivantes). Laissez-le vide pour un dépôt ouvert. À ne pas confondre avec le <b>mot de passe admin</b>, qui protège seulement le panneau d’admin de <b>votre</b> serveur (pousser de nouvelles versions) et n’est pas une barrière pour les abonnés.</p>'
            + '<h4>BetterCommunity, c’est autre chose</h4><p>Le hub BetterCommunity ajoute des choses qu’un dépôt auto-hébergé n’a <b>pas</b> : une empreinte <code>BCR-XXXX-XXXX</code>, un accès par compte (e-mail / mot de passe), et de l’hébergement géré. Ne confondez pas les deux.</p>',
        },
      },
      {
        id: 'server-sync', view: 'repo', diagram: 'server-mode', docsPath: '',
        title: { en: 'Subscribe & keep in sync', fr: 'S’abonner et rester synchronisé' },
        summary: { en: 'Point BMM at a repo link — get the exact same mods, and only fetch what changes.', fr: 'Pointez BMM sur un lien de dépôt — mêmes mods exacts, et seul ce qui change est téléchargé.' },
        keywords: 'subscribe sync update repo download manifest s’abonner synchro mise à jour',
        body: {
          en: '<p>Subscribing points your BMM at a repo’s link; you get the exact same mods, versions and order as the host, and stay converged as they update.</p>'
            + '<h4>How a sync works</h4><p>Your BMM never blindly re-downloads. It fetches the <b>manifest</b> and compares it to what you already have:</p><ul><li>Unchanged files (same SHA-256) are <b>skipped</b>.</li><li>For a changed file, BMM compares 4&nbsp;MB <b>chunks</b> and Range-fetches only the mismatched ones — so a small change to a 10&nbsp;GB collection costs a few MB.</li><li>Every downloaded file is <b>verified against its SHA-256</b> before it’s deployed.</li></ul>'
            + '<h4>Getting updates</h4><p>BMM spots a new version by comparing the repo’s <b>published version string</b> with what you installed. When it differs, the update checker flags it; applying re-runs the sync above — fetching only what actually changed and removing mods the host dropped.</p>',
          fr: '<p>S’abonner pointe votre BMM sur le lien d’un dépôt ; vous obtenez exactement les mêmes mods, versions et ordre que l’hôte, et restez alignés à mesure qu’il met à jour.</p>'
            + '<h4>Comment marche une synchro</h4><p>Votre BMM ne re-télécharge jamais à l’aveugle. Il récupère le <b>manifeste</b> et le compare à ce que vous avez déjà :</p><ul><li>Les fichiers inchangés (même SHA-256) sont <b>ignorés</b>.</li><li>Pour un fichier modifié, BMM compare les <b>blocs</b> de 4&nbsp;Mo et ne récupère (par Range) que ceux qui diffèrent — un petit changement dans 10&nbsp;Go coûte quelques Mo.</li><li>Chaque fichier téléchargé est <b>vérifié par son SHA-256</b> avant d’être déployé.</li></ul>'
            + '<h4>Recevoir les mises à jour</h4><p>BMM repère une nouvelle version en comparant la <b>chaîne de version publiée</b> du dépôt à celle installée. Quand elle diffère, le vérificateur de mises à jour le signale ; appliquer relance la synchro ci-dessus — en ne récupérant que ce qui a réellement changé et en retirant les mods que l’hôte a supprimés.</p>',
        },
      },
      {
        id: 'repo-admin', view: 'repo', diagram: 'security-system',
        title: { en: 'Repo admin & monitoring', fr: 'Admin et monitoring du dépôt' },
        summary: { en: 'Watch who downloads what, live — and manage your whitelist and bans.', fr: 'Voyez qui télécharge quoi, en direct — et gérez liste blanche et bannissements.' },
        keywords: 'admin monitoring whitelist ban clients downloads dashboard surveiller bannir',
        body: {
          en: '<p>Hosting a repo comes with two host-side tools, both on the <b>Server Repo</b> screen:</p>'
            + '<h4>Monitoring</h4><p>A live table, refreshed every second: each connected client’s IP, creator ID, protocol (<b>Local / LAN / WAN</b>), the file being downloaded with a progress bar and speed, and idle sessions. Totals up top: clients, combined speed, active files. From any row you can <b>whitelist</b> or <b>ban</b> that client in one click. It also aggregates a running standalone server’s <code>monitoring.json</code>, so you see both servers in one place.</p>'
            + '<h4>Whitelist & bans</h4><p>Two managers with search, manual add (by IP and/or creator key), one-click removal, and JSON export. The whitelist has a master <b>on/off</b> switch — off means everyone may download (minus bans); on means only listed identities pass. Changes are pushed to a standalone server through its authenticated <code>/admin</code> endpoints.</p>'
            + '<h4>The generated server’s endpoints</h4><ul><li><code>/dashboard</code> and <code>/monitoring.json</code> — public read-only status.</li><li><code>/admin/data</code>, <code>/admin/update</code>, <code>/admin/logs</code> — gated by the <b>admin password</b> (sent as an Authorization header, compared in constant time).</li></ul>',
          fr: '<p>Héberger un dépôt s’accompagne de deux outils côté hôte, tous deux sur l’écran <b>Dépôt Serveur</b> :</p>'
            + '<h4>Monitoring</h4><p>Un tableau en direct, rafraîchi chaque seconde : IP de chaque client connecté, ID créateur, protocole (<b>Local / LAN / WAN</b>), fichier en cours avec barre de progression et vitesse, et sessions inactives. Totaux en haut : clients, vitesse cumulée, fichiers actifs. Depuis chaque ligne, <b>autorisez</b> (liste blanche) ou <b>bannissez</b> ce client en un clic. Il agrège aussi le <code>monitoring.json</code> d’un serveur autonome en cours d’exécution — les deux serveurs au même endroit.</p>'
            + '<h4>Liste blanche & bannissements</h4><p>Deux gestionnaires avec recherche, ajout manuel (par IP et/ou clé créateur), retrait en un clic et export JSON. La liste blanche a un interrupteur <b>on/off</b> : off = tout le monde peut télécharger (moins les bannis) ; on = seules les identités listées passent. Les changements sont poussés vers un serveur autonome via ses endpoints <code>/admin</code> authentifiés.</p>'
            + '<h4>Les endpoints du serveur généré</h4><ul><li><code>/dashboard</code> et <code>/monitoring.json</code> — état public en lecture seule.</li><li><code>/admin/data</code>, <code>/admin/update</code>, <code>/admin/logs</code> — protégés par le <b>mot de passe admin</b> (envoyé en header Authorization, comparé en temps constant).</li></ul>',
        },
      },
      {
        id: 'catalogs', view: 'apps', diagram: 'app-catalog',
        title: { en: 'Catalogs & BetterCommunity', fr: 'Catalogues et BetterCommunity' },
        summary: { en: 'Browse and install mods, apps and themes from community catalogs.', fr: 'Parcourez et installez mods, applis et thèmes depuis les catalogues.' },
        keywords: 'catalog community bettercommunity browse install apps themes catalogue',
        body: {
          en: '<p>Catalogs are feeds of ready-to-install content — mods, apps, themes and plugins — that BMM reads from a URL. The <b>App Catalog</b> screen browses them; installing is one click (BMM handles the download and, for apps, the setup).</p><ul><li><b>Official</b> catalogs are curated; you can also add a <b>community</b> catalog by URL.</li><li>Install buttons are plain <code>bmm://</code> deeplinks, so a catalog can live on any website — or in the BetterCommunity hub.</li><li>Publish your own through <b>BetterCommunity</b>. Note it’s a separate hosted service from a self-hosted server repo.</li></ul>',
          fr: '<p>Les catalogues sont des flux de contenu prêt à installer — mods, applis, thèmes et plugins — que BMM lit depuis une URL. L’écran <b>App Catalog</b> les parcourt ; l’installation se fait en un clic (BMM gère le téléchargement et, pour les applis, l’installation).</p><ul><li>Les catalogues <b>officiels</b> sont sélectionnés ; vous pouvez aussi ajouter un catalogue <b>communautaire</b> par URL.</li><li>Les boutons d’installation sont de simples deeplinks <code>bmm://</code>, un catalogue peut donc vivre sur n’importe quel site — ou dans le hub BetterCommunity.</li><li>Publiez les vôtres via <b>BetterCommunity</b>. C’est un service hébergé, distinct d’un dépôt serveur auto-hébergé.</li></ul>',
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
        id: 'themes', view: 'settings', diagram: 'theme-system',
        title: { en: 'Themes & appearance', fr: 'Thèmes et apparence' },
        summary: { en: 'Recolour BMM — pick a built-in theme or design and share your own.', fr: 'Recolorez BMM — choisissez un thème intégré ou créez et partagez le vôtre.' },
        keywords: 'theme appearance color dark light editor custom thème apparence couleur',
        body: {
          en: '<p>BMM ships <b>12 built-in themes</b> — dark ones (Default, Sombre, Void, Discord, Spotify, Nord, Glass…) and four light ones (Full White, Brutalist, Clay, Sakura). Switch in <b>Settings → Themes</b>, or make your own.</p>'
            + '<h4>The theme editor</h4><p>Open it from Settings → <b>Open Theme Editor</b>. Four tabs:</p><ul><li><b>Simple</b> — every design token grouped with friendly labels: backgrounds, accent, borders, text, fonts, radii, buttons, effects… An <b>eyedropper</b> lets you click any element in the running app to jump straight to its token. Or pick one colour and let the <b>auto-palette</b> build a coherent theme around it.</li><li><b>+ Elements</b> — inject your own HTML/CSS anywhere (a badge, a banner…), globally or per page.</li><li><b>CSS</b> — full custom CSS for power users, global and per-page.</li><li><b>Installed</b> — manage your themes and browse the <b>theme catalogue</b>.</li></ul><p>Everything previews <b>live</b> and nothing persists until you save — Discard restores what you had.</p>'
            + '<h4>Save, share, import</h4><ul><li><b>Save as…</b> makes it yours; <b>Export</b> writes a shareable <code>.bmmtheme</code> file (a zip with the theme JSON + fonts/assets).</li><li><b>Share</b> copies a <code>bmm://</code> link — the recipient clicks it and the theme installs.</li><li>Light themes get automatic <b>contrast enforcement</b> (real WCAG ratios), so text stays readable even on themes that only change backgrounds.</li></ul><p>Themes are just data — they never touch your mods or profiles. Internals: <b>Developer → Theme system</b>.</p>',
          fr: '<p>BMM livre <b>12 thèmes intégrés</b> — des sombres (Default, Sombre, Void, Discord, Spotify, Nord, Glass…) et quatre clairs (Full White, Brutalist, Clay, Sakura). Changez dans <b>Réglages → Thèmes</b>, ou créez le vôtre.</p>'
            + '<h4>L\'éditeur de thèmes</h4><p>Ouvrez-le depuis Réglages → <b>Ouvrir l\'éditeur de thèmes</b>. Quatre onglets :</p><ul><li><b>Simple</b> — chaque token de design groupé avec des libellés clairs : fonds, accent, bordures, texte, polices, rayons, boutons, effets… Une <b>pipette</b> permet de cliquer n\'importe quel élément de l\'app pour sauter directement à son token. Ou choisissez une seule couleur et laissez l\'<b>auto-palette</b> bâtir un thème cohérent autour.</li><li><b>+ Éléments</b> — injectez votre propre HTML/CSS n\'importe où (un badge, une bannière…), globalement ou par page.</li><li><b>CSS</b> — CSS libre pour utilisateurs avancés, global et par page.</li><li><b>Installés</b> — gérez vos thèmes et parcourez le <b>catalogue de thèmes</b>.</li></ul><p>Tout se prévisualise <b>en direct</b> et rien ne persiste avant d\'enregistrer — Annuler restaure l\'état précédent.</p>'
            + '<h4>Enregistrer, partager, importer</h4><ul><li><b>Enregistrer sous…</b> le rend vôtre ; <b>Exporter</b> écrit un fichier <code>.bmmtheme</code> partageable (un zip avec le JSON du thème + polices/assets).</li><li><b>Partager</b> copie un lien <code>bmm://</code> — le destinataire clique et le thème s\'installe.</li><li>Les thèmes clairs bénéficient d\'un <b>renforcement de contraste</b> automatique (vrais ratios WCAG), le texte reste lisible même sur un thème qui ne change que les fonds.</li></ul><p>Les thèmes ne sont que des données — ils ne touchent jamais vos mods ni vos profils. Détails internes : <b>Développeur → Système de thèmes</b>.</p>',
        },
      },
      {
        id: 'plugins', view: 'plugins', diagram: 'mcp-server', docsPath: '',
        title: { en: 'Plugins & the API', fr: 'Plugins et API' },
        summary: { en: 'Add features BMM doesn’t ship — and automate it from scripts or an AI assistant.', fr: 'Ajoutez des fonctions que BMM ne fournit pas — et automatisez-le depuis des scripts ou une IA.' },
        keywords: 'plugin api mcp automation script install extend plugins étendre',
        body: {
          en: '<p>Not everything is built in — and it doesn’t have to be. The <b>Plugins &amp; API</b> screen lets you install plugins that add new features, and add plugin sources so you can find more.</p><ul><li><b>Install a plugin</b> from a catalog or a file; enable or disable it any time.</li><li>Power users: BMM also exposes a <b>local API</b> and an <b>MCP server</b>, so scripts — or an AI assistant — can drive it (scan, activate, build packs…).</li></ul><p>Curious how that works? See <b>Developer → MCP server &amp; local API</b>, or the full endpoint reference in the online docs.</p>',
          fr: '<p>Tout n’est pas intégré — et ça n’a pas à l’être. L’écran <b>Plugins &amp; API</b> vous laisse installer des plugins qui ajoutent des fonctions, et ajouter des sources de plugins pour en trouver d’autres.</p><ul><li><b>Installez un plugin</b> depuis un catalogue ou un fichier ; activez-le ou désactivez-le quand vous voulez.</li><li>Utilisateurs avancés : BMM expose aussi une <b>API locale</b> et un <b>serveur MCP</b>, pour que des scripts — ou une IA — le pilotent (scanner, activer, construire des packs…).</li></ul><p>Curieux du fonctionnement ? Voir <b>Développeur → Serveur MCP et API locale</b>, ou la référence complète des endpoints dans la doc en ligne.</p>',
        },
      },
      {
        id: 'custom-pages',
        title: { en: 'Custom pages', fr: 'Pages personnalisées' },
        summary: { en: 'Add your own sandboxed pages to the navbar.', fr: 'Ajoutez vos propres pages sandbox à la barre de navigation.' },
        keywords: 'custom pages navbar bmmpage sandbox pages personnalisées',
        body: {
          en: '<p>Build a sandboxed <code>bmmpage://</code> page — a mini app inside BMM — and pin it to the navbar. Each page only gets the permissions you grant it, so it can’t reach anything you didn’t allow. Great for a personal dashboard, a launcher, or a tool the community shares.</p><p>Curious how the sandbox works? See <b>Developer → Extending BMM</b>.</p>',
          fr: '<p>Créez une page <code>bmmpage://</code> en sandbox — une mini-application dans BMM — et épinglez-la à la barre de navigation. Chaque page n’obtient que les permissions que vous accordez, elle ne peut donc rien atteindre que vous n’avez pas autorisé. Idéal pour un tableau de bord perso, un lanceur, ou un outil partagé par la communauté.</p><p>Curieux du fonctionnement du sandbox ? Voir <b>Développeur → Étendre BMM</b>.</p>',
        },
      },
      {
        id: 'translate-bmm', view: 'settings', diagram: 'i18n-system',
        title: { en: 'Translate BMM (add a language)', fr: 'Traduire BMM (ajouter une langue)' },
        summary: { en: 'Create, edit and share a full translation — no rebuild, no coding.', fr: 'Créez, éditez et partagez une traduction complète — sans recompilation, sans coder.' },
        keywords: 'translate language translation locale sandbox import traduire langue traduction',
        body: {
          en: '<p>BMM’s languages are plain JSON files in the app’s <code>Lang/</code> folder — adding one requires <b>no rebuild</b>. Everything you need is in <b>Settings → Language</b>: a <b>Guide</b>, a downloadable <b>template</b>, an <b>Import</b> button, and the <b>Translation Sandbox</b>.</p>'
            + '<h4>The comfortable way: the Translation Sandbox</h4><ul><li><b>Create new language</b> — give it a code (e.g. <code>de</code>, <code>pt-br</code>) and optionally seed it from an existing language.</li><li>Translate key by key with a searchable list, a <b>progress bar</b>, a “<b>next missing</b>” jump, and side-by-side reference from other languages.</li><li>Preview any string <b>live</b> — as a toast, a tooltip, or swapped into the real UI.</li><li><b>Pick from screen</b>: click any text in BMM to jump straight to its key; a scanner also finds hardcoded strings.</li><li>Edits auto-save to the sandbox (never the live app); <b>Export</b> downloads the finished JSON, then import it to make it live.</li></ul>'
            + '<h4>Good to know</h4><ul><li>Keep the <code>_info</code> block (name + flag — it’s what the language picker shows) and the <code>_synonyms</code> groups (they power semantic search in your language).</li><li><b>French is the base</b>: a key you haven’t translated falls back to FR; a key missing everywhere shows its raw id — easy to spot.</li><li>Share your language as the JSON file, or via a <code>bmm://</code> import link. <code>en</code>, <code>fr</code> and the template can’t be deleted.</li></ul>',
          fr: '<p>Les langues de BMM sont de simples fichiers JSON dans le dossier <code>Lang/</code> de l’app — en ajouter une ne demande <b>aucune recompilation</b>. Tout est dans <b>Réglages → Langue</b> : un <b>Guide</b>, un <b>modèle</b> téléchargeable, un bouton <b>Importer</b>, et le <b>Bac à sable de traduction</b>.</p>'
            + '<h4>La voie confortable : le Bac à sable de traduction</h4><ul><li><b>Créer une nouvelle langue</b> — donnez-lui un code (ex. <code>de</code>, <code>pt-br</code>) et amorcez-la éventuellement depuis une langue existante.</li><li>Traduisez clé par clé avec une liste cherchable, une <b>barre de progression</b>, un saut « <b>prochaine manquante</b> », et la référence des autres langues côte à côte.</li><li>Prévisualisez chaque texte <b>en direct</b> — en toast, en infobulle, ou substitué dans la vraie UI.</li><li><b>Choisir à l’écran</b> : cliquez n’importe quel texte de BMM pour sauter à sa clé ; un scanner trouve aussi les textes en dur.</li><li>Les éditions s’enregistrent dans le bac à sable (jamais l’app en direct) ; <b>Exporter</b> télécharge le JSON fini — importez-le ensuite pour l’activer.</li></ul>'
            + '<h4>Bon à savoir</h4><ul><li>Conservez le bloc <code>_info</code> (nom + drapeau — c’est ce qu’affiche le sélecteur) et les groupes <code>_synonyms</code> (ils alimentent la recherche sémantique dans votre langue).</li><li><b>Le français est la base</b> : une clé non traduite retombe sur le FR ; une clé absente partout affiche son id brut — facile à repérer.</li><li>Partagez votre langue en fichier JSON, ou via un lien d’import <code>bmm://</code>. <code>en</code>, <code>fr</code> et le modèle ne peuvent pas être supprimés.</li></ul>',
        },
      },
      {
        id: 'command-palette', view: 'settings',
        title: { en: 'Command palette & shortcuts', fr: 'Palette de commandes et raccourcis' },
        summary: { en: 'Press Ctrl/⌘+K to jump anywhere or run any action — and rebind every shortcut.', fr: 'Ctrl/⌘+K pour aller partout ou lancer n’importe quelle action — et réassignez chaque raccourci.' },
        keywords: 'palette command ctrl k shortcut keyboard search rebind raccourci clavier recherche',
        body: {
          en: '<p>Press <kbd>Ctrl/⌘ + K</kbd> anywhere in BMM to open the <b>command palette</b> — one search box over every page and action. Start typing, use ↑/↓ and <kbd>Enter</kbd> to run.</p>'
            + '<h4>What it can reach</h4><ul><li><b>Go to</b> any screen — including your own <b>custom navbar pages</b> (they show up automatically, so a page you pinned yesterday is searchable today).</li><li><b>Run actions</b> across the app: add a mod, scan, verify integrity, create/import a profile, sync or host a server repo, generate a server, check for updates, open storage or hashing stats, and more.</li><li>Two search modes: <b>Classic</b> (literal match) and <b>Semantic</b>, which expands your words through synonyms so “update” also finds “upgrade / new version”.</li></ul>'
            + '<h4>Rebind anything</h4><p>The same actions are listed in <b>Settings → Keyboard shortcuts</b>, where you can record a new key combo, reset to default, or clear a shortcut. Custom nav pages appear here too, so you can bind a hotkey straight to one. Combos with a modifier (Ctrl/Shift/Alt) are recommended so they don’t clash with typing.</p>',
          fr: '<p>Appuyez sur <kbd>Ctrl/⌘ + K</kbd> n’importe où dans BMM pour ouvrir la <b>palette de commandes</b> — une seule barre de recherche sur toutes les pages et actions. Tapez, utilisez ↑/↓ et <kbd>Entrée</kbd> pour exécuter.</p>'
            + '<h4>Ce qu’elle atteint</h4><ul><li><b>Aller à</b> n’importe quel écran — y compris vos <b>pages de navbar personnalisées</b> (elles apparaissent automatiquement : une page épinglée hier est cherchable aujourd’hui).</li><li><b>Lancer des actions</b> partout : ajouter un mod, scanner, vérifier l’intégrité, créer/importer un profil, synchroniser ou héberger un dépôt serveur, générer un serveur, vérifier les mises à jour, ouvrir le stockage ou les stats de hachage, etc.</li><li>Deux modes : <b>Classique</b> (correspondance littérale) et <b>Sémantique</b>, qui étend vos mots via des synonymes — « mise à jour » trouve aussi « upgrade / nouvelle version ».</li></ul>'
            + '<h4>Tout réassigner</h4><p>Les mêmes actions sont listées dans <b>Réglages → Raccourcis clavier</b>, où vous pouvez enregistrer une nouvelle combinaison, revenir au défaut, ou effacer un raccourci. Les pages perso y figurent aussi, vous pouvez donc en lier une à une touche. Les combinaisons avec un modificateur (Ctrl/Maj/Alt) sont recommandées pour ne pas gêner la saisie.</p>',
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
        id: 'scheduler', view: 'settings', diagram: 'scheduler', docsPath: 'features/scheduler/',
        title: { en: 'Scheduling & automation', fr: 'Planification & automatisation' },
        summary: { en: 'A real automation builder — triggers, conditions, loops and ~60 actions.', fr: 'Un vrai constructeur d’automatisations — déclencheurs, conditions, boucles et ~60 actions.' },
        keywords: 'scheduler cron automate task timer trigger loop condition bmmpa planificateur automatiser boucle',
        body: {
          en: `The **Scheduler** turns BMM into an automation tool: a task pairs a **trigger** (when) with a **workflow** (what) — and workflows can branch, loop and wait, not just run a flat list.

:::steps
:::step[Pick a trigger]
Every N minutes/hours, daily/weekly/monthly at a time, once, on app start, or manual (you run it).
:::
:::step[Build the workflow]
Add actions (~60 — activate a profile, enable a modpack, sync a repo, benchmark a disk, launch an app…), plus **IF/ELSE**, **LOOP** and **WAIT UNTIL** blocks, with per-run variables so a measured value can drive a later branch.
:::
:::step[Let it run]
While BMM is open a timer fires due tasks. Hit :kbd[▶] **Run now** any time, or **Test run** the unsaved draft.
:::
:::

:::tip[Run even when BMM is closed]
Flip this and the task registers with your OS scheduler, so it fires on time whether or not BMM is open. Deleting it in BMM removes the OS task too.
:::

It can drive [Launch Packs](doc:launch-packs), your [storage](doc:storage-manager) limits and [benchmarks](doc:benchmarks). Share a whole set with **Export/Import .BMMPA** — imports arrive disabled and never register OS tasks on their own. Find it in **Settings → Scheduler**.`,
          fr: `Le **Planificateur** transforme BMM en outil d’automatisation : une tâche associe un **déclencheur** (quand) à un **workflow** (quoi) — et un workflow peut se ramifier, boucler et attendre, pas seulement dérouler une liste plate.

:::steps
:::step[Choisis un déclencheur]
Toutes les N minutes/heures, chaque jour/semaine/mois à une heure, une fois, au démarrage de l’app, ou manuel (tu le lances).
:::
:::step[Construis le workflow]
Ajoute des actions (~60 — activer un profil, appliquer un modpack, synchroniser un dépôt, benchmarker un disque, lancer une app…), plus des blocs **SI/SINON**, **BOUCLE** et **ATTENDRE**, avec des variables par exécution pour qu’une valeur mesurée pilote une branche suivante.
:::
:::step[Laisse-le tourner]
Tant que BMM est ouvert, une minuterie déclenche les tâches dues. Fais :kbd[▶] **Lancer maintenant** à tout moment, ou **Test** sur le brouillon non enregistré.
:::
:::

:::tip[Exécuter même quand BMM est fermé]
Active ça et la tâche s’enregistre auprès du planificateur de l’OS : elle part à l’heure, que BMM soit ouvert ou non. La supprimer dans BMM supprime aussi la tâche OS.
:::

Il peut piloter les [Launch Packs](doc:launch-packs), tes limites de [stockage](doc:storage-manager) et les [benchmarks](doc:benchmarks). Partage tout un jeu avec **Exporter/Importer .BMMPA** — les imports arrivent désactivés et n’enregistrent jamais de tâches OS tout seuls. Dans **Réglages → Planificateur**.`,
        },
      },
      {
        id: 'actions-reference', view: 'plugins', docsPath: 'reference/actions/',
        title: { en: 'Action reference', fr: 'Référence des actions' },
        summary: { en: 'Everything the scheduler and the script generator can do.', fr: 'Tout ce que le planificateur et le générateur de scripts savent faire.' },
        keywords: 'action list catalogue scheduler script generator deeplink endpoint liste catalogue planificateur générateur',
        body: {
          en: `BMM has **two action catalogues**. They overlap in capability but are separate systems — pick by *who runs it*.

:::columns
:::column
**Scheduled-task actions**
Steps inside a workflow BMM runs by itself on a trigger. Grouped as: mods & profiles, repo & sharing, apps & launch, appearance, benchmarks & storage, privacy & recorder, system & flow, logic & maths. Only these have **real nested blocks** (IF / LOOP / WAIT UNTIL) and the storage actions.
:::
:::column
**Script generator actions**
Blocks that emit a script you run *outside* BMM. Adds the full CRUD and read endpoints, process control, raw code, and textual control flow (\`If…\` / \`Else\` / \`End block\`) since a script is flat text.
:::
:::

:::tip[Things worth knowing]
- Scheduled **enable** actions bypass the SHA check — a background run can't stop to ask you.
- *Allow custom commands* is per-task and off by default; it gates only *Run custom command*, not *Open URL* or raw deeplinks.
- A telemetry/recorder **“Full”** switch means *unmasked* — names and paths stop being \`••••\`.
- On repo sync, *delete extra* removes local files the remote doesn't have.
:::

The full list — every action, its parameters and the deeplink/endpoint it emits — is on BMM Docs. See also [Scheduling & automation](doc:scheduler) and [Plugins & API](doc:plugins).`,
          fr: `BMM a **deux catalogues d’actions**. Leurs capacités se recoupent mais ce sont deux systèmes distincts — choisis selon *qui l’exécute*.

:::columns
:::column
**Actions de tâche planifiée**
Des étapes d’un workflow que BMM exécute seul sur un déclencheur. Groupes : mods & profils, dépôt & partage, apps & lancement, apparence, benchmarks & stockage, confidentialité & enregistreur, système & flux, logique & maths. Seules elles ont de **vrais blocs imbriqués** (SI / BOUCLE / ATTENDRE) et les actions de stockage.
:::
:::column
**Actions du générateur de scripts**
Des blocs qui produisent un script lancé *hors* de BMM. S’y ajoutent le CRUD complet et les endpoints de lecture, le contrôle de processus, le code brut, et un contrôle de flux textuel (\`Si…\` / \`Sinon\` / \`Fin de bloc\`) puisqu’un script est du texte plat.
:::
:::

:::tip[Bon à savoir]
- Les actions planifiées d’**activation** contournent le contrôle SHA — une exécution de fond ne peut pas s’arrêter pour te demander.
- *Autoriser les commandes personnalisées* est par tâche et désactivé par défaut ; ça ne verrouille que *Lancer une commande personnalisée*, pas *Ouvrir une URL* ni les deeplinks bruts.
- Un interrupteur **« Complet »** de télémétrie/enregistreur signifie *démasqué* — noms et chemins ne sont plus \`••••\`.
- À la synchro d’un dépôt, *supprimer les extras* efface les fichiers locaux absents du distant.
:::

La liste complète — chaque action, ses paramètres et le deeplink/endpoint émis — est sur BMM Docs. Voir aussi [Planification & automatisation](doc:scheduler) et [Plugins & API](doc:plugins).`,
        },
      },
      {
        id: 'benchmarks', view: 'settings', diagram: 'blake3-hashing',
        title: { en: 'Benchmarks & performance', fr: 'Benchmarks et performances' },
        summary: { en: 'Measure how fast BMM scans, hashes and deploys on your machine.', fr: 'Mesurez la vitesse de scan, de hachage et de déploiement sur votre machine.' },
        keywords: 'benchmark performance speed hash blake3 measure performances vitesse',
        body: {
          en: '<p>The built-in benchmark suite measures the three things BMM does most — <b>scanning</b> a folder, <b>hashing</b> file content (BLAKE3), and <b>copying / deploying</b> — and reports throughput for your actual disk and CPU.</p><ul><li>Run it to compare drives (an SSD vs. a network share), or to sanity-check a sync that felt slow.</li><li>Results stay local — nothing is uploaded.</li><li>Find it in <b>Settings</b>; for the internals, see <b>Developer → BLAKE3 hashing</b>.</li></ul>',
          fr: '<p>La suite de benchmarks intégrée mesure les trois opérations que BMM fait le plus — <b>scanner</b> un dossier, <b>hacher</b> le contenu (BLAKE3) et <b>copier / déployer</b> — et rapporte le débit pour votre disque et votre CPU réels.</p><ul><li>Lancez-la pour comparer des disques (un SSD contre un partage réseau), ou vérifier une synchro qui a semblé lente.</li><li>Les résultats restent locaux — rien n’est envoyé.</li><li>Trouvez-la dans les <b>Réglages</b> ; pour les détails, voir <b>Développeur → Hachage BLAKE3</b>.</li></ul>',
        },
      },
      {
        id: 'storage-manager', view: 'settings', docsPath: 'features/storage/',
        title: { en: 'Storage & disk I/O', fr: 'Stockage & E/S disque' },
        summary: { en: 'Per-disk speed limits, space alerts, and Smart I/O.', fr: 'Limites de vitesse par disque, alertes d’espace, et Smart I/O.' },
        keywords: 'storage disk io space cache ssd hdd throttle smart limit stockage disque espace',
        body: {
          en: `The **Storage Manager** (**Settings → Storage**) shows every disk with a live space breakdown, and controls how hard BMM pushes your drives.

:::tip[Smart I/O — the one to know]
On by default: mod copies use a bounded thread pool with tiny yields so the interface stays smooth. Turn it **off** to saturate every CPU core for maximum speed.
:::

- **Per-disk speed limit** in MB/s (\`0\` = unlimited) — stop a slow HDD or a cloud drive from lagging the whole machine during a big copy.
- **Benchmark a disk** → read/write MB/s plus a suggested limit you can apply in one click.
- **Auto Performance Calibration** benchmarks the disks your profiles use and sets sensible limits for you.
- **Low-space alerts** with warning/critical thresholds colour the per-disk bars before a drive fills.

:::tip[Archived mods save space]
A \`.zip\` / \`.7z\` / \`.rar\` mod stays compressed in your mods folder; BMM extracts it to a temp cache only when needed. There's no "clear cache" button — the OS manages temp.
:::

Automate it from the [Scheduler](doc:scheduler): benchmark a disk, apply a limit, or check free space and branch on the result.`,
          fr: `Le **Gestionnaire de Stockage** (**Réglages → Stockage**) montre chaque disque avec une répartition d’espace en direct, et contrôle jusqu’où BMM sollicite tes disques.

:::tip[Smart I/O — celui à connaître]
Activé par défaut : les copies de mods utilisent un pool de threads borné avec de petites pauses pour garder l’interface fluide. Désactive-le pour saturer tous les cœurs CPU et une vitesse maximale.
:::

- **Limite de vitesse par disque** en Mo/s (\`0\` = illimité) — empêche un HDD lent ou un disque cloud de ralentir toute la machine pendant une grosse copie.
- **Benchmarker un disque** → Mo/s lecture/écriture plus une limite suggérée applicable en un clic.
- **Auto-calibration des performances** benchmarke les disques de tes profils et te fixe des limites raisonnables.
- **Alertes d’espace faible** avec seuils avertissement/critique qui colorent les barres par disque avant saturation.

:::tip[Les mods archivés économisent de la place]
Un mod \`.zip\` / \`.7z\` / \`.rar\` reste compressé dans ton dossier de mods ; BMM ne l’extrait dans un cache temporaire qu’au besoin. Pas de bouton « vider le cache » — l’OS gère le temp.
:::

Automatise-le depuis le [Planificateur](doc:scheduler) : benchmarke un disque, applique une limite, ou vérifie l’espace libre et branche sur le résultat.`,
        },
      },
      {
        id: 'offline', diagram: 'offline-mode',
        title: { en: 'Offline mode', fr: 'Mode hors ligne' },
        summary: { en: 'No connection? BMM pauses online features and keeps everything local working.', fr: 'Pas de connexion ? BMM met en pause les fonctions en ligne et garde tout le local fonctionnel.' },
        keywords: 'offline connection internet network banner hors ligne connexion réseau',
        body: {
          en: '<p>BMM doesn’t just trust the OS “connected” flag — that only says a network interface exists. It <b>probes</b> two lightweight endpoints; if neither answers within 5 seconds, you’re offline.</p><ul><li>A discreet <b>“no connection” banner</b> appears, and network features (repo syncs, catalogs, update checks) pause with a warning toast instead of failing cryptically.</li><li><b>Everything local keeps working</b> — your library, profiles, activation, the mapper, themes. Nothing is removed.</li><li>Recovery is automatic: while offline BMM re-probes every <b>15 seconds</b>, and the banner slides away the moment a probe answers. Online, a 2-minute re-check catches connections that died silently.</li></ul>',
          fr: '<p>BMM ne se fie pas au simple drapeau « connecté » de l’OS — il dit seulement qu’une interface réseau existe. Il <b>sonde</b> deux endpoints légers ; si aucun ne répond sous 5 secondes, vous êtes hors ligne.</p><ul><li>Un <b>bandeau « pas de connexion »</b> discret apparaît, et les fonctions réseau (synchros de dépôts, catalogues, vérifs de mise à jour) se mettent en pause avec un toast d’avertissement au lieu d’échouer cryptiquement.</li><li><b>Tout le local continue de fonctionner</b> — bibliothèque, profils, activation, mapper, thèmes. Rien n’est retiré.</li><li>La reprise est automatique : hors ligne, BMM re-sonde toutes les <b>15 secondes</b>, et le bandeau disparaît dès qu’une sonde répond. En ligne, une re-vérification toutes les 2 minutes attrape les connexions mortes en silence.</li></ul>',
        },
      },
      {
        id: 'privacy-telemetry', view: 'settings', diagram: 'telemetry-pipeline',
        title: { en: 'Privacy & telemetry', fr: 'Confidentialité et télémétrie' },
        summary: { en: 'Strictly opt-in analytics: what’s collected, what never is, and how to export or erase it.', fr: 'Télémétrie strictement opt-in : ce qui est collecté, ce qui ne l’est jamais, et comment l’exporter ou l’effacer.' },
        keywords: 'privacy telemetry analytics gdpr consent data replay confidentialité données rgpd consentement',
        body: {
          en: '<p>Telemetry in BMM is <b>opt-in</b>: until you explicitly accept the consent dialog, <b>nothing is collected at all</b> — and declining also wipes anything previously buffered.</p>'
            + '<h4>If you opt in</h4><ul><li>What’s sent: pages visited, clicks (<b>labels only — never what you type</b>), performance samples, errors, and an anonymous hardware profile. No file paths, no mod contents, no name or e-mail; your identity is an anonymous id.</li><li><b>Session replay</b> (optional, on by default when telemetry is on) records the UI <b>masked</b>: mod names, profile names and paths appear as <code>••••</code>. Unmasking is a separate, explicit toggle.</li><li>Everything buffers to a <b>local file (10 MB cap)</b> first, and is only uploaded as gzip batches over <b>HTTPS</b> — if no endpoint is configured, data never leaves your machine.</li></ul>'
            + '<h4>Your controls (Settings → Privacy)</h4><ul><li>Master toggle plus separate toggles for the 7-day benchmark/extra-hardware report and session replay.</li><li><b>Export</b> the raw buffer as JSON any time.</li><li>See every <b>sent packet</b> (event names and counts only) and request its <b>deletion</b> — honoured within 72 hours.</li></ul>',
          fr: '<p>La télémétrie de BMM est <b>opt-in</b> : tant que vous n’acceptez pas explicitement la boîte de consentement, <b>rien n’est collecté du tout</b> — et refuser efface aussi tout ce qui aurait été mis en tampon.</p>'
            + '<h4>Si vous acceptez</h4><ul><li>Ce qui part : pages visitées, clics (<b>libellés seulement — jamais ce que vous tapez</b>), échantillons de performance, erreurs, et un profil matériel anonyme. Pas de chemins de fichiers, pas de contenu de mods, ni nom ni e-mail ; votre identité est un id anonyme.</li><li>Le <b>replay de session</b> (optionnel, actif par défaut quand la télémétrie l’est) enregistre l’UI <b>masquée</b> : noms de mods, de profils et chemins s’affichent en <code>••••</code>. Le démasquage est un interrupteur séparé et explicite.</li><li>Tout s’accumule d’abord dans un <b>fichier local (plafond 10 Mo)</b>, envoyé uniquement en lots gzip via <b>HTTPS</b> — sans endpoint configuré, les données ne quittent jamais votre machine.</li></ul>'
            + '<h4>Vos contrôles (Réglages → Confidentialité)</h4><ul><li>Interrupteur principal plus des interrupteurs séparés pour le rapport benchmark/matériel étendu (7 jours) et le replay de session.</li><li><b>Exportez</b> le tampon brut en JSON à tout moment.</li><li>Consultez chaque <b>paquet envoyé</b> (noms et comptes d’événements seulement) et demandez sa <b>suppression</b> — honorée sous 72 heures.</li></ul>',
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
        id: 'faq-pat', view: 'settings', docsPath: '',
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
          en: '<p>Space goes to four places, each with its own remedy:</p><ul><li><b>Duplicated mods</b> — enable <b>shared storage</b> so one copy serves every profile, and open <b>Settings → Storage &amp; disk usage</b> to see exactly what each area weighs.</li><li><b>Backups</b> — every overwritten game file lands in your profile’s backup folder. Prune snapshots you no longer need; the automatic per-file backups are cleaned when a mod is disabled.</li><li><b>Caches</b> — the hash cache and extracted-archive cache can be cleared from Settings; they rebuild on demand.</li><li><b>Session recordings</b> — crash/session replays are capped by retention limits you control (default <b>30 sessions / 2&nbsp;GB</b>, in the Crash Reports &amp; Sessions manager). Lower them if space is tight.</li></ul><p>During big deploys BMM also throttles disk I/O so the app stays responsive (see the disk-I/O limiter diagram).</p>',
          fr: '<p>L’espace part dans quatre endroits, chacun avec son remède :</p><ul><li><b>Mods dupliqués</b> — activez le <b>stockage partagé</b> pour qu’une seule copie serve tous les profils, et ouvrez <b>Réglages → Stockage &amp; espace disque</b> pour voir ce que pèse chaque zone.</li><li><b>Sauvegardes</b> — chaque fichier de jeu écrasé atterrit dans le dossier de backup du profil. Supprimez les instantanés devenus inutiles ; les backups automatiques par fichier sont nettoyés à la désactivation d’un mod.</li><li><b>Caches</b> — le cache de hachage et le cache d’archives extraites se vident depuis les Réglages ; ils se reconstruisent à la demande.</li><li><b>Enregistrements de session</b> — les replays de crash/session sont plafonnés par des limites de rétention que vous contrôlez (défaut <b>30 sessions / 2&nbsp;Go</b>, dans le gestionnaire Rapports de plantage &amp; Sessions). Baissez-les si l’espace manque.</li></ul><p>Pendant les gros déploiements, BMM limite aussi les E/S disque pour rester réactif (voir le diagramme du limiteur d’E/S).</p>',
        },
      },
      {
        id: 'faq-deleted-mod', diagram: 'faq-deleted-mod',
        title: { en: 'I deleted a mod by mistake', fr: 'J’ai supprimé un mod par erreur' },
        summary: { en: 'How to recover, and why profiles make this rare.', fr: 'Comment récupérer, et pourquoi les profils rendent cela rare.' },
        keywords: 'deleted recover restore mistake backup supprimé récupérer',
        body: {
          en: '<p>Check these, in order — deleting from a profile rarely removes the only copy:</p><ul><li><b>Another profile still has it?</b> With shared storage, other profiles keep pointing at the same stored copy — re-add it to this profile from the Library.</li><li><b>It came from a server repo?</b> Re-run the sync: the client compares the manifest to your disk and re-downloads exactly the missing files.</li><li><b>You have a snapshot?</b> Restore the profile backup taken before the change.</li><li><b>It replaced game files?</b> Disabling/removing a mod puts the backed-up originals back automatically — your game is never left half-modded.</li></ul><p>The <b>History</b> button in the Library shows recent operations, which helps pin down what happened when.</p>',
          fr: '<p>Vérifiez ceci, dans l’ordre — supprimer d’un profil retire rarement la seule copie :</p><ul><li><b>Un autre profil l’a encore ?</b> Avec le stockage partagé, les autres profils pointent toujours vers la même copie stockée — ré-ajoutez-le à ce profil depuis la Bibliothèque.</li><li><b>Il venait d’un dépôt serveur ?</b> Relancez la synchro : le client compare le manifeste à votre disque et re-télécharge exactement les fichiers manquants.</li><li><b>Vous avez un instantané ?</b> Restaurez la sauvegarde de profil prise avant le changement.</li><li><b>Il remplaçait des fichiers du jeu ?</b> Désactiver/retirer un mod remet automatiquement les originaux sauvegardés — le jeu n’est jamais laissé à moitié moddé.</li></ul><p>Le bouton <b>Historique</b> de la Bibliothèque montre les opérations récentes — utile pour comprendre ce qui s’est passé quand.</p>',
        },
      },
      {
        id: 'faq-crash', diagram: 'crash-reporting',
        title: { en: 'Reporting a crash', fr: 'Signaler un plantage' },
        summary: { en: 'What BMM collects, where reports live, and how to share one.', fr: 'Ce que BMM collecte, où sont les rapports et comment en partager un.' },
        keywords: 'crash report bug log support diagnostics plantage rapport',
        body: {
          en: '<p>On a crash BMM writes a <b>self-contained zip</b> — logs, system info, and the rolling session recording from right before the crash — so a report arrives with enough to reproduce the issue.</p><h4>Where to find and use them</h4><ul><li>Open <b>Settings → Crash Reports &amp; Sessions</b>. The manager lists crash reports and saved sessions.</li><li><b>Analyze</b> opens a report’s metadata, logs and files in-app, and can <b>play the attached session recording</b> so you can watch what happened.</li><li><b>Export</b> copies the zip anywhere (to attach to a bug report); <b>Open</b> jumps to the folder; <b>Delete</b> removes it.</li><li>Reports stay <b>local</b> until you share them. Retention limits (default 30 sessions / 2&nbsp;GB) keep the folder from growing forever.</li></ul><p>The in-app bug reporter can attach a session recording to a BetaHub report — see <b>Developer → BetaHub reporting</b>.</p>',
          fr: '<p>En cas de plantage, BMM écrit un <b>zip autonome</b> — journaux, infos système, et l’enregistrement de session glissant d’avant le crash — pour qu’un rapport arrive avec de quoi reproduire le problème.</p><h4>Où les trouver et les utiliser</h4><ul><li>Ouvrez <b>Réglages → Rapports de plantage &amp; Sessions</b>. Le gestionnaire liste rapports et sessions enregistrées.</li><li><b>Analyser</b> ouvre les métadonnées, journaux et fichiers du rapport dans l’app, et peut <b>rejouer l’enregistrement de session joint</b> pour voir ce qui s’est passé.</li><li><b>Exporter</b> copie le zip où vous voulez (à joindre à un bug report) ; <b>Ouvrir</b> saute au dossier ; <b>Supprimer</b> le retire.</li><li>Les rapports restent <b>locaux</b> tant que vous ne les partagez pas. Des limites de rétention (défaut 30 sessions / 2&nbsp;Go) empêchent le dossier de grossir sans fin.</li></ul><p>Le rapporteur de bugs intégré peut joindre un enregistrement à un rapport BetaHub — voir <b>Développeur → Rapports BetaHub</b>.</p>',
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
      devArticle('code-stack', { en: 'The stack — and why it’s lean', fr: 'La stack — et pourquoi elle est légère' }, { en: 'Tauri shell, a native Rust core and a TypeScript UI — and why that stays small.', fr: 'Coquille Tauri, cœur natif Rust et UI TypeScript — et pourquoi ça reste léger.' }, 'stack rust tauri typescript lightweight memory ram electron', {
        en: '<p>BMM is a <b>Tauri</b> app: the UI is TypeScript running in the OS\'s native webview, and every real operation — scanning, hashing, copying, networking — is a compiled <b>Rust</b> core. The UI never touches the disk directly; it calls the core over a single typed <code>invoke()</code> channel, and all state lives in the core.</p><p>Unlike an Electron app — which bundles a whole copy of Chromium (~150&nbsp;MB) and runs its logic in JavaScript — BMM reuses the OS webview and does the heavy work natively. So it idles at a few dozen MB, runs file operations at native speed, and the UI can reload at any time without losing your session.</p>',
        fr: '<p>BMM est une app <b>Tauri</b> : l\'interface est en TypeScript dans la webview native de l\'OS, et chaque opération réelle — scan, hachage, copie, réseau — est un cœur <b>Rust</b> compilé. L\'interface ne touche jamais le disque directement ; elle appelle le cœur via un unique canal typé <code>invoke()</code>, et tout l\'état vit dans le cœur.</p><p>Contrairement à une app Electron — qui embarque une copie complète de Chromium (~150&nbsp;Mo) et exécute sa logique en JavaScript — BMM réutilise la webview de l\'OS et fait le gros du travail nativement. Il tourne donc au repos à quelques dizaines de Mo, exécute les opérations fichier à vitesse native, et l\'interface peut se recharger sans perdre votre session.</p>',
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
      devArticle('update-system', { en: 'Updates (app & mods)', fr: 'Mises à jour (app & mods)' }, { en: 'How BMM and your mods check for and apply updates.', fr: 'Comment BMM et vos mods vérifient et appliquent les mises à jour.' }, 'update version release mod', {
        en: '<p>Whether it\'s a mod or the app itself, BMM compares the source\'s published version with what you have and only fetches when they differ.</p><ul><li><b>Mods</b> — for each mod with a known source, the new files are <b>staged</b> without disturbing the rest of the profile; you review what changed and apply. Non-destructive, like everything else.</li><li><b>The app</b> — its updates are cryptographically <b>signed</b> and checked before installing, so an intercepted download can\'t slip in a tampered build.</li></ul><p>Every downloaded file is hash-verified before it\'s trusted.</p>',
        fr: '<p>Qu\'il s\'agisse d\'un mod ou de l\'app elle-même, BMM compare la version publiée de la source avec la vôtre et ne télécharge que si elles diffèrent.</p><ul><li><b>Les mods</b> — pour chaque mod ayant une source connue, les nouveaux fichiers sont <b>préparés</b> sans toucher au reste du profil ; vous examinez ce qui change et appliquez. Non destructif, comme le reste.</li><li><b>L\'app</b> — ses mises à jour sont <b>signées</b> cryptographiquement et vérifiées avant installation, donc un téléchargement intercepté ne peut pas glisser une version altérée.</li></ul><p>Chaque fichier téléchargé est vérifié par hachage avant d\'être considéré fiable.</p>',
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
      devArticle('launch-packs', { en: 'Launch packs', fr: 'Launch packs' }, { en: 'How app groups launch silently — the VBScript bridge.', fr: 'Comment les groupes d’applis se lancent en silence — le pont VBScript.' }, 'launch pack apps vbs shortcut silent', {
        en: '<p>A launch pack is an <b>application group</b>. Creating one builds a small folder holding the pack\'s icon (converted to a 256×256 <code>.ico</code>) and a generated <code>launcher.vbs</code> that starts each executable <b>invisibly</b> — no console windows — plus a <code>.lnk</code> shortcut targeting that script, so the pack is launchable from the desktop. The Steam-style app picker scans the Windows registry\'s Uninstall hives and Start-Menu shortcuts to list installed programs, and per-exe icons are extracted lazily. Shortcut names are sanitised against path traversal.</p>',
        fr: '<p>Un launch pack est un <b>groupe d\'applications</b>. Sa création construit un petit dossier contenant l\'icône du pack (convertie en <code>.ico</code> 256×256) et un <code>launcher.vbs</code> généré qui démarre chaque exécutable <b>de façon invisible</b> — aucune fenêtre de console — plus un raccourci <code>.lnk</code> ciblant ce script, pour lancer le pack depuis le bureau. Le sélecteur d\'applis façon Steam scanne les ruches Uninstall du registre Windows et les raccourcis du menu Démarrer, et les icônes par exe sont extraites à la demande. Les noms de raccourcis sont assainis contre la traversée de chemins.</p>',
      }),
      devArticle('theme-system', { en: 'Theme system', fr: 'Système de thèmes' }, { en: 'How themes tokenise the UI — and how you make your own.', fr: 'Comment les thèmes tokenisent l’UI — et comment créer le vôtre.' }, 'theme editor tokens css couleurs', {
        en: '<p>The whole UI is drawn from CSS <b>design tokens</b> — the <code>--bmm-*</code> custom properties defined in one file (<code>tokens.css</code>), which is the <b>official theming surface</b>: backgrounds, borders, accent (with r/g/b channel triplets for tints), semantic colours, text, fonts, spacing, radii, shadows, wallpaper/images, and even animation speed (<code>--bmm-anim-speed: 0</code> disables all animations).</p><p>A theme is a JSON object (<code>id</code>, <code>name</code>, <code>mode: dark|light</code>, a <code>vars</code> map of token overrides, plus optional fonts, assets, per-page CSS, element overrides and HTML swaps), stored under the app data <code>themes/</code> folder; a <code>.bmmtheme</code> file is that JSON zipped with its assets. Built-ins are plain files in a bundled folder — 12 ship today.</p><p>Two runtime mechanisms make ANY theme complete: an inline-style <b>patch observer</b> rewrites hardcoded colours to tokens as the DOM changes, and on light themes a <b>contrast enforcer</b> fixes too-light text against real WCAG ratios (reversible, opt-out). Applying a theme only writes &lt;style&gt; blocks — never source files.</p>',
        fr: '<p>Toute l\'interface est dessinée à partir de <b>tokens</b> CSS — les propriétés <code>--bmm-*</code> définies dans un seul fichier (<code>tokens.css</code>), la <b>surface de thématisation officielle</b> : fonds, bordures, accent (avec triplets r/g/b pour les teintes), couleurs sémantiques, texte, polices, espacements, rayons, ombres, fond d\'écran/images, et même la vitesse d\'animation (<code>--bmm-anim-speed: 0</code> coupe toutes les animations).</p><p>Un thème est un objet JSON (<code>id</code>, <code>name</code>, <code>mode: dark|light</code>, une map <code>vars</code> de tokens, plus optionnellement polices, assets, CSS par page, overrides d\'éléments et swaps HTML), stocké dans le dossier <code>themes/</code> des données de l\'app ; un fichier <code>.bmmtheme</code> est ce JSON zippé avec ses assets. Les intégrés sont de simples fichiers dans un dossier embarqué — 12 aujourd\'hui.</p><p>Deux mécanismes runtime rendent N\'IMPORTE quel thème complet : un <b>observateur de patch</b> réécrit les couleurs en dur vers les tokens au fil du DOM, et sur les thèmes clairs un <b>renforceur de contraste</b> corrige le texte trop clair selon de vrais ratios WCAG (réversible, désactivable). Appliquer un thème n\'écrit que des blocs &lt;style&gt; — jamais les fichiers sources.</p>',
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
      devArticle('i18n-system', { en: 'Translation (i18n) system', fr: 'Système de traduction (i18n)' }, { en: 'External JSON dictionaries, FR fallback, live switching — and how to add a language.', fr: 'Dictionnaires JSON externes, repli FR, bascule en direct — et comment ajouter une langue.' }, 'i18n translation language locale synonym traduction langue', {
        en: '<p>Every UI string resolves through <code>t(key)</code> against per-language JSON files in <code>Lang/</code> — plain key→string maps, loaded from disk at startup. Lookup order: the active language → the <b>French</b> dictionary (FR is the base language) → the raw key itself, so a missing translation is visible instead of silent.</p><ul><li><b>Live switching</b>: changing language re-applies every <code>data-i18n</code> attribute immediately and fires a <code>langChanged</code> event for dynamic modules — no restart.</li><li><b>Adding a language</b> is dropping a new JSON file in <code>Lang/</code>: it appears in the picker (with the name/flag from its <code>_info</code>) without a rebuild.</li><li>Each file can also ship <code>_synonyms</code> groups — they merge across languages to power the <b>semantic search</b> in the palette and the docs.</li></ul>',
        fr: '<p>Chaque texte de l’UI se résout via <code>t(clé)</code> contre des fichiers JSON par langue dans <code>Lang/</code> — de simples maps clé→texte, chargées du disque au démarrage. Ordre de résolution : la langue active → le dictionnaire <b>français</b> (le FR est la langue de base) → la clé brute elle-même, pour qu’une traduction manquante soit visible plutôt que silencieuse.</p><ul><li><b>Bascule en direct</b> : changer de langue ré-applique immédiatement chaque attribut <code>data-i18n</code> et émet un événement <code>langChanged</code> pour les modules dynamiques — sans redémarrage.</li><li><b>Ajouter une langue</b> = déposer un nouveau JSON dans <code>Lang/</code> : elle apparaît dans le sélecteur (avec le nom/drapeau de son <code>_info</code>) sans recompilation.</li><li>Chaque fichier peut aussi fournir des groupes <code>_synonyms</code> — fusionnés entre langues pour alimenter la <b>recherche sémantique</b> de la palette et des docs.</li></ul>',
      }),
      devArticle('docker-deployment', { en: 'Docker deployment', fr: 'Déploiement Docker' }, { en: 'Running the community/server pieces in containers.', fr: 'Exécuter les briques communauté/serveur en conteneurs.' }, 'docker deploy container', {
        en: '<p>The community and server-side pieces (the web hub, repo hosting) run as containers via Docker Compose, so a host can bring the whole stack up reproducibly and update it in place. This is for people self-hosting the infrastructure, not for using BMM itself.</p>',
        fr: '<p>Les briques communauté et côté serveur (le hub web, l\'hébergement de dépôts) tournent en conteneurs via Docker Compose : un hébergeur peut monter toute la stack de façon reproductible et la mettre à jour sur place. C\'est pour ceux qui auto-hébergent l\'infrastructure, pas pour utiliser BMM lui-même.</p>',
      }),
      devArticle('hosting-flow', { en: 'Hosting flow (publish → subscribe)', fr: 'Flux d’hébergement (publier → s’abonner)' }, { en: 'The end-to-end path, and how a hosted repo is served.', fr: 'Le chemin complet, et comment un dépôt hébergé est servi.' }, 'hosting flow publish subscribe dedicated server manifest', {
        en: '<p>Publishing turns a profile into a repo with a <b>manifest</b> (files + their hashes) and access rules. Subscribing points a client at its link; the client diffs the manifest against what it already has, pulls <b>only the difference</b>, and verifies each transferred file by hash — which is why a small update to a huge collection costs a few MB. It then stays in sync as the owner updates. That\'s the whole path, from one person\'s setup to a group running the exact same thing.</p>',
        fr: '<p>Publier transforme un profil en dépôt avec un <b>manifeste</b> (fichiers + leurs hachages) et des règles d\'accès. S\'abonner pointe un client sur son lien ; le client compare le manifeste à ce qu\'il possède, ne tire que la <b>différence</b>, et vérifie chaque fichier transféré par hachage — d\'où le coût de quelques Mo pour une petite mise à jour d\'une énorme collection. Il reste ensuite synchronisé à mesure que le propriétaire met à jour. C\'est tout le chemin, de la configuration d\'une personne à un groupe faisant exactement la même chose.</p>',
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
        <button class="dh-mode ${route.mode === 'classic' ? 'on' : ''}" data-mode="classic" data-tooltip="${tr({ en: 'Exact text match', fr: 'Correspondance exacte' })}">${tr({ en: 'Classic', fr: 'Classique' })}</button>
        <button class="dh-mode ${route.mode === 'semantic' ? 'on' : ''}" data-mode="semantic" data-tooltip="${tr({ en: 'Match meaning & synonyms', fr: 'Sens et synonymes' })}">${tr({ en: 'Semantic', fr: 'Sémantique' })}</button>
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
    a.view ? `<button class="dh-rel dh-rel-open" data-nav="${a.view}">${svg('arrow', 15)} ${tr({ en: 'Open', fr: 'Ouvrir' })} ${navLabel(a.view)} ${tr({ en: 'in BMM', fr: 'dans BMM' })}</button>` : '',
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

  const navBtn = hit('[data-nav]');
  if (navBtn) { const v = navBtn.getAttribute('data-nav'); (document.querySelector(`.nav-item[data-view="${v}"]`) as HTMLElement | null)?.click(); return; }

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
  // Open an article by id alone (category resolved from the id) — used by the
  // bmm://docs/open?article=<id> deeplink so BMM Docs pages can link into the app.
  (window as any).openDocsArticleById = (artId: string) => {
    const f = findArticle(artId);
    if (f) openArticle(f.cat.id, f.art.id); else (window as any).openDocsHome();
  };
  (window as any).openDocsHome = () => { route = { ...route, view: 'hub', catId: undefined, artId: undefined }; showDocs(); paint(); };
  (window as any).openHelpTo = (key: string) => {
    const map = LEGACY_HELP[key];
    if (map) openArticle(map[0], map[1]); else (window as any).openDocsHome();
  };
}
