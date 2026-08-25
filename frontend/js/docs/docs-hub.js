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
import { BMMS_REFERENCE } from './bmms-reference.gen.js';
import { ensureMermaid } from '../ui/lazy-vendor.js';
// The published mkdocs documentation site (see BMM Docs/mkdocs.yml site_url).
const DOCS_SITE = 'https://freeproject089.github.io/BMM-Docs/';
const tr = (s) => (getLang() === 'fr' ? s.fr : s.en);
// The displayed label of a live navbar item (custom names + current language), for the
// "Open in BMM" button; falls back to the view id.
function navLabel(view) {
    const el = document.querySelector(`.nav-item[data-view="${view}"] .nav-label`);
    return (el?.textContent || view).trim();
}
// small inline icon set (stroke, currentColor)
const ICON = {
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
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
};
const svg = (name, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ''}</svg>`;
// ── the documentation content ────────────────────────────────────────────────────
const CATEGORIES = [
    // ═══════════════════════ USER PART ═══════════════════════
    {
        id: 'start', part: 'user', icon: 'rocket',
        title: { en: 'Getting started', fr: 'Prise en main' },
        blurb: { en: 'Install, first launch, and your first profile.', fr: 'Installation, premier lancement et premier profil.' },
        articles: [
            {
                id: 'what-is-bmm', tutorial: { id: 'basics' }, docsPath: 'index/',
                title: { en: 'What is BetterModsManager?', fr: 'Qu’est-ce que BetterModsManager ?' },
                summary: { en: 'A fast, safe mod manager built around profiles, integrity checks and one-click sharing.', fr: 'Un gestionnaire de mods rapide et sûr, bâti autour des profils, des vérifications d’intégrité et du partage en un clic.' },
                keywords: 'bmm overview intro presentation aperçu',
                body: {
                    en: '<p>BetterModsManager (BMM) organises your mods into <b>profiles</b> you can switch between instantly, verifies every file with cryptographic hashing, and lets you share a whole setup with one link. It’s game-agnostic: any game you can mod by placing files can be managed.</p><h4>Why it’s different</h4><ul><li><b>Non-destructive</b> — activating a profile never touches your originals; BMM links or copies as needed, and backs up anything it replaces.</li><li><b>Fast</b> — a native Rust core scans thousands of files in seconds.</li><li><b>Safe</b> — BLAKE3/SHA integrity catches a corrupted download before it reaches your game.</li></ul>'
                        + '<h4>The screens, in one glance</h4><ul><li><b>Library</b> — your mods: add, enable/disable, verify, history.</li><li><b>Profiles</b> — one per game setup; switching swaps what’s deployed.</li><li><b>Modpacks</b> — saved recipes of mods to apply in one click.</li><li><b>Mapper</b> — fix mods whose folder shape doesn’t match the game.</li><li><b>Server Repo</b> — subscribe to someone’s repo, or host your own.</li><li><b>.MM Lists</b> — import/export a mod list as a file.</li><li><b>App Catalog / Plugins</b> — install apps, themes and plugins; automate via the API.</li><li><b>Settings</b> — appearance, shortcuts, scheduler, launch packs, privacy, storage.</li></ul><p>The bell beside <b>Check for Updates</b> keeps every message BMM has shown you — source, time and text — so a toast you missed is still there.</p><p>Press <kbd>Ctrl/⌘+K</kbd> anywhere to search all of it.</p>',
                    fr: '<p>BetterModsManager (BMM) organise vos mods en <b>profils</b> interchangeables en un instant, vérifie chaque fichier par hachage cryptographique et vous permet de partager une configuration complète avec un seul lien. Il est agnostique du jeu : tout jeu moddable en plaçant des fichiers peut être géré.</p><h4>Ce qui le distingue</h4><ul><li><b>Non destructif</b> — activer un profil ne touche jamais vos originaux ; BMM lie ou copie selon le besoin, et sauvegarde ce qu’il remplace.</li><li><b>Rapide</b> — un cœur natif en Rust scanne des milliers de fichiers en quelques secondes.</li><li><b>Sûr</b> — l’intégrité BLAKE3/SHA détecte un téléchargement corrompu avant qu’il n’atteigne le jeu.</li></ul>'
                        + '<h4>Les écrans, en un coup d’œil</h4><ul><li><b>Bibliothèque</b> — vos mods : ajouter, activer/désactiver, vérifier, historique.</li><li><b>Profils</b> — un par configuration de jeu ; changer échange ce qui est déployé.</li><li><b>Modpacks</b> — des recettes de mods enregistrées, applicables en un clic.</li><li><b>Mapper</b> — corriger les mods dont l’arborescence ne correspond pas au jeu.</li><li><b>Dépôt Serveur</b> — s’abonner au dépôt de quelqu’un, ou héberger le vôtre.</li><li><b>Listes .MM</b> — importer/exporter une liste de mods en fichier.</li><li><b>App Catalog / Plugins</b> — installer applis, thèmes et plugins ; automatiser via l’API.</li><li><b>Réglages</b> — apparence, raccourcis, planificateur, launch packs, confidentialité, stockage.</li></ul><p>La cloche à côté de <b>Vérifier les mises à jour</b> conserve chaque message que BMM vous a affiché — source, heure et texte — donc un toast manqué reste consultable.</p><p>Appuyez sur <kbd>Ctrl/⌘+K</kbd> n’importe où pour chercher dans tout ça.</p>',
                },
            },
            {
                id: 'first-profile', docsPath: 'getting-started/first-launch/', view: 'profiles', tutorial: { id: 'basics', part: 'profiles', step: 's1' }, diagram: ['profile-system', 'profile-customization'],
                title: { en: 'Create your first profile', fr: 'Créer votre premier profil' },
                summary: { en: 'A profile = one destination folder + the exact mods enabled in it. Here are the three folders it needs.', fr: 'Un profil = un dossier de destination + les mods exacts qui y sont activés. Voici les trois dossiers qu’il demande.' },
                keywords: 'profile setup game path mods backup folder create profil dossier',
                // Authored in md-lite (the BCWEB-style directive markdown) — steps + a tip callout.
                body: {
                    en: `A **profile** ties one destination folder to the exact set of mods you enable in it. Keep a clean
profile, a multiplayer one, and an experimental one side by side — each remembers its own enabled mods.

:::steps
:::step[Open Profiles → New profile]
Go to the **Profiles** screen and click **New profile**.
:::
:::step[Fill in the three folders]
A profile keeps your library, your game, and your safety net in separate places, so you point it at three paths:
- **Destination folder** — where the game actually reads its files (this is where enabled mods get deployed).
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
                    fr: `Un **profil** relie un dossier de destination à l'ensemble exact des mods que vous y activez. Gardez un profil
propre, un profil multijoueur et un profil expérimental côte à côte — chacun mémorise ses propres mods activés.

:::steps
:::step[Ouvrez Profils → Nouveau profil]
Allez sur l'écran **Profils** et cliquez **Nouveau profil**.
:::
:::step[Renseignez les trois dossiers]
Un profil garde votre bibliothèque, votre jeu et votre filet de sécurité à des endroits distincts ; vous indiquez donc trois chemins :
- **Dossier de destination** — là où le jeu lit réellement ses fichiers (c'est là que les mods activés sont déployés).
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
                id: 'scan', docsPath: 'how-it-works/scanning-cache/', view: 'library', tutorial: { id: 'basics', part: 'scan', step: 's0' }, diagram: ['mod-sync', 'mod-import'],
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
                id: 'staying-updated', docsPath: 'getting-started/install/', diagram: ['update-system', 'app-update'],
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
                id: 'mod-structure', docsPath: 'how-it-works/mapper/', tutorial: { id: 'basics', part: 'map' }, diagram: 'mod-mapper', view: 'mapper',
                title: { en: 'How a mod must be structured', fr: 'Comment un mod doit être structuré' },
                summary: { en: 'A mod is a folder that copies the game’s own folder tree — here’s what that means.', fr: 'Un mod est un dossier qui copie l’arborescence du jeu — voici ce que ça veut dire.' },
                keywords: 'structure ovgme folder tree config mapper arborescence dossier configuration store mirror',
                body: {
                    en: `<p>BMM applies your mods <b>without ever moving your originals</b> (the same idea as OvGME). The trick that makes that possible: <b>a mod is just a folder that mirrors the game’s own folder tree.</b> Whatever path a file needs inside the game, your mod recreates that exact path — so BMM can lay one straight over the other.</p>
<div class="dh-treecmp">
  <div class="dh-treecol">
    <div class="dh-treecol-h">① The destination folder — what your game already has</div>
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
<p>Plenty of archives ship the files loose, or zipped one folder too deep, so the parent folders the game expects are missing. Don’t rebuild them by hand — open the <b>Mapper</b>, drag each file to where it belongs, and save. Nothing moves until you save, and the left pane shows the mod <i>as it will be</i>, so you can stage a dozen changes and check the result first.</p>
<p>Note what saving does: it <b>restructures the mod folder on disk</b>. It is not a mapping table replayed at each deploy, so a new version of the mod with the same wrong layout has to be re-mapped. Restructuring also changes the mod’s content id (unless it ships a <code>bmm.json</code> id) and invalidates its integrity baseline — re-run the check afterwards.</p>`,
                    fr: `<p>BMM applique vos mods <b>sans jamais déplacer vos originaux</b> (le même principe qu’OvGME). L’astuce qui rend ça possible : <b>un mod n’est qu’un dossier qui copie l’arborescence du jeu.</b> Quel que soit le chemin dont un fichier a besoin dans le jeu, votre mod recrée ce chemin exact — BMM peut alors poser l’un directement sur l’autre.</p>
<div class="dh-treecmp">
  <div class="dh-treecol">
    <div class="dh-treecol-h">① Le dossier de destination — ce que votre jeu a déjà</div>
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
<p>Beaucoup d’archives livrent les fichiers en vrac, ou zippés un dossier trop bas, si bien que les dossiers parents attendus par le jeu manquent. Ne les reconstruisez pas à la main — ouvrez le <b>Mappeur</b>, glissez chaque fichier à sa place, et enregistrez. Rien ne bouge avant l’enregistrement, et le volet de gauche montre le mod <i>tel qu’il sera</i> : vous pouvez donc préparer une dizaine de changements et vérifier le résultat d’abord.</p>
<p>À noter, ce que fait l’enregistrement : il <b>restructure le dossier du mod sur le disque</b>. Ce n’est pas une table rejouée à chaque déploiement, donc une nouvelle version du mod au même mauvais agencement doit être re-mappée. La restructuration change aussi l’id de contenu du mod (sauf s’il embarque un id dans <code>bmm.json</code>) et invalide sa baseline d’intégrité — relancez le contrôle ensuite.</p>`,
                },
            },
            {
                id: 'activation', docsPath: 'how-it-works/profiles-activation/', view: 'library', tutorial: { id: 'basics', part: 'activate' }, diagram: 'mod-activation',
                title: { en: 'Activate & deactivate mods', fr: 'Activer et désactiver des mods' },
                summary: { en: 'Toggle mods on or off per profile without moving files by hand.', fr: 'Activez ou désactivez des mods par profil sans déplacer les fichiers à la main.' },
                keywords: 'activate enable disable toggle deploy activer désactiver',
                body: {
                    en: '<p>Toggling a mod stages it into the active profile: its files are linked or copied into the destination folder, and any game file it replaces is <b>backed up first</b>. BMM tracks exactly which files belong to which mod, so deactivating removes only those — and puts the backed-up originals (or the next mod’s file) back. Cleanly, every time.</p><ul><li>Enable with a single click or a <b>double-click on the card</b>; batch-toggle a whole category, or everything, at once.</li><li>Activation is <b>transactional</b>: an interrupted deploy rolls back instead of leaving a half-state.</li><li>If two enabled mods ship the same file, the one you enabled <b>last</b> wins — see <button class="dh-xref" data-art="conflicts">Conflicts (who wins)</button>.</li></ul><h4>Enabling ≠ switching profiles</h4><p><b>Enabling/disabling a mod is the only thing that moves files.</b> Changing the active profile does not — it just picks which profile you’re working in; whatever is already enabled stays deployed in the game. And profiles that point at the <b>same game + mods folders share their enabled mods</b> (so a mod can’t be enabled in two of them at once); profiles with <i>different</i> folders are fully independent setups.</p>',
                    fr: '<p>Activer un mod le met en place dans le profil actif : ses fichiers sont liés ou copiés dans le dossier de destination, et tout fichier du jeu qu’il remplace est <b>d’abord sauvegardé</b>. BMM sait exactement quels fichiers appartiennent à quel mod : la désactivation ne retire que ceux-là — et remet les originaux sauvegardés (ou le fichier du mod suivant). Proprement, à chaque fois.</p><ul><li>Activez d’un clic ou d’un <b>double-clic sur la carte</b> ; basculez toute une catégorie, ou tout, d’un coup.</li><li>L’activation est <b>transactionnelle</b> : un déploiement interrompu est annulé au lieu de laisser un état incomplet.</li><li>Si deux mods activés fournissent le même fichier, le dernier activé <b>gagne</b> — voir <button class="dh-xref" data-art="conflicts">Conflits (qui gagne)</button>.</li></ul><h4>Activer ≠ changer de profil</h4><p><b>Activer/désactiver un mod est la seule chose qui déplace des fichiers.</b> Changer de profil actif, non — ça choisit juste le profil dans lequel vous travaillez ; ce qui est déjà activé reste déployé dans le jeu. Et les profils qui pointent vers les <b>mêmes dossiers jeu + mods partagent leurs mods activés</b> (un mod ne peut donc pas être activé dans deux d’entre eux à la fois) ; les profils avec des dossiers <i>différents</i> sont des configurations totalement indépendantes.</p>',
                },
            },
            {
                id: 'conflicts', docsPath: 'how-it-works/conflicts/', view: 'library', tutorial: { id: 'basics', part: 'conflicts' }, diagram: 'conflict-management',
                title: { en: 'Conflicts (who wins)', fr: 'Conflits (qui gagne)' },
                summary: { en: 'Two mods sharing a file: the one you enable LAST wins. BMM warns you first.', fr: 'Deux mods partageant un fichier : le dernier activé gagne. BMM vous prévient avant.' },
                keywords: 'conflict overwrite order last enable resolve conflit ordre écrase',
                body: {
                    en: '<p>Two mods are in <b>conflict</b> when they ship the same file. BMM doesn’t hide it: before it deploys, it detects the overlap and shows you exactly which files two mods share.</p><h4>Who wins?</h4><p>The rule is simple — <b>whichever mod you enable last wins</b>. Its file overwrites the earlier one in the destination folder. So your control is the <b>order you enable mods in</b>: enable the one you want to win last.</p><ul><li>BMM warns you when you activate and lists the overlapping files (you can open them to compare).</li><li>Nothing is lost: your original game files are backed up, and if you later disable the winning mod, BMM puts back the file from the next mod that provides it — or the original game file.</li></ul><p>There is <b>no per-file winner picker and no priority list</b> — it’s the enable order, tracked per profile.</p>',
                    fr: '<p>Deux mods sont en <b>conflit</b> quand ils fournissent le même fichier. BMM ne le cache pas : avant de déployer, il détecte le chevauchement et vous montre exactement quels fichiers deux mods partagent.</p><h4>Qui gagne ?</h4><p>La règle est simple — <b>le dernier mod que vous activez gagne</b>. Son fichier écrase le précédent dans le dossier de destination. Votre levier, c’est donc l’<b>ordre dans lequel vous activez les mods</b> : activez en dernier celui qui doit gagner.</p><ul><li>BMM vous avertit à l’activation et liste les fichiers qui se chevauchent (vous pouvez les ouvrir pour comparer).</li><li>Rien n’est perdu : vos fichiers de jeu d’origine sont sauvegardés, et si vous désactivez ensuite le mod gagnant, BMM remet le fichier du mod suivant qui le fournit — ou le fichier de jeu d’origine.</li></ul><p>Il n’y a <b>pas de sélecteur de gagnant par fichier ni de liste de priorité</b> — c’est l’ordre d’activation, mémorisé par profil.</p>',
                },
            },
            {
                id: 'dependencies', docsPath: 'how-it-works/dependencies/', view: 'library',
                title: { en: 'Dependencies & conflicts (the tree)', fr: 'Dépendances et conflits (l’arbre)' },
                summary: { en: 'What a mod pulls in, what is missing, and which of them collide — in one tree.',
                    fr: 'Ce qu’un mod entraîne, ce qui manque, et lesquels se percutent — en un seul arbre.' },
                keywords: 'dependency dependencies tree graph missing cycle requires needs conflict dépendance arbre manquant cycle requiert',
                body: {
                    en: '<p>The command palette (<kbd>Ctrl</kbd>+<kbd>K</kbd> → <b>Dependencies &amp; conflicts</b>) draws your library as a <b>tree</b>. Each root is a mod nothing else depends on — what you chose, rather than what came along behind it — with its dependencies underneath, and theirs, to the bottom. On the right of each line: how many other enabled mods share at least one file with it.</p><h4>Three things it refuses to smooth over</h4><ul><li>A dependency <b>nothing provides</b> is drawn in place and marked <i>not installed</i>, and counted in the summary. Leaving it out would make the tree agree with a library that is broken — and it is usually the most useful line on screen.</li><li>A <b>cycle</b> (A needs B needs A) is drawn once and marked, never followed.</li><li>A mod reached by <b>two paths appears under both</b>, the second marked <i>seen above</i>. Deduplicating it would hide that two different things depend on it — exactly what you need before removing it.</li></ul><p><b>Copy as text</b> puts the whole tree on the clipboard in box-drawing form: searchable and quotable in an issue, which a screenshot is not.</p><p>It decides nothing. Which mod wins is still the enable order — see <button class="dh-xref" data-art="conflicts">Conflicts (who wins)</button>. This is the view that shows you the shape of the problem before you act on it.</p>',
                    fr: '<p>La palette de commandes (<kbd>Ctrl</kbd>+<kbd>K</kbd> → <b>Dépendances et conflits</b>) dessine votre bibliothèque en <b>arbre</b>. Chaque racine est un mod dont rien d’autre ne dépend — ce que vous avez choisi, plutôt que ce qui a suivi derrière — avec ses dépendances en dessous, puis les leurs, jusqu’en bas. À droite de chaque ligne : combien d’autres mods activés partagent au moins un fichier avec lui.</p><h4>Trois choses qu’il refuse de lisser</h4><ul><li>Une dépendance que <b>rien ne fournit</b> est dessinée à sa place et marquée <i>non installé</i>, et comptée dans le résumé. L’omettre ferait dire à l’arbre qu’une bibliothèque cassée va bien — et c’est souvent la ligne la plus utile de l’écran.</li><li>Un <b>cycle</b> (A a besoin de B qui a besoin de A) est dessiné une fois et marqué, jamais suivi.</li><li>Un mod atteint par <b>deux chemins apparaît sous les deux</b>, le second marqué <i>déjà vu plus haut</i>. Le dédupliquer cacherait que deux choses différentes en dépendent — précisément ce qu’il faut savoir avant de le retirer.</li></ul><p><b>Copier en texte</b> met tout l’arbre dans le presse-papiers en caractères de dessin de boîte : cherchable et citable dans un ticket, contrairement à une capture.</p><p>Il ne décide rien. Quel mod gagne reste l’ordre d’activation — voir <button class="dh-xref" data-art="conflicts">Conflits (qui gagne)</button>. C’est la vue qui montre la forme du problème avant d’agir.</p>',
                },
            },
            {
                id: 'modpacks', docsPath: 'features/modpacks/', view: 'modpacks', tutorial: { id: 'basics', part: 'modpacks' }, diagram: 'modpack-flow',
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
                id: 'shared-storage', docsPath: 'features/storage/',
                title: { en: 'Shared storage', fr: 'Stockage partagé' },
                summary: { en: 'Keep one copy of a mod on disk, used by many profiles.', fr: 'Gardez une seule copie d’un mod sur le disque, utilisée par plusieurs profils.' },
                keywords: 'shared storage dedupe link space disk stockage partagé espace',
                body: {
                    en: '<p>Enable the same mod in three profiles and BMM still keeps <b>one</b> copy of its files on disk — each profile links to that shared copy instead of duplicating it. You get per-profile isolation without paying for it three times in space.</p><ul><li>Deduplication is by <b>content</b>: two mods (or two versions) that contain identical files share the stored bytes.</li><li>Editing or removing a mod in one profile never touches the others — each keeps its own view.</li><li>Open <b>Storage &amp; disk usage</b> in Settings to see how much space this is saving you.</li></ul>',
                    fr: '<p>Activez le même mod dans trois profils et BMM ne garde qu’<b>une</b> copie de ses fichiers sur le disque — chaque profil pointe vers cette copie partagée au lieu de la dupliquer. Vous gardez l’isolation par profil sans la payer trois fois en espace.</p><ul><li>La déduplication se fait par <b>contenu</b> : deux mods (ou deux versions) contenant des fichiers identiques partagent les octets stockés.</li><li>Modifier ou supprimer un mod dans un profil ne touche jamais les autres — chacun garde sa propre vue.</li><li>Ouvrez <b>Stockage &amp; espace disque</b> dans les Paramètres pour voir l’espace ainsi économisé.</li></ul>',
                },
            },
            {
                id: 'backups', docsPath: 'features/profiles/', view: 'profiles', diagram: 'backup-system',
                title: { en: 'Backups', fr: 'Sauvegardes' },
                summary: { en: 'Snapshot a profile so you can always roll back.', fr: 'Prenez un instantané d’un profil pour pouvoir toujours revenir en arrière.' },
                keywords: 'backup snapshot restore rollback safety sauvegarde restaurer',
                body: {
                    en: '<p>Every profile has a <b>backup folder</b> (the third path you set when creating it). Two things use it:</p><ul><li><b>Automatic</b> — whenever deploying a mod would overwrite an existing game file, BMM copies the original into the backup folder first. That’s what makes disabling a mod a clean, exact undo.</li><li><b>Manual snapshots</b> — take a snapshot before a big change; if it goes wrong, restore the profile exactly how it was, mods, order and choices included.</li></ul>',
                    fr: '<p>Chaque profil a un <b>dossier de backup</b> (le troisième chemin que vous définissez à sa création). Deux choses l’utilisent :</p><ul><li><b>Automatique</b> — dès que déployer un mod écraserait un fichier de jeu existant, BMM copie d’abord l’original dans le dossier de backup. C’est ce qui fait de la désactivation d’un mod une annulation propre et exacte.</li><li><b>Instantanés manuels</b> — prenez un instantané avant un grand changement ; en cas de problème, restaurez le profil exactement comme il était, mods, ordre et choix compris.</li></ul>',
                },
            },
            {
                id: 'launch-packs', docsPath: 'features/launch-packs/', view: 'settings', diagram: 'launch-packs',
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
                id: 'server-host', view: 'repo', diagram: 'hosting-flow', docsPath: 'features/repo/',
                title: { en: 'Host your own repository', fr: 'Héberger votre propre dépôt' },
                summary: { en: 'Turn a profile into a hosted source others can subscribe to.', fr: 'Transformez un profil en source hébergée à laquelle d’autres peuvent s’abonner.' },
                keywords: 'server repo host publish self-host manifest hosting dépôt héberger squadron',
                body: {
                    en: '<p>Hosting turns a profile into a <b>source of truth</b> others subscribe to — a squadron, a community, or just keeping your own machines identical.</p>'
                        + '<h4>What BMM builds</h4><ul><li>A <b>manifest</b> (<code>repo.json</code>) listing every file with its <b>SHA-256</b> hash (plus 4&nbsp;MB chunk hashes, for efficient updates).</li><li>A cryptographic <b>signature</b> tied to your identity (an author id + ed25519 signature), so subscribers can confirm a repo really came from you.</li></ul>'
                        + '<h4>Three ways to produce it</h4><p>They are alternatives, in <b>Server Repo → Host</b>: <b>Full export</b> copies every mod into a folder you upload; <b>Manifest only</b> writes just <code>repo.json</code> for folders already on this machine — one, several, or a set of profiles — copying nothing; <b>Update from the server</b> reads what your server holds — an HTTP directory listing, or SFTP on an SSH machine, where no index has to be published at all — and writes the manifest without pulling the repo back. A layout template (<code>{id}</code>/<code>{path}</code>) lets an existing server keep its own folder shape. Re-running any of them keeps the repo’s identity, re-signs it, and reports what was added, changed and removed.</p><h4>Serving it</h4><p>Open <b>Server Repo</b> and pick what to share. Then either run BMM’s <b>built-in mini-server</b>, or generate a small standalone server (Node, or a <code>.bat</code>/<code>.sh</code> script) to run on a dedicated machine. Serve it over HTTP — <b>HTTPS is strongly recommended</b>. Hand out the resulting link.</p>'
                        + '<h4>Who can download it</h4><p>A self-hosted repo is <b>public by default</b>. You can restrict it two ways: a <b>whitelist / ban list</b>, matched automatically against a subscriber’s linked account or device identity; and an optional <b>download password</b> — set it when generating the server, and subscribers are asked for it the first time they connect (BMM remembers it for later syncs). Leave it blank for an open repo. Keep this separate from the <b>admin password</b>, which protects only <b>your</b> server’s admin panel (pushing new versions) and is not a subscriber gate.</p>'
                        + '<h4>BetterCommunity is different</h4><p>The BetterCommunity hub adds things a repo you host yourself does <b>not</b> have: a <code>BCR-XXXX-XXXX</code> repo fingerprint, account-based (email / password) access, and managed hosting. Don’t confuse the two.</p>',
                    fr: '<p>Héberger transforme un profil en <b>source de vérité</b> à laquelle d’autres s’abonnent — une escadrille, une communauté, ou juste garder vos propres machines identiques.</p>'
                        + '<h4>Ce que BMM construit</h4><ul><li>Un <b>manifeste</b> (<code>repo.json</code>) listant chaque fichier avec son hachage <b>SHA-256</b> (plus des hachages de blocs de 4&nbsp;Mo, pour des mises à jour efficaces).</li><li>Une <b>signature</b> cryptographique liée à votre identité (un author id + signature ed25519), pour que les abonnés confirment qu’un dépôt vient bien de vous.</li></ul>'
                        + '<h4>Trois façons de le produire</h4><p>Ce sont des alternatives, dans <b>Dépôt Serveur → Host</b> : l’<b>export complet</b> copie chaque mod dans un dossier à uploader ; le <b>manifeste seul</b> écrit uniquement <code>repo.json</code> pour des dossiers déjà présents sur cette machine — un, plusieurs, ou un ensemble de profils — sans rien copier ; <b>mettre à jour depuis le serveur</b> lit l’index de votre serveur et écrit le manifeste sans rapatrier le dépôt. Un gabarit de disposition (<code>{id}</code>/<code>{path}</code>) laisse un serveur existant garder sa propre arborescence. Relancer l’une d’elles conserve l’identité du dépôt, le resigne, et rapporte ce qui a été ajouté, modifié et retiré.</p><h4>Le servir</h4><p>Ouvrez <b>Dépôt Serveur</b> et choisissez ce que vous partagez. Puis lancez le <b>mini-serveur intégré</b> de BMM, ou générez un petit serveur autonome (Node, ou un script <code>.bat</code>/<code>.sh</code>) à exécuter sur une machine dédiée. Servez-le en HTTP — <b>le HTTPS est fortement recommandé</b>. Distribuez le lien obtenu.</p>'
                        + '<h4>Qui peut le télécharger</h4><p>Un dépôt auto-hébergé est <b>public par défaut</b>. Vous pouvez le restreindre de deux façons : une <b>liste blanche / liste de bannis</b>, comparée automatiquement au compte lié ou à l’identité d’appareil d’un abonné ; et un <b>mot de passe de téléchargement</b> optionnel — définissez-le à la génération du serveur, et les abonnés se le voient demander à la première connexion (BMM le retient pour les synchros suivantes). Laissez-le vide pour un dépôt ouvert. À ne pas confondre avec le <b>mot de passe admin</b>, qui protège seulement le panneau d’admin de <b>votre</b> serveur (pousser de nouvelles versions) et n’est pas une barrière pour les abonnés.</p>'
                        + '<h4>BetterCommunity, c’est autre chose</h4><p>Le hub BetterCommunity ajoute des choses qu’un dépôt auto-hébergé n’a <b>pas</b> : une empreinte <code>BCR-XXXX-XXXX</code>, un accès par compte (e-mail / mot de passe), et de l’hébergement géré. Ne confondez pas les deux.</p>',
                },
            },
            {
                id: 'server-sync', view: 'repo', diagram: 'server-mode', docsPath: 'how-it-works/sync-repos/',
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
                id: 'server-publish-ssh', view: 'repo', diagram: 'hosting-flow', docsPath: 'features/repo/',
                title: { en: 'Publish & fetch over SSH', fr: 'Publier et r\u00e9cup\u00e9rer par SSH' },
                summary: { en: 'Send the exported folder straight to the server, without a separate file-transfer program.', fr: 'Envoyer le dossier export\u00e9 directement sur le serveur, sans programme de transfert s\u00e9par\u00e9.' },
                keywords: 'ssh sftp publish upload download pull fetch sync mirror password key ppk openssh fingerprint scp winscp filezilla putty puttygen browse remote folder ed25519 rsa ecdsa dsa nistp authorized_keys pem pkcs1 pkcs8 rfc4716 passphrase publier envoyer r\u00e9cup\u00e9rer t\u00e9l\u00e9charger synchroniser mot de passe cl\u00e9 priv\u00e9e publique phrase secr\u00e8te empreinte t\u00e9l\u00e9verser parcourir dossier distant',
                body: {
                    en: '<p>Exporting writes a folder. <b>Publish over SSH</b>, on the same screen, is what puts that folder on the machine that serves it \u2014 no separate file-transfer program, and no half-finished upload that nobody notices.</p>'
                        + '<h4>What you fill in</h4><ul>'
                        + '<li><b>Host, port, user</b> \u2014 the same three things any SSH client asks for. Port defaults to 22.</li>'
                        + '<li><b>Key or password</b> \u2014 two buttons at the top of the panel. A password is what most accounts already have; a key is what a server running <code>PasswordAuthentication no</code> requires. Neither secret is ever stored, so a password is retyped each session.</li>'
                        + '<li><b>Private key</b> \u2014 OpenSSH or PuTTY <code>.ppk</code>, both read as they are. No conversion step. The chooser underneath lists your IDENTITY KEYS: a keyring entry is a name and a path, which is exactly what SFTP needs, so the key a catalogue knows you by can open a shell too. Picking one fills the path field rather than replacing what it means, and the reverse is deliberately not wired \u2014 configuring a server must not silently change which identity BMM presents to catalogues.</li>'
                        + '<li><b>Remote folder</b> \u2014 an absolute path. The repo\u2019s contents land INSIDE it; missing sub-folders are created. <b>Browse\u2026</b> opens the server\u2019s folders so you can pick it instead of typing it \u2014 a mistyped path used to surface as \u201cnot writable\u201d for a directory that simply was not there.</li>'
                        + '<li><b>Passphrase</b> \u2014 only if your key has one. It is used for that upload and never written anywhere.</li></ul>'
                        + '<h4>Test before you publish</h4><p><b>Test the connection</b> does everything an upload does except upload: it authenticates, opens the folder, and writes-then-deletes a probe file. That last part is the one worth having \u2014 a key that logs in fine but lands in a folder it cannot write fails at the END of a multi-gigabyte transfer otherwise.</p>'
                        + '<p>When the probe is refused, the report names the folder\u2019s OWNER and MODE and the account BMM connected as \u2014 \u201c/srv belongs to uid 0:0 with mode rwxr-xr-x, and BMM connected as bob\u201d \u2014 plus the <code>chown</code> line that fixes it. That is almost always the whole story and it is invisible from your side: <code>/srv</code>, <code>/var/www</code> and <code>/opt</code> are root-owned and mode 755 on most distributions, so EVERYONE may list them and only root may create a file in one. Nothing is wrong with your account or your key, which is why \u201cpermission denied\u201d on its own sends people to check the one thing that was never the problem.</p>'
                        + '<h4>What BMM stores, and what it does not</h4><p>Host, port, user, remote folder and the PATH to your key are saved. The key itself never is, and neither is the passphrase. A key copied into BMM\u2019s settings would be a key inside every backup, every settings export and every crash report that attaches them.</p>'
                        + '<h4>The server\u2019s fingerprint</h4><p>The first connection records it. Every later one must match, and a CHANGED fingerprint is refused rather than warned about \u2014 the situation it protects against is exactly the one where a warning gets clicked past. If you genuinely rebuilt the machine, <b>Forget the fingerprint</b> is the deliberate way to accept the new one.</p>'
                        + '<h4>The manifest goes last</h4><p>Files are sent first and <code>repo.json</code> last, on purpose. Subscribers read the manifest and then fetch what it lists, so sending it first would hand everyone syncing during the upload a list of files that do not exist yet. This way the repo is either the old one or the new one.</p>'
                        + '<h4>Which keys work</h4><p>Checked by decoding one of each with the library BMM actually uses. <b>ed25519</b> (prefer this), <b>RSA</b> 3072/4096, and <b>ECDSA</b> on nistp256, nistp384 or nistp521. <b>DSA</b> is out \u2014 OpenSSH removed it and <code>ssh-keygen</code> will not even generate one.</p>'
                        + '<p>The container matters as much as the algorithm, and all of these are read as they are: <code>-----BEGIN OPENSSH PRIVATE KEY-----</code> (what ssh-keygen writes today), <code>PuTTY-User-Key-File-\u2026</code> (a PuTTY/WinSCP <code>.ppk</code>, no conversion needed), <code>-----BEGIN RSA PRIVATE KEY-----</code> (PKCS#1, from <code>ssh-keygen -m PEM</code>), and PKCS#8 \u2014 <code>-----BEGIN PRIVATE KEY-----</code>, <code>-----BEGIN EC PRIVATE KEY-----</code>, or <code>-----BEGIN ENCRYPTED PRIVATE KEY-----</code>.</p>'
                        + '<p>A passphrase-protected key works: type the passphrase beside it. It is used for that connection and never stored \u2014 which is why an unattended run needs a key with <b>no</b> passphrase.</p>'
                        + '<p><b>RSA needs a server newer than OpenSSH 8.8.</b> The legacy <code>ssh-rsa</code> signature is SHA-1 and has been refused by default since then; BMM negotiates <code>rsa-sha2-512</code>/<code>rsa-sha2-256</code> instead. On an older server that offers nothing else, use ed25519.</p>'
                        + '<h4>The public half, on the server</h4><p>BMM only ever reads the PRIVATE key. The public one belongs in <code>~/.ssh/authorized_keys</code> on the server, and it must be the ONE-LINE OpenSSH form \u2014 <code>ssh-ed25519 AAAAC3\u2026 you@machine</code>.</p>'
                        + '<p>PuTTY\u2019s <b>Save public key</b> button writes the RFC4716 block instead (<code>---- BEGIN SSH2 PUBLIC KEY ----</code>), which <code>authorized_keys</code> cannot read: the server rejects the key while every file looks correct. Use the <b>Public key for pasting into OpenSSH authorized_keys</b> box at the top of PuTTYgen, or convert \u2014 <code>ssh-keygen -i -m RFC4716 -f exported.pub</code>. You can also just derive it from the private key you already have: <code>ssh-keygen -y -f ~/.ssh/id_ed25519</code>.</p>'
                        + '<h4>Fetching it back</h4><p><b>Fetch from the server</b> is the same connection in the other direction: it copies the repo the server is actually serving into your export folder. That is what you want when you edit a repo from a second machine, when the local copy is gone, or simply to confirm that what is online is what you think it is.</p>'
                        + '<p>Files of the same name are overwritten by the server\u2019s version; local files the server does not have are LEFT ALONE. Deleting them would let a fetch aimed at the wrong folder destroy something unrelated. It asks before it starts, because the button sits next to <b>Publish</b> and the two read alike at a glance.</p>'
                        + '<h4>Syncing FROM an SSH repo</h4><p>The other side of the same connection: installing mods from a repo that lives on an SSH server rather than behind an HTTP URL. Put <code>ssh://</code> in the sync URL field \u2014 that value carries no host, user or key, because everything about where to connect comes from the target configured here.</p>'
                        + '<p>The rest of the sync screen behaves exactly as it does over HTTP: the profile list, the choices, delta by hash, the update-source checkbox. And because it is only a URL, every entry point inherits it with no new action \u2014 <code>bmm://repo/sync?url=ssh://</code>, the scheduler\u2019s <b>Sync repo</b>, and <code>POST /api/repo/sync</code> with <code>\"url\": \"ssh://\"</code>.</p>'
                        + '<p>Two differences from HTTP. Chunk-level <b>resume</b> is a Range feature and is not used over SFTP, so a file that needs fetching is fetched whole \u2014 the per-file delta that saves the real time still applies, because the sync compares hashes first. And a <b>password</b> source works while this panel is filled in; unattended runs need a key with no passphrase, for the same reason publishing does.</p>'
                        + '<h4>Without opening the screen</h4><p>The scheduler has <b>Publish repo over SSH</b> and <b>Fetch repo over SSH</b>; the deeplinks are <code>bmm://repo/publish-ssh?dir=&lt;folder&gt;</code> and <code>bmm://repo/fetch-ssh?dir=&lt;folder&gt;</code>; the API has <code>POST /api/repo/publish-ssh</code> and <code>POST /api/repo/fetch-ssh</code>. All of them use the target you saved here \u2014 none can name a different host, key or password. That matters most for fetching, which writes to your own disk: a link able to name a host could pull files from a machine of its choosing into a folder of its choosing.</p>'
                        + '<p>Unattended runs need a key with NO passphrase, and cannot use a password at all \u2014 nothing is stored and there is nobody to ask at 04:00, so it fails with a message rather than waiting forever on a prompt no one will ever see.</p>',
                    fr: '<p>L\u2019export \u00e9crit un dossier. <b>Publier par SSH</b>, sur le m\u00eame \u00e9cran, est ce qui d\u00e9pose ce dossier sur la machine qui l\u2019h\u00e9berge \u2014 sans programme de transfert s\u00e9par\u00e9, et sans envoi \u00e0 moiti\u00e9 termin\u00e9 que personne ne remarque.</p>'
                        + '<h4>Ce que vous renseignez</h4><ul>'
                        + '<li><b>H\u00f4te, port, utilisateur</b> \u2014 les trois m\u00eames choses que demande n\u2019importe quel client SSH. Le port vaut 22 par d\u00e9faut.</li>'
                        + '<li><b>Cl\u00e9 ou mot de passe</b> \u2014 deux boutons en haut du panneau. Le mot de passe est ce que la plupart des comptes ont d\u00e9j\u00e0 ; la cl\u00e9 est ce qu\u2019exige un serveur configur\u00e9 avec <code>PasswordAuthentication no</code>. Aucun des deux secrets n\u2019est conserv\u00e9, donc un mot de passe est \u00e0 retaper \u00e0 chaque session.</li>'
                        + '<li><b>Cl\u00e9 priv\u00e9e</b> \u2014 OpenSSH ou PuTTY <code>.ppk</code>, les deux lues telles quelles. Aucune conversion \u00e0 faire. Le s\u00e9lecteur en dessous liste vos CL\u00c9S D\u2019IDENTIT\u00c9 : une entr\u00e9e du trousseau est un nom et un chemin, exactement ce dont SFTP a besoin \u2014 la cl\u00e9 sous laquelle un catalogue vous conna\u00eet peut aussi ouvrir une session. En choisir une remplit le champ du chemin plut\u00f4t que d\u2019en changer le sens, et l\u2019inverse n\u2019est volontairement pas c\u00e2bl\u00e9 \u2014 configurer un serveur ne doit pas modifier en douce l\u2019identit\u00e9 que BMM pr\u00e9sente aux catalogues.</li>'
                        + '<li><b>Dossier distant</b> \u2014 un chemin absolu. Le contenu du d\u00e9p\u00f4t atterrit DEDANS ; les sous-dossiers manquants sont cr\u00e9\u00e9s. <b>Parcourir\u2026</b> ouvre les dossiers du serveur pour le choisir au lieu de le saisir \u2014 un chemin mal tap\u00e9 se manifestait par un \u00ab non inscriptible \u00bb sur un dossier qui n\u2019existait pas.</li>'
                        + '<li><b>Phrase secr\u00e8te</b> \u2014 seulement si votre cl\u00e9 en a une. Elle sert \u00e0 cet envoi et n\u2019est \u00e9crite nulle part.</li></ul>'
                        + '<h4>Testez avant de publier</h4><p><b>Tester la connexion</b> fait tout ce que fait un envoi, sauf envoyer : elle s\u2019authentifie, ouvre le dossier, puis y \u00e9crit et efface un fichier t\u00e9moin. C\u2019est cette derni\u00e8re partie qui compte \u2014 une cl\u00e9 qui se connecte bien mais atterrit dans un dossier o\u00f9 elle ne peut pas \u00e9crire \u00e9choue sinon \u00e0 la FIN d\u2019un transfert de plusieurs gigaoctets.</p>'
                        + '<p>Quand le t\u00e9moin est refus\u00e9, le rapport nomme le PROPRI\u00c9TAIRE et le MODE du dossier ainsi que le compte utilis\u00e9 \u2014 \u00ab\u00a0/srv appartient \u00e0 l\u2019uid 0:0 avec le mode rwxr-xr-x, et BMM s\u2019est connect\u00e9 en tant que bob\u00a0\u00bb \u2014 avec la ligne <code>chown</code> qui corrige. C\u2019est presque toujours toute l\u2019explication, et elle est invisible depuis votre c\u00f4t\u00e9 : <code>/srv</code>, <code>/var/www</code> et <code>/opt</code> appartiennent \u00e0 root en mode 755 sur la plupart des distributions \u2014 TOUT LE MONDE peut les lister, seul root peut y cr\u00e9er un fichier. Ni votre compte ni votre cl\u00e9 n\u2019ont de probl\u00e8me, et c\u2019est bien pourquoi \u00ab\u00a0permission denied\u00a0\u00bb tout seul envoie les gens v\u00e9rifier la seule chose qui n\u2019a jamais \u00e9t\u00e9 en cause.</p>'
                        + '<h4>Ce que BMM enregistre, et ce qu\u2019il n\u2019enregistre pas</h4><p>H\u00f4te, port, utilisateur, dossier distant et le CHEMIN de votre cl\u00e9 sont conserv\u00e9s. La cl\u00e9 elle-m\u00eame, jamais, ni la phrase secr\u00e8te. Une cl\u00e9 copi\u00e9e dans les r\u00e9glages de BMM serait une cl\u00e9 pr\u00e9sente dans chaque sauvegarde, chaque export de r\u00e9glages et chaque rapport de plantage qui les joint.</p>'
                        + '<h4>L\u2019empreinte du serveur</h4><p>La premi\u00e8re connexion l\u2019enregistre. Toutes les suivantes doivent correspondre, et une empreinte QUI CHANGE est refus\u00e9e plut\u00f4t que signal\u00e9e \u2014 la situation contre laquelle elle prot\u00e8ge est justement celle o\u00f9 l\u2019on clique \u00e0 travers un avertissement. Si vous avez r\u00e9ellement reconstruit la machine, <b>Oublier l\u2019empreinte</b> est la fa\u00e7on d\u00e9lib\u00e9r\u00e9e d\u2019accepter la nouvelle.</p>'
                        + '<h4>Le manifeste part en dernier</h4><p>Les fichiers sont envoy\u00e9s d\u2019abord et <code>repo.json</code> en dernier, expr\u00e8s. Les abonn\u00e9s lisent le manifeste puis r\u00e9cup\u00e8rent ce qu\u2019il liste : l\u2019envoyer en premier donnerait \u00e0 tous ceux qui synchronisent pendant l\u2019envoi une liste de fichiers qui n\u2019existent pas encore. Ainsi le d\u00e9p\u00f4t est soit l\u2019ancien, soit le nouveau.</p>'
                        + '<h4>Quelles cl\u00e9s fonctionnent</h4><p>V\u00e9rifi\u00e9 en d\u00e9codant un exemplaire de chaque avec la biblioth\u00e8que que BMM utilise r\u00e9ellement. <b>ed25519</b> (\u00e0 pr\u00e9f\u00e9rer), <b>RSA</b> 3072/4096, et <b>ECDSA</b> sur nistp256, nistp384 ou nistp521. <b>DSA</b> est hors course \u2014 OpenSSH l\u2019a retir\u00e9 et <code>ssh-keygen</code> refuse m\u00eame d\u2019en g\u00e9n\u00e9rer.</p>'
                        + '<p>Le conteneur compte autant que l\u2019algorithme, et tous ceux-ci sont lus tels quels : <code>-----BEGIN OPENSSH PRIVATE KEY-----</code> (ce qu\u2019\u00e9crit ssh-keygen aujourd\u2019hui), <code>PuTTY-User-Key-File-\u2026</code> (un <code>.ppk</code> PuTTY/WinSCP, aucune conversion), <code>-----BEGIN RSA PRIVATE KEY-----</code> (PKCS#1, via <code>ssh-keygen -m PEM</code>), et PKCS#8 \u2014 <code>-----BEGIN PRIVATE KEY-----</code>, <code>-----BEGIN EC PRIVATE KEY-----</code> ou <code>-----BEGIN ENCRYPTED PRIVATE KEY-----</code>.</p>'
                        + '<p>Une cl\u00e9 prot\u00e9g\u00e9e par phrase secr\u00e8te fonctionne : saisissez-la dans le champ voisin. Elle sert \u00e0 cette connexion et n\u2019est jamais conserv\u00e9e \u2014 d\u2019o\u00f9 le fait qu\u2019une ex\u00e9cution sans surveillance exige une cl\u00e9 <b>sans</b> phrase secr\u00e8te.</p>'
                        + '<p><b>RSA exige un serveur plus r\u00e9cent qu\u2019OpenSSH 8.8.</b> L\u2019ancienne signature <code>ssh-rsa</code> est en SHA-1 et refus\u00e9e par d\u00e9faut depuis ; BMM n\u00e9gocie <code>rsa-sha2-512</code>/<code>rsa-sha2-256</code>. Sur un serveur plus ancien qui n\u2019offre rien d\u2019autre, prenez une ed25519.</p>'
                        + '<h4>La moiti\u00e9 publique, sur le serveur</h4><p>BMM ne lit jamais que la cl\u00e9 PRIV\u00c9E. La publique doit \u00eatre dans <code>~/.ssh/authorized_keys</code> sur le serveur, au format OpenSSH SUR UNE SEULE LIGNE \u2014 <code>ssh-ed25519 AAAAC3\u2026 vous@machine</code>.</p>'
                        + '<p>Le bouton <b>Save public key</b> de PuTTY \u00e9crit \u00e0 la place le bloc RFC4716 (<code>---- BEGIN SSH2 PUBLIC KEY ----</code>), que <code>authorized_keys</code> ne sait pas lire : le serveur refuse la cl\u00e9 alors que tous les fichiers ont l\u2019air corrects. Utilisez la zone <b>Public key for pasting into OpenSSH authorized_keys</b> en haut de PuTTYgen, ou convertissez \u2014 <code>ssh-keygen -i -m RFC4716 -f exportee.pub</code>. Vous pouvez aussi la d\u00e9river de la cl\u00e9 priv\u00e9e que vous avez d\u00e9j\u00e0 : <code>ssh-keygen -y -f ~/.ssh/id_ed25519</code>.</p>'
                        + '<h4>R\u00e9cup\u00e9rer depuis le serveur</h4><p><b>R\u00e9cup\u00e9rer depuis le serveur</b>, c\u2019est la m\u00eame connexion dans l\u2019autre sens : elle copie le d\u00e9p\u00f4t r\u00e9ellement servi vers votre dossier d\u2019export. C\u2019est ce qu\u2019il vous faut pour modifier un d\u00e9p\u00f4t depuis une deuxi\u00e8me machine, quand la copie locale a disparu, ou simplement pour v\u00e9rifier que ce qui est en ligne est bien ce que vous croyez.</p>'
                        + '<p>Les fichiers de m\u00eame nom sont \u00e9cras\u00e9s par la version du serveur ; ceux que le serveur n\u2019a pas sont LAISS\u00c9S EN PLACE. Les supprimer permettrait \u00e0 une r\u00e9cup\u00e9ration point\u00e9e sur le mauvais dossier d\u2019y d\u00e9truire autre chose. Une confirmation est demand\u00e9e avant de commencer, car le bouton voisine avec <b>Publier</b> et les deux se ressemblent au premier coup d\u2019\u0153il.</p>'
                        + '<h4>Synchroniser DEPUIS un d\u00e9p\u00f4t SSH</h4><p>L\u2019autre versant de la m\u00eame connexion : installer des mods depuis un d\u00e9p\u00f4t qui vit sur un serveur SSH plut\u00f4t que derri\u00e8re une URL HTTP. Saisissez <code>ssh://</code> dans le champ URL de la synchronisation \u2014 cette valeur ne porte ni h\u00f4te, ni utilisateur, ni cl\u00e9, car tout ce qui concerne la connexion vient de la cible configur\u00e9e ici.</p>'
                        + '<p>Le reste de l\u2019\u00e9cran se comporte exactement comme en HTTP : liste des profils, choix, delta par empreinte, case de source de mise \u00e0 jour. Et comme ce n\u2019est qu\u2019une URL, tous les points d\u2019entr\u00e9e en h\u00e9ritent sans nouvelle action \u2014 <code>bmm://repo/sync?url=ssh://</code>, l\u2019action <b>Synchroniser un d\u00e9p\u00f4t</b> du planificateur, et <code>POST /api/repo/sync</code> avec <code>\"url\": \"ssh://\"</code>.</p>'
                        + '<p>Deux diff\u00e9rences avec HTTP. La <b>reprise par morceaux</b> repose sur les requ\u00eates Range et n\u2019est pas utilis\u00e9e en SFTP : un fichier \u00e0 r\u00e9cup\u00e9rer l\u2019est en entier \u2014 le delta par fichier, celui qui fait gagner du temps, s\u2019applique toujours puisque la synchro compare d\u2019abord les empreintes. Et une source par <b>mot de passe</b> fonctionne tant que ce panneau est rempli ; une ex\u00e9cution sans surveillance exige une cl\u00e9 sans phrase secr\u00e8te, pour la m\u00eame raison que la publication.</p>'
                        + '<h4>Sans ouvrir l\u2019\u00e9cran</h4><p>Le planificateur propose <b>Publier le d\u00e9p\u00f4t par SSH</b> et <b>R\u00e9cup\u00e9rer le d\u00e9p\u00f4t par SSH</b> ; les liens profonds sont <code>bmm://repo/publish-ssh?dir=&lt;dossier&gt;</code> et <code>bmm://repo/fetch-ssh?dir=&lt;dossier&gt;</code> ; l\u2019API expose <code>POST /api/repo/publish-ssh</code> et <code>POST /api/repo/fetch-ssh</code>. Tous utilisent la cible enregistr\u00e9e ici \u2014 aucun ne peut d\u00e9signer un autre h\u00f4te, une autre cl\u00e9 ni un mot de passe. Cela compte surtout pour la r\u00e9cup\u00e9ration, qui \u00e9crit sur votre propre disque : un lien capable de nommer un h\u00f4te pourrait tirer des fichiers d\u2019une machine de son choix vers un dossier de son choix.</p>'
                        + '<p>Une ex\u00e9cution sans surveillance exige une cl\u00e9 SANS phrase secr\u00e8te, et ne peut pas utiliser de mot de passe \u2014 rien n\u2019est conserv\u00e9 et personne n\u2019est l\u00e0 \u00e0 4 h du matin, donc l\u2019op\u00e9ration \u00e9choue avec un message plut\u00f4t que d\u2019attendre ind\u00e9finiment devant une invite que personne ne verra.</p>',
                },
            },
            {
                id: 'server-keyauth', view: 'repo', diagram: 'hosting-flow', docsPath: 'features/repo/',
                title: { en: 'Protect a repo or catalogue with a key', fr: 'Prot\u00e9ger un d\u00e9p\u00f4t ou un catalogue par cl\u00e9' },
                summary: { en: 'A password can be passed on; a key has to be signed for. What each is good for, and where to paste which half.', fr: 'Un mot de passe se transmet ; une cl\u00e9 doit \u00eatre sign\u00e9e. \u00c0 quoi sert chacun, et o\u00f9 coller quelle moiti\u00e9.' },
                keywords: 'key public private ed25519 proof signature password protect access whitelist ban catalogue catalog index repo identity authorised authorized pubkey revoke cl\u00e9 publique priv\u00e9e preuve mot de passe prot\u00e9ger acc\u00e8s liste blanche bannir catalogue index identit\u00e9 autoris\u00e9e r\u00e9voquer',
                body: {
                    en: '<p>A repository or a catalogue can be closed two different ways, and they combine.</p><p>A <b>download password</b> is a shared secret: anyone who has it can sync, and anyone who has it can pass it on. That is exactly what you want when opening access to a group, and exactly the problem when opening it to one machine.</p><p>A <b>public key</b> does not travel like that. The owner pastes the public half into the access list; the client has to hold the private half and SIGN for it on every request. Nothing sent over the wire can be replayed somewhere else, and revoking access is deleting one line.</p><h4>Related to the SSH key, but not the same job</h4><p>The SSH key logs BMM in to a SERVER to move files around. This key proves WHO BMM IS to a repository or catalogue fetched over HTTPS. The same FILE can do both — the SSH panel offers this keyring to pick from — but the CHOICE is not shared: naming a key for an SFTP target does not change which identity BMM presents to catalogues. One says “let me in”, the other says “this is who I am”.</p><h4>A keyring, not a key</h4><p><b>Settings → Identity &amp; API → Identity keys</b>. Add as many as you like, each under a name you choose. One is the DEFAULT — presented to anything that asks — and any individual server can be pointed at a different one, so a work identity and a personal one coexist without swapping files between runs. Every key chooser elsewhere in BMM lists these same keys by name, and the choice made for a source is remembered for that server’s origin.</p><p>Only the PATH is stored. The file is read at the moment a proof is signed and the bytes are dropped — no key material is ever written to disk, the same rule as the SSH passphrase.</p><p>It must be an UNENCRYPTED private key — ed25519, RSA or ECDSA, OpenSSH format or a PuTTY <code>.ppk</code>. A passphrase-protected file is refused: there is nowhere to keep the passphrase and nobody to ask for it while signing. BMM checks the file when you pick it, rather than failing later against somebody else’s server: <code>ssh-keygen -t ed25519 -N &quot;&quot; -f ~/.ssh/bmm_identity</code>.</p><h4>Authorising a key, on the other side</h4><p>Paste the PUBLIC half — the <code>.pub</code> file, one-line OpenSSH form. On BetterCommunity that is the repo dashboard’s <b>Access</b> tab, or a catalogue’s <b>Access</b> panel; every kind a catalogue can hold is covered — plugin, theme, preset and app. A repo you serve from BMM itself takes the same list, and a catalogue index YOU host is just a JSON file on your server, protected by whatever protects it (BMM presents both the password and the key). BetterCommunity’s own <code>/api/catalogs.json</code> is the platform’s directory of listed public catalogues: no gate, on purpose — closing it would hide the catalogues it exists to advertise, and a private catalogue never appears in it anyway.</p><p>Adding a key makes it REQUIRED FOR EVERYONE. It is not one more way onto an allow list — it is a condition on every request, so add your own key before anybody else’s. Only ed25519 is accepted, and the refusal comes the moment you paste: a key that cannot be verified would store a requirement nothing could satisfy and lock out every client, you included.</p><h4>What actually goes over the wire</h4><p>A short-lived signed statement, never the key: <code>X-BMM-Key-Proof: bmmk1.&lt;payload&gt;.&lt;signature&gt;</code>. The payload names the public key, the ORIGIN it is addressed to, and an expiry two minutes out.</p><p>That address is what stops a proof captured by one server from opening another — a signature for <code>https://a.example</code> is refused by <code>https://b.example</code>, and the server checks it against its own configured address, never against the one the request claims. Signing is cached per origin, so syncing a thousand files costs one signature every two minutes rather than a thousand.</p>',
                    fr: '<p>Un dépôt ou un catalogue se ferme de deux manières, et elles se combinent.</p><p>Un <b>mot de passe de téléchargement</b> est un secret partagé : quiconque l’a peut synchroniser, et quiconque l’a peut le transmettre. C’est exactement ce qu’on veut pour ouvrir l’accès à un groupe, et exactement le problème pour l’ouvrir à une seule machine.</p><p>Une <b>clé publique</b> ne circule pas ainsi. Le propriétaire colle la moitié publique dans la liste d’accès ; le client doit détenir la moitié privée et SIGNER à chaque requête. Rien de ce qui passe sur le réseau ne peut être rejoué ailleurs, et révoquer un accès revient à supprimer une ligne.</p><h4>Parente de la clé SSH, mais pas le même rôle</h4><p>La clé SSH ouvre une session sur un SERVEUR pour y déplacer des fichiers. Celle-ci prouve QUI EST BMM auprès d’un dépôt ou d’un catalogue récupéré en HTTPS. Le même FICHIER peut faire les deux — le panneau SSH propose justement ce trousseau — mais le CHOIX n’est pas partagé : désigner une clé pour une cible SFTP ne change pas l’identité que BMM présente aux catalogues. L’une dit « laisse-moi entrer », l’autre « voici qui je suis ».</p><h4>Un trousseau, pas une clé</h4><p><b>Paramètres → Identité &amp; API → Clés d’identité</b>. Ajoutes-en autant que tu veux, chacune sous un nom que tu choisis. L’une est la clé PAR DÉFAUT — présentée à tout ce qui en demande une — et n’importe quel serveur peut être dirigé vers une autre : une identité professionnelle et une personnelle cohabitent sans échanger de fichiers entre deux exécutions. Tous les sélecteurs de clé de BMM listent ces mêmes clés par leur nom, et le choix fait pour une source est retenu pour l’origine de ce serveur.</p><p>Seul le CHEMIN est conservé. Le fichier est lu au moment de signer et les octets sont oubliés — aucune matière cryptographique n’est jamais écrite sur le disque, même règle que pour la phrase secrète SSH.</p><p>Il faut une clé privée NON CHIFFRÉE — ed25519, RSA ou ECDSA, au format OpenSSH ou une <code>.ppk</code> PuTTY. Un fichier protégé par une phrase secrète est refusé : il n’y a nulle part où la garder, ni personne à qui la demander au moment de signer. BMM vérifie le fichier au moment où vous le choisissez, plutôt que d’échouer plus tard face au serveur d’un autre : <code>ssh-keygen -t ed25519 -N &quot;&quot; -f ~/.ssh/bmm_identity</code>.</p><h4>Autoriser une clé, de l’autre côté</h4><p>Collez la moitié PUBLIQUE — le fichier <code>.pub</code>, format OpenSSH sur une ligne. Sur BetterCommunity, c’est l’onglet <b>Accès</b> du tableau de bord du dépôt, ou le panneau <b>Accès</b> d’un catalogue ; tous les types qu’un catalogue peut contenir sont couverts — plugin, thème, préréglage et application. Un dépôt que vous servez depuis BMM prend la même liste, et un index de catalogues QUE VOUS hébergez n’est qu’un fichier JSON sur votre serveur, protégé par ce qui protège celui-ci (BMM présente le mot de passe et la clé). Le <code>/api/catalogs.json</code> de BetterCommunity est l’annuaire des catalogues publics répertoriés : aucune garde, exprès — le fermer masquerait les catalogues qu’il existe pour faire connaître, et un catalogue privé n’y figure de toute façon jamais.</p><p>Ajouter une clé la rend OBLIGATOIRE POUR TOUT LE MONDE. Ce n’est pas une entrée de plus sur une liste blanche, c’est une condition sur chaque requête : ajoutez la vôtre avant celle des autres. Seul ed25519 est accepté, et le refus tombe dès le collage : une clé invérifiable enregistrerait une exigence que rien ne pourrait satisfaire et mettrait tous les clients dehors, vous compris.</p><h4>Ce qui passe réellement sur le réseau</h4><p>Une attestation signée à durée de vie courte, jamais la clé : <code>X-BMM-Key-Proof: bmmk1.&lt;charge&gt;.&lt;signature&gt;</code>. La charge nomme la clé publique, l’ORIGINE à laquelle elle s’adresse, et une expiration à deux minutes.</p><p>C’est cette adresse qui empêche une preuve captée par un serveur d’en ouvrir un autre — une signature pour <code>https://a.example</code> est refusée par <code>https://b.example</code>, et le serveur la compare à sa propre adresse configurée, jamais à celle que la requête prétend viser. La signature est mise en cache par origine : synchroniser mille fichiers coûte une signature toutes les deux minutes, pas mille.</p>',
                },
            },
            {
                id: 'server-reach', view: 'repo', diagram: 'hosting-flow', docsPath: 'features/repo/',
                title: { en: 'Reach your repo from outside', fr: 'Joindre votre d\u00e9p\u00f4t depuis l\u2019ext\u00e9rieur' },
                summary: { en: 'BMM opens the port and runs the tunnel itself \u2014 three addresses, and what each one exposes.', fr: 'BMM ouvre le port et lance le tunnel lui\u2011m\u00eame \u2014 trois adresses, et ce que chacune expose.' },
                keywords: 'tunnel cloudflared upnp port forward public lan external internet expose ngrok routeur port ouvrir exposer distance',
                body: {
                    en: '<p>Starting the server on <b>Server Repo \u2192 Host</b> gives you up to <b>three</b> addresses. BMM does the exposing for you \u2014 there is no tunnel to install and no router page to open by hand.</p>'
                        + '<h4>The three addresses</h4><ul>'
                        + '<li><b>LAN address</b> \u2014 always. The server listens on <code>0.0.0.0</code>, so every machine on your network can reach it the moment it starts. Anyone on the same Wi\u2011Fi is already in scope.</li>'
                        + '<li><b>Public address</b> \u2014 shown either way, and this is the one that fools people. BMM asks your router to forward the port over <b>UPnP</b>; if that works the address comes from the router. If it does <b>not</b> work \u2014 many routers have UPnP off \u2014 BMM still shows a public address, looked up separately, and <b>nothing forwards to it</b>. Trust the <b>UPnP badge</b> beside it, not the presence of the address: red means you must forward the port on your router yourself, or use the tunnel instead. Either way it points at your home IP, which changes when your ISP says so.</li>'
                        + '<li><b>Tunnel address</b> \u2014 a <code>*.trycloudflare.com</code> URL. This one needs nothing from your router.</li></ul>'
                        + '<h4>About the tunnel</h4><p>BMM runs <b>cloudflared</b> for you. On first use it downloads the official binary from Cloudflare\u2019s GitHub releases into BMM\u2019s app data folder (Windows). If you already have cloudflared, point BMM at it in the Server Repo settings and it will use yours instead of downloading one.</p>'
                        + '<p>It is a <b>quick tunnel</b>: the hostname is random and <b>changes every time you start the server</b>. It is right for handing a link to a squadron for an evening, and wrong as a permanent address \u2014 subscribers would have to update their link each session.</p>'
                        + '<h4>What a public address actually exposes</h4><p>Both the public and tunnel addresses put a folder on <b>your own machine</b> on the internet. Before sharing one, know what the server checks, in this order:</p><ul>'
                        + '<li><b>Download password</b>, if you set one \u2014 checked before any file is even considered. Clients send it as an <code>X-Repo-Password</code> header; a browser cannot set headers, so <code>?password=</code> works too.</li>'
                        + '<li><b>Creator ID</b> \u2014 required on every mod download, so a request with no identifier at all is refused.</li>'
                        + '<li><b>BetterCommunity account</b>, if the repo requires one \u2014 the client must present a <b>signed</b> attestation. A forged or expired one is worth exactly as much as sending none.</li>'
                        + '<li><b>Bans</b>, then the <b>whitelist</b> if you enabled it. Both match on IP, creator key and account.</li></ul>'
                        + '<p>With no password and no whitelist, a repo you expose is <b>public</b>: anyone with the link downloads it. That is a deliberate default, not an oversight \u2014 but it is your decision to make before you paste the link somewhere.</p>'
                        + '<h4>Stopping</h4><p>Stopping the server closes the tunnel and asks the router to <b>remove</b> the UPnP forwarding it added. Leaving BMM running with the server stopped leaves nothing exposed.</p>'
                        + '<h4>If it will not start</h4><p>Two refusals are deliberate: the folder must contain a <code>repo.json</code> (generate the repo first), and the port must be free \u2014 <b>8080</b> by default, changeable on the same form.</p>',
                    fr: '<p>D\u00e9marrer le serveur depuis <b>D\u00e9p\u00f4t Serveur \u2192 Host</b> vous donne jusqu\u2019\u00e0 <b>trois</b> adresses. BMM s\u2019occupe de l\u2019exposition \u2014 aucun tunnel \u00e0 installer, aucune page de routeur \u00e0 ouvrir \u00e0 la main.</p>'
                        + '<h4>Les trois adresses</h4><ul>'
                        + '<li><b>Adresse LAN</b> \u2014 toujours. Le serveur \u00e9coute sur <code>0.0.0.0</code>, donc toutes les machines de votre r\u00e9seau l\u2019atteignent d\u00e8s le d\u00e9marrage. Quiconque est sur le m\u00eame Wi\u2011Fi est d\u00e9j\u00e0 concern\u00e9.</li>'
                        + '<li><b>Adresse publique</b> \u2014 affich\u00e9e dans les deux cas, et c\u2019est elle qui trompe. BMM demande \u00e0 votre routeur d\u2019ouvrir le port en <b>UPnP</b> ; si \u00e7a marche, l\u2019adresse vient du routeur. Si \u00e7a <b>ne marche pas</b> \u2014 beaucoup de routeurs ont l\u2019UPnP d\u00e9sactiv\u00e9 \u2014 BMM affiche quand m\u00eame une adresse publique, obtenue autrement, et <b>rien ne redirige vers elle</b>. Fiez-vous au <b>badge UPnP</b> juste \u00e0 c\u00f4t\u00e9, pas \u00e0 la pr\u00e9sence de l\u2019adresse : rouge signifie que vous devez ouvrir le port vous-m\u00eame sur le routeur, ou passer par le tunnel. Dans tous les cas elle pointe sur votre IP domestique, qui change quand votre FAI le d\u00e9cide.</li>'
                        + '<li><b>Adresse de tunnel</b> \u2014 une URL <code>*.trycloudflare.com</code>. Celle-ci ne demande rien \u00e0 votre routeur.</li></ul>'
                        + '<h4>\u00c0 propos du tunnel</h4><p>BMM lance <b>cloudflared</b> pour vous. \u00c0 la premi\u00e8re utilisation, il t\u00e9l\u00e9charge le binaire officiel depuis les releases GitHub de Cloudflare dans le dossier de donn\u00e9es de BMM (Windows). Si vous avez d\u00e9j\u00e0 cloudflared, indiquez son chemin dans les r\u00e9glages du D\u00e9p\u00f4t Serveur et BMM utilisera le v\u00f4tre au lieu d\u2019en t\u00e9l\u00e9charger un.</p>'
                        + '<p>C\u2019est un <b>tunnel rapide</b> : le nom d\u2019h\u00f4te est al\u00e9atoire et <b>change \u00e0 chaque d\u00e9marrage du serveur</b>. Parfait pour donner un lien \u00e0 une escadrille le temps d\u2019une soir\u00e9e, inadapt\u00e9 comme adresse permanente \u2014 vos abonn\u00e9s devraient changer de lien \u00e0 chaque session.</p>'
                        + '<h4>Ce qu\u2019une adresse publique expose vraiment</h4><p>L\u2019adresse publique et celle du tunnel mettent un dossier de <b>votre propre machine</b> sur Internet. Avant d\u2019en partager une, sachez ce que le serveur v\u00e9rifie, dans cet ordre :</p><ul>'
                        + '<li><b>Mot de passe de t\u00e9l\u00e9chargement</b>, si vous en avez mis un \u2014 v\u00e9rifi\u00e9 avant m\u00eame qu\u2019un fichier soit envisag\u00e9. Les clients l\u2019envoient dans un en\u2011t\u00eate <code>X-Repo-Password</code> ; un navigateur ne pouvant pas poser d\u2019en\u2011t\u00eate, <code>?password=</code> fonctionne aussi.</li>'
                        + '<li><b>Identifiant de cr\u00e9ateur</b> \u2014 exig\u00e9 sur chaque t\u00e9l\u00e9chargement de mod : une requ\u00eate sans aucun identifiant est refus\u00e9e.</li>'
                        + '<li><b>Compte BetterCommunity</b>, si le d\u00e9p\u00f4t l\u2019exige \u2014 le client doit pr\u00e9senter une attestation <b>sign\u00e9e</b>. Une attestation forg\u00e9e ou expir\u00e9e vaut exactement autant que ne rien envoyer.</li>'
                        + '<li><b>Bannissements</b>, puis la <b>liste blanche</b> si vous l\u2019avez activ\u00e9e. Les deux comparent l\u2019IP, la cl\u00e9 de cr\u00e9ateur et le compte.</li></ul>'
                        + '<p>Sans mot de passe ni liste blanche, un d\u00e9p\u00f4t que vous exposez est <b>public</b> : quiconque a le lien le t\u00e9l\u00e9charge. C\u2019est un choix par d\u00e9faut d\u00e9lib\u00e9r\u00e9, pas un oubli \u2014 mais c\u2019est \u00e0 vous de trancher avant de coller le lien quelque part.</p>'
                        + '<h4>Arr\u00eater</h4><p>Arr\u00eater le serveur ferme le tunnel et demande au routeur de <b>retirer</b> la redirection UPnP qu\u2019il avait ajout\u00e9e. Laisser BMM ouvert avec le serveur arr\u00eat\u00e9 n\u2019expose rien.</p>'
                        + '<h4>S\u2019il refuse de d\u00e9marrer</h4><p>Deux refus sont volontaires : le dossier doit contenir un <code>repo.json</code> (g\u00e9n\u00e9rez le d\u00e9p\u00f4t d\u2019abord), et le port doit \u00eatre libre \u2014 <b>8080</b> par d\u00e9faut, modifiable sur le m\u00eame formulaire.</p>',
                },
            },
            {
                id: 'repo-admin', docsPath: 'features/repo/', view: 'repo', diagram: 'security-system',
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
                id: 'catalogs', docsPath: 'features/community/', view: 'apps', diagram: 'app-catalog',
                title: { en: 'Catalogs & BetterCommunity', fr: 'Catalogues et BetterCommunity' },
                summary: { en: 'Browse and install mods, apps and themes from community catalogs.', fr: 'Parcourez et installez mods, applis et thèmes depuis les catalogues.' },
                keywords: 'catalog community bettercommunity browse install apps themes catalogue',
                body: {
                    en: '<p>Catalogs are feeds of ready-to-install content — mods, apps, themes and plugins — that BMM reads from a URL. The <b>App Catalog</b> screen browses them; installing is one click (BMM handles the download and, for apps, the setup).</p><ul><li><b>Official</b> catalogs are curated; you can also add a <b>community</b> catalog by URL.</li><li>Install buttons are plain <code>bmm://</code> deeplinks, so a catalog can live on any website — or in the BetterCommunity hub.</li><li>Publish your own through <b>BetterCommunity</b>. Note it’s a separate hosted service from a self-hosted server repo.</li></ul>',
                    fr: '<p>Les catalogues sont des flux de contenu prêt à installer — mods, applis, thèmes et plugins — que BMM lit depuis une URL. L’écran <b>App Catalog</b> les parcourt ; l’installation se fait en un clic (BMM gère le téléchargement et, pour les applis, l’installation).</p><ul><li>Les catalogues <b>officiels</b> sont sélectionnés ; vous pouvez aussi ajouter un catalogue <b>communautaire</b> par URL.</li><li>Les boutons d’installation sont de simples deeplinks <code>bmm://</code>, un catalogue peut donc vivre sur n’importe quel site — ou dans le hub BetterCommunity.</li><li>Publiez les vôtres via <b>BetterCommunity</b>. C’est un service hébergé, distinct d’un dépôt serveur auto-hébergé.</li></ul>',
                },
            },
            {
                id: 'commands', docsPath: 'reference/commands', view: 'settings',
                title: { en: 'Every command', fr: 'Toutes les commandes' },
                summary: {
                    en: 'Building, checking and shipping BMM — grouped by goal, not by tool.',
                    fr: 'Construire, vérifier et livrer BMM — groupé par objectif, pas par outil.',
                },
                keywords: 'command npm script build ci check compile typecheck cargo test lint gate commande script vérification compilation',
                body: {
                    en: '<p>Every command this repository has, grouped by what you are trying to do rather than by which tool provides it.</p><p>The two that matter most: <code>npm run dev</code> (TypeScript watch plus the Tauri window) and <code>npm run ci</code> (all 43 gates, in the order CI runs them). The second is slow on purpose — it is the difference between "it compiles" and "it works".</p><ul><li><b>Checks</b> are grouped by what they protect: text and translation, appearance, correctness, and the features that carry their own invariants.</li><li><b>Maps</b> print a report and change nothing — the module graph, the frontend→Rust surface, every <code>bmm://</code> action. <code>npm run impact</code> answers "if I break this, what tells me".</li><li><b>The compiled JavaScript is committed</b>, so it must match the committed TypeScript — and the check wants it committed, not merely staged.</li></ul><p>It ends with the traps that have actually cost time here, including the one where a green <code>tsc</code> is not a working app.</p>',
                    fr: '<p>Toutes les commandes de ce dépôt, regroupées par objectif plutôt que par outil.</p><p>Les deux principales : <code>npm run dev</code> (surveillance TypeScript et la fenêtre Tauri) et <code>npm run ci</code> (les 43 vérifications, dans l’ordre de la CI). La seconde est lente exprès — c’est la différence entre « ça compile » et « ça marche ».</p><ul><li>Les <b>vérifications</b> sont groupées par ce qu’elles protègent : texte et traduction, apparence, justesse, et les fonctionnalités qui ont leurs propres invariants.</li><li>Les <b>cartes</b> affichent un rapport et ne changent rien — graphe des modules, surface frontend→Rust, chaque action <code>bmm://</code>. <code>npm run impact</code> répond à « si je casse ça, qu’est-ce qui me le dira ».</li><li><b>Le JavaScript compilé est commité</b>, il doit donc correspondre au TypeScript commité — et le contrôle le veut commité, pas seulement indexé.</li></ul><p>Elle se termine par les pièges qui ont réellement coûté du temps ici, dont celui où un <code>tsc</code> vert n’est pas une application qui fonctionne.</p>',
                },
            },
            {
                id: 'links-and-updates', docsPath: 'reference/links-and-updates', diagram: 'deeplinks', view: 'settings',
                title: { en: 'Links and updates', fr: 'Liens et mises à jour' },
                summary: {
                    en: 'Where every address BMM uses comes from, and why the update check has a second source.',
                    fr: 'D’où vient chaque adresse utilisée par BMM, et pourquoi la vérification des mises à jour a une seconde source.',
                },
                keywords: 'links.json update autoupdate fallback github rate limit releases telemetry endpoint liens mise a jour secours quota',
                body: {
                    en: '<p>Every external address BMM uses — catalogues, the repo list, telemetry, the update feed — lives in one file, <code>links.json</code>, so any of them can change <b>without shipping a new version of BMM</b>.</p><p>BMM loads it from BetterCommunity first, then a copy on GitHub, then the file bundled in the app, then built-in defaults — stopping at the first that answers. So a link corrected on BetterCommunity reaches every installation at its next start.</p><p><b>Updates have two sources.</b> GitHub is asked first; BetterCommunity only if GitHub cannot answer. GitHub allows 60 unauthenticated requests per hour <i>per IP address</i> — behind a company network, a university or a mobile operator, that budget can be spent entirely by other people, and the check would fail for the rest of the hour through no fault of yours.</p><ul><li>It falls back on a failed connection, a server error, or a rate limit.</li><li>It does <b>not</b> fall back on "no release found" — that feed genuinely has none, and the other almost certainly has none either.</li><li>If the fallback fails too, the error shown is the fallback’s own.</li></ul><p>Set <code>autoupdate_api_fallback</code> to an empty string to switch it off.</p>',
                    fr: '<p>Toutes les adresses externes qu’utilise BMM — catalogues, liste des dépôts, télémétrie, flux de mises à jour — vivent dans un seul fichier, <code>links.json</code>, pour que n’importe laquelle puisse changer <b>sans publier une nouvelle version de BMM</b>.</p><p>BMM le charge depuis BetterCommunity en premier, puis une copie sur GitHub, puis le fichier embarqué dans l’app, puis des valeurs par défaut — en s’arrêtant à la première qui répond. Un lien corrigé sur BetterCommunity atteint donc chaque installation à son démarrage suivant.</p><p><b>Les mises à jour ont deux sources.</b> GitHub est interrogé en premier ; BetterCommunity seulement s’il ne peut pas répondre. GitHub autorise 60 requêtes non authentifiées par heure <i>par adresse IP</i> — derrière un réseau d’entreprise, une université ou un opérateur mobile, ce quota peut être entièrement consommé par d’autres, et la vérification échouerait pendant le reste de l’heure sans que vous y soyez pour quoi que ce soit.</p><ul><li>Il bascule sur une connexion échouée, une erreur serveur ou un quota dépassé.</li><li>Il ne bascule <b>pas</b> sur « aucune version trouvée » — ce flux n’en a réellement aucune, et l’autre n’en aura presque sûrement pas davantage.</li><li>Si le secours échoue aussi, l’erreur affichée est la sienne.</li></ul><p>Mettez <code>autoupdate_api_fallback</code> à une chaîne vide pour le désactiver.</p>',
                },
            },
            {
                id: 'app-cfg', docsPath: 'reference/app-cfg', view: 'settings',
                title: { en: 'app.cfg — the build’s own switches', fr: 'app.cfg — les interrupteurs de la build' },
                summary: {
                    en: 'Debug menu, updates, test server — the flags decided at build time, not in Settings.',
                    fr: 'Menu de débogage, mises à jour, serveur de test — les drapeaux fixés à la compilation, pas dans les Réglages.',
                },
                keywords: 'app.cfg config flag prod ptb debug fsdm disableupdate eula bctestmode bctestbase build packaging drapeau configuration compilation débogage',
                body: {
                    en: '<p>A flat text file next to the executable that decides how a <b>build</b> behaves: whether the debug menu exists, whether BMM may update itself, whether the blog talks to a local server instead of the real site. It is read once at startup and never written back — nothing in the interface changes it.</p><p>Three things catch people out, every time:</p><ul><li><b>There is no comment syntax.</b> Most keys are found by searching the whole file for a substring, so <code>#Prod=false</code> still contains <code>prod=false</code> and debug mode is on. Delete the line instead.</li><li><b>Spaces around <code>=</code> break some keys and not others</b>, because the file is parsed twice by two pieces of code that disagree. <code>BCTestMode = true</code> works; <code>PTB = true</code> is silently ignored. Write every key tight.</li><li><b>A missing file is not an error.</b> Every flag defaults to off, which looks exactly like a normal release build — so a flag that seems ignored is usually a file that was never found.</li></ul><p>Two keys are in the file and do nothing at all, which the full page names rather than leaves you to discover. <b>Settings → Debug → resource paths</b> shows which <code>app.cfg</code> was actually read.</p>',
                    fr: '<p>Un fichier texte plat, à côté de l’exécutable, qui décide du comportement d’une <b>build</b> : si le menu de débogage existe, si BMM peut se mettre à jour lui-même, si le blog s’adresse à un serveur local plutôt qu’au vrai site. Il est lu une fois au démarrage et jamais réécrit — rien dans l’interface ne le modifie.</p><p>Trois choses piègent tout le monde, à chaque fois :</p><ul><li><b>Il n’existe aucune syntaxe de commentaire.</b> La plupart des clés sont trouvées en cherchant une sous-chaîne dans tout le fichier : <code>#Prod=false</code> contient toujours <code>prod=false</code>, et le mode débogage est actif. Supprimez la ligne.</li><li><b>Les espaces autour du <code>=</code> cassent certaines clés et pas d’autres</b>, car le fichier est analysé deux fois par deux morceaux de code qui ne sont pas d’accord. <code>BCTestMode = true</code> fonctionne ; <code>PTB = true</code> est ignoré en silence. Écrivez chaque clé serrée.</li><li><b>Un fichier absent n’est pas une erreur.</b> Chaque drapeau vaut « désactivé » par défaut, ce qui ressemble exactement à une build de sortie ordinaire — un drapeau qui semble ignoré est donc le plus souvent un fichier jamais trouvé.</li></ul><p>Deux clés figurent dans le fichier sans rien faire du tout ; la page complète les nomme au lieu de vous laisser le découvrir. <b>Réglages → Débogage → chemins de ressources</b> montre quel <code>app.cfg</code> a réellement été lu.</p>',
                },
            },
            {
                id: 'catalog-index', docsPath: 'features/community/', view: 'settings',
                title: { en: 'Catalogue index — one address for many', fr: 'Index de catalogues — une adresse pour plusieurs' },
                summary: {
                    en: 'Follow a community with one URL instead of collecting four.',
                    fr: 'Suivre une communauté avec une seule URL au lieu d’en collecter quatre.',
                },
                keywords: 'index catalogue catalog of catalogs source preset repo app plugin theme scope official community index de catalogues',
                body: {
                    en: '<p>A catalog lists things to install. An <b>index</b> lists catalogs. Without one, following a community means finding a URL for their apps, another for plugins, another for themes, and pasting each into a different screen.</p><p>Add one under <b>Settings → Catalogue index</b>. Press <b>Preview</b> first: it shows what it would add, how many you already have, and how many entries it refused — nothing is imported until you say so. Several indexes can be followed at once, and each catalog in your lists shows which one brought it in.</p><ul><li>Entries name a <b>type</b> — app, plugin, theme, preset or repo — so each lands in the right screen.</li><li>An entry marked for another Better* product is ignored; one that names no product is kept, because "nobody said" is not the same as "not for you".</li><li>An index cannot grant itself trust: badges come from where a catalog was fetched, never from what it claims.</li></ul><p>Paste an index into an ordinary "add a source" box by mistake and BMM notices, and points you here rather than adding a source that would read as empty.</p>',
                    fr: '<p>Un catalogue liste des choses à installer. Un <b>index</b> liste des catalogues. Sans lui, suivre une communauté oblige à trouver une URL pour ses applis, une autre pour ses plugins, une autre pour ses thèmes, et à coller chacune dans un écran différent.</p><p>Ajoutez-en un dans <b>Réglages → Index de catalogues</b>. Appuyez d’abord sur <b>Prévisualiser</b> : il montre ce qu’il ajouterait, combien vous avez déjà, et combien d’entrées il a refusées — rien n’est importé tant que vous ne le demandez pas. Plusieurs index peuvent être suivis à la fois, et chaque catalogue de vos listes indique lequel l’a amené.</p><ul><li>Les entrées portent un <b>type</b> — app, plugin, thème, preset ou dépôt — pour atterrir dans le bon écran.</li><li>Une entrée destinée à un autre produit Better* est ignorée ; une entrée qui ne nomme aucun produit est gardée, car « personne ne l’a dit » n’est pas « pas pour vous ».</li><li>Un index ne peut pas s’accorder de confiance : les badges viennent de l’endroit d’où un catalogue a été récupéré, jamais de ce qu’il prétend.</li></ul><p>Si vous collez un index dans une boîte « ajouter une source » ordinaire par erreur, BMM le remarque et vous renvoie ici plutôt que d’ajouter une source qui paraîtrait vide.</p>',
                },
            },
            {
                id: 'preset-catalog', docsPath: 'features/scheduler/', view: 'settings',
                title: { en: 'Sharing automations safely', fr: 'Partager des automatisations sans risque' },
                summary: {
                    en: 'Read what a shared automation does before importing it.',
                    fr: 'Lire ce que fait une automatisation partagée avant de l’importer.',
                },
                keywords: 'preset bmmpa automation share import inspect scheduler catalogue de presets inspecter automatisation',
                body: {
                    en: '<p>Automations export as <code>.bmmpa</code> files, so they can be shared — and a <b>preset catalog</b> is a published list of them, opened from <b>Scheduler → new task → From a catalog…</b></p><p>A shared automation is somebody else’s code. Deciding whether to trust it used to mean importing it and reading the editor, which is the wrong order: importing is the commitment. So every row ends in <b>Inspect</b>, never in Install, and the same button exists for a file somebody sent you.</p><p>Inspecting shows, without running anything:</p><ul><li>what each task does and when it would fire;</li><li>what it <b>grants itself</b> — running programs, running scripts, firing deeplinks, stopping programs;</li><li>what it reaches outside BMM, <b>including anything buried inside a loop or a branch</b>;</li><li>the full text of every script, so you can read the actual code;</li><li>every program, path and URL it names — printed exactly as written, never opened.</li></ul>',
                    fr: '<p>Les automatisations s’exportent en fichiers <code>.bmmpa</code>, donc elles se partagent — et un <b>catalogue de presets</b> en est une liste publiée, ouverte depuis <b>Planificateur → nouvelle tâche → Depuis un catalogue…</b></p><p>Une automatisation partagée, c’est le code de quelqu’un d’autre. Décider d’y faire confiance obligeait à l’importer puis à lire l’éditeur — l’ordre inverse, puisque importer <i>est</i> l’engagement. Chaque ligne se termine donc par <b>Inspecter</b>, jamais par Installer, et le même bouton existe pour un fichier qu’on vous a envoyé.</p><p>L’inspection montre, sans rien exécuter :</p><ul><li>ce que fait chaque tâche et quand elle se déclencherait ;</li><li>ce qu’elle <b>s’accorde</b> — exécuter des programmes, exécuter des scripts, déclencher des deeplinks, arrêter des programmes ;</li><li>ce qu’elle atteint hors de BMM, <b>y compris ce qui est enfoui dans une boucle ou une branche</b> ;</li><li>le texte intégral de chaque script, pour lire le vrai code ;</li><li>chaque programme, chemin et URL qu’elle nomme — imprimés tels quels, jamais ouverts.</li></ul>',
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
                id: 'themes', docsPath: 'features/themes/', view: 'settings', diagram: 'theme-system',
                title: { en: 'Themes & appearance', fr: 'Thèmes et apparence' },
                summary: { en: 'Recolour BMM — pick a built-in theme or design and share your own.', fr: 'Recolorez BMM — choisissez un thème intégré ou créez et partagez le vôtre.' },
                keywords: 'theme appearance color dark light editor custom thème apparence couleur',
                body: {
                    en: '<p>BMM ships <b>11 built-in themes</b> — dark ones (Default, Sombre, Void, Discord, Spotify, Nord…) and four light ones (Full White, Brutalist, Clay, Sakura). Switch in <b>Settings → Themes</b>, or make your own.</p>'
                        + '<h4>The theme editor</h4><p>Open it from Settings → <b>Open Theme Editor</b>. Four tabs:</p><ul><li><b>Simple</b> — every design token grouped with friendly labels: backgrounds, accent, borders, text, fonts, radii, buttons, effects… An <b>eyedropper</b> lets you click any element in the running app to jump straight to its token. Or pick one colour and let the <b>auto-palette</b> build a coherent theme around it.</li><li><b>+ Elements</b> — inject your own HTML/CSS anywhere (a badge, a banner…), globally or per page.</li><li><b>CSS</b> — full custom CSS for power users, global and per-page.</li><li><b>Installed</b> — manage your themes and browse the <b>theme catalogue</b>.</li></ul><p>Everything previews <b>live</b> and nothing persists until you save — Discard restores what you had.</p>'
                        + '<h4>Save, share, import</h4><ul><li><b>Save as…</b> makes it yours; <b>Export</b> writes a shareable <code>.bmmtheme</code> file (a zip with the theme JSON + fonts/assets).</li><li><b>Share</b> copies a <code>bmm://</code> link — the recipient clicks it and the theme installs.</li><li>Light themes get automatic <b>contrast enforcement</b> (real WCAG ratios), so text stays readable even on themes that only change backgrounds.</li></ul><p>Themes are just data — they never touch your mods or profiles. Internals: <b>Developer → Theme system</b>.</p>',
                    fr: '<p>BMM livre <b>11 thèmes intégrés</b> — des sombres (Default, Sombre, Void, Discord, Spotify, Nord…) et quatre clairs (Full White, Brutalist, Clay, Sakura). Changez dans <b>Réglages → Thèmes</b>, ou créez le vôtre.</p>'
                        + '<h4>L\'éditeur de thèmes</h4><p>Ouvrez-le depuis Réglages → <b>Ouvrir l\'éditeur de thèmes</b>. Quatre onglets :</p><ul><li><b>Simple</b> — chaque token de design groupé avec des libellés clairs : fonds, accent, bordures, texte, polices, rayons, boutons, effets… Une <b>pipette</b> permet de cliquer n\'importe quel élément de l\'app pour sauter directement à son token. Ou choisissez une seule couleur et laissez l\'<b>auto-palette</b> bâtir un thème cohérent autour.</li><li><b>+ Éléments</b> — injectez votre propre HTML/CSS n\'importe où (un badge, une bannière…), globalement ou par page.</li><li><b>CSS</b> — CSS libre pour utilisateurs avancés, global et par page.</li><li><b>Installés</b> — gérez vos thèmes et parcourez le <b>catalogue de thèmes</b>.</li></ul><p>Tout se prévisualise <b>en direct</b> et rien ne persiste avant d\'enregistrer — Annuler restaure l\'état précédent.</p>'
                        + '<h4>Enregistrer, partager, importer</h4><ul><li><b>Enregistrer sous…</b> le rend vôtre ; <b>Exporter</b> écrit un fichier <code>.bmmtheme</code> partageable (un zip avec le JSON du thème + polices/assets).</li><li><b>Partager</b> copie un lien <code>bmm://</code> — le destinataire clique et le thème s\'installe.</li><li>Les thèmes clairs bénéficient d\'un <b>renforcement de contraste</b> automatique (vrais ratios WCAG), le texte reste lisible même sur un thème qui ne change que les fonds.</li></ul><p>Les thèmes ne sont que des données — ils ne touchent jamais vos mods ni vos profils. Détails internes : <b>Développeur → Système de thèmes</b>.</p>',
                },
            },
            {
                id: 'repo-format', view: 'repo', docsPath: 'reference/repo-format/', wide: true,
                title: { en: 'The repo format', fr: 'Le format de dépôt' },
                summary: { en: 'What repo.json contains, field by field — so you can write, read or debug one by hand.', fr: 'Ce que contient repo.json, champ par champ — pour en écrire, en lire ou en déboguer un à la main.' },
                keywords: 'repo.json manifest format field schema generator chunk sha256 mtime layout files_base_url manifeste format champ schéma générateur bloc',
                body: {
                    en: `A repo is a folder behind any web server: the mod files, plus one **manifest** (\`repo.json\`) describing them precisely enough that another BMM knows what it already has.

### What the generator writes

\`repo.json\` and \`mods/\` are the only two things a subscriber needs. \`Info.json\`, \`bans.json\` and the standalone-server files are conveniences for hosting it yourself — delete them if you serve the folder with your own nginx or with BetterCommunity hosting.

### The shape

\`repo.json\` holds repo metadata (\`name\`, \`version\`, \`game_name\`, \`created_at\`) and a **profiles** array. Each profile has **mods**; each mod has **files**; each file carries its \`relative_path\` (relative to the mod, not the repo), exact \`size\`, \`sha256_hash\`, and \`chunks\`.

:::warning[The mistake that costs the most time]
A field can be *required* and still accept \`null\` — the **key** must be there. Omitting it is a parse error, and a parse error makes the whole repo read as **empty**, not as partly broken. \`download_links\` on a mod is the usual culprit: required, no default, easy to forget when writing a manifest by hand.
:::

### Three details that decide whether syncing is cheap

- **Exact sizes.** A rounded \`"1.2K"\` compared against a byte count marks *every* file as changed, so every sync re-downloads everything. It still works — it just stops being worth anything.
- **\`mtime\`** (Unix seconds, optional). This is what lets a refresh *skip* a file. Without it the planner reads "unknown" and re-hashes every time. It never validates a download — that is always the hash.
- **Chunks.** Files over **4 MiB** carry per-chunk hashes, so a small change inside a huge file costs a few MB instead of the whole file.

### Serving files from somewhere else

By default a file is fetched from \`<base>/mods/<mod id>/<relative_path>\`. \`files_base_url\` moves the base to another host, and \`files_layout\` is a template over \`{id}\` and \`{path}\` — the default \`mods/{id}/{path}\` is what every older manifest means.

### You may not need to write one at all

BetterCommunity hosting **generates the manifest** from the files you upload, and serves an nginx-style directory listing so BMM can walk it. An uploaded manifest still wins where one exists, because it carries profile names, mod versions and tags that no file listing can recover.

The complete field-by-field reference, including every optional key and a troubleshooting table, is on the documentation site.`,
                    fr: `Un dépôt est un dossier derrière n'importe quel serveur web : les fichiers de mods, plus un **manifeste** (\`repo.json\`) qui les décrit assez précisément pour qu'un autre BMM sache ce qu'il possède déjà.

### Ce que le générateur écrit

\`repo.json\` et \`mods/\` sont les deux seules choses nécessaires à un abonné. \`Info.json\`, \`bans.json\` et les fichiers du serveur autonome sont des conforts pour héberger vous-même — supprimez-les si vous servez le dossier avec votre propre nginx ou avec l'hébergement BetterCommunity.

### La forme

\`repo.json\` contient les métadonnées du dépôt (\`name\`, \`version\`, \`game_name\`, \`created_at\`) et un tableau **profiles**. Chaque profil a des **mods** ; chaque mod a des **files** ; chaque fichier porte son \`relative_path\` (relatif au mod, pas au dépôt), sa \`size\` exacte, son \`sha256_hash\` et ses \`chunks\`.

:::warning[L'erreur qui coûte le plus de temps]
Un champ peut être *obligatoire* et accepter \`null\` — c'est la **clé** qui doit être là. L'omettre est une erreur d'analyse, et une erreur d'analyse fait lire le dépôt entier comme **vide**, pas comme partiellement cassé. \`download_links\` sur un mod est le coupable habituel : obligatoire, sans valeur par défaut, facile à oublier quand on écrit un manifeste à la main.
:::

### Trois détails qui décident si la synchro est bon marché

- **Tailles exactes.** Un « 1,2 K » arrondi comparé à un décompte d'octets marque *tous* les fichiers comme modifiés : chaque synchro retélécharge tout. Ça marche encore — ça cesse juste de servir à quelque chose.
- **\`mtime\`** (secondes Unix, optionnel). C'est ce qui permet à un rafraîchissement de *sauter* un fichier. Sans lui, le planificateur lit « inconnu » et re-hashe à chaque fois. Il ne valide jamais un téléchargement — c'est toujours le hachage.
- **Blocs.** Les fichiers de plus de **4 Mio** portent des hachages par bloc : une petite modification dans un énorme fichier coûte quelques Mo au lieu du fichier entier.

### Servir les fichiers depuis ailleurs

Par défaut un fichier est récupéré à \`<base>/mods/<id du mod>/<relative_path>\`. \`files_base_url\` déplace la base vers un autre hôte, et \`files_layout\` est un gabarit sur \`{id}\` et \`{path}\` — le défaut \`mods/{id}/{path}\` est ce que signifie tout manifeste plus ancien.

### Vous n'avez peut-être pas à en écrire

L'hébergement BetterCommunity **génère le manifeste** à partir des fichiers que vous envoyez, et sert un index de répertoire au format nginx que BMM sait parcourir. Un manifeste envoyé garde la priorité là où il existe, car il porte des noms de profils, des versions de mods et des tags qu'aucune liste de fichiers ne peut reconstituer.

La référence complète champ par champ, avec chaque clé optionnelle et un tableau de diagnostic, est sur le site de documentation.`,
                },
            },
            {
                id: 'plugins', view: 'plugins', diagram: 'mcp-server', docsPath: 'features/plugins/',
                title: { en: 'Plugins & the API', fr: 'Plugins et API' },
                summary: { en: 'Add features BMM doesn’t ship — and automate it from scripts or an AI assistant.', fr: 'Ajoutez des fonctions que BMM ne fournit pas — et automatisez-le depuis des scripts ou une IA.' },
                keywords: 'plugin api mcp automation script install extend plugins étendre',
                body: {
                    en: '<p>Not everything is built in — and it doesn’t have to be. The <b>Plugins &amp; API</b> screen lets you install plugins that add new features, and add plugin sources so you can find more.</p><ul><li><b>Install a plugin</b> from a catalog or a file; enable or disable it any time.</li><li>Power users: BMM also exposes a <b>local API</b> and an <b>MCP server</b>, so scripts — or an AI assistant — can drive it (scan, activate, build packs…).</li></ul><p>Curious how that works? See <b>Developer → MCP server &amp; local API</b>, or the full endpoint reference in the online docs.</p>',
                    fr: '<p>Tout n’est pas intégré — et ça n’a pas à l’être. L’écran <b>Plugins &amp; API</b> vous laisse installer des plugins qui ajoutent des fonctions, et ajouter des sources de plugins pour en trouver d’autres.</p><ul><li><b>Installez un plugin</b> depuis un catalogue ou un fichier ; activez-le ou désactivez-le quand vous voulez.</li><li>Utilisateurs avancés : BMM expose aussi une <b>API locale</b> et un <b>serveur MCP</b>, pour que des scripts — ou une IA — le pilotent (scanner, activer, construire des packs…).</li></ul><p>Curieux du fonctionnement ? Voir <b>Développeur → Serveur MCP et API locale</b>, ou la référence complète des endpoints dans la doc en ligne.</p>',
                },
            },
            {
                id: 'custom-pages', docsPath: 'features/plugins/', diagram: 'custom-pages',
                title: { en: 'Custom pages', fr: 'Pages personnalisées' },
                summary: { en: 'Add your own sandboxed pages to the navbar.', fr: 'Ajoutez vos propres pages sandbox à la barre de navigation.' },
                keywords: 'custom pages navbar bmmpage sandbox pages personnalisées',
                body: {
                    en: '<p>Build a sandboxed <code>bmmpage://</code> page — a mini app inside BMM — and pin it to the navbar. Each page only gets the permissions you grant it, so it can’t reach anything you didn’t allow. Great for a personal dashboard, a launcher, or a tool the community shares.</p><p>Curious how the sandbox works? See <b>Developer → Extending BMM</b>.</p>',
                    fr: '<p>Créez une page <code>bmmpage://</code> en sandbox — une mini-application dans BMM — et épinglez-la à la barre de navigation. Chaque page n’obtient que les permissions que vous accordez, elle ne peut donc rien atteindre que vous n’avez pas autorisé. Idéal pour un tableau de bord perso, un lanceur, ou un outil partagé par la communauté.</p><p>Curieux du fonctionnement du sandbox ? Voir <b>Développeur → Étendre BMM</b>.</p>',
                },
            },
            {
                // What BMM's own renderer (md-lite.ts) understands — deliberately a SUBSET of
                // BetterCommunity's, and said so here. A page listing blocks that only render on the
                // website would send people to write a roadmap that comes out as literal text in the app.
                id: 'custom-markdown', docsPath: 'reference/custom-markdown/',
                title: { en: 'Rich text blocks (custom markdown)', fr: 'Blocs de texte enrichi (markdown personnalisé)' },
                summary: { en: 'Callouts, steps, columns and more — in plugin docs, article bodies and anywhere BMM shows markdown.', fr: 'Encadrés, étapes, colonnes et plus — dans les docs de plugins, les articles, et partout où BMM affiche du markdown.' },
                keywords: 'markdown callout steps columns details replay blocks directive formatting encadré étapes colonnes mise en forme',
                body: {
                    en: '<p>Anywhere BMM renders markdown — a plugin’s documentation, a custom page, a community article — you get ordinary markdown <b>plus</b> a set of blocks. Each one opens with <code>:::name</code> and closes with a bare <code>:::</code>.</p>'
                        + '<h4>The blocks</h4><ul>'
                        + '<li><b>Callouts</b> — <code>:::note</code>, <code>:::tip</code>, <code>:::info</code>, <code>:::success</code>, <code>:::warning</code>, <code>:::danger</code>. A title goes in brackets: <code>:::warning[Back up first]</code>.</li>'
                        + '<li><b>Steps</b> — <code>:::steps</code> wrapping several <code>:::step[Title]</code> blocks. They number themselves, so don’t number the titles.</li>'
                        + '<li><b>Columns</b> — <code>:::columns</code> wrapping <code>:::column</code> blocks. They stack on a narrow window, so never write “the one on the left”.</li>'
                        + '<li><b>Collapsible</b> — <code>:::details[Show more]</code>, hidden until clicked.</li>'
                        + '<li><b>Session replay</b> — <code>:::replay{src="…" title="…"}</code> plays a <code>.bmmreplay</code> recording inline.</li>'
                        + '<li>Plus GFM <b>tables</b>, fenced <b>code</b>, lists, quotes and mkdocs-style <code>!!!</code> admonitions.</li></ul>'
                        + '<h4>Two rules</h4><ul><li>Leave a <b>blank line</b> before a block — <code>:::note</code> tucked under a paragraph is read as part of it.</li><li><b>Close what you open.</b> Blocks nest freely, and every <code>:::</code> closes the innermost one still open.</li></ul>'
                        + '<p><b>On the website there are more</b> — cards, roadmaps, download rows, inline badges, icons and keyboard keys. Those render on BetterCommunity; in BMM they come out as plain text. The full list is in the online docs.</p>',
                    fr: '<p>Partout où BMM affiche du markdown — la documentation d’un plugin, une page personnalisée, un article de la communauté — vous avez le markdown ordinaire <b>plus</b> un jeu de blocs. Chacun s’ouvre par <code>:::nom</code> et se ferme par un <code>:::</code> seul.</p>'
                        + '<h4>Les blocs</h4><ul>'
                        + '<li><b>Encadrés</b> — <code>:::note</code>, <code>:::tip</code>, <code>:::info</code>, <code>:::success</code>, <code>:::warning</code>, <code>:::danger</code>. Le titre va entre crochets : <code>:::warning[Sauvegardez d’abord]</code>.</li>'
                        + '<li><b>Étapes</b> — <code>:::steps</code> autour de plusieurs <code>:::step[Titre]</code>. Elles se numérotent seules : ne numérotez pas les titres.</li>'
                        + '<li><b>Colonnes</b> — <code>:::columns</code> autour de blocs <code>:::column</code>. Elles s’empilent sur une fenêtre étroite : n’écrivez jamais « celle de gauche ».</li>'
                        + '<li><b>Repliable</b> — <code>:::details[Voir plus]</code>, caché jusqu’au clic.</li>'
                        + '<li><b>Replay de session</b> — <code>:::replay{src="…" title="…"}</code> joue un enregistrement <code>.bmmreplay</code> dans la page.</li>'
                        + '<li>Plus les <b>tableaux</b> GFM, le <b>code</b> en blocs, les listes, les citations et les admonitions <code>!!!</code> façon mkdocs.</li></ul>'
                        + '<h4>Deux règles</h4><ul><li>Laissez une <b>ligne vide</b> avant un bloc — <code>:::note</code> collé sous un paragraphe est lu comme en faisant partie.</li><li><b>Fermez ce que vous ouvrez.</b> Les blocs s’imbriquent librement, et chaque <code>:::</code> ferme le plus proche encore ouvert.</li></ul>'
                        + '<p><b>Sur le site il y en a d’autres</b> — cartes, feuilles de route, lignes de téléchargement, badges, icônes et touches clavier en ligne. Ceux-là s’affichent sur BetterCommunity ; dans BMM ils sortent en texte brut. La liste complète est dans la doc en ligne.</p>',
                },
            },
            {
                id: 'translate-bmm', docsPath: 'how-it-works/extending/', view: 'settings', diagram: 'i18n-system',
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
                id: 'command-palette', docsPath: 'features/command-palette/', view: 'settings',
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
                id: 'integrations', docsPath: 'features/community/', diagram: 'discord-rpc',
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
Add actions (~60 — activate a profile, enable a modpack, sync a repo, benchmark a disk, launch an app…), plus the full control-flow set: **IF/ELSE**, **LOOP** (while / until / do-while / N times), **FOR EACH** (over every enabled mod, profile, modpack or theme, with \`{item.name}\` in the body), **SWITCH**, **WAIT UNTIL**, and **TRY / ON ERROR** with **BREAK**, **CONTINUE** and **STOP**. Per-run variables let a measured value drive a later branch.
:::
:::step[Let it run]
While BMM is open a timer fires due tasks. Hit :kbd[▶] **Run now** any time, or **Test run** the unsaved draft.
:::
:::

:::tip[Run even when BMM is closed]
Flip this and the task registers with your OS scheduler, so it fires on time whether or not BMM is open. Deleting it in BMM removes the OS task too.
:::

### Running your own code

A step can **Run a script** — PowerShell, CMD, Bash, Python, JavaScript (Node) or Rust — written straight into the task. BMM saves it to a temp file and hands the interpreter the file, so nothing you write is ever pasted into a command line: there is no quoting or escaping to get right, and no stray quote can change what runs. Inside a **FOR EACH**, \`{item.name}\` and \`{item.id}\` are substituted before the script starts. Name a variable under *Advanced* and the script's first output line becomes a value later steps can test — otherwise a script can only pass or fail.

There is also **Run external program** for the simpler case of launching something with arguments.

:::tip[Permissions are per task, and each names what it unlocks]
A task grants three capabilities separately: **Run external programs**, **Run scripts**, and **Fire deeplinks**. Each is off until you turn it on, and a step whose permission is missing fails with a message naming the one to grant — it never runs quietly.

**Fire deeplinks** deserves a moment: a \`bmm://\` link reaches anything the app exposes, including actions with no step of their own, so it is the widest of the three. Tasks made before permissions were split keep what they already had, but none gains *Run scripts* — that capability did not exist when you agreed to the old single checkbox.
:::

It can drive [Launch Packs](doc:launch-packs), your [storage](doc:storage-manager) limits and [benchmarks](doc:benchmarks). Share a whole set with **Export/Import .BMMPA** — imports arrive disabled and never register OS tasks on their own. Find it in **Settings → Scheduler**.`,
                    fr: `Le **Planificateur** transforme BMM en outil d’automatisation : une tâche associe un **déclencheur** (quand) à un **workflow** (quoi) — et un workflow peut se ramifier, boucler et attendre, pas seulement dérouler une liste plate.

:::steps
:::step[Choisis un déclencheur]
Toutes les N minutes/heures, chaque jour/semaine/mois à une heure, une fois, au démarrage de l’app, ou manuel (tu le lances).
:::
:::step[Construis le workflow]
Ajoute des actions (~60 — activer un profil, appliquer un modpack, synchroniser un dépôt, benchmarker un disque, lancer une app…), plus des blocs **SI/SINON**, **BOUCLE** et **ATTENDRE**, avec des variables par exécution pour qu’une valeur mesurée pilote une branche suivante, plus tout le contrôle de flux : **SI/SINON**, **BOUCLE** (tant que / jusqu'à / do-while / N fois), **POUR CHAQUE** (sur chaque mod activé, profil, modpack ou thème, avec \`{item.name}\` dans le corps), **SWITCH**, **ATTENDRE**, et **ESSAYER / EN CAS D'ERREUR** avec **SORTIR**, **CONTINUER** et **ARRÊTER**.
:::
:::step[Laisse-le tourner]
Tant que BMM est ouvert, une minuterie déclenche les tâches dues. Fais :kbd[▶] **Lancer maintenant** à tout moment, ou **Test** sur le brouillon non enregistré.
:::
:::

:::tip[Exécuter même quand BMM est fermé]
Active ça et la tâche s’enregistre auprès du planificateur de l’OS : elle part à l’heure, que BMM soit ouvert ou non. La supprimer dans BMM supprime aussi la tâche OS.
:::

### Exécuter ton propre code

Une étape peut **Exécuter un script** — PowerShell, CMD, Bash, Python, JavaScript (Node) ou Rust — écrit directement dans la tâche. BMM l’enregistre dans un fichier temporaire et donne ce fichier à l’interpréteur : rien de ce que tu écris n’est collé dans une ligne de commande, il n’y a donc aucun échappement à réussir, et aucun guillemet égaré ne peut changer ce qui s’exécute. Dans un **POUR CHAQUE**, \`{item.name}\` et \`{item.id}\` sont remplacés avant le démarrage du script. Nomme une variable dans *Avancé* et la première ligne de sortie devient une valeur testable par les étapes suivantes — sinon un script ne peut que réussir ou échouer.

Il existe aussi **Lancer un programme externe** pour le cas plus simple d’un exécutable avec des arguments.

:::tip[Les permissions sont par tâche, et chacune dit ce qu’elle débloque]
Une tâche accorde trois capacités séparément : **Lancer des programmes externes**, **Exécuter des scripts** et **Déclencher des deeplinks**. Chacune est désactivée tant que tu ne l’actives pas, et une étape dont la permission manque échoue avec un message indiquant laquelle accorder — elle ne s’exécute jamais en silence.

**Déclencher des deeplinks** mérite une seconde d’attention : un lien \`bmm://\` atteint tout ce que l’app expose, y compris des actions sans étape dédiée — c’est la plus large des trois. Les tâches créées avant la séparation gardent ce qu’elles avaient déjà, mais aucune ne gagne *Exécuter des scripts* : cette capacité n’existait pas quand tu as coché l’ancienne case unique.
:::

Il peut piloter les [Launch Packs](doc:launch-packs), tes limites de [stockage](doc:storage-manager) et les [benchmarks](doc:benchmarks). Partage tout un jeu avec **Exporter/Importer .BMMPA** — les imports arrivent désactivés et n’enregistrent jamais de tâches OS tout seuls. Dans **Réglages → Planificateur**.`,
                },
            },
            {
                id: 'bmmscript', view: 'settings', docsPath: 'features/bmmscript/',
                title: { en: 'BMMScript — automations as code', fr: 'BMMScript — les automatisations en code' },
                summary: {
                    en: 'Write a task as text instead of bricks — and open it back up as bricks.',
                    fr: 'Écrire une tâche en texte plutôt qu’en briques — et la rouvrir en briques.',
                },
                keywords: 'bmmscript code advanced language script compile task automation avancé langage compiler texte',
                body: {
                    en: `The scheduler has a second way to write the same thing: **BMMScript**, the automation as text.

It is not a separate language with its own actions. It **compiles to the bricks** — the text becomes exactly the steps the brick editor produces, and the same runner executes them.

\`\`\`
task "Nightly tidy" {
    every day at 03:00
    allow script

    do mods.scan()
    if online and not modEnabled(id: "keep-me") {
        do notify(message: "Scanning…")
        wait 30s
    }
    for item in enabledMods {
        try { do mod.disable(id: "{item.id}") }
        catch { do notify(message: "Could not disable {item.name}") }
    }
}
\`\`\`

:::tip[Why compiled and not interpreted]
Three things follow from it, and they are the whole reason. **It is never behind the bricks** — an action is \`do <name>(…)\` and the language holds no list of names, so an action added tomorrow is writable today. **You can switch modes** — code opens as bricks, bricks print as code. **It cannot do more than a brick can** — permissions, variables and loop caps are the runner's, unchanged.
:::

It computes, too: \`set count = count + 1\`, \`if count >= 3\`, and \`set n: number = 0\` checked as you type. The only things deliberately out are functions of your own and recursion.

### Doing several things at once

\`\`\`
parallel settle {
    branch { do repo.sync() }
    branch { do benchmark.run() }
}
\`\`\`

Branches start together. \`parallel\` stops as soon as one fails; \`parallel settle\` lets them all finish and says how many did not. They share the task's variables, so use them for work that does not depend on each other.

\`run "Other task"\` waits for it; \`spawn "Other task"\` starts it and carries on.

### Real code, without escaping it

\`\`\`
script python {
    import os
    print(os.getcwd())
}
\`\`\`

PowerShell, CMD, Bash, Python, JavaScript (Node) or Rust, body taken exactly as written. As an action parameter this needed every quote and newline escaped, which is why nobody used it.

You do not have to choose between the two. The action **Run BMMScript (advanced)** takes a snippet with no \`task\` wrapper and runs it inside the surrounding task — same variables, same permissions. The editor compiles it as you type and names the line of the first error.

One thing an round trip does not keep: **comments and blank lines**. They are yours, not the task's, and the brick tree has nowhere to put them.

### Sharing one

A \`.bmmscript\` is a plain text file. Double-click one and BMM opens it — it does NOT run it. You get the compiled steps, every script body in full, and then one of two things: a script that asks for nothing runs on one click, and one that grants itself \`command\`, \`script\`, \`deeplink\` or \`stopProcess\` stays disabled until you tick that you have read it. Those four are the only things a task can do that the app's own buttons cannot.

The full reference — every trigger, statement and condition — is on the docs site.`,
                    fr: `Le planificateur offre une seconde façon d’écrire la même chose : **BMMScript**, l’automatisation en texte.

Ce n’est pas un langage à part avec ses propres actions. Il **se compile vers les briques** — le texte devient exactement les étapes que produit l’éditeur de briques, et c’est le même exécuteur qui les fait tourner.

\`\`\`
task "Ménage nocturne" {
    every day at 03:00
    allow script

    do mods.scan()
    if online and not modEnabled(id: "garde-moi") {
        do notify(message: "Analyse…")
        wait 30s
    }
    for item in enabledMods {
        try { do mod.disable(id: "{item.id}") }
        catch { do notify(message: "Impossible de désactiver {item.name}") }
    }
}
\`\`\`

:::tip[Pourquoi compilé et non interprété]
Trois conséquences, et c’est toute la raison. **Il n’est jamais en retard sur les briques** — une action s’écrit \`do <nom>(…)\` et le langage ne contient aucune liste de noms, donc une action ajoutée demain s’écrit déjà. **Vous pouvez changer de mode** — le code s’ouvre en briques, les briques s’impriment en code. **Il ne peut pas faire plus qu’une brique** — permissions, variables et limites de boucle sont celles de l’exécuteur, inchangées.
:::

Il calcule aussi : \`set count = count + 1\`, \`if count >= 3\`, et \`set n: number = 0\` vérifié pendant que vous tapez. Les seules choses volontairement hors périmètre sont vos propres fonctions et la récursion.

### Faire plusieurs choses à la fois

\`\`\`
parallel settle {
    branch { do repo.sync() }
    branch { do benchmark.run() }
}
\`\`\`

Les branches démarrent ensemble. \`parallel\` s’arrête dès qu’une échoue ; \`parallel settle\` les laisse toutes finir et dit combien ont échoué. Elles partagent les variables de la tâche — servez-vous en pour du travail indépendant.

\`run "Autre tâche"\` attend ; \`spawn "Autre tâche"\` la démarre et continue.

### Du vrai code, sans rien échapper

\`\`\`
script python {
    import os
    print(os.getcwd())
}
\`\`\`

PowerShell, CMD, Bash, Python, JavaScript (Node) ou Rust, corps pris exactement tel qu’écrit. En paramètre d’action il fallait échapper chaque guillemet et chaque retour à la ligne, et c’est pour ça que personne ne s’en servait.

Vous n’avez pas à choisir entre les deux modes. L’action **Exécuter du BMMScript (avancé)** prend un extrait sans enveloppe \`task\` et l’exécute dans la tâche qui l’entoure — mêmes variables, mêmes permissions. L’éditeur le compile pendant que vous tapez et nomme la ligne de la première erreur.

Une chose que l’aller-retour ne garde pas : **les commentaires et les lignes vides**. Ils sont à vous, pas à la tâche, et l’arbre de briques n’a nulle part où les mettre.

### En partager un

Un \`.bmmscript\` est un simple fichier texte. Double-cliquez dessus et BMM l’ouvre — il ne l’exécute PAS. Vous voyez les étapes compilées, chaque corps de script en entier, puis deux cas : un script qui ne demande rien s’exécute en un clic, et un qui s’accorde \`command\`, \`script\`, \`deeplink\` ou \`stopProcess\` reste bloqué tant que vous n’avez pas coché que vous l’avez lu. Ces quatre capacités sont les seules qu’une tâche peut avoir et que les boutons de l’app n’ont pas.

La référence complète — chaque déclencheur, instruction et condition — est sur le site de documentation.`,
                },
            },
            {
                // GENERATED body. The one article in this hub whose text is not written here, because
                // it is the one whose text can be WRONG the moment somebody adds an action — and the
                // article beside it, 'actions-reference', is exactly what that looks like: 32,000
                // characters describing the categories, naming two of the seventy-five actions.
                //
                // Both are kept. That one explains what the two action catalogues are FOR; this one
                // is the lookup table, and neither does the other's job.
                id: 'bmmscript-reference', view: 'settings', docsPath: 'features/bmmscript-reference/', wide: true,
                title: { en: 'BMMScript — every action, condition and value', fr: 'BMMScript — toutes les actions, conditions et valeurs' },
                summary: {
                    en: 'The complete list, generated from BMM’s own registry so it cannot describe a version that does not exist.',
                    fr: 'La liste complète, générée depuis le registre de BMM pour qu’elle ne puisse pas décrire une version qui n’existe pas.',
                },
                keywords: 'bmmscript reference list actions conditions values sources parameters référence liste actions conditions valeurs paramètres complete complète',
                body: { en: BMMS_REFERENCE.en, fr: BMMS_REFERENCE.fr },
            },
            {
                id: 'actions-reference', view: 'plugins', docsPath: 'reference/actions/', wide: true,
                title: { en: 'Action reference', fr: 'Référence des actions' },
                summary: { en: 'Every action the scheduler and the script generator can perform — the complete list.', fr: 'Toutes les actions du planificateur et du générateur de scripts — la liste complète.' },
                keywords: 'action list catalogue scheduler script generator deeplink endpoint condition variable liste catalogue planificateur générateur',
                body: {
                    en: `BMM has **two action catalogues**. They overlap in capability but are separate systems — pick by *who runs it*.

| | Where | What it drives |
|---|---|---|
| **Scheduled-task actions** | Settings → Scheduler | Steps inside a workflow BMM runs on a trigger |
| **Script generator actions** | Plugins & API → script generator | Blocks that emit a runnable script (\`bmm://\` deeplinks and/or HTTP calls) |

:::tip[Which one do I want?]
Use the **scheduler** when BMM should do it *by itself*. Use the **script generator** when you want a script you can run from outside BMM — a batch file, another tool, a game launcher.
:::

## Part 1 — Scheduled-task actions

Grouped exactly as the action dropdown groups them.

#### Mods & profiles

| Action | What it does | You provide |
|---|---|---|
| Activate profile | Switches the active profile | profile |
| Enable mod | Enables one mod | mod |
| Disable mod | Disables one mod | mod |
| Enable modpack | Enables every mod in a modpack | modpack |
| Disable modpack | Disables every mod in a modpack | modpack |
| Create modpack | Creates an empty modpack | name, profile |
| Add a mod (from URL) | Downloads and installs a mod | URL, name |
| Export a mod list (.mmlist) | Writes a mod list | — |
| Import a mod list (.mmlist) | Reads a mod list back | — |
| Enable all mods | Enables everything in the profile | — |
| Disable all mods | Disables everything in the profile | — |
| Scan mods folder | Re-scans for new mods | — |
| Apply plugin | Applies a plugin's mod list | plugin id |
| Compare plugin | Compares against a plugin's list | plugin id |
| Delete plugin | Uninstalls a plugin | plugin id |
| Check mod updates | Checks mods for new versions | — |
| Auto-import Open Mod Manager mods | Imports mods from an OMM setup | — |
| Clear profile activity history | Wipes the profile's history | profile |
| Export modpack (.bmp) | Writes a modpack file | modpack, destination |

:::warning[Enable actions skip the integrity check]
*Enable mod*, *Enable modpack* and *Enable all mods* run with the SHA check bypassed — a scheduled run can't stop to ask you about a missing hash. Enable by hand if you want the prompt.
:::

#### Repo & sharing

| Action | What it does | You provide |
|---|---|---|
| Connect repo | Adds a remote repo | repo.json URL, name |
| Sync repo | Downloads and integrates a remote profile | repo URL, remote profile |
| Generate repo | Opens repo generation | — |
| Update repo | Updates a repo folder | repo folder |
| Host repo (HTTP) | **Serves a folder over HTTP** | folder, port |

#### Apps & launch

| Action | What it does | You provide |
|---|---|---|
| Launch app | Starts a registered app | app (or exe path) |
| Open / launch a file or program | **Runs any file**, including \`.exe\` | path |
| Open a folder | Opens a folder in the explorer | path |
| Install app | Downloads and installs an app | app id, URL, title |
| Run launch pack | Runs a Launch Pack | launch pack |

#### Appearance

| Action | What it does | You provide |
|---|---|---|
| Set theme | Applies a theme | theme |

#### Benchmarks & storage

| Action | What it does | Captures |
|---|---|---|
| Run benchmark | Runs the app benchmark (dataset, size S/M/L/XL or custom MB) | \`benchmark.mbps\`, \`benchmark.total_ms\` |
| Benchmark a disk | Measures a disk's read/write speed | \`disk.read_mbps\`, \`disk.write_mbps\`, \`disk.suggested_limit\` |
| Apply disk speed limit | Sets a per-disk MB/s cap — empty uses the suggested value from a preceding benchmark, \`0\` = unlimited | — |
| Performance Auto-Calibration | Turns auto-calibration on/off | — |
| Smart I/O | Turns Smart I/O on/off | — |
| Toggle a setting (advanced) | Flips **any** boolean setting by key | — |
| Check free disk space | Reads free space | \`disk.free_gb\`, \`disk.total_gb\`, \`disk.free_percent\` |

Those captured values are what the \`value\` condition compares against — that's how you build *“benchmark the disk, and if it's slower than 50 MB/s, warn me”*.

#### Privacy & recorder

| Action | What it does |
|---|---|
| Telemetry consent | Turns telemetry on/off |
| Telemetry options | Replay / **Full (unmasked)** / benchmark reporting |
| Session recorder | Record on/off, **Full (unmasked)**, Rust log, JS log |
| Export replay | Exports the current recording |
| Import replay | Loads a \`.bmmreplay\` from a path or URL |

:::danger[“Full” means unmasked]
Normally replays mask mod names, profile names and paths as \`••••\`. The *Full* switches turn that masking **off**. Don't schedule it unless you know where the data goes.
:::

#### System & flow

| Action | What it does | Notes |
|---|---|---|
| Show notification | Toasts a message | |
| Discord Rich Presence | Turns Discord RPC on/off | |
| Export data (backup) | Writes a backup — the filename template supports \`{date}\`, \`{time}\`, \`{datetime}\` | the *overwrite* collision mode **replaces** an existing backup |
| Set a value | Sets a variable for later conditions | |
| Check for BMM update | Checks for a new version | captures \`update.available\` |
| Clear API log | Empties the API log | |
| Clear resource monitor records | Empties the resource records | |
| Run another scheduled task | Runs another task and waits | sets \`lasttask.ok\` (1/0) — **a task calling itself recurses** |
| Restart BMM | Restarts the app | ends the running task |
| Open a URL / link | Opens a link in your browser | |
| Run custom command | **Runs an arbitrary program** | requires *Allow custom commands* on the task |
| Run \`bmm://\` deeplink | Fires any deeplink | can reach any deeplink action |

#### Logic & maths

| Action | What it does |
|---|---|
| Compute into a variable | Arithmetic (\`+ - * / % ^\`, parentheses, variables, functions). A real parser — **no \`eval\`** |
| Ternary | \`var = condition ? a : b\` |
| Rule table | Walks rows, **first match wins**, writes the result into a variable |
| Stop the task (guard clause) | Ends the task **cleanly** — not an error |

#### Conditions

Used by **IF**, **WAIT UNTIL** and **LOOP**. Every condition has a **NOT** box.

| Condition | True when |
|---|---|
| \`always\` | Always — no gate |
| \`value\` | A captured number compares (\`>\` \`<\` \`>=\` \`<=\` \`==\` \`!=\`) against your threshold |
| \`profileActive\` | A given profile is the active one |
| \`modEnabled\` / \`modDisabled\` | A given mod is on / off |
| \`modpackActive\` / \`modpackInactive\` | Every mod in a modpack is on / off |
| \`allModsActive\` | Everything in the active profile is on |
| \`appRunning\` / \`appNotRunning\` | A process (by exe name) is / isn't running |
| \`fileExists\` | A path exists |
| \`fileHash\` | A file's hash (blake3/sha256) matches |
| \`fileSize\` | A file's size compares |
| \`fileType\` | A file's extension matches |
| \`fileName\` | A file name contains a substring |
| \`fileNewer\` | A file was modified within N minutes |
| \`online\` | There's an internet connection |
| \`timeReached\` | The clock has passed a time |
| \`dayOfWeek\` | Today is one of the days you picked |
| \`timeRange\` | The clock is inside a range (**wraps over midnight**) |
| \`commandSucceeds\` | An external command exits \`0\` — note this **runs the program** just to evaluate the condition |

:::note[Missing data is false, not an error]
If a \`value\` condition names a variable that was never captured, it's simply false — it won't fire on missing data.
:::

**Capturable variables:** \`disk.read_mbps\`, \`disk.write_mbps\`, \`disk.suggested_limit\`, \`benchmark.mbps\`, \`benchmark.total_ms\`, \`lasttask.ok\`, \`disk.free_gb\`, \`disk.total_gb\`, \`disk.free_percent\`, \`update.available\`, plus any variable you set yourself.

## Part 2 — Script generator actions

Each block is either a **deeplink** (\`bmm://…\`), an **HTTP call** to BMM's local API, or a **native** operation (a wait, a loop, a print) that needs no API at all.

:::note[Deeplink or HTTP?]
In deeplink mode, actions that have a native \`bmm://\` URL emit one; everything else falls back to an HTTP call — and an HTTP call needs an API token. Anything without a dedicated deeplink can still be reached through the generic passthrough \`bmm://api?method=<M>&path=<path>&<field>=<value>\`.
:::

#### Mods

| Action | Emits |
|---|---|
| Enable mod | \`bmm://mod/enable?id=\` · \`POST /api/mods/enable\` |
| Disable mod | \`bmm://mod/disable?id=\` · \`POST /api/mods/disable\` |
| Switch profile | \`bmm://profile/activate?id=\` · \`POST /api/profiles/activate\` |
| Enable modpack | \`bmm://modpack/enable?id=\` · \`POST /api/modpacks/enable\` |
| Disable modpack | \`bmm://modpack/disable?id=\` · \`POST /api/modpacks/disable\` |
| Apply plugin | \`bmm://plugin/activate?id=\` · \`POST /api/plugins/apply\` |
| Compare plugin | \`bmm://plugin/compare?id=\` · \`POST /api/plugins/compare\` |
| Update modpack | \`PUT /api/modpacks/{id}\` |
| Delete mod | \`DELETE /api/mods/{id}\` |
| Update mod | \`PUT /api/mods/{id}\` — name, version, author, description |
| Create profile | \`POST /api/profiles\` — name, game, the three folders |
| Update profile | \`PUT /api/profiles/{id}\` |
| Delete profile | \`DELETE /api/profiles/{id}\` |
| Create modpack | \`POST /api/modpacks/create\` |
| Delete modpack | \`DELETE /api/modpacks/{id}\` |
| Run benchmark | \`bmm://benchmark/run?…\` · \`POST /api/benchmark\` |
| Check mod updates | \`bmm://mod/check-updates\` · \`POST /api/mod/check-updates\` |

#### Repo

| Action | Emits |
|---|---|
| Sync repo | \`POST /api/repo/sync\` — URL, folders, speed cap, **download password**, overwrite, *delete extra* |
| Cancel sync | \`DELETE /api/repo/sync/cancel\` |
| Generate repo | \`POST /api/repo/gen\` — profile, output, author, port, admin password, zip, auto-start |
| Cancel gen | \`DELETE /api/repo/gen/cancel\` |
| Start HTTP host | \`POST /api/repo/host\` — folder, port, upload cap |
| Stop HTTP host | \`DELETE /api/repo/host\` |
| Update repo | \`POST /api/repo/update\` |
| Connect repo | \`POST /api/repo/connect\` |
| Remove repo | \`DELETE /api/repo\` |

:::warning[“Delete extra” removes local files]
On *Sync repo*, that switch makes the local copy match the remote exactly — anything extra on your side is deleted.
:::

#### Apps

| Action | Emits |
|---|---|
| Install app | \`POST /api/apps/install\` — id, title, URL, file type |
| Launch app | \`POST /api/apps/launch\` |
| List installed apps | \`GET /api/apps\` |
| Uninstall app | \`DELETE /api/apps/{appId}\` — deregisters, files stay on disk |

#### Read — all \`GET\`, no token needed, print JSON

\`GET /api/status\` · \`/api/mods\` · \`/api/mods/active\` · \`/api/mods/all\` · \`/api/profiles\` · \`/api/plugins\` · \`/api/modpacks\` · \`/api/check-update\` · \`/api/creator-id\` · \`/api/health\` · \`/api/repo/list\` · \`/api/repo/info?url=&password=\`

:::warning[Repo info puts the password in the query string]
*Repo info* passes the download password as a URL parameter. Don't paste the generated line into a shared log or a chat.
:::

#### System

| Action | Emits |
|---|---|
| Wait | native pause (seconds) |
| Kill process | native — **force-terminates** a process by name |
| Open URL | native shell open |
| Show message | native popup, waits for the user |
| Launch game | native — **runs an arbitrary executable** |
| Log line | native print |
| Restart BMM | \`POST /api/restart\` |
| Run launch pack | \`bmm://launchpack/run?id=\` · \`POST /api/launchpack/run\` |
| Discord Rich Presence | \`bmm://discord/rpc?enabled=\` · \`POST /api/discord/rpc\` |
| Export data (backup) | \`bmm://data/export-auto?…\` · \`POST /api/data/export-auto\` |
| Telemetry consent | \`bmm://telemetry/consent?enabled=\` · \`POST /api/telemetry/consent\` |
| Telemetry options | \`bmm://telemetry/set?…\` · \`POST /api/telemetry/settings\` |
| Session recorder | \`bmm://recorder/set?…\` · \`POST /api/recorder\` |
| Export replay | \`bmm://replay/export?path=\` · \`POST /api/replay/export\` — \`path\` skips the save dialog |
| Import replay | \`bmm://replay/import?…\` · \`POST /api/replay/import\` |
| **Open a screen** | \`bmm://view/open?id=\` · \`POST /api/view\` |

#### Driving BMM without a mouse

\`bmm://view/open?id=<screen>\` reaches every screen in the sidebar, and everything above can be
fired over the local API — so a script can walk the whole app. That is how the recordings in
BMM Docs are made.

The \`id\` is the sidebar's own value: \`library\`, \`profiles\`, \`modpacks\`, \`mapper\`, \`repo\`,
\`modlist\`, \`apps\`, \`plugins\`, \`community\`, \`settings\`, \`docs\`, \`credits\`. An id that names
no screen does nothing and says so in the console.

:::tip[Exporting without a dialog]
\`replay/export\` takes an optional \`path\`. With it, the file is written straight there; without
it BMM asks where to save — right for a person clicking Export, wrong for anything driving BMM
remotely, which has nobody to answer a picker.

\`full: true\` on the recorder records **real mod and profile names**; left off they are masked as
\`••••\`. For public documentation, record on a demo profile rather than unmasking a real library.
:::

#### Control flow

| Action | What it does |
|---|---|
| Run scheduled task | \`bmm://schedule/run?id=\` · \`POST /api/schedule/run\` — bridges to the scheduler |
| Comment | A comment line; runs nothing |
| Set variable | Assigns a variable |
| If file exists / is missing | Opens a conditional block |
| If variable == / != | Opens a conditional block |
| If API call OK / failed | **Runs the linked API call**, then branches on its result |
| Else | The other branch |
| End block | Closes an \`if\` / \`else\` |
| Pause (wait for key) | Waits for a keypress |
| Stop script | Exits immediately |
| Raw code | Inserts verbatim code into the generated script |
| Loop (repeat N times) / End loop | A counted loop |
| Verify file (hash → variable) | SHA-256 of a file into a variable |
| Wait until file exists | Polls until it appears, or times out |
| Math (compute → variable) | Arithmetic into a variable |
| Ternary | Conditional assignment |
| Guard clause (stop if…) | Exits when a condition holds |

:::note[The two catalogues are separate on purpose]
The scheduler has **real nested steps** (IF / LOOP / WAIT UNTIL blocks that contain other steps). The generator, producing flat text, uses **block markers** instead (\`If…\` / \`Else\` / \`End block\`). Some actions exist only on one side: the scheduler owns the storage actions, *Enable/Disable all*, *Scan*, *Set theme* and raw deeplinks; the generator owns the full CRUD and read endpoints, *Kill process*, *Raw code* and the textual control flow.
:::

See also [API & deeplinks](doc:api-reference), [Scheduling & automation](doc:scheduler) and [Plugins & API](doc:plugins).`,
                    fr: `BMM a **deux catalogues d’actions**. Leurs capacités se recoupent mais ce sont deux systèmes distincts — choisis selon *qui l’exécute*.

| | Où | Ce que ça pilote |
|---|---|---|
| **Actions de tâche planifiée** | Réglages → Planificateur | Des étapes d’un workflow que BMM exécute sur un déclencheur |
| **Actions du générateur de scripts** | Plugins & API → générateur de scripts | Des blocs qui produisent un script exécutable (deeplinks \`bmm://\` et/ou appels HTTP) |

:::tip[Lequel je veux ?]
Le **planificateur** quand BMM doit le faire *tout seul*. Le **générateur de scripts** quand tu veux un script lançable hors de BMM — un fichier batch, un autre outil, un lanceur de jeu.
:::

## Partie 1 — Actions de tâche planifiée

Regroupées exactement comme dans le menu déroulant des actions.

#### Mods & profils

| Action | Ce que ça fait | Tu fournis |
|---|---|---|
| Activer un profil | Change le profil actif | profil |
| Activer un mod | Active un mod | mod |
| Désactiver un mod | Désactive un mod | mod |
| Activer un modpack | Active tous les mods d’un modpack | modpack |
| Désactiver un modpack | Désactive tous les mods d’un modpack | modpack |
| Créer un modpack | Crée un modpack vide | nom, profil |
| Ajouter un mod (depuis une URL) | Télécharge et installe un mod | URL, nom |
| Exporter une liste de mods (.mmlist) | Écrit une liste de mods | — |
| Importer une liste de mods (.mmlist) | Relit une liste de mods | — |
| Activer tous les mods | Active tout dans le profil | — |
| Désactiver tous les mods | Désactive tout dans le profil | — |
| Scanner le dossier mods | Recherche les nouveaux mods | — |
| Appliquer un plugin | Applique la liste de mods d’un plugin | id du plugin |
| Comparer un plugin | Compare avec la liste d’un plugin | id du plugin |
| Supprimer un plugin | Désinstalle un plugin | id du plugin |
| Vérifier les mises à jour de mods | Cherche de nouvelles versions | — |
| Auto-importer les mods Open Mod Manager | Importe depuis une install OMM | — |
| Effacer l’historique d’activité du profil | Vide l’historique du profil | profil |
| Exporter un modpack (.bmp) | Écrit un fichier modpack | modpack, destination |

:::warning[Les actions d’activation sautent le contrôle d’intégrité]
*Activer un mod*, *Activer un modpack* et *Activer tous les mods* tournent avec le contrôle SHA contourné — une exécution planifiée ne peut pas s’arrêter pour te parler d’un hash manquant. Active à la main si tu veux la question.
:::

#### Dépôt & partage

| Action | Ce que ça fait | Tu fournis |
|---|---|---|
| Connecter un dépôt | Ajoute un dépôt distant | URL du repo.json, nom |
| Synchroniser un dépôt | Télécharge et intègre un profil distant | URL du dépôt, profil distant |
| Générer un dépôt | Ouvre la génération de dépôt | — |
| Mettre à jour un dépôt | Met à jour un dossier de dépôt | dossier du dépôt |
| Héberger un dépôt (HTTP) | **Sert un dossier en HTTP** | dossier, port |

#### Apps & lancement

| Action | Ce que ça fait | Tu fournis |
|---|---|---|
| Lancer une app | Démarre une app enregistrée | app (ou chemin de l’exe) |
| Ouvrir / lancer un fichier ou programme | **Exécute n’importe quel fichier**, \`.exe\` compris | chemin |
| Ouvrir un dossier | Ouvre un dossier dans l’explorateur | chemin |
| Installer une app | Télécharge et installe une app | id, URL, titre |
| Exécuter un launch pack | Lance un Launch Pack | launch pack |

#### Apparence

| Action | Ce que ça fait | Tu fournis |
|---|---|---|
| Définir le thème | Applique un thème | thème |

#### Benchmarks & stockage

| Action | Ce que ça fait | Capture |
|---|---|---|
| Lancer un benchmark | Lance le benchmark de l’app (jeu de données, taille S/M/L/XL ou Mo perso) | \`benchmark.mbps\`, \`benchmark.total_ms\` |
| Benchmarker un disque | Mesure la vitesse lecture/écriture d’un disque | \`disk.read_mbps\`, \`disk.write_mbps\`, \`disk.suggested_limit\` |
| Appliquer une limite de vitesse disque | Pose un plafond Mo/s par disque — vide = la valeur suggérée par un benchmark précédent, \`0\` = illimité | — |
| Auto-calibration des performances | Active/désactive l’auto-calibration | — |
| Smart I/O | Active/désactive Smart I/O | — |
| Basculer un réglage (avancé) | Inverse **n’importe quel** réglage booléen par clé | — |
| Vérifier l’espace disque libre | Lit l’espace libre | \`disk.free_gb\`, \`disk.total_gb\`, \`disk.free_percent\` |

Ces valeurs capturées sont ce que la condition \`value\` compare — c’est comme ça qu’on construit *« benchmarke le disque, et s’il est sous 50 Mo/s, préviens-moi »*.

#### Confidentialité & enregistreur

| Action | Ce que ça fait |
|---|---|
| Consentement télémétrie | Active/désactive la télémétrie |
| Options de télémétrie | Replay / **Complet (démasqué)** / rapport de benchmark |
| Enregistreur de session | Enregistrement on/off, **Complet (démasqué)**, log Rust, log JS |
| Exporter le replay | Exporte l’enregistrement courant |
| Importer un replay | Charge un \`.bmmreplay\` depuis un chemin ou une URL |

:::danger[« Complet » veut dire démasqué]
Normalement les replays masquent noms de mods, noms de profils et chemins en \`••••\`. Les interrupteurs *Complet* **coupent** ce masquage. Ne le planifie pas sans savoir où vont les données.
:::

#### Système & flux

| Action | Ce que ça fait | Notes |
|---|---|---|
| Afficher une notification | Affiche un toast | |
| Discord Rich Presence | Active/désactive Discord RPC | |
| Exporter les données (sauvegarde) | Écrit une sauvegarde — le modèle de nom accepte \`{date}\`, \`{time}\`, \`{datetime}\` | le mode de collision *écraser* **remplace** une sauvegarde existante |
| Définir une valeur | Pose une variable pour les conditions suivantes | |
| Vérifier les mises à jour de BMM | Cherche une nouvelle version | capture \`update.available\` |
| Effacer le journal API | Vide le journal API | |
| Effacer les relevés du moniteur de ressources | Vide les relevés | |
| Exécuter une autre tâche planifiée | Lance une autre tâche et attend | pose \`lasttask.ok\` (1/0) — **une tâche qui s’appelle elle-même récurse** |
| Redémarrer BMM | Redémarre l’app | met fin à la tâche en cours |
| Ouvrir une URL / un lien | Ouvre un lien dans le navigateur | |
| Lancer une commande personnalisée | **Exécute un programme arbitraire** | exige *Autoriser les commandes personnalisées* sur la tâche |
| Exécuter un deeplink \`bmm://\` | Déclenche n’importe quel deeplink | peut atteindre toute action deeplink |

#### Logique & maths

| Action | Ce que ça fait |
|---|---|
| Calculer dans une variable | Arithmétique (\`+ - * / % ^\`, parenthèses, variables, fonctions). Un vrai parseur — **pas d’\`eval\`** |
| Ternaire | \`var = condition ? a : b\` |
| Table de règles | Parcourt les lignes, **la première qui correspond gagne**, écrit le résultat dans une variable |
| Arrêter la tâche (garde) | Termine la tâche **proprement** — pas une erreur |

#### Conditions

Utilisées par **SI**, **ATTENDRE JUSQU’À** et **BOUCLE**. Chaque condition a une case **NON**.

| Condition | Vraie quand |
|---|---|
| \`always\` | Toujours — aucune barrière |
| \`value\` | Un nombre capturé se compare (\`>\` \`<\` \`>=\` \`<=\` \`==\` \`!=\`) à ton seuil |
| \`profileActive\` | Un profil donné est l’actif |
| \`modEnabled\` / \`modDisabled\` | Un mod donné est activé / désactivé |
| \`modpackActive\` / \`modpackInactive\` | Tous les mods d’un modpack sont on / off |
| \`allModsActive\` | Tout est activé dans le profil actif |
| \`appRunning\` / \`appNotRunning\` | Un processus (par nom d’exe) tourne / ne tourne pas |
| \`fileExists\` | Un chemin existe |
| \`fileHash\` | Le hash d’un fichier (blake3/sha256) correspond |
| \`fileSize\` | La taille d’un fichier se compare |
| \`fileType\` | L’extension d’un fichier correspond |
| \`fileName\` | Un nom de fichier contient une sous-chaîne |
| \`fileNewer\` | Un fichier a été modifié dans les N dernières minutes |
| \`online\` | Il y a une connexion Internet |
| \`timeReached\` | L’horloge a passé une heure |
| \`dayOfWeek\` | Aujourd’hui est l’un des jours choisis |
| \`timeRange\` | L’horloge est dans une plage (**passe minuit**) |
| \`commandSucceeds\` | Une commande externe sort en \`0\` — note que ça **exécute le programme** juste pour évaluer la condition |

:::note[Une donnée absente est fausse, pas une erreur]
Si une condition \`value\` nomme une variable jamais capturée, elle est simplement fausse — elle ne se déclenchera pas sur une donnée manquante.
:::

**Variables capturables :** \`disk.read_mbps\`, \`disk.write_mbps\`, \`disk.suggested_limit\`, \`benchmark.mbps\`, \`benchmark.total_ms\`, \`lasttask.ok\`, \`disk.free_gb\`, \`disk.total_gb\`, \`disk.free_percent\`, \`update.available\`, plus toute variable que tu poses toi-même.

## Partie 2 — Actions du générateur de scripts

Chaque bloc est soit un **deeplink** (\`bmm://…\`), soit un **appel HTTP** à l’API locale de BMM, soit une opération **native** (une attente, une boucle, un affichage) qui n’a besoin d’aucune API.

:::note[Deeplink ou HTTP ?]
En mode deeplink, les actions qui ont une URL \`bmm://\` native en émettent une ; tout le reste retombe sur un appel HTTP — et un appel HTTP exige un token d’API. Tout ce qui n’a pas de deeplink dédié reste atteignable via le passe-plat générique \`bmm://api?method=<M>&path=<chemin>&<champ>=<valeur>\`.
:::

#### Mods

| Action | Émet |
|---|---|
| Activer un mod | \`bmm://mod/enable?id=\` · \`POST /api/mods/enable\` |
| Désactiver un mod | \`bmm://mod/disable?id=\` · \`POST /api/mods/disable\` |
| Changer de profil | \`bmm://profile/activate?id=\` · \`POST /api/profiles/activate\` |
| Activer un modpack | \`bmm://modpack/enable?id=\` · \`POST /api/modpacks/enable\` |
| Désactiver un modpack | \`bmm://modpack/disable?id=\` · \`POST /api/modpacks/disable\` |
| Appliquer un plugin | \`bmm://plugin/activate?id=\` · \`POST /api/plugins/apply\` |
| Comparer un plugin | \`bmm://plugin/compare?id=\` · \`POST /api/plugins/compare\` |
| Mettre à jour un modpack | \`PUT /api/modpacks/{id}\` |
| Supprimer un mod | \`DELETE /api/mods/{id}\` |
| Mettre à jour un mod | \`PUT /api/mods/{id}\` — nom, version, auteur, description |
| Créer un profil | \`POST /api/profiles\` — nom, jeu, les trois dossiers |
| Mettre à jour un profil | \`PUT /api/profiles/{id}\` |
| Supprimer un profil | \`DELETE /api/profiles/{id}\` |
| Créer un modpack | \`POST /api/modpacks/create\` |
| Supprimer un modpack | \`DELETE /api/modpacks/{id}\` |
| Lancer un benchmark | \`bmm://benchmark/run?…\` · \`POST /api/benchmark\` |
| Vérifier les mises à jour de mods | \`bmm://mod/check-updates\` · \`POST /api/mod/check-updates\` |

#### Dépôt

| Action | Émet |
|---|---|
| Synchroniser un dépôt | \`POST /api/repo/sync\` — URL, dossiers, plafond de vitesse, **mot de passe de téléchargement**, écraser, *supprimer les extras* |
| Annuler la synchro | \`DELETE /api/repo/sync/cancel\` |
| Générer un dépôt | \`POST /api/repo/gen\` — profil, sortie, auteur, port, mot de passe admin, zip, démarrage auto |
| Annuler la génération | \`DELETE /api/repo/gen/cancel\` |
| Démarrer l’hébergement HTTP | \`POST /api/repo/host\` — dossier, port, plafond d’upload |
| Arrêter l’hébergement HTTP | \`DELETE /api/repo/host\` |
| Mettre à jour un dépôt | \`POST /api/repo/update\` |
| Connecter un dépôt | \`POST /api/repo/connect\` |
| Retirer un dépôt | \`DELETE /api/repo\` |

:::warning[« Supprimer les extras » efface des fichiers locaux]
Sur *Synchroniser un dépôt*, cet interrupteur aligne exactement la copie locale sur le distant — tout ce qui est en trop chez toi est supprimé.
:::

#### Apps

| Action | Émet |
|---|---|
| Installer une app | \`POST /api/apps/install\` — id, titre, URL, type de fichier |
| Lancer une app | \`POST /api/apps/launch\` |
| Lister les apps installées | \`GET /api/apps\` |
| Désinstaller une app | \`DELETE /api/apps/{appId}\` — désenregistre, les fichiers restent sur le disque |

#### Lecture — tous en \`GET\`, sans token, affichent le JSON

\`GET /api/status\` · \`/api/mods\` · \`/api/mods/active\` · \`/api/mods/all\` · \`/api/profiles\` · \`/api/plugins\` · \`/api/modpacks\` · \`/api/check-update\` · \`/api/creator-id\` · \`/api/health\` · \`/api/repo/list\` · \`/api/repo/info?url=&password=\`

:::warning[Repo info met le mot de passe dans la query string]
*Repo info* passe le mot de passe de téléchargement en paramètre d’URL. Ne colle pas la ligne générée dans un journal partagé ou un chat.
:::

#### Système

| Action | Émet |
|---|---|
| Attendre | pause native (secondes) |
| Tuer un processus | natif — **termine de force** un processus par nom |
| Ouvrir une URL | ouverture shell native |
| Afficher un message | popup native, attend l’utilisateur |
| Lancer le jeu | natif — **exécute un exécutable arbitraire** |
| Écrire une ligne de log | affichage natif |
| Redémarrer BMM | \`POST /api/restart\` |
| Exécuter un launch pack | \`bmm://launchpack/run?id=\` · \`POST /api/launchpack/run\` |
| Discord Rich Presence | \`bmm://discord/rpc?enabled=\` · \`POST /api/discord/rpc\` |
| Exporter les données (sauvegarde) | \`bmm://data/export-auto?…\` · \`POST /api/data/export-auto\` |
| Consentement télémétrie | \`bmm://telemetry/consent?enabled=\` · \`POST /api/telemetry/consent\` |
| Options de télémétrie | \`bmm://telemetry/set?…\` · \`POST /api/telemetry/settings\` |
| Enregistreur de session | \`bmm://recorder/set?…\` · \`POST /api/recorder\` |
| Exporter le replay | \`bmm://replay/export?path=\` · \`POST /api/replay/export\` — \`path\` évite la boîte de dialogue |
| Importer un replay | \`bmm://replay/import?…\` · \`POST /api/replay/import\` |
| **Ouvrir un écran** | \`bmm://view/open?id=\` · \`POST /api/view\` |

#### Piloter BMM sans souris

\`bmm://view/open?id=<écran>\` atteint tous les écrans de la barre latérale, et tout ce qui précède
peut être déclenché par l’API locale — un script peut donc parcourir toute l’application. C’est
ainsi que sont faits les enregistrements de BMM Docs.

L’\`id\` est la valeur de la barre latérale elle-même : \`library\`, \`profiles\`, \`modpacks\`,
\`mapper\`, \`repo\`, \`modlist\`, \`apps\`, \`plugins\`, \`community\`, \`settings\`, \`docs\`,
\`credits\`. Un id qui ne désigne aucun écran ne fait rien et le signale dans la console.

:::tip[Exporter sans boîte de dialogue]
\`replay/export\` accepte un \`path\` facultatif. Avec, le fichier est écrit directement ; sans, BMM
demande où enregistrer — ce qui convient à une personne qui clique sur Exporter, et pas du tout à
un pilotage à distance, qui n’a personne pour répondre au sélecteur.

\`full: true\` sur l’enregistreur capture les **vrais noms de mods et de profils** ; sans lui ils
sont masqués en \`••••\`. Pour de la documentation publique, enregistrez sur un profil de
démonstration plutôt que de démasquer une vraie bibliothèque.
:::

#### Contrôle de flux

| Action | Ce que ça fait |
|---|---|
| Exécuter une tâche planifiée | \`bmm://schedule/run?id=\` · \`POST /api/schedule/run\` — passerelle vers le planificateur |
| Commentaire | Une ligne de commentaire ; n’exécute rien |
| Définir une variable | Assigne une variable |
| Si le fichier existe / est absent | Ouvre un bloc conditionnel |
| Si variable == / != | Ouvre un bloc conditionnel |
| Si l’appel API réussit / échoue | **Exécute l’appel API lié**, puis branche sur son résultat |
| Sinon | L’autre branche |
| Fin de bloc | Ferme un \`if\` / \`else\` |
| Pause (attendre une touche) | Attend une frappe |
| Arrêter le script | Sort immédiatement |
| Code brut | Insère du code verbatim dans le script généré |
| Boucle (répéter N fois) / Fin de boucle | Une boucle comptée |
| Vérifier un fichier (hash → variable) | Le SHA-256 d’un fichier dans une variable |
| Attendre qu’un fichier existe | Interroge jusqu’à ce qu’il apparaisse, ou expire |
| Maths (calcul → variable) | Arithmétique dans une variable |
| Ternaire | Assignation conditionnelle |
| Garde (arrêter si…) | Sort quand une condition est vraie |

:::note[Les deux catalogues sont séparés exprès]
Le planificateur a de **vraies étapes imbriquées** (des blocs SI / BOUCLE / ATTENDRE qui contiennent d’autres étapes). Le générateur, qui produit du texte plat, utilise à la place des **marqueurs de bloc** (\`Si…\` / \`Sinon\` / \`Fin de bloc\`). Certaines actions n’existent que d’un côté : le planificateur détient les actions de stockage, *Activer/Désactiver tout*, *Scanner*, *Définir le thème* et les deeplinks bruts ; le générateur détient le CRUD complet et les endpoints de lecture, *Tuer un processus*, *Code brut* et le contrôle de flux textuel.
:::

Voir aussi [API & deeplinks](doc:api-reference), [Planification & automatisation](doc:scheduler) et [Plugins & API](doc:plugins).`,
                },
            },
            {
                id: 'api-reference', view: 'plugins', docsPath: 'reference/api/', wide: true,
                title: { en: 'API & deeplink reference', fr: 'Référence API & deeplinks' },
                summary: { en: 'Every bmm:// deeplink and every HTTP endpoint — the complete list.', fr: 'Chaque deeplink bmm:// et chaque endpoint HTTP — la liste complète.' },
                keywords: 'api deeplink endpoint bmm:// token permission curl http port 51274 rest liste complète endpoints',
                body: {
                    en: `Two ways to drive BMM from outside: **deeplinks** (\`bmm://…\`, no token, fired at the running window) and a **local HTTP API** (token, \`127.0.0.1\` only).

:::tip[Which one?]
A deeplink is a URL — anything that can open a link can trigger it (a \`.bat\`, a shortcut, a website) and it needs no secret. The HTTP API is for reading data back and for payloads a URL cannot express. If a thing exists as both, prefer the deeplink.
:::

## Transport

| | |
|---|---|
| Base URL | \`http://127.0.0.1:51274\` |
| Bind address | **\`127.0.0.1\` only** — never \`0.0.0.0\`, so nothing off-machine can reach it |
| Port | \`51274\` by default; override with \`api_port\` in settings (\`0\` = the default). Needs a restart |
| Effective port | Read it at runtime from \`GET /api/health\` → \`port\` |
| Rate limiting | **None.** Do not expose this port |

:::warning[If the port is already taken, the API does not start at all]
It does **not** fall back to another port. If something already holds 51274 — typically a zombie instance after an in-app restart — the API is **disabled for that whole session** and a line goes to the crash log. The app keeps working normally, so a script failing to connect is the only symptom. Check \`GET /api/health\` first.
:::

**CORS.** In a release build, origins are limited to \`https://tauri.localhost\`, \`tauri://localhost\`, \`http://tauri.localhost\`, \`https://bettercommunity.ch\`, plus anything you add under **CORS** on this page (a lone \`*\` entry opts into allow-any). The list is read **once when the API starts**, so a change needs a restart of BMM (or of the API) to take effect — the panel says so under the list. \`curl\` and deeplinks send no \`Origin\`, so none of this affects them.

The panel is two decisions, not one. **Allow any origin** is the switch at the top; the bordered box under it is the allow-list you build yourself. Turning the switch on does not empty that list — it stops it being consulted, and the box says so rather than merely greying out, because a control that dims without explanation reads as broken rather than as not applicable. Turn the switch off and your list is live again, exactly as you left it.

## Authenticating

\`\`\`bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:51274/api/mods
\`\`\`

\`Authorization: Bearer …\` is the only accepted form, and it is compared in **constant time**.

| | Where it comes from | Scope |
|---|---|---|
| **Admin token** | A UUID v4 minted on first run. Rotate it on this page | Everything. Bypasses all permission checks |
| **Plugin token** | Issued per plugin | Only what that plugin has been granted |

The token is re-read on **every** request, so rotating takes effect immediately — no restart. For a plugin token the caller's identity comes **from the token**, never from the \`X-BMM-Plugin-Id\` header, so a plugin cannot escalate by forging it. The ten grants: \`app.read\` · \`app.write\` · \`catalog.read\` · \`catalog.write\` · \`modpacks.write\` · \`mods.write\` · \`plugins.read\` · \`plugins.write\` · \`profiles.write\` · \`repo.write\`

:::note[Read endpoints are not permission-gated]
There is no \`mods.read\` / \`profiles.read\`. Routes marked *no token* below are open to anything that can reach the port; routes marked *token* accept **any** valid token, including a plugin token with no permissions at all.
:::

| Status | Body |
|---|---|
| \`401\` | invalid or missing token |
| \`403\` | the plugin lacks a permission — the message names it and the route that grants it |
| \`400\` | bad JSON body |
| \`404\` / \`405\` / \`500\` | \`{"error":"…"}\` |

## Deeplinks

Fired at the running window — **no token**. \`*\` marks a required parameter. Each one shows a toast on receipt, and a global kill switch refuses all of them.

\`\`\`bat
start "" "bmm://mod/enable?id=my-mod-folder"
\`\`\`

#### Mods, profiles, modpacks

| Deeplink | Params | Does |
|---|---|---|
| \`bmm://mod/enable\` | \`id\`* | Enables a mod in the active profile |
| \`bmm://mod/disable\` | \`id\`* | Disables it |
| \`bmm://profile/activate\` | \`id\`* (profile UUID) | Switches the active profile |
| \`bmm://modpack/enable\` | \`id\`* | Enables every mod in a modpack — \`id\` accepts a **modpack or a profile** id |
| \`bmm://modpack/disable\` | \`id\`* | The inverse |
| \`bmm://modpack/create\` | \`name\`*, \`profile\` | Creates a modpack from a profile's active mods |
| \`bmm://install\` | \`url\`*, \`name\` | Downloads a mod and opens the install dialog |

#### Plugins, repo & updates

| Deeplink | Params | Does |
|---|---|---|
| \`bmm://plugin/activate\` | \`id\`* | Applies the plugin's modlist (and disables the rest if strict) |
| \`bmm://plugin/compare\` | \`id\`* | Opens the modlist-vs-active comparison |
| \`bmm://plugin/delete\` | \`id\`* | Uninstalls it — registry, permissions and files |
| \`bmm://repo/connect\` | \`url\`*, \`name\` | Registers a remote repo (the parent folder is enough) |
| \`bmm://repo/sync\` | \`url\`*, \`profile\`*, \`game_dir\`, \`mods_dir\`, \`backup_dir\`, \`local_profile\`, \`password\` | Opens sync pre-filled and starts the fetch |
| \`bmm://repo/gen\` | — | Opens the Generation section |
| \`bmm://repo/update\` | \`dir\` | Opens Update, pre-filled |
| \`bmm://repo/host\` | \`dir\`, \`port\` | Opens Hosting, pre-filled |
| \`bmm://mod/check-updates\` | — | Runs the update check |
| \`bmm://mod/update\` | \`url\` | Pre-fills the connection, or runs the check if omitted |

#### Apps, themes, language

| Deeplink | Params | Does |
|---|---|---|
| \`bmm://app/install\` | \`id\`*, \`url\`*, \`title\`, \`type\`, \`path\` | Downloads and installs an app |
| \`bmm://app/launch\` | \`id\`*, \`exe\`* | Launches an installed app |
| \`bmm://theme/apply\` | \`id\`* | Activates an installed theme |
| \`bmm://theme/import\` | \`url\`* | Downloads and installs a \`.bmmtheme.json\` |
| \`bmm://theme/editor\` | — | Opens the theme editor |
| \`bmm://language/import\` | \`path\` | Imports a translation \`.json\` (picker if omitted) |

#### Automation, privacy, misc

| Deeplink | Params | Does |
|---|---|---|
| \`bmm://schedule/run\` | \`id\`* | Runs a scheduled task — the hook the Windows Scheduler uses |
| \`bmm://launchpack/run\` | \`id\`* | Runs a Launch Pack |
| \`bmm://benchmark/run\` | \`dataset\`, \`size\`, \`mb\`, \`mode\`, \`sources\`, \`profiles\`, \`folders\` | Opens the benchmark pre-configured. **Auto-runs unless \`mode=manual\`** |
| \`bmm://telemetry/consent\` | \`enabled\`* | Global telemetry consent; declining also purges the local queue |
| \`bmm://telemetry/set\` | \`replay\`, \`full\`, \`bench\` | Sub-options. \`full\` means **unmasked** |
| \`bmm://recorder/set\` | \`on\`, \`full\`, \`rust\`, \`js\` | Configures the local session recorder |
| \`bmm://replay/export\` | — | Exports the session as \`.bmmreplay\` |
| \`bmm://replay/import\` | \`path\`, \`url\` | Imports and plays a \`.bmmreplay\` |
| \`bmm://discord/rpc\` | \`enabled\`* | Discord Rich Presence |
| \`bmm://data/export-auto\` | \`dir\`*, \`name\`, \`increment\` | Unattended backup. \`name\` takes \`{date}\` \`{time}\` \`{datetime}\`; \`increment\` is \`paren\`, \`underscore\`, \`timestamp\` or \`overwrite\` |
| \`bmm://settings/layout\` | \`code\`* | Applies a shared card layout |
| \`bmm://docs/open\` | \`article\` | Opens Help & other, optionally at an article id |
| \`bmm://restart\` | — | Restarts the app |

#### Also works — previously undocumented

Handled by the router but missing from the list above for a long time. They are real and supported; several are what the BetterCommunity website generates.

| Deeplink | Params | Does |
|---|---|---|
| \`bmm://catalog/app/install\` | \`url\`, \`name\`, \`type\` | One-click install from a catalog feed (no \`url\` → opens Apps) |
| \`bmm://catalog/plugin/install\` | \`url\`, \`name\` | Same, for a plugin |
| \`bmm://catalog/theme/install\` | \`url\`, \`name\` | Same, for a theme (validated as JSON first) |
| \`bmm://catalog/app/add-source\` | \`url\`* | Subscribes to a community app catalog (asks first) |
| \`bmm://catalog/plugin/add-source\` | \`url\`* | Subscribes to a plugin catalog |
| \`bmm://catalog/theme/add-source\` | \`url\`* | Subscribes to a theme catalog |
| \`bmm://language/import-inline\` | \`data\`* (base64url), \`code\`, \`gz\` | A whole translation carried in the link; \`gz=1\` for gzipped |
| \`bmm://theme/import-inline\` | \`data\`* (base64 JSON) | Installs **and activates** a theme from the link |
| \`bmm://settings/navbar\` | \`code\`* | Applies a shared navbar layout |
| \`bmm://benchmark/open\` | as \`benchmark/run\` | Same handler, **inverted default** — only auto-runs when \`mode=auto\` |
| \`bmm://import\` · \`bmm://download\` | \`url\`*, \`name\` | Aliases of \`bmm://install\` |

**Undocumented aliases:** \`telemetry/consent\` and \`telemetry/set\` accept \`consent\` for \`enabled\` and \`replayFull\` for \`full\`; \`benchmark/run\` also reads \`folders\`, and splits lists on \`;\` **or** \`|\`.

**Which ones ask first** — safe to hand to a user, because they confirm before acting: \`repo/connect\`, \`language/import\` with a bare \`path\`, every \`catalog/*/add-source\`, \`bmm://api\` for any non-GET method, and the install / import / download flow. URL parameters on \`repo/connect\`, \`repo/sync\` and \`catalog/*/add-source\` are rejected unless they are \`http(s)\`.

## The \`bmm://api\` passthrough

Any endpoint without a dedicated deeplink is still reachable:

\`\`\`
bmm://api?method=POST&path=/api/mods/enable&mod_id=my-mod
\`\`\`

- \`method\` defaults to \`GET\`; \`path\` is **required and must start with \`/api/\`**.
- Every other parameter becomes the payload: a query string for \`GET\`/\`DELETE\`, a **JSON body** otherwise, with \`"true"\` / \`"false"\` / integers coerced to real types.
- The **admin token is attached automatically**, so a passthrough link runs with full rights.
- Any non-\`GET\` method **asks for confirmation** first.

:::warning[Two hard limits]
**It cannot express nested data.** Parameters are flat, so endpoints taking an array or object — \`choices\`, \`mod_overrides\`, \`permissions\`, \`updateSources\`, \`addProfiles\` — need a real HTTP client.

**It never gives you the response body.** You get a success/status toast and nothing else, so it is useless for reading data back. Use the HTTP API for that.
:::

## Endpoints

**Auth** — \`—\` = no token · \`token\` = any valid token · a permission name = that grant is required (the admin token bypasses it). **DL** = has a dedicated deeplink.

#### Reading

| Method | Path | Auth | Returns |
|---|---|---|---|
| \`GET\` | \`/api/health\` | — | \`{ok, service, port}\` — the liveness probe, and how to learn the real port |
| \`GET\` | \`/api/status\` | — | App version, active profile, mod/profile/plugin counts |
| \`GET\` | \`/api/check-update\` | — | Latest GitHub release vs current: \`has_update\`, \`release_url\` |
| \`GET\` | \`/api/mods\` | — | Visible mods of the active profile |
| \`GET\` | \`/api/mods/active\` | — | Only the enabled ones |
| \`GET\` | \`/api/mods/all\` | — | Every mod of **every** profile, grouped, plus \`total_mods\` |
| \`GET\` | \`/api/profiles\` | — | All profiles with their mod lists |
| \`GET\` | \`/api/plugins\` | — | Installed plugins (manifest + \`enabled\`) |
| \`GET\` | \`/api/modpacks\` | — | All saved modpacks |
| \`GET\` | \`/api/creator-id\` | — | This install's creator id |
| \`GET\` | \`/api/repo/info\` | — | Fetches a remote \`repo.json\`. Query \`url\`*, \`password\`. \`401\` if protected, \`502\` if the remote fails |
| \`GET\` | \`/api/repo/list\` | — | Registered remote repos |
| \`GET\` | \`/api/language/template\` | — | \`lang-template.json\`, a flat \`{"key": "English"}\` map |
| \`GET\` | \`/api/data\` | token | **Full \`data.json\` dump** |
| \`GET\` | \`/api/apps\` | \`app.read\` | Apps installed through the catalog |
| \`GET\` | \`/api/apps/permissions\` | token | \`plugin_id → [permissions]\` |
| \`GET\` | \`/api/apps/permissions/:id\` | token | One plugin's permissions |
| \`GET\` | \`/api/catalog\` | \`catalog.read\` | The local app catalog |

:::danger[GET /api/data is the whole database]
It returns everything, \`settings\` included — and \`settings\` holds the admin token and the plugin tokens. Any token that can call it can read the admin token and mint itself full access. Treat granting it as equivalent to handing over admin rights.
:::

#### Mods & profiles

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/mods/enable\` | \`mods.write\` | \`mod_id\`* | ✓ |
| \`POST\` | \`/api/mods/disable\` | \`mods.write\` | \`mod_id\`* | ✓ |
| \`PUT\` | \`/api/mods/:id\` | \`mods.write\` | \`name\`, \`version\`, \`author\`, \`description\`, \`tags[]\`, \`install_notes\` | |
| \`DELETE\` | \`/api/mods/:id\` | \`mods.write\` | — · removes the entry, **keeps the files** | |
| \`POST\` | \`/api/mod/config\` | \`mods.write\` | \`modId\`*, \`repoModId\`, \`updateUrl\`, \`directUrl\`, \`updateSources[]\` | |
| \`POST\` | \`/api/profiles\` | \`profiles.write\` | \`name\`*, \`game_path\`*, \`mods_path\`*, \`backup_path\`*, \`game_name\`, \`color\`, \`icon\` · **not** activated | |
| \`POST\` | \`/api/profiles/activate\` | \`profiles.write\` | \`profile_id\`* | ✓ |
| \`PUT\` | \`/api/profiles/:id\` | \`profiles.write\` | \`name\`, \`color\`, \`icon\`, and the three paths | |
| \`DELETE\` | \`/api/profiles/:id\` | \`profiles.write\` | — · refuses the active profile | |

#### Modpacks & plugins

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/modpacks/create\` | \`modpacks.write\` | \`name\`*, \`mod_ids[]\`, \`source_profile_id\`, \`description\`, \`game_name\`, \`sr_link\`, \`multi_profile\`, \`skip_integrity_check\`, \`dependency_mode\`, \`mod_overrides[]\` → \`201\` | ✓ |
| \`POST\` | \`/api/modpacks/enable\` | \`modpacks.write\` | \`modpack_id\`* (legacy \`profile_id\` also accepted) | ✓ |
| \`POST\` | \`/api/modpacks/disable\` | \`modpacks.write\` | idem | ✓ |
| \`PUT\` | \`/api/modpacks/:id\` | \`modpacks.write\` | any of the create fields | |
| \`DELETE\` | \`/api/modpacks/:id\` | \`modpacks.write\` | — · irreversible, local mods kept | |
| \`POST\` | \`/api/plugins/compare\` | \`plugins.read\` | \`plugin_id\`* → \`missing_required\`, \`strict_extra\` | ✓ |
| \`POST\` | \`/api/plugins/apply\` | \`plugins.write\` | \`plugin_id\`*, \`force_strict\` → \`enabled\`, \`not_found\` | ✓ |
| \`DELETE\` | \`/api/plugins/:id\` | token | — · registry + permissions + files | ✓ |

#### Server repo

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/repo/connect\` | \`repo.write\` | \`url\`*, \`name\` | ✓ |
| \`DELETE\` | \`/api/repo\` | \`repo.write\` | \`url\`* · files kept | |
| \`POST\` | \`/api/repo/sync\` | \`repo.write\` | \`url\`*, \`choices[]\`*, \`gameDir\`, \`modsDir\`, \`backupDir\`, \`creatorId\`, \`password\`, \`overwriteAll\`, \`deleteExtra\`, \`downloadLimit\` → \`202 {job_id}\`. **One at a time** (\`409\`) | ✓ |
| \`DELETE\` | \`/api/repo/sync/cancel\` | token | — · stops at the next mod boundary | |
| \`POST\` | \`/api/repo/gen\` | \`repo.write\` | \`profileIds[]\`*, \`outputDir\`*, \`authorName\`*, \`seed\`, \`generateServer\`, \`port\`, \`uploadLimit\`, \`adminPassword\`, \`useCloudflare\`, \`useUpnp\`, \`autoStart\`, \`lang\`, \`serverVersion\` (number), \`serverType\` (\`std\`/\`lux\`), \`lightweight\`, \`zipOutput\`, \`useDocker\`, \`dockerOs\` → \`202\` | ✓ |
| \`DELETE\` | \`/api/repo/gen/cancel\` | token | — | |
| \`POST\` | \`/api/repo/update\` | token | \`repoDir\`*, \`authorName\`, \`removeModIds[]\`, \`removeProfileIds[]\`, \`addProfiles[]\`, \`modChangelogs{}\` → \`202\` | ✓ |
| \`POST\` | \`/api/repo/host\` | token | \`serveDir\`*, \`port\`, \`uploadLimit\` → \`202\`, \`409\` if already serving | ✓ |
| \`DELETE\` | \`/api/repo/host\` | token | — | |
| \`POST\` | \`/api/mod/check-updates\` | token | — → \`202\` | ✓ |
| \`POST\` | \`/api/mod/update\` | token | \`repoUrl\` → \`202\` | ✓ |

#### Apps & catalog

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/apps/install\` | \`app.write\` | \`appId\`*, \`appTitle\`*, \`downloadUrl\`*, \`fileType\`*, \`installPath\`, \`version\`, \`category\`, \`thumb\` → \`202\` | ✓ |
| \`POST\` | \`/api/apps/launch\` | \`app.write\` | \`appId\`*, \`exePath\`* | ✓ |
| \`DELETE\` | \`/api/apps/:id\` | \`app.write\` | — · deregisters, files kept | |
| \`PUT\` | \`/api/apps/permissions/:id\` | token | \`permissions[]\`* · **replaces** the list; \`[]\` revokes everything | |
| \`POST\` | \`/api/catalog/new\` | \`catalog.write\` | \`name\`, \`description\`, \`partner_catalogs[]\`, \`community_imports[]\`, \`apps[]\` → \`201\` | |
| \`POST\` | \`/api/catalog/apps\` | \`catalog.write\` | \`id\`*, \`title\`*, \`download\`* (\`url\`, \`file_type\`), \`description\`, \`category\`, \`price\`, \`tags\` (max 3), \`requirements\`, \`md_link\` → \`201\` | |
| \`PUT\` | \`/api/catalog/apps/:id\` | \`catalog.write\` | \`title\`, \`description\`, \`version\`, \`category\`, \`download\` | |
| \`DELETE\` | \`/api/catalog/apps/:id\` | \`catalog.write\` | — | |

#### Import / export — these drive the UI

Each opens the matching in-app flow and returns \`202\`. They are **not** headless; the one exception is \`data/export-auto\`.

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/data/export\` · \`/api/data/import\` | token | — | |
| \`POST\` | \`/api/data/export-auto\` | token | \`dir\`*, \`name\`, \`increment\` · **unattended**, no dialog | ✓ |
| \`POST\` | \`/api/modlists/export\` · \`/api/modlists/import\` | token | — · \`.mmlist\`, metadata only, no mod files | |
| \`POST\` | \`/api/modpacks/import\` | token | \`path\` | |
| \`POST\` | \`/api/modpacks/export\` | token | \`id\`*, \`destDir\` | |
| \`POST\` | \`/api/plugins/import\` | token | — | |
| \`POST\` | \`/api/plugins/export\` | token | \`id\`* → \`.bmmplug\` | |
| \`POST\` | \`/api/language/import\` | token | \`path\` · the filename becomes the language code; \`template.json\` is refused | ✓ |
| \`POST\` | \`/api/profiles/import/ovgme\` | token | — · scans the OvGME folder | |
| \`POST\` | \`/api/profiles/import/omm\` | token | — · OpenModManager \`.omm\`/\`.omx\` | |

#### Automation & privacy

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/schedule/run\` | token | \`id\`* | ✓ |
| \`POST\` | \`/api/launchpack/run\` | token | \`id\`* | ✓ |
| \`POST\` | \`/api/benchmark\` | token | \`dataset\`, \`size\`, \`mode\`, \`sources[]\`, \`profiles[]\` | ✓ |
| \`POST\` | \`/api/telemetry/consent\` | token | \`enabled\`* | ✓ |
| \`POST\` | \`/api/telemetry/settings\` | token | \`replay\`, \`full\`, \`bench\` | ✓ |
| \`POST\` | \`/api/recorder\` | token | \`on\`, \`full\`, \`rust\`, \`js\` | ✓ |
| \`POST\` | \`/api/replay/export\` | token | — | ✓ |
| \`POST\` | \`/api/replay/import\` | token | \`path\`, \`url\` | ✓ |
| \`POST\` | \`/api/discord/rpc\` | token | \`enabled\`* | ✓ |
| \`POST\` | \`/api/restart\` | token | — · the API is briefly unavailable | ✓ |

## Known inconsistencies

Recorded because this page and the server do not agree on every detail:

- **Permission gates are narrower than they look.** \`mod/check-updates\`, \`mod/update\`, \`repo/update\`, \`repo/host\` (both methods), both cancel routes, \`DELETE /api/plugins/:id\` and every \`/api/apps/permissions*\` route are **token-only** — a plugin token with zero permissions passes them.
- **\`POST /api/repo/gen\`** takes \`serverVersion\` (a number) **and** \`serverType\` (\`"std"\` / \`"lux"\`) — the string goes in \`serverType\`.
- **\`POST /api/repo/host\`** drives the native Server Repo UI and returns \`202\`, not \`200\`.
- **\`bmm://telemetry/settings\`** is **not routed** — only \`bmm://telemetry/set\` works.
- Error responses re-add \`access-control-allow-origin: *\` unconditionally, even in release.

Every \`/api/\` request emits an event carrying method, path and status — that is what produces the toasts and the API log on the Plugins & API page, so you can watch external calls arrive without instrumenting your own script.

See also [Action reference](doc:actions-reference) and [Plugins & API](doc:plugins).`,
                    fr: `Deux façons de piloter BMM depuis l’extérieur : les **deeplinks** (\`bmm://…\`, sans token, envoyés à la fenêtre en cours) et une **API HTTP locale** (token, \`127.0.0.1\` uniquement).

:::tip[Lequel choisir ?]
Un deeplink est une URL — tout ce qui sait ouvrir un lien peut le déclencher (un \`.bat\`, un raccourci, un site) et ça ne demande aucun secret. L’API HTTP sert à **relire** des données et à envoyer des payloads qu’une URL ne peut pas exprimer. Si la chose existe sous les deux formes, préfère le deeplink.
:::

## Transport

| | |
|---|---|
| URL de base | \`http://127.0.0.1:51274\` |
| Adresse d’écoute | **\`127.0.0.1\` uniquement** — jamais \`0.0.0.0\`, rien hors de la machine n’y accède |
| Port | \`51274\` par défaut ; surchargeable via \`api_port\` dans les réglages (\`0\` = le défaut). Nécessite un redémarrage |
| Port effectif | À lire à l’exécution sur \`GET /api/health\` → \`port\` |
| Limitation de débit | **Aucune.** N’expose pas ce port |

:::warning[Si le port est déjà pris, l’API ne démarre pas du tout]
Elle ne **bascule pas** sur un autre port. Si quelque chose occupe déjà 51274 — typiquement une instance zombie après un redémarrage in-app — l’API est **désactivée pour toute la session** et une ligne part dans le journal de crash. L’app continue de fonctionner normalement, donc le seul symptôme est un script qui n’arrive pas à se connecter. Commence par \`GET /api/health\`.
:::

**CORS.** En build release, les origines sont limitées à \`https://tauri.localhost\`, \`tauri://localhost\`, \`http://tauri.localhost\`, \`https://bettercommunity.ch\`, plus ce que tu ajoutes sous **CORS** sur cette page (une entrée \`*\` seule = tout autoriser). La liste est lue **une seule fois au démarrage de l’API** : un changement demande donc de redémarrer BMM (ou l’API) pour prendre effet — le panneau le rappelle sous la liste. \`curl\` et les deeplinks n’envoient pas d’\`Origin\`, rien de tout ça ne les concerne.

Le panneau porte deux décisions, pas une. **Autoriser toute origine** est l’interrupteur du haut ; le cadre en dessous est la liste que vous constituez vous-même. Activer l’interrupteur ne vide pas cette liste — il cesse de la consulter, et le cadre le dit au lieu de simplement griser, parce qu’un contrôle qui pâlit sans explication se lit comme cassé plutôt que comme sans objet. Désactivez l’interrupteur et votre liste reprend effet, telle que vous l’aviez laissée.

## S’authentifier

\`\`\`bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:51274/api/mods
\`\`\`

\`Authorization: Bearer …\` est la seule forme acceptée, et la comparaison est faite en **temps constant**.

| | D’où il vient | Portée |
|---|---|---|
| **Token admin** | Un UUID v4 généré au premier lancement. Rotation sur cette page | Tout. Contourne tous les contrôles de permission |
| **Token plugin** | Émis par plugin | Uniquement ce qui a été accordé à ce plugin |

Le token est relu à **chaque** requête : une rotation prend effet immédiatement, sans redémarrage. Pour un token plugin, l’identité de l’appelant vient **du token**, jamais de l’en-tête \`X-BMM-Plugin-Id\` : un plugin ne peut donc pas s’élever en le forgeant. Les dix droits : \`app.read\` · \`app.write\` · \`catalog.read\` · \`catalog.write\` · \`modpacks.write\` · \`mods.write\` · \`plugins.read\` · \`plugins.write\` · \`profiles.write\` · \`repo.write\`

:::note[Les endpoints de lecture ne sont pas soumis aux permissions]
Il n’existe pas de \`mods.read\` / \`profiles.read\`. Les routes marquées *sans token* sont ouvertes à tout ce qui atteint le port ; celles marquées *token* acceptent **n’importe quel** token valide, y compris un token plugin sans aucune permission.
:::

| Statut | Corps |
|---|---|
| \`401\` | token invalide ou absent |
| \`403\` | le plugin manque d’une permission — le message la nomme, ainsi que la route qui l’accorde |
| \`400\` | corps JSON invalide |
| \`404\` / \`405\` / \`500\` | \`{"error":"…"}\` |

## Deeplinks

Envoyés à la fenêtre en cours — **sans token**. \`*\` marque un paramètre obligatoire. Chacun affiche un toast à la réception, et un coupe-circuit global les refuse tous.

\`\`\`bat
start "" "bmm://mod/enable?id=mon-dossier-de-mod"
\`\`\`

#### Mods, profils, modpacks

| Deeplink | Params | Effet |
|---|---|---|
| \`bmm://mod/enable\` | \`id\`* | Active un mod dans le profil actif |
| \`bmm://mod/disable\` | \`id\`* | Le désactive |
| \`bmm://profile/activate\` | \`id\`* (UUID du profil) | Change le profil actif |
| \`bmm://modpack/enable\` | \`id\`* | Active tous les mods d’un modpack — \`id\` accepte un id de **modpack ou de profil** |
| \`bmm://modpack/disable\` | \`id\`* | L’inverse |
| \`bmm://modpack/create\` | \`name\`*, \`profile\` | Crée un modpack depuis les mods actifs d’un profil |
| \`bmm://install\` | \`url\`*, \`name\` | Télécharge un mod et ouvre la boîte d’installation |

#### Plugins, dépôt & mises à jour

| Deeplink | Params | Effet |
|---|---|---|
| \`bmm://plugin/activate\` | \`id\`* | Applique la modlist du plugin (et désactive le reste si strict) |
| \`bmm://plugin/compare\` | \`id\`* | Ouvre la comparaison modlist / mods actifs |
| \`bmm://plugin/delete\` | \`id\`* | Le désinstalle — registre, permissions et fichiers |
| \`bmm://repo/connect\` | \`url\`*, \`name\` | Enregistre un dépôt distant (le dossier parent suffit) |
| \`bmm://repo/sync\` | \`url\`*, \`profile\`*, \`game_dir\`, \`mods_dir\`, \`backup_dir\`, \`local_profile\`, \`password\` | Ouvre la synchro pré-remplie et lance la récupération |
| \`bmm://repo/gen\` | — | Ouvre la section Génération |
| \`bmm://repo/update\` | \`dir\` | Ouvre Mise à jour, pré-rempli |
| \`bmm://repo/host\` | \`dir\`, \`port\` | Ouvre Hébergement, pré-rempli |
| \`bmm://mod/check-updates\` | — | Lance la vérification des mises à jour |
| \`bmm://mod/update\` | \`url\` | Pré-remplit la connexion, ou lance la vérification si omis |

#### Apps, thèmes, langue

| Deeplink | Params | Effet |
|---|---|---|
| \`bmm://app/install\` | \`id\`*, \`url\`*, \`title\`, \`type\`, \`path\` | Télécharge et installe une app |
| \`bmm://app/launch\` | \`id\`*, \`exe\`* | Lance une app installée |
| \`bmm://theme/apply\` | \`id\`* | Active un thème installé |
| \`bmm://theme/import\` | \`url\`* | Télécharge et installe un \`.bmmtheme.json\` |
| \`bmm://theme/editor\` | — | Ouvre l’éditeur de thème |
| \`bmm://language/import\` | \`path\` | Importe une traduction \`.json\` (sélecteur si omis) |

#### Automatisation, confidentialité, divers

| Deeplink | Params | Effet |
|---|---|---|
| \`bmm://schedule/run\` | \`id\`* | Exécute une tâche planifiée — le hook utilisé par le Planificateur Windows |
| \`bmm://launchpack/run\` | \`id\`* | Exécute un Launch Pack |
| \`bmm://benchmark/run\` | \`dataset\`, \`size\`, \`mb\`, \`mode\`, \`sources\`, \`profiles\`, \`folders\` | Ouvre le benchmark préconfiguré. **Se lance automatiquement sauf si \`mode=manual\`** |
| \`bmm://telemetry/consent\` | \`enabled\`* | Consentement télémétrie global ; refuser purge aussi la file locale |
| \`bmm://telemetry/set\` | \`replay\`, \`full\`, \`bench\` | Sous-options. \`full\` veut dire **non masqué** |
| \`bmm://recorder/set\` | \`on\`, \`full\`, \`rust\`, \`js\` | Configure l’enregistreur de session local |
| \`bmm://replay/export\` | — | Exporte la session en \`.bmmreplay\` |
| \`bmm://replay/import\` | \`path\`, \`url\` | Importe et joue un \`.bmmreplay\` |
| \`bmm://discord/rpc\` | \`enabled\`* | Discord Rich Presence |
| \`bmm://data/export-auto\` | \`dir\`*, \`name\`, \`increment\` | Sauvegarde sans intervention. \`name\` accepte \`{date}\` \`{time}\` \`{datetime}\` ; \`increment\` vaut \`paren\`, \`underscore\`, \`timestamp\` ou \`overwrite\` |
| \`bmm://settings/layout\` | \`code\`* | Applique une disposition de cartes partagée |
| \`bmm://docs/open\` | \`article\` | Ouvre Aide & autres, éventuellement sur un id d’article |
| \`bmm://restart\` | — | Redémarre l’app |

#### Fonctionnent aussi — jusqu’ici non documentés

Gérés par le routeur mais longtemps absents de la liste ci-dessus. Ils sont réels et supportés ; plusieurs sont ceux que génère le site BetterCommunity.

| Deeplink | Params | Effet |
|---|---|---|
| \`bmm://catalog/app/install\` | \`url\`, \`name\`, \`type\` | Installation en un clic depuis un flux de catalogue (sans \`url\` → ouvre Apps) |
| \`bmm://catalog/plugin/install\` | \`url\`, \`name\` | Idem, pour un plugin |
| \`bmm://catalog/theme/install\` | \`url\`, \`name\` | Idem, pour un thème (validé comme JSON d’abord) |
| \`bmm://catalog/app/add-source\` | \`url\`* | S’abonne à un catalogue d’apps communautaire (demande confirmation) |
| \`bmm://catalog/plugin/add-source\` | \`url\`* | S’abonne à un catalogue de plugins |
| \`bmm://catalog/theme/add-source\` | \`url\`* | S’abonne à un catalogue de thèmes |
| \`bmm://language/import-inline\` | \`data\`* (base64url), \`code\`, \`gz\` | Une traduction entière portée par le lien ; \`gz=1\` si gzippée |
| \`bmm://theme/import-inline\` | \`data\`* (JSON base64) | Installe **et active** un thème depuis le lien |
| \`bmm://settings/navbar\` | \`code\`* | Applique une disposition de navbar partagée |
| \`bmm://benchmark/open\` | comme \`benchmark/run\` | Même handler, **défaut inversé** — ne se lance que si \`mode=auto\` |
| \`bmm://import\` · \`bmm://download\` | \`url\`*, \`name\` | Alias de \`bmm://install\` |

**Alias non documentés :** \`telemetry/consent\` et \`telemetry/set\` acceptent \`consent\` pour \`enabled\` et \`replayFull\` pour \`full\` ; \`benchmark/run\` lit aussi \`folders\`, et découpe les listes sur \`;\` **ou** \`|\`.

**Lesquels demandent confirmation** — sûrs à donner à un utilisateur, parce qu’ils confirment avant d’agir : \`repo/connect\`, \`language/import\` avec un \`path\` nu, tous les \`catalog/*/add-source\`, \`bmm://api\` pour toute méthode autre que GET, et le flux install / import / download. Les paramètres URL de \`repo/connect\`, \`repo/sync\` et \`catalog/*/add-source\` sont rejetés s’ils ne sont pas en \`http(s)\`.

## Le passe-plat \`bmm://api\`

Tout endpoint sans deeplink dédié reste atteignable :

\`\`\`
bmm://api?method=POST&path=/api/mods/enable&mod_id=mon-mod
\`\`\`

- \`method\` vaut \`GET\` par défaut ; \`path\` est **obligatoire et doit commencer par \`/api/\`**.
- Tous les autres paramètres deviennent le payload : une query string pour \`GET\`/\`DELETE\`, un **corps JSON** sinon, avec \`"true"\` / \`"false"\` / les entiers convertis en vrais types.
- Le **token admin est attaché automatiquement** : un lien passe-plat s’exécute avec tous les droits.
- Toute méthode autre que \`GET\` **demande confirmation** d’abord.

:::warning[Deux limites dures]
**Il ne peut pas exprimer de données imbriquées.** Les paramètres sont plats, donc les endpoints qui prennent un tableau ou un objet — \`choices\`, \`mod_overrides\`, \`permissions\`, \`updateSources\`, \`addProfiles\` — exigent un vrai client HTTP.

**Il ne te rend jamais le corps de la réponse.** Tu obtiens un toast succès/statut et rien d’autre : inutile pour relire des données. Passe par l’API HTTP.
:::

## Endpoints

**Auth** — \`—\` = sans token · \`token\` = n’importe quel token valide · un nom de permission = ce droit est requis (le token admin le contourne). **DL** = possède un deeplink dédié.

#### Lecture

| Méthode | Chemin | Auth | Renvoie |
|---|---|---|---|
| \`GET\` | \`/api/health\` | — | \`{ok, service, port}\` — la sonde de vie, et le moyen de connaître le vrai port |
| \`GET\` | \`/api/status\` | — | Version de l’app, profil actif, nombre de mods/profils/plugins |
| \`GET\` | \`/api/check-update\` | — | Dernière release GitHub vs actuelle : \`has_update\`, \`release_url\` |
| \`GET\` | \`/api/mods\` | — | Mods visibles du profil actif |
| \`GET\` | \`/api/mods/active\` | — | Uniquement les activés |
| \`GET\` | \`/api/mods/all\` | — | Tous les mods de **tous** les profils, groupés, plus \`total_mods\` |
| \`GET\` | \`/api/profiles\` | — | Tous les profils avec leurs listes de mods |
| \`GET\` | \`/api/plugins\` | — | Plugins installés (manifest + \`enabled\`) |
| \`GET\` | \`/api/modpacks\` | — | Tous les modpacks sauvegardés |
| \`GET\` | \`/api/creator-id\` | — | L’id créateur de cette installation |
| \`GET\` | \`/api/repo/info\` | — | Récupère un \`repo.json\` distant. Query \`url\`*, \`password\`. \`401\` si protégé, \`502\` si le distant échoue |
| \`GET\` | \`/api/repo/list\` | — | Dépôts distants enregistrés |
| \`GET\` | \`/api/language/template\` | — | \`lang-template.json\`, une map plate \`{"clé": "English"}\` |
| \`GET\` | \`/api/data\` | token | **Dump complet de \`data.json\`** |
| \`GET\` | \`/api/apps\` | \`app.read\` | Apps installées via le catalogue |
| \`GET\` | \`/api/apps/permissions\` | token | \`plugin_id → [permissions]\` |
| \`GET\` | \`/api/apps/permissions/:id\` | token | Les permissions d’un plugin |
| \`GET\` | \`/api/catalog\` | \`catalog.read\` | Le catalogue d’apps local |

:::danger[GET /api/data c’est toute la base]
Il renvoie tout, \`settings\` inclus — et \`settings\` contient le token admin et les tokens de plugins. N’importe quel token capable de l’appeler peut lire le token admin et se fabriquer un accès total. Accorder cet endpoint équivaut à céder les droits admin.
:::

#### Mods & profils

| Méthode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/mods/enable\` | \`mods.write\` | \`mod_id\`* | ✓ |
| \`POST\` | \`/api/mods/disable\` | \`mods.write\` | \`mod_id\`* | ✓ |
| \`PUT\` | \`/api/mods/:id\` | \`mods.write\` | \`name\`, \`version\`, \`author\`, \`description\`, \`tags[]\`, \`install_notes\` | |
| \`DELETE\` | \`/api/mods/:id\` | \`mods.write\` | — · retire l’entrée, **garde les fichiers** | |
| \`POST\` | \`/api/mod/config\` | \`mods.write\` | \`modId\`*, \`repoModId\`, \`updateUrl\`, \`directUrl\`, \`updateSources[]\` | |
| \`POST\` | \`/api/profiles\` | \`profiles.write\` | \`name\`*, \`game_path\`*, \`mods_path\`*, \`backup_path\`*, \`game_name\`, \`color\`, \`icon\` · **pas** activé | |
| \`POST\` | \`/api/profiles/activate\` | \`profiles.write\` | \`profile_id\`* | ✓ |
| \`PUT\` | \`/api/profiles/:id\` | \`profiles.write\` | \`name\`, \`color\`, \`icon\`, et les trois chemins | |
| \`DELETE\` | \`/api/profiles/:id\` | \`profiles.write\` | — · refuse le profil actif | |

#### Modpacks & plugins

| Méthode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/modpacks/create\` | \`modpacks.write\` | \`name\`*, \`mod_ids[]\`, \`source_profile_id\`, \`description\`, \`game_name\`, \`sr_link\`, \`multi_profile\`, \`skip_integrity_check\`, \`dependency_mode\`, \`mod_overrides[]\` → \`201\` | ✓ |
| \`POST\` | \`/api/modpacks/enable\` | \`modpacks.write\` | \`modpack_id\`* (l’ancien \`profile_id\` est aussi accepté) | ✓ |
| \`POST\` | \`/api/modpacks/disable\` | \`modpacks.write\` | idem | ✓ |
| \`PUT\` | \`/api/modpacks/:id\` | \`modpacks.write\` | n’importe quel champ de création | |
| \`DELETE\` | \`/api/modpacks/:id\` | \`modpacks.write\` | — · irréversible, les mods locaux sont conservés | |
| \`POST\` | \`/api/plugins/compare\` | \`plugins.read\` | \`plugin_id\`* → \`missing_required\`, \`strict_extra\` | ✓ |
| \`POST\` | \`/api/plugins/apply\` | \`plugins.write\` | \`plugin_id\`*, \`force_strict\` → \`enabled\`, \`not_found\` | ✓ |
| \`DELETE\` | \`/api/plugins/:id\` | token | — · registre + permissions + fichiers | ✓ |

#### Dépôt serveur

| Méthode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/repo/connect\` | \`repo.write\` | \`url\`*, \`name\` | ✓ |
| \`DELETE\` | \`/api/repo\` | \`repo.write\` | \`url\`* · fichiers conservés | |
| \`POST\` | \`/api/repo/sync\` | \`repo.write\` | \`url\`*, \`choices[]\`*, \`gameDir\`, \`modsDir\`, \`backupDir\`, \`creatorId\`, \`password\`, \`overwriteAll\`, \`deleteExtra\`, \`downloadLimit\` → \`202 {job_id}\`. **Un seul à la fois** (\`409\`) | ✓ |
| \`DELETE\` | \`/api/repo/sync/cancel\` | token | — · s’arrête à la prochaine frontière de mod | |
| \`POST\` | \`/api/repo/gen\` | \`repo.write\` | \`profileIds[]\`*, \`outputDir\`*, \`authorName\`*, \`seed\`, \`generateServer\`, \`port\`, \`uploadLimit\`, \`adminPassword\`, \`useCloudflare\`, \`useUpnp\`, \`autoStart\`, \`lang\`, \`serverVersion\` (nombre), \`serverType\` (\`std\`/\`lux\`), \`lightweight\`, \`zipOutput\`, \`useDocker\`, \`dockerOs\` → \`202\` | ✓ |
| \`DELETE\` | \`/api/repo/gen/cancel\` | token | — | |
| \`POST\` | \`/api/repo/update\` | token | \`repoDir\`*, \`authorName\`, \`removeModIds[]\`, \`removeProfileIds[]\`, \`addProfiles[]\`, \`modChangelogs{}\` → \`202\` | ✓ |
| \`POST\` | \`/api/repo/host\` | token | \`serveDir\`*, \`port\`, \`uploadLimit\` → \`202\`, \`409\` si déjà en service | ✓ |
| \`DELETE\` | \`/api/repo/host\` | token | — | |
| \`POST\` | \`/api/mod/check-updates\` | token | — → \`202\` | ✓ |
| \`POST\` | \`/api/mod/update\` | token | \`repoUrl\` → \`202\` | ✓ |

#### Apps & catalogue

| Méthode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/apps/install\` | \`app.write\` | \`appId\`*, \`appTitle\`*, \`downloadUrl\`*, \`fileType\`*, \`installPath\`, \`version\`, \`category\`, \`thumb\` → \`202\` | ✓ |
| \`POST\` | \`/api/apps/launch\` | \`app.write\` | \`appId\`*, \`exePath\`* | ✓ |
| \`DELETE\` | \`/api/apps/:id\` | \`app.write\` | — · désenregistre, fichiers conservés | |
| \`PUT\` | \`/api/apps/permissions/:id\` | token | \`permissions[]\`* · **remplace** la liste ; \`[]\` révoque tout | |
| \`POST\` | \`/api/catalog/new\` | \`catalog.write\` | \`name\`, \`description\`, \`partner_catalogs[]\`, \`community_imports[]\`, \`apps[]\` → \`201\` | |
| \`POST\` | \`/api/catalog/apps\` | \`catalog.write\` | \`id\`*, \`title\`*, \`download\`* (\`url\`, \`file_type\`), \`description\`, \`category\`, \`price\`, \`tags\` (3 max), \`requirements\`, \`md_link\` → \`201\` | |
| \`PUT\` | \`/api/catalog/apps/:id\` | \`catalog.write\` | \`title\`, \`description\`, \`version\`, \`category\`, \`download\` | |
| \`DELETE\` | \`/api/catalog/apps/:id\` | \`catalog.write\` | — | |

#### Import / export — ceux-ci pilotent l’interface

Chacun ouvre le flux in-app correspondant et renvoie \`202\`. Ils ne sont **pas** headless ; la seule exception est \`data/export-auto\`.

| Méthode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/data/export\` · \`/api/data/import\` | token | — | |
| \`POST\` | \`/api/data/export-auto\` | token | \`dir\`*, \`name\`, \`increment\` · **sans intervention**, aucune boîte de dialogue | ✓ |
| \`POST\` | \`/api/modlists/export\` · \`/api/modlists/import\` | token | — · \`.mmlist\`, métadonnées seules, aucun fichier de mod | |
| \`POST\` | \`/api/modpacks/import\` | token | \`path\` | |
| \`POST\` | \`/api/modpacks/export\` | token | \`id\`*, \`destDir\` | |
| \`POST\` | \`/api/plugins/import\` | token | — | |
| \`POST\` | \`/api/plugins/export\` | token | \`id\`* → \`.bmmplug\` | |
| \`POST\` | \`/api/language/import\` | token | \`path\` · le nom de fichier devient le code de langue ; \`template.json\` est refusé | ✓ |
| \`POST\` | \`/api/profiles/import/ovgme\` | token | — · scanne le dossier OvGME | |
| \`POST\` | \`/api/profiles/import/omm\` | token | — · OpenModManager \`.omm\`/\`.omx\` | |

#### Automatisation & confidentialité

| Méthode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/schedule/run\` | token | \`id\`* | ✓ |
| \`POST\` | \`/api/launchpack/run\` | token | \`id\`* | ✓ |
| \`POST\` | \`/api/benchmark\` | token | \`dataset\`, \`size\`, \`mode\`, \`sources[]\`, \`profiles[]\` | ✓ |
| \`POST\` | \`/api/telemetry/consent\` | token | \`enabled\`* | ✓ |
| \`POST\` | \`/api/telemetry/settings\` | token | \`replay\`, \`full\`, \`bench\` | ✓ |
| \`POST\` | \`/api/recorder\` | token | \`on\`, \`full\`, \`rust\`, \`js\` | ✓ |
| \`POST\` | \`/api/replay/export\` | token | — | ✓ |
| \`POST\` | \`/api/replay/import\` | token | \`path\`, \`url\` | ✓ |
| \`POST\` | \`/api/discord/rpc\` | token | \`enabled\`* | ✓ |
| \`POST\` | \`/api/restart\` | token | — · l’API est brièvement indisponible | ✓ |

## Incohérences connues

Consignées parce que cette page et le serveur ne s’accordent pas sur tous les détails :

- **Les barrières de permission sont plus étroites qu’elles n’y paraissent.** \`mod/check-updates\`, \`mod/update\`, \`repo/update\`, \`repo/host\` (les deux méthodes), les deux routes d’annulation, \`DELETE /api/plugins/:id\` et toutes les routes \`/api/apps/permissions*\` sont **token seul** — un token plugin sans aucune permission y passe.
- **\`POST /api/repo/gen\`** prend \`serverVersion\` (un nombre) **et** \`serverType\` (\`"std"\` / \`"lux"\`) — la chaîne va dans \`serverType\`.
- **\`POST /api/repo/host\`** pilote l’UI native Dépôt Serveur et renvoie \`202\`, pas \`200\`.
- **\`bmm://telemetry/settings\`** n’est **pas routé** — seul \`bmm://telemetry/set\` fonctionne.
- Les réponses d’erreur rajoutent \`access-control-allow-origin: *\` sans condition, même en release.

Chaque requête \`/api/\` émet un événement portant la méthode, le chemin et le statut — c’est ce qui produit les toasts et le journal API de la page Plugins & API : tu peux donc voir arriver les appels externes sans instrumenter ton propre script.

Voir aussi [Référence des actions](doc:actions-reference) et [Plugins & API](doc:plugins).`,
                },
            },
            {
                id: 'benchmarks', docsPath: 'how-it-works/performance/', view: 'settings', diagram: ['blake3-hashing', 'perf-monitoring'],
                title: { en: 'Benchmarks & performance', fr: 'Benchmarks et performances' },
                summary: { en: 'Measure how fast BMM scans, hashes and deploys on your machine.', fr: 'Mesurez la vitesse de scan, de hachage et de déploiement sur votre machine.' },
                keywords: 'benchmark performance speed hash blake3 measure performances vitesse',
                body: {
                    en: '<p>The built-in benchmark suite measures the three things BMM does most — <b>scanning</b> a folder, <b>hashing</b> file content (BLAKE3), and <b>copying / deploying</b> — and reports throughput for your actual disk and CPU.</p><ul><li>Run it to compare drives (an SSD vs. a network share), or to sanity-check a sync that felt slow.</li><li>Results stay local — nothing is uploaded.</li><li>Find it in <b>Settings</b>; for the internals, see <b>Developer → BLAKE3 hashing</b>.</li></ul>',
                    fr: '<p>La suite de benchmarks intégrée mesure les trois opérations que BMM fait le plus — <b>scanner</b> un dossier, <b>hacher</b> le contenu (BLAKE3) et <b>copier / déployer</b> — et rapporte le débit pour votre disque et votre CPU réels.</p><ul><li>Lancez-la pour comparer des disques (un SSD contre un partage réseau), ou vérifier une synchro qui a semblé lente.</li><li>Les résultats restent locaux — rien n’est envoyé.</li><li>Trouvez-la dans les <b>Réglages</b> ; pour les détails, voir <b>Développeur → Hachage BLAKE3</b>.</li></ul>',
                },
            },
            {
                id: 'storage-manager', view: 'settings', docsPath: 'features/storage/', diagram: 'cache-management',
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
                id: 'offline', docsPath: 'features/privacy-telemetry/', diagram: 'offline-mode',
                title: { en: 'Offline mode', fr: 'Mode hors ligne' },
                summary: { en: 'No connection? BMM pauses online features and keeps everything local working.', fr: 'Pas de connexion ? BMM met en pause les fonctions en ligne et garde tout le local fonctionnel.' },
                keywords: 'offline connection internet network banner hors ligne connexion réseau',
                body: {
                    en: '<p>BMM doesn’t just trust the OS “connected” flag — that only says a network interface exists. It <b>probes</b> two lightweight endpoints; if neither answers within 5 seconds, you’re offline.</p><ul><li>A discreet <b>“no connection” banner</b> appears, and network features (repo syncs, catalogs, update checks) pause with a warning toast instead of failing cryptically.</li><li><b>Everything local keeps working</b> — your library, profiles, activation, the mapper, themes. Nothing is removed.</li><li>Recovery is automatic: while offline BMM re-probes every <b>15 seconds</b>, and the banner slides away the moment a probe answers. Online, a 2-minute re-check catches connections that died silently.</li></ul>',
                    fr: '<p>BMM ne se fie pas au simple drapeau « connecté » de l’OS — il dit seulement qu’une interface réseau existe. Il <b>sonde</b> deux endpoints légers ; si aucun ne répond sous 5 secondes, vous êtes hors ligne.</p><ul><li>Un <b>bandeau « pas de connexion »</b> discret apparaît, et les fonctions réseau (synchros de dépôts, catalogues, vérifs de mise à jour) se mettent en pause avec un toast d’avertissement au lieu d’échouer cryptiquement.</li><li><b>Tout le local continue de fonctionner</b> — bibliothèque, profils, activation, mapper, thèmes. Rien n’est retiré.</li><li>La reprise est automatique : hors ligne, BMM re-sonde toutes les <b>15 secondes</b>, et le bandeau disparaît dès qu’une sonde répond. En ligne, une re-vérification toutes les 2 minutes attrape les connexions mortes en silence.</li></ul>',
                },
            },
            {
                id: 'privacy-telemetry', view: 'settings', diagram: 'telemetry-pipeline', docsPath: 'features/privacy-telemetry/',
                title: { en: 'Privacy & telemetry', fr: 'Confidentialité et télémétrie' },
                summary: { en: 'Strictly opt-in analytics: what’s collected, what never is, and how to export or erase it.', fr: 'Télémétrie strictement opt-in : ce qui est collecté, ce qui ne l’est jamais, et comment l’exporter ou l’effacer.' },
                keywords: 'privacy telemetry analytics gdpr consent data replay rrweb confidentialité données rgpd consentement enregistrement',
                // A real recording, played by the app's own viewer, so "masked session replay" is
                // something you can look at rather than a claim you have to take on trust. Streamed from
                // the docs site on click — a replay is a ~25 MB JSON event stream, far too big to bundle.
                media: {
                    kind: 'replay',
                    src: DOCS_SITE + 'assets/replays/bmm-demo.bmmreplay',
                    caption: {
                        en: 'A real masked session — names and paths are recorded as ••••. Loads on click (~25 MB, from the docs site).',
                        fr: 'Une vraie session masquée — noms et chemins sont enregistrés en ••••. Se charge au clic (~25 Mo, depuis le site de doc).',
                    },
                },
                body: {
                    en: '<p>Telemetry in BMM is <b>opt-in</b>: until you explicitly accept the consent dialog, <b>nothing is collected at all</b> — and declining also wipes anything previously buffered.</p>'
                        + '<p>The player above is the same one the app uses for any <code>.bmmreplay</code>. It replays the <b>DOM</b>, not a video — text stays selectable text — and it shows the masking as it is actually stored: the unmasked values never enter the file, so there is nothing to leak afterwards.</p>'
                        + '<h4>If you opt in</h4><ul><li>What’s sent: pages visited, clicks (<b>labels only — never what you type</b>), performance samples, errors, and an anonymous hardware profile. No file paths, no mod contents, no name or e-mail; your identity is an anonymous id.</li><li><b>Session replay</b> (optional, on by default when telemetry is on) records the UI <b>masked</b>: mod names, profile names and paths appear as <code>••••</code>. Unmasking is a separate, explicit toggle.</li><li>Everything buffers to a <b>local file (10 MB cap)</b> first, and is only uploaded as gzip batches over <b>HTTPS</b> — if no endpoint is configured, data never leaves your machine.</li></ul>'
                        + '<h4>Where a recording lives while it’s being made</h4><p>The local session recorder writes to disk <b>as it goes</b> instead of holding the session in the app: events are appended to a spool in batches (512 KB or 200 events, flushed at least every 3s), and the core assembles the <code>.bmmreplay</code> by streaming — so it costs about half a megabyte of memory whatever the session length, even when you export it. History is a rolling <b>512 MB</b> window on disk; oldest segments go first, and since each starts with a full snapshot, what remains always plays. If BMM is killed you lose at most the last few seconds.</p>'
                        + '<p>The DevTools <b>Replay Studio</b> is the exception: it keeps events in memory because it needs them for pause-compression and the trim, so it is capped at 64 MB and <b>stops the take</b> there rather than growing — what it already has stays complete and playable.</p>'
                        + '<h4>Your controls (Settings → Privacy)</h4><ul><li>Master toggle plus separate toggles for the 7-day benchmark/extra-hardware report and session replay.</li><li><b>Export</b> the raw buffer as JSON any time.</li><li>See every <b>sent packet</b> (event names and counts only) and request its <b>deletion</b> — honoured within 72 hours.</li></ul>',
                    fr: '<p>La télémétrie de BMM est <b>opt-in</b> : tant que vous n’acceptez pas explicitement la boîte de consentement, <b>rien n’est collecté du tout</b> — et refuser efface aussi tout ce qui aurait été mis en tampon.</p>'
                        + '<p>Le lecteur ci-dessus est celui que l’app utilise pour n’importe quel <code>.bmmreplay</code>. Il rejoue le <b>DOM</b>, pas une vidéo — le texte reste du texte sélectionnable — et il montre le masquage tel qu’il est réellement stocké : les valeurs démasquées n’entrent jamais dans le fichier, il n’y a donc rien à fuiter ensuite.</p>'
                        + '<h4>Si vous acceptez</h4><ul><li>Ce qui part : pages visitées, clics (<b>libellés seulement — jamais ce que vous tapez</b>), échantillons de performance, erreurs, et un profil matériel anonyme. Pas de chemins de fichiers, pas de contenu de mods, ni nom ni e-mail ; votre identité est un id anonyme.</li><li>Le <b>replay de session</b> (optionnel, actif par défaut quand la télémétrie l’est) enregistre l’UI <b>masquée</b> : noms de mods, de profils et chemins s’affichent en <code>••••</code>. Le démasquage est un interrupteur séparé et explicite.</li><li>Tout s’accumule d’abord dans un <b>fichier local (plafond 10 Mo)</b>, envoyé uniquement en lots gzip via <b>HTTPS</b> — sans endpoint configuré, les données ne quittent jamais votre machine.</li></ul>'
                        + '<h4>Où vit un enregistrement pendant qu’il se fait</h4><p>L’enregistreur de session local écrit sur le disque <b>au fil de l’eau</b> au lieu de garder la session dans l’app : les événements sont ajoutés à un spool par lots (512 Ko ou 200 événements, vidés au moins toutes les 3 s), et le cœur assemble le <code>.bmmreplay</code> en streaming — ça coûte donc environ un demi-mégaoctet de mémoire quelle que soit la durée, même à l’export. L’historique est une fenêtre glissante de <b>512 Mo</b> sur le disque ; les plus vieux segments partent en premier, et comme chacun commence par un snapshot complet, ce qui reste se lit toujours. Si BMM est tué, tu perds au pire les dernières secondes.</p>'
                        + '<p>Le <b>Replay Studio</b> des DevTools fait exception : il garde les événements en mémoire parce qu’il en a besoin pour la compression des pauses et le trim, il est donc plafonné à 64 Mo et <b>arrête la prise</b> à ce moment-là au lieu de grossir — ce qu’il a déjà reste complet et lisible.</p>'
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
                id: 'faq-pat', view: 'settings', docsPath: 'reference/github-pat/',
                title: { en: 'GitHub rate limits & Personal Access Token (PAT)', fr: 'Limites GitHub et jeton d’accès personnel (PAT)' },
                summary: { en: 'Why some GitHub actions hit a limit, and how a PAT raises it.', fr: 'Pourquoi certaines actions GitHub atteignent une limite, et comment un PAT l’augmente.' },
                keywords: 'pat github token rate limit api 403 jeton limite',
                body: {
                    en: '<p>Unauthenticated GitHub requests are capped at ~60/hour. Adding a <b>Personal Access Token (PAT)</b> raises this to 5 000/hour.</p><h4>Create one</h4><ul><li>On GitHub → <b>Settings → Developer settings → Personal access tokens</b>.</li><li>A <b>read-only</b>, public-scope token is enough — BMM only reads public releases/catalogs.</li><li>Paste it in BMM <b>Settings</b>; it’s stored locally and never shared.</li></ul>',
                    fr: '<p>Les requêtes GitHub non authentifiées sont limitées à ~60/heure. Ajouter un <b>jeton d’accès personnel (PAT)</b> monte cette limite à 5 000/heure.</p><h4>En créer un</h4><ul><li>Sur GitHub → <b>Settings → Developer settings → Personal access tokens</b>.</li><li>Un jeton <b>en lecture seule</b>, portée publique, suffit — BMM ne lit que des releases/catalogues publics.</li><li>Collez-le dans les <b>Réglages</b> de BMM ; il est stocké localement et jamais partagé.</li></ul>',
                },
            },
            {
                id: 'faq-disk-full', docsPath: 'features/storage/', diagram: 'faq-disk-full',
                title: { en: 'My disk is filling up', fr: 'Mon disque se remplit' },
                summary: { en: 'Where BMM stores data and how to reclaim space safely.', fr: 'Où BMM stocke ses données et comment récupérer de l’espace en sécurité.' },
                keywords: 'disk full space cache clean storage io disque espace cache',
                body: {
                    en: '<p>Space goes to four places, each with its own remedy:</p><ul><li><b>Duplicated mods</b> — enable <b>shared storage</b> so one copy serves every profile, and open <b>Settings → Storage &amp; disk usage</b> to see exactly what each area weighs.</li><li><b>Backups</b> — every overwritten game file lands in your profile’s backup folder. Prune snapshots you no longer need; the automatic per-file backups are cleaned when a mod is disabled.</li><li><b>Caches</b> — the hash cache and extracted-archive cache can be cleared from Settings; they rebuild on demand.</li><li><b>Session recordings</b> — crash/session replays are capped by retention limits you control (default <b>30 sessions / 2&nbsp;GB</b>, in the Crash Reports &amp; Sessions manager). Lower them if space is tight.</li></ul><p>During big deploys BMM also throttles disk I/O so the app stays responsive (see the disk-I/O limiter diagram).</p>',
                    fr: '<p>L’espace part dans quatre endroits, chacun avec son remède :</p><ul><li><b>Mods dupliqués</b> — activez le <b>stockage partagé</b> pour qu’une seule copie serve tous les profils, et ouvrez <b>Réglages → Stockage &amp; espace disque</b> pour voir ce que pèse chaque zone.</li><li><b>Sauvegardes</b> — chaque fichier de jeu écrasé atterrit dans le dossier de backup du profil. Supprimez les instantanés devenus inutiles ; les backups automatiques par fichier sont nettoyés à la désactivation d’un mod.</li><li><b>Caches</b> — le cache de hachage et le cache d’archives extraites se vident depuis les Réglages ; ils se reconstruisent à la demande.</li><li><b>Enregistrements de session</b> — les replays de crash/session sont plafonnés par des limites de rétention que vous contrôlez (défaut <b>30 sessions / 2&nbsp;Go</b>, dans le gestionnaire Rapports de plantage &amp; Sessions). Baissez-les si l’espace manque.</li></ul><p>Pendant les gros déploiements, BMM limite aussi les E/S disque pour rester réactif (voir le diagramme du limiteur d’E/S).</p>',
                },
            },
            {
                id: 'faq-deleted-mod', docsPath: 'reference/troubleshooting/', diagram: 'faq-deleted-mod',
                title: { en: 'I deleted a mod by mistake', fr: 'J’ai supprimé un mod par erreur' },
                summary: { en: 'How to recover, and why profiles make this rare.', fr: 'Comment récupérer, et pourquoi les profils rendent cela rare.' },
                keywords: 'deleted recover restore mistake backup supprimé récupérer',
                body: {
                    en: '<p>Check these, in order — deleting from a profile rarely removes the only copy:</p><ul><li><b>Another profile still has it?</b> With shared storage, other profiles keep pointing at the same stored copy — re-add it to this profile from the Library.</li><li><b>It came from a server repo?</b> Re-run the sync: the client compares the manifest to your disk and re-downloads exactly the missing files.</li><li><b>You have a snapshot?</b> Restore the profile backup taken before the change.</li><li><b>It replaced game files?</b> Disabling/removing a mod puts the backed-up originals back automatically — your game is never left half-modded.</li></ul><p>The <b>History</b> button in the Library shows recent operations, which helps pin down what happened when.</p>',
                    fr: '<p>Vérifiez ceci, dans l’ordre — supprimer d’un profil retire rarement la seule copie :</p><ul><li><b>Un autre profil l’a encore ?</b> Avec le stockage partagé, les autres profils pointent toujours vers la même copie stockée — ré-ajoutez-le à ce profil depuis la Bibliothèque.</li><li><b>Il venait d’un dépôt serveur ?</b> Relancez la synchro : le client compare le manifeste à votre disque et re-télécharge exactement les fichiers manquants.</li><li><b>Vous avez un instantané ?</b> Restaurez la sauvegarde de profil prise avant le changement.</li><li><b>Il remplaçait des fichiers du jeu ?</b> Désactiver/retirer un mod remet automatiquement les originaux sauvegardés — le jeu n’est jamais laissé à moitié moddé.</li></ul><p>Le bouton <b>Historique</b> de la Bibliothèque montre les opérations récentes — utile pour comprendre ce qui s’est passé quand.</p>',
                },
            },
            {
                id: 'faq-crash', docsPath: 'reference/troubleshooting/', diagram: 'crash-reporting',
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
            {
                id: 'codebase-maps', docsPath: 'how-it-works/codebase-maps/',
                title: { en: 'Codebase maps', fr: 'Cartes du code' },
                summary: { en: 'Three tools that answer what the compiler cannot: the module graph, the Rust API surface, and what a change actually touches.', fr: 'Trois outils qui répondent à ce que le compilateur ignore : le graphe de modules, la surface d’API Rust, et ce qu’un changement touche vraiment.' },
                keywords: 'dependency graph cycles orphan invoke api surface test impact coverage carte graphe cycle couverture',
                body: {
                    en: '<p>Two boundaries in BMM have <b>no type checking behind them</b>, and the test suite is far smaller than the codebase. Three developer tools answer what the compiler cannot. None of them ships in the app; they read the source and print a structure.</p><p><b>The module graph</b> (<code>npm run map:deps</code>) reads every import. It names the hub &mdash; <code>core/i18n.ts</code> is imported by 66 modules, so a change there is never small &mdash; the modules nothing reachable ever imports, and the import cycles. A cycle is legal in ES modules and harmless until one member reads a binding at evaluation time; then it is <code>undefined</code> at runtime with a stack pointing at the wrong file. The CI gate is a <b>ratchet against a committed baseline</b>, not a demand for zero: there are 77 cycles today, and a gate insisting on zero on day one is a gate somebody switches off in week two.</p><p><b>The API map</b> (<code>npm run map:api</code>) covers the boundary with the Rust core. <code>invoke</code> is non-generic and returns <code>Promise&lt;any&gt;</code>, so TypeScript checks nothing about those calls &mdash; a typo compiles and fails at runtime as a rejected promise. 367 commands are registered, 322 are called from the frontend. The 45 with no frontend caller are reported as exactly that and <b>never as unused</b>: the MCP server, the CLI and <code>bmm://</code> deeplinks reach commands the interface never touches.</p><p><b>The impact analyser</b> (<code>npm run impact</code>) says which tests reach your change, and &mdash; the useful half &mdash; which changed files no test reaches. It follows the dependency graph, so a test importing one module counts as reaching what that module imports. It therefore <b>over-reports coverage and under-reports gaps</b>, which is what makes the gap list worth trusting: <code>ui/app.ts</code> and <code>features/mods/mods.ts</code>, the two largest modules here, are reached by no test at all.</p>',
                    fr: '<p>Deux frontières de BMM n\'ont <b>aucun typage derrière elles</b>, et la suite de tests est bien plus petite que le code. Trois outils de développement répondent à ce que le compilateur ignore. Aucun n\'est embarqué dans l\'app : ils lisent les sources et impriment une structure.</p><p><b>Le graphe de modules</b> (<code>npm run map:deps</code>) lit chaque import. Il nomme le pivot &mdash; <code>core/i18n.ts</code> est importé par 66 modules, un changement là n\'est jamais petit &mdash; les modules que rien d\'atteignable n\'importe, et les cycles d\'import. Un cycle est légal en modules ES et inoffensif jusqu\'à ce qu\'un membre lise une liaison à l\'évaluation ; c\'est alors <code>undefined</code> à l\'exécution, avec une pile qui pointe le mauvais fichier. La barrière CI est un <b>cliquet contre une référence versionnée</b>, pas une exigence de zéro : il y a 77 cycles aujourd\'hui, et une barrière qui exige zéro dès le premier jour est une barrière que quelqu\'un désactive la deuxième semaine.</p><p><b>La carte d\'API</b> (<code>npm run map:api</code>) couvre la frontière avec le cœur Rust. <code>invoke</code> n\'est pas générique et renvoie <code>Promise&lt;any&gt;</code> : TypeScript ne vérifie rien de ces appels &mdash; une faute de frappe compile et échoue à l\'exécution en promesse rejetée. 367 commandes enregistrées, 322 appelées depuis le frontend. Les 45 sans appelant sont signalées exactement ainsi et <b>jamais comme inutilisées</b> : le serveur MCP, la CLI et les deeplinks <code>bmm://</code> atteignent des commandes que l\'interface ne touche jamais.</p><p><b>L\'analyseur d\'impact</b> (<code>npm run impact</code>) dit quels tests atteignent votre changement et &mdash; la moitié utile &mdash; quels fichiers modifiés aucun test n\'atteint. Il suit le graphe de dépendances : un test qui importe un module atteint donc ce que ce module importe. Il <b>sur-estime la couverture et sous-estime les trous</b>, ce qui rend justement la liste des trous fiable : <code>ui/app.ts</code> et <code>features/mods/mods.ts</code>, les deux plus gros modules d\'ici, ne sont atteints par aucun test.</p>',
                },
            },
            devArticle('code-stack', { en: 'The stack — and why it’s lean', fr: 'La stack — et pourquoi elle est légère' }, { en: 'Tauri shell, a native Rust core and a TypeScript UI — and why that stays small.', fr: 'Coquille Tauri, cœur natif Rust et UI TypeScript — et pourquoi ça reste léger.' }, 'stack rust tauri typescript lightweight memory ram electron', {
                en: '<p>BMM is a <b>Tauri</b> app: the UI is TypeScript running in the OS\'s native webview, and every real operation — scanning, hashing, copying, networking — is a compiled <b>Rust</b> core. The UI never touches the disk directly; it calls the core over a single typed <code>invoke()</code> channel, and all state lives in the core.</p><p>Unlike an Electron app — which bundles a whole copy of Chromium (~150&nbsp;MB) and runs its logic in JavaScript — BMM reuses the OS webview and does the heavy work natively. So it idles at a few dozen MB, runs file operations at native speed, and the UI can reload at any time without losing your session.</p>',
                fr: '<p>BMM est une app <b>Tauri</b> : l\'interface est en TypeScript dans la webview native de l\'OS, et chaque opération réelle — scan, hachage, copie, réseau — est un cœur <b>Rust</b> compilé. L\'interface ne touche jamais le disque directement ; elle appelle le cœur via un unique canal typé <code>invoke()</code>, et tout l\'état vit dans le cœur.</p><p>Contrairement à une app Electron — qui embarque une copie complète de Chromium (~150&nbsp;Mo) et exécute sa logique en JavaScript — BMM réutilise la webview de l\'OS et fait le gros du travail nativement. Il tourne donc au repos à quelques dizaines de Mo, exécute les opérations fichier à vitesse native, et l\'interface peut se recharger sans perdre votre session.</p>',
            }),
            devArticle('engine-threads', { en: 'Engine & threads', fr: 'Moteur et threads' }, { en: 'How work is split across threads to keep the UI responsive.', fr: 'Comment le travail est réparti sur les threads pour garder l’UI réactive.' }, 'threads async engine concurrency', {
                en: '<p>Long jobs never run on the UI thread, and big applies and unapplies do not run in the app at all — they go to a <b>separate process</b>, the same executable re-invoked as a mod worker, which starts without booting the webview at all. It demotes itself to Windows <b>background IO priority</b>, so the kernel keeps disk bandwidth for the window. Cancelling is a hard kill of that process — instant and reliable however stuck the IO is — followed by an inverse-op undo pass, so a cancelled deploy does not leave half a mod behind.</p><p>There are <b>three thread pools</b>, each capped for its own reason: the global one (capped, with 512 KB stacks, so it cannot hog the CPU and lag the OS), the hashing pool (max 4), and the copy pool (1–2, forced to 1 on the OS drive). A single global lock means one mod operation at a time.</p><p>Inside the app the rule is: hold a lock to collect metadata, never to do I/O. Every heavy path takes a lightweight snapshot under the lock and releases it before reading a single file — that is what used to freeze the window on big mods.</p>',
                fr: '<p>Les longues tâches ne tournent jamais sur le thread de l\'interface, et les grosses applications/désapplications ne tournent pas du tout dans l\'app — elles partent dans un <b>processus séparé</b>, le même exécutable réinvoqué en worker de mods, qui démarre sans lancer le webview. Il se rétrograde en <b>priorité I/O de fond</b> Windows, le noyau garde donc de la bande passante disque pour la fenêtre. Annuler, c\'est tuer ce processus — instantané et fiable quel que soit le blocage des I/O — suivi d\'une passe d\'annulation en opération inverse, donc un déploiement annulé ne laisse pas la moitié d\'un mod.</p><p>Il y a <b>trois pools de threads</b>, chacun plafonné pour sa propre raison : le global (plafonné, piles de 512 Ko, pour ne pas monopoliser le CPU et faire ramer l\'OS), le pool de hachage (max 4), et le pool de copie (1–2, forcé à 1 sur le disque système). Un verrou global signifie une seule opération de mod à la fois.</p><p>Dans l\'app, la règle est : tenir un verrou pour collecter des métadonnées, jamais pour faire des I/O. Chaque chemin lourd prend un instantané léger sous le verrou et le relâche avant de lire le moindre fichier — c\'est ce qui figeait la fenêtre sur les gros mods.</p>',
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
                en: '<p>Every file gets a <b>BLAKE3</b> content fingerprint — a short value that changes completely if a single byte does. Local hashes are stored tagged <code>b3:</code>; an untagged one is read as a legacy SHA-256, so old baselines and modpacks keep verifying after the switch.</p><p>BLAKE3 was chosen because it can parallelise <i>within</i> one large file — and the hot path <b>deliberately declines to</b>. Hashing runs on a pool capped to about half your cores (max 4), with a sequential mmap per file, precisely because BLAKE3 is fast enough to saturate every core and freeze the window while a library is imported. Parallelism comes from hashing several <i>files</i> at once, not one file across all cores.</p><p>SHA-256 survives in three places on purpose: legacy baselines, the repo wire format, and the <code>content_id</code> fingerprint — which had to keep its algorithm so the migration would not change any mod\'s identity.</p>',
                fr: '<p>Chaque fichier reçoit une empreinte de contenu <b>BLAKE3</b> — une valeur courte qui change complètement si un seul octet change. Les hashs locaux sont stockés préfixés <code>b3:</code> ; un hash non préfixé est lu comme un SHA-256 legacy, donc les anciennes baselines et les anciens modpacks continuent de se vérifier après le changement.</p><p>BLAKE3 a été choisi parce qu\'il sait paralléliser <i>à l\'intérieur</i> d\'un gros fichier — et le chemin chaud <b>refuse délibérément</b> de s\'en servir. Le hachage tourne sur un pool plafonné à environ la moitié des cœurs (max 4), avec un mmap séquentiel par fichier, précisément parce que BLAKE3 est assez rapide pour saturer tous les cœurs et figer la fenêtre pendant l\'import d\'une bibliothèque. Le parallélisme vient du hachage de plusieurs <i>fichiers</i> à la fois, pas d\'un fichier sur tous les cœurs.</p><p>SHA-256 survit à trois endroits exprès : les baselines legacy, le format de transport des dépôts, et l\'empreinte <code>content_id</code> — qui devait garder son algorithme pour que la migration ne change l\'identité d\'aucun mod.</p>',
            }),
            devArticle('integrity-engine', { en: 'Integrity engine', fr: 'Moteur d’intégrité' }, { en: 'How every file is verified before it reaches your game.', fr: 'Comment chaque fichier est vérifié avant d’atteindre le jeu.' }, 'integrity verify corrupt intégrité', {
                en: '<p>Checking a mod compares its stored baseline against the disk and returns three lists: <b>missing</b> (the baseline has it, the disk does not), <b>modified</b> (present, but the content hash changed) and <b>added</b> (on disk, unknown to the baseline).</p><p>Two behaviours nobody guesses: the <b>first</b> check on a mod never fails — with no baseline yet, BMM hashes everything and stores that as the baseline, so only the <i>second</i> check can report a problem. And a failed result is <b>remembered</b>: it sets a flag that draws the warning icon in the Library and survives a restart.</p><p>Where a hash actually <i>blocks</i> something: a catalog download is SHA-256 verified before it can run (if the catalog carries no hash, BMM says so and asks); a repo sync compares before downloading, per chunk during, and re-verifies after; applying a modpack checks unless that pack has <i>skip integrity check</i>. Enabling a mod from the <b>scheduler bypasses the check</b> — a background run cannot stop to ask you.</p>',
                fr: '<p>Vérifier un mod compare sa baseline stockée au disque et renvoie trois listes : <b>missing</b> (la baseline l\'a, le disque non), <b>modified</b> (présent, mais le hash de contenu a changé) et <b>added</b> (sur le disque, inconnu de la baseline).</p><p>Deux comportements que personne ne devine : le <b>premier</b> contrôle d\'un mod n\'échoue jamais — sans baseline, BMM hache tout et le stocke comme baseline, seul le <i>deuxième</i> contrôle peut donc signaler un problème. Et un résultat en échec est <b>mémorisé</b> : il pose un drapeau qui dessine l\'icône d\'avertissement dans la Bibliothèque et survit à un redémarrage.</p><p>Là où un hash <i>bloque</i> réellement quelque chose : un téléchargement de catalogue est vérifié en SHA-256 avant toute exécution (si le catalogue ne porte aucun hash, BMM le dit et demande) ; une synchro de dépôt compare avant le téléchargement, par chunk pendant, et re-vérifie après ; appliquer un modpack contrôle, sauf si ce pack a <i>ignorer le contrôle d\'intégrité</i>. Activer un mod depuis le <b>planificateur contourne le contrôle</b> — une exécution de fond ne peut pas s\'arrêter pour te demander.</p>',
            }),
            devArticle('mtime-cache', { en: 'mtime cache', fr: 'Cache mtime' }, { en: 'Skip re-hashing unchanged files using modification times.', fr: 'Éviter de re-hacher les fichiers inchangés via les dates de modification.' }, 'mtime cache incremental', {
                en: '<p>Re-scanning gigabytes on every launch would be pointless — almost nothing changes between runs. There are actually <b>two caches, keyed differently</b>, and the distinction is the whole design:</p><ul><li>The <b>file list</b> is keyed on the mod <i>folder\'s</i> modification time. Same mtime as stored → reuse the list verbatim, without even walking the directory.</li><li>The <b>file hashes</b> are keyed per file, and are recomputed by an integrity check rather than by a scan.</li></ul><p>If reading the metadata fails, BMM logs it and resets the stored mtime rather than trusting a zero — a failure becomes a re-scan, never a false cache hit.</p><p>The honest limit: editing a file <i>in place</i> may leave the parent folder\'s mtime untouched, so the cached list stays valid (correctly — the list did not change) but nothing prompts a re-hash. That is exactly why the hashes are a separate cache with a separate trigger: run an integrity check when you want the truth. Re-hashing itself is a throttled background queue — one mod at a time, on the capped hash pool, with a pause between each.</p>',
                fr: '<p>Re-scanner des gigaoctets à chaque lancement serait inutile — presque rien ne change entre deux sessions. Il y a en fait <b>deux caches, avec des clés différentes</b>, et cette distinction est tout le design :</p><ul><li>La <b>liste de fichiers</b> a pour clé la date de modification du <i>dossier</i> du mod. Même mtime que celle stockée → réutiliser la liste telle quelle, sans même parcourir le dossier.</li><li>Les <b>hashs de fichiers</b> ont pour clé le fichier, et sont recalculés par un contrôle d\'intégrité, pas par un scan.</li></ul><p>Si la lecture des métadonnées échoue, BMM le journalise et remet à zéro la mtime stockée plutôt que de faire confiance à un zéro — un échec devient un re-scan, jamais un faux succès de cache.</p><p>La limite honnête : éditer un fichier <i>sur place</i> peut laisser la mtime du dossier parent intacte, donc la liste en cache reste valide (à juste titre — la liste n\'a pas changé) mais rien ne déclenche un re-hachage. C\'est exactement pour ça que les hashs sont un cache séparé avec un déclencheur séparé : lance un contrôle d\'intégrité quand tu veux la vérité. Le re-hachage lui-même est une file de fond bridée — un mod à la fois, sur le pool de hash plafonné, avec une pause entre chacun.</p>',
            }),
            devArticle('disk-io-limiter', { en: 'Disk I/O limiter', fr: 'Limiteur d’E/S disque' }, { en: 'Keep the app responsive during big copies.', fr: 'Garder l’app réactive pendant les grosses copies.' }, 'io disk throttle limiter', {
                en: '<p>Copying at full tilt can peg a drive and make the whole system stutter — BMM included. Every copy takes one of <b>three routes</b>:</p><ul><li><b>Throttled</b> — you set a MB/s cap for that disk: 128 KB chunks, paced to hit the rate.</li><li><b>Smart I/O</b> — no cap: 1 MiB chunks with a short yield on a ~16 MiB <i>byte budget</i>. The older 256 KB + per-chunk sleep cost about 37% versus full speed; budgeting the yield keeps the window responsive and wins most of that back.</li><li><b>Full speed</b> — Smart I/O off and no cap: the OS does the whole copy.</li></ul><p>Parallelism is capped at 2 threads so copies never saturate every core, and if the game or backup folder sits on your <b>OS drive</b> it drops to a single thread whatever the setting says — Windows itself needs the headroom.</p><p><b>BMM never hard-links or symlinks.</b> Every deployed file is a real copy. That costs disk space, and it is why the destination folder works with tools that do not understand links, survives a mods folder on another drive, and stays intact if BMM is uninstalled.</p>',
                fr: '<p>Copier à fond peut monopoliser un disque et faire saccader tout le système — BMM compris. Chaque copie prend l\'une de <b>trois routes</b> :</p><ul><li><b>Bridée</b> — tu poses un plafond Mo/s pour ce disque : blocs de 128 Ko, cadencés pour tenir le débit.</li><li><b>Smart I/O</b> — sans plafond : blocs de 1 Mio avec un court yield sur un <i>budget d\'octets</i> de ~16 Mio. L\'ancien 256 Ko + pause par bloc coûtait environ 37% par rapport à la pleine vitesse ; budgétiser le yield garde la fenêtre réactive et récupère l\'essentiel.</li><li><b>Pleine vitesse</b> — Smart I/O coupé et aucun plafond : l\'OS fait toute la copie.</li></ul><p>Le parallélisme est plafonné à 2 threads pour que les copies ne saturent jamais tous les cœurs, et si le dossier de destination ou de sauvegarde est sur ton <b>disque système</b>, ça descend à un seul thread quel que soit le réglage — Windows lui-même a besoin de la marge.</p><p><b>BMM ne fait jamais de hard-link ni de lien symbolique.</b> Chaque fichier déployé est une vraie copie. Ça coûte de l\'espace disque, et c\'est pour ça que le dossier de destination fonctionne avec les outils qui ne comprennent pas les liens, survit à un dossier mods sur un autre disque, et reste intact si BMM est désinstallé.</p>',
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
                en: '<p>A profile is a small record — a name, <b>three folders</b> (game, mods, backup) and an ordered list of which mods are on. It stores no files, so you can keep a dozen for almost nothing.</p><p><b>Switching a profile moves no files at all.</b> It sets one pointer and saves — nothing is deployed, nothing is removed, and whatever is already in the destination folder stays exactly where it is. What changes is which list you are now editing. Only enabling and disabling touch the destination folder. This is the single most common surprise in BMM, so it is worth repeating: switching does not swap your loadout.</p><p>A mod belongs to a profile by <b>path prefix</b> — its folder sits under that profile\'s mods folder — not by a stored id. And profiles that share <i>both</i> the game and mods folders have their active lists reconciled with each other, because there is only one destination folder underneath. To keep genuinely separate loadouts, give each profile its own mods folder.</p>',
                fr: '<p>Un profil est un petit enregistrement — un nom, <b>trois dossiers</b> (jeu, mods, sauvegarde) et une liste ordonnée des mods actifs. Il ne stocke aucun fichier, tu peux donc en garder une douzaine pour presque rien.</p><p><b>Changer de profil ne déplace aucun fichier.</b> Ça pose un pointeur et sauvegarde — rien n\'est déployé, rien n\'est retiré, et ce qui est déjà dans le dossier de destination reste exactement où il est. Ce qui change, c\'est la liste que tu édites désormais. Seuls activer et désactiver touchent au dossier de destination. C\'est la surprise la plus fréquente dans BMM, donc autant le répéter : changer de profil ne permute pas ton loadout.</p><p>Un mod appartient à un profil par <b>préfixe de chemin</b> — son dossier se trouve sous le dossier mods de ce profil — pas par un id stocké. Et les profils qui partagent <i>à la fois</i> le dossier de destination et le dossier mods ont leurs listes actives réconciliées entre elles, parce qu\'il n\'y a qu\'un seul dossier de destination en dessous. Pour garder des loadouts vraiment séparés, donne à chaque profil son propre dossier mods.</p>',
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
            }, '#', 'launch-packs-internals'),
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
// `id` defaults to the diagram id, which is right when one diagram backs one article. It is
// NOT right when the same diagram illustrates both a user-facing article and a dev one:
// article ids are a single global namespace (findArticle scans every category and returns
// the FIRST match), so the second article silently becomes unreachable — every route to it
// renders the first. That happened to `launch-packs`. Pass an explicit id in that case.
function devArticle(diagramId, title, summary, keywords, body, docsPath = '#', id = diagramId) {
    return {
        id, title, summary, diagram: diagramId, docsPath: docsPath === '#' ? undefined : docsPath, keywords,
        body: {
            en: `${body.en}<p class="dh-diagnote">Open the interactive diagram (button below) to follow this step by step — pan, zoom and hover each node.</p>`,
            fr: `${body.fr}<p class="dh-diagnote">Ouvrez le diagramme interactif (bouton ci-dessous) pour suivre étape par étape — déplacez, zoomez et survolez chaque nœud.</p>`,
        },
    };
}
let host = null;
let route = { view: 'hub', part: 'user', mode: 'classic' };
const catsOf = (part) => CATEGORIES.filter((c) => c.part === part);
const findArticle = (id) => {
    for (const cat of CATEGORIES) {
        const art = cat.articles.find((a) => a.id === id);
        if (art)
            return { cat, art };
    }
    return null;
};
// Diagram gallery entries, built from the shared registry (title from each module's titleKey).
function diagramList() {
    const reg = diagrams;
    return Object.keys(reg).map((id) => {
        const key = reg[id]?.titleKey;
        const title = (key && t(key)) || id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        return { id, title };
    }).sort((a, b) => a.title.localeCompare(b.title));
}
/** An article's diagrams, however it declared them. An article can genuinely have more than
 *  one — "how a mod is imported" and "how it is then kept in sync" are two pictures of the
 *  same subject, and forcing a choice is what left four diagrams written, translated, shipped
 *  and linked from nowhere. */
function diaIds(a) {
    if (!a.diagram)
        return [];
    return Array.isArray(a.diagram) ? a.diagram : [a.diagram];
}
/** The registry's own title for a diagram, so a second button says WHICH one it opens. */
function diaTitle(id) {
    const key = diagrams[id]?.titleKey;
    return (key && t(key)) || id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
// ── rendering: chrome (header, part toggle, search) ────────────────────────────────
function chrome() {
    const seg = (p, label, sub) => `<button class="dh-seg ${route.part === p ? 'on' : ''}" data-part="${p}"><span>${tr(label)}</span><small>${tr(sub)}</small></button>`;
    return `
  <div class="dh">
    <div class="dh-top">
      <div class="dh-heading">
        <h1>${tr({ en: 'Help & documentation', fr: 'Aide et documentation' })}</h1>
        <p>${tr({ en: 'Everything about BMM — searchable, with hands-on tutorials and interactive diagrams.', fr: 'Tout sur BMM — recherchable, avec des tutoriels guidés et des diagrammes interactifs.' })}</p>
      </div>
      <div class="dh-actions">
        <button class="dh-btn dh-btn-primary" data-act="tutorial">${svg('play', 16)} ${tr({ en: 'Interactive tutorial', fr: 'Tutoriel interactif' })}</button>
        <button class="dh-btn" data-view2="pages">${svg('book', 16)} ${tr({ en: 'Full documentation', fr: 'Documentation complète' })}</button>
        <button class="dh-btn" data-ext="${DOCS_SITE}">${svg('ext', 16)} ${tr({ en: 'On the website', fr: 'Sur le site' })}</button>
      </div>
    </div>
    <!-- The part toggle and the search sit on ONE row: both answer "narrow what I am
         looking at", and stacking them cost a full-width band for a small pill, pushing the
         actual content a third of the way down the page. -->
    <div class="dh-controls">
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
    </div>
    <div class="dh-crumbs"></div>
    <div class="dh-body"></div>
  </div>`;
}
function crumbs() {
    const home = `<button class="dh-crumb" data-view2="hub">${tr({ en: 'Help', fr: 'Aide' })}</button>`;
    const partName = route.part === 'dev' ? { en: 'Developer', fr: 'Développeur' } : { en: 'User guide', fr: 'Guide utilisateur' };
    const sep = `<span class="dh-crumb-sep">${svg('arrow', 12)}</span>`;
    const parts = [home];
    if (route.view === 'search') {
        parts.push(sep, `<span class="dh-crumb on">${tr({ en: 'Search', fr: 'Recherche' })}</span>`);
        return parts.join('');
    }
    parts.push(sep, `<button class="dh-crumb" data-view2="hub" data-part="${route.part}">${tr(partName)}</button>`);
    if (route.view === 'diagrams') {
        parts.push(sep, `<span class="dh-crumb on">${tr({ en: 'Diagrams', fr: 'Diagrammes' })}</span>`);
        return parts.join('');
    }
    if (route.view === 'pages' || route.view === 'page') {
        const all = tr({ en: 'Full documentation', fr: 'Documentation complète' });
        if (route.view === 'pages') {
            parts.push(sep, `<span class="dh-crumb on">${all}</span>`);
            return parts.join('');
        }
        const meta = (_manifest || []).find((p) => p.path === route.page);
        parts.push(sep, `<button class="dh-crumb" data-view2="pages">${all}</button>`, sep, `<span class="dh-crumb on">${meta ? tr(meta.title) : route.page}</span>`);
        return parts.join('');
    }
    const cat = route.catId ? CATEGORIES.find((c) => c.id === route.catId) : null;
    if (cat) {
        const last = route.view === 'cat';
        parts.push(sep, last ? `<span class="dh-crumb on">${tr(cat.title)}</span>` : `<button class="dh-crumb" data-cat="${cat.id}">${tr(cat.title)}</button>`);
    }
    if (route.view === 'art' && route.artId) {
        const found = findArticle(route.artId);
        if (found)
            parts.push(sep, `<span class="dh-crumb on">${tr(found.art.title)}</span>`);
    }
    return parts.join('');
}
function hubView() {
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
function articleCard(a) {
    return `
    <button class="dh-art" data-art="${a.id}">
      <span class="dh-art-t">${tr(a.title)}</span>
      <span class="dh-art-s">${tr(a.summary)}</span>
      <span class="dh-art-tags">
        ${a.tutorial ? `<span class="dh-tag dh-tag-tut">${svg('play', 11)} ${tr({ en: 'Tutorial', fr: 'Tutoriel' })}</span>` : ''}
        ${diaIds(a).length ? `<span class="dh-tag dh-tag-dia">${svg('diagram', 11)} ${tr({ en: 'Diagram', fr: 'Diagramme' })}${diaIds(a).length > 1 ? ` · ${diaIds(a).length}` : ''}</span>` : ''}
        ${a.media ? `<span class="dh-tag dh-tag-med">${svg('play', 11)} ${tr({ en: 'Demo', fr: 'Démo' })}</span>` : ''}
      </span>
    </button>`;
}
function categoryView(c) {
    return `
    <div class="dh-cat-head">${svg(c.icon, 24)}<div><h2>${tr(c.title)}</h2><p>${tr(c.blurb)}</p></div></div>
    <div class="dh-arts">${c.articles.map(articleCard).join('')}</div>`;
}
function mediaBlock(m) {
    const cap = m.caption ? `<figcaption class="dh-media-cap">${tr(m.caption)}</figcaption>` : '';
    if (m.kind === 'image' && m.src)
        return `<figure class="dh-media"><img class="dh-media-img" src="${m.src}" alt="${m.caption ? tr(m.caption) : ''}" loading="lazy">${cap}</figure>`;
    if (m.kind === 'svg' && m.svg)
        return `<figure class="dh-media dh-media-svg">${m.svg}${cap}</figure>`;
    if (m.kind === 'replay' && m.src)
        return `<figure class="dh-media"><button class="dh-replay" data-replay="${m.src}">${svg('play', 20)} <span>${tr({ en: 'Play session recording', fr: 'Lire l’enregistrement' })}</span></button>${cap}</figure>`;
    return '';
}
function articleView(cat, a) {
    const rel = [
        a.view ? `<button class="dh-rel dh-rel-open" data-nav="${a.view}">${svg('arrow', 15)} ${tr({ en: 'Open', fr: 'Ouvrir' })} ${navLabel(a.view)} ${tr({ en: 'in BMM', fr: 'dans BMM' })}</button>` : '',
        a.tutorial ? `<button class="dh-rel dh-rel-tut" data-tut="${a.tutorial.id}" data-tut-part="${a.tutorial.part || ''}" data-tut-step="${a.tutorial.step || ''}">${svg('play', 15)} ${tr({ en: 'Try it in the tutorial', fr: 'Essayer dans le tutoriel' })}</button>` : '',
        ...diaIds(a).map((id, i, all) => `<button class="dh-rel dh-rel-dia" data-diagram="${id}">${svg('diagram', 15)} ${all.length > 1 ? escapeHtml(diaTitle(id)) : tr({ en: 'Open the diagram', fr: 'Ouvrir le diagramme' })}</button>`),
        // The full page is BUNDLED, so it opens in place rather than sending you to a browser. The
        // external link stays for the site itself (search, PDF, sharing a URL).
        // Label reads as "what pressing this gives you". The full page is the default, so it starts
        // offering the short version; showFullPage() flips it back.
        a.docsPath ? `<button class="dh-rel dh-rel-full" data-fullpage="${a.docsPath}"
      data-lbl-short="${tr({ en: 'Short version', fr: 'Version courte' })}"
      data-lbl-full="${tr({ en: 'Full page', fr: 'Page complète' })}">${svg('book', 15)} <span class="dh-rel-lbl">${tr({ en: 'Full page', fr: 'Page complète' })}</span></button>` : '',
        // mkdocs serves index.md at the site root, so "index/" is not a URL there.
        `<button class="dh-rel dh-rel-ext" data-ext="${DOCS_SITE}${a.docsPath === 'index/' ? '' : (a.docsPath || '')}">${svg('ext', 15)} ${tr({ en: 'Open on the site', fr: 'Ouvrir sur le site' })}</button>`,
    ].filter(Boolean).join('');
    return `
    <article class="dh-article${a.wide ? ' dh-wide' : ''}">
      <h2>${tr(a.title)}</h2>
      <p class="dh-lead">${tr(a.summary)}</p>
      ${a.media ? mediaBlock(a.media) : ''}
      <div class="dh-content">${renderDocMarkdown(tr(a.body))}</div>
      <div class="dh-rels">${rel}</div>
    </article>`;
}
function diagramsView() {
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
function expandTerms(q) {
    const base = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (route.mode === 'classic')
        return base;
    // Semantic: add synonyms for each token (Algolia-ish query expansion).
    const syn = getSynonyms() || {};
    const set = new Set(base);
    for (const tok of base) {
        for (const [k, list] of Object.entries(syn)) {
            if (k.toLowerCase() === tok || (list || []).some((s) => s.toLowerCase() === tok)) {
                set.add(k.toLowerCase());
                (list || []).forEach((s) => set.add(s.toLowerCase()));
            }
        }
    }
    return [...set];
}
function scoreHay(hay, terms) {
    let s = 0;
    for (const t2 of terms)
        if (t2 && hay.includes(t2))
            s += 1;
    return s;
}
function searchView(q) {
    const terms = expandTerms(q);
    const arts = [];
    for (const cat of CATEGORIES)
        for (const art of cat.articles) {
            const hay = `${tr(art.title)} ${tr(art.summary)} ${art.keywords || ''} ${art.title.en} ${art.title.fr} ${art.summary.en} ${art.summary.fr}`.toLowerCase();
            const s = scoreHay(hay, terms);
            if (s > 0)
                arts.push({ cat, art, s });
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
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// ── controller ───────────────────────────────────────────────────────────────────
function bodyHtml() {
    switch (route.view) {
        case 'search': return searchView(route.q || '');
        case 'diagrams': return diagramsView();
        case 'pages': return pagesView();
        case 'page': return pageReaderView(route.page || '');
        case 'cat': {
            const c = CATEGORIES.find((x) => x.id === route.catId);
            return c ? categoryView(c) : hubView();
        }
        case 'art': {
            const f = route.artId ? findArticle(route.artId) : null;
            return f ? articleView(f.cat, f.art) : hubView();
        }
        default: return hubView();
    }
}
function paint() {
    const body = host?.querySelector('.dh-body');
    const cr = host?.querySelector('.dh-crumbs');
    if (body)
        body.innerHTML = bodyHtml();
    if (cr)
        cr.innerHTML = crumbs();
    // keep the search input in sync (e.g. after a lang re-render)
    const input = host?.querySelector('.dh-search');
    if (input && route.view === 'search' && input.value !== (route.q || ''))
        input.value = route.q || '';
    // An article that HAS a documentation page shows that page, not a second text written beside
    // it. The hand-written blurb stays reachable as the short version, and the article's own
    // buttons — open the screen, run the tutorial, open the diagram — are what BMM adds on top.
    // Two texts maintained in parallel is exactly how they came to disagree.
    if (route.view === 'art') {
        const f = route.artId ? findArticle(route.artId) : null;
        const path = f?.art.docsPath?.replace(/^\/+|\/+$/g, '');
        if (path && (_manifest || []).some((p) => p.path === path)) {
            const btn = host?.querySelector('[data-fullpage]');
            void showFullPage(path, btn, undefined, true);
        }
    }
    // The standalone page reader paints a "Loading…" shell and openPage() fills it. paint() had no
    // such step, so anything that repainted WITHOUT going through openPage — switching language is
    // the one a reader hits — left the page saying "Loading…" with nothing on the way to replace it.
    if (route.view === 'page' && route.page)
        void fillPage(route.page);
}
function renderAll() {
    if (!host)
        return;
    host.innerHTML = chrome();
    wireSearch();
    paint();
}
function go(next) { route = { ...route, ...next }; paint(); }
function wireSearch() {
    const input = host?.querySelector('.dh-search');
    if (!input)
        return;
    if (route.view === 'search')
        input.value = route.q || '';
    let deb = null;
    input.addEventListener('input', () => {
        if (deb != null)
            window.clearTimeout(deb);
        deb = window.setTimeout(() => {
            const q = input.value.trim();
            if (q.length >= 2)
                go({ view: 'search', q });
            else
                go({ view: 'hub', q: '' });
        }, 120);
    });
}
function onClick(e) {
    const el = e.target;
    const hit = (sel) => el.closest(sel);
    const modeBtn = hit('[data-mode]');
    if (modeBtn) {
        route.mode = modeBtn.getAttribute('data-mode') || 'classic';
        host?.querySelectorAll('.dh-mode').forEach((m) => m.classList.toggle('on', m.getAttribute('data-mode') === route.mode));
        if (route.view === 'search' && route.q)
            paint();
        return;
    }
    const partBtn = hit('[data-part]');
    if (partBtn && (partBtn.hasAttribute('data-part')) && (partBtn.classList.contains('dh-seg') || partBtn.classList.contains('dh-crumb'))) {
        const p = partBtn.getAttribute('data-part');
        host?.querySelectorAll('.dh-seg').forEach((s) => s.classList.toggle('on', s.getAttribute('data-part') === p));
        go({ part: p, view: 'hub', catId: undefined, artId: undefined });
        return;
    }
    const rep = hit('[data-replay]');
    if (rep) {
        playReplay(rep.getAttribute('data-replay') || '');
        return;
    }
    const navBtn = hit('[data-nav]');
    if (navBtn) {
        const v = navBtn.getAttribute('data-nav');
        document.querySelector(`.nav-item[data-view="${v}"]`)?.click();
        return;
    }
    const tutBtn = hit('[data-tut]');
    if (tutBtn) {
        launchTutorial(tutBtn.getAttribute('data-tut') || '', tutBtn.getAttribute('data-tut-part') || '', tutBtn.getAttribute('data-tut-step') || '');
        return;
    }
    if (hit('[data-act="tutorial"]')) {
        launchTutorial('', '', '');
        return;
    }
    const dia = hit('[data-diagram]');
    if (dia) {
        const id = dia.getAttribute('data-diagram');
        if (id && typeof window.openDiagram === 'function')
            window.openDiagram(id);
        return;
    }
    const v2 = hit('[data-view2]');
    if (v2) {
        const want = v2.getAttribute('data-view2');
        if (want === 'pages') {
            void openPages();
            return;
        } // needs the manifest first
        go({ view: want === 'diagrams' ? 'diagrams' : 'hub', q: '' });
        return;
    }
    const catBtn = hit('[data-cat]');
    if (catBtn) {
        const c = CATEGORIES.find((x) => x.id === catBtn.getAttribute('data-cat'));
        if (c)
            go({ view: 'cat', part: c.part, catId: c.id });
        return;
    }
    const artBtn = hit('[data-art]');
    if (artBtn) {
        const f = findArticle(artBtn.getAttribute('data-art') || '');
        if (f)
            go({ view: 'art', part: f.cat.part, catId: f.cat.id, artId: f.art.id });
        return;
    }
    // Outward links from rendered markdown. None of these is an <a href>: in the Tauri webview a
    // web href is blocked by the CSP (and window.open is a no-op), and a relative one would
    // navigate the app away from itself.
    const ext = hit('[data-ext]');
    if (ext) {
        window.openExternal?.(ext.getAttribute('data-ext') || '');
        return;
    }
    const dl = hit('[data-deeplink]');
    if (dl) {
        // Handle it in-process rather than handing it back to the OS, which would ask Windows to
        // launch BMM again just to reach the window we are already in.
        const url = dl.getAttribute('data-deeplink') || '';
        const art = /[?&]article=([a-z0-9-]+)/i.exec(url);
        if (art) {
            const f = findArticle(art[1]);
            if (f) {
                go({ view: 'art', part: f.cat.part, catId: f.cat.id, artId: f.art.id });
                return;
            }
        }
        import('../core/deep_link_manager.js').then((m) => m.handleDeepLink?.(url)).catch(() => { });
        return;
    }
    const anc = hit('[data-anchor]');
    if (anc) {
        const id = anc.getAttribute('data-anchor') || '';
        const target = host?.querySelector(`#${CSS.escape(id)}`)
            || [...(host?.querySelectorAll('.dh-content h3, .dh-content h4, .dh-content h5') || [])]
                .find((h) => slugify(h.textContent || '') === id);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    const full = hit('[data-fullpage]');
    if (full) {
        void showFullPage(full.getAttribute('data-fullpage') || '', full);
        return;
    }
    // A recording / clip card.
    const clip = hit('.dh-clip');
    if (clip) {
        void playClip(clip);
        return;
    }
    const pg = hit('[data-page]');
    if (pg) {
        void openPage(pg.getAttribute('data-page') || '');
        return;
    }
    // A link between two bundled pages (rewritten from the site's own relative .md links). Inside
    // the standalone reader it navigates; inside an article it swaps that article's body.
    const dp = hit('[data-docpage]');
    if (dp) {
        // The site's links carry anchors ("library#conflicts"); the path is what identifies the file.
        const [target, hash] = (dp.getAttribute('data-docpage') || '').split('#');
        if (route.view === 'page')
            void openPage(target, hash);
        else
            void showFullPage(target, null, hash);
        return;
    }
}
/** mkdocs' heading slug, so an in-page anchor from the site resolves against what we rendered. */
function slugify(s) {
    return s.toLowerCase().trim()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');
}
/** Give rendered headings ids, and scroll to one. */
function anchorise(body, hash) {
    body.querySelectorAll('h3, h4, h5').forEach((h) => {
        if (!h.id)
            h.id = slugify(h.textContent || '');
    });
    if (!hash)
        return;
    const el = body.querySelector(`#${CSS.escape(hash)}`);
    if (el)
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}
let _manifest = null;
async function loadManifest() {
    if (_manifest)
        return _manifest;
    try {
        const res = await fetch('assets/docs/manifest.json');
        _manifest = res.ok ? (await res.json()).pages : [];
    }
    catch {
        _manifest = [];
    }
    return _manifest;
}
const SECTION_TITLE = {
    'getting-started': { en: 'Getting started', fr: 'Prise en main' },
    features: { en: 'Features', fr: 'Fonctionnalités' },
    'how-it-works': { en: 'How it works', fr: 'Comment ça marche' },
    reference: { en: 'Reference', fr: 'Référence' },
    root: { en: 'Overview', fr: 'Vue d’ensemble' },
};
function pagesView() {
    const pages = _manifest || [];
    if (!pages.length) {
        // Rendered before the manifest resolves; openPages() repaints once it has.
        return `<p class="dh-lead">${tr({ en: 'Loading the documentation index…', fr: 'Chargement de l’index de la documentation…' })}</p>`;
    }
    const order = ['root', 'getting-started', 'features', 'how-it-works', 'reference'];
    const groups = order.filter((s) => pages.some((p) => p.section === s));
    const lang = getLang?.() === 'fr' ? 'fr' : 'en';
    const totalWords = pages.reduce((s, p) => s + (p.words || 0), 0);
    const totalDia = pages.reduce((s, p) => s + (p.diagrams || 0), 0);
    const mins = (w) => Math.max(1, Math.round(w / 220)); // ~220 words a minute
    const card = (p) => {
        // What a reader needs to choose a page: what it covers, how long it is, whether it is
        // illustrated. The raw path told them none of that and is now a hover title instead.
        const bits = [`<span class="dh-pg-m">${svg('clock', 13)} ${mins(p.words || 0)} min</span>`];
        if (p.diagrams)
            bits.push(`<span class="dh-pg-m">${svg('diagram', 13)} ${p.diagrams}</span>`);
        if (!p.fr && lang === 'fr')
            bits.push(`<span class="dh-pg-m dh-pg-en" title="${escapeHtml(tr({ en: 'Not translated yet — shown in English.', fr: 'Pas encore traduite — affichée en anglais.' }))}">EN</span>`);
        return `
      <button class="dh-pg" data-page="${escapeHtml(p.path)}" title="${escapeHtml(p.path)}">
        <div class="dh-pg-t">${escapeHtml(tr(p.title))}</div>
        ${p.summary ? `<div class="dh-pg-s">${escapeHtml(tr(p.summary))}</div>` : ''}
        <div class="dh-pg-meta">${bits.join('')}</div>
      </button>`;
    };
    return `
    <h2>${tr({ en: 'The full documentation', fr: 'La documentation complète' })}</h2>
    <p class="dh-lead">${tr({
        en: 'The same pages as the website, rendered here in your theme. Nothing is fetched from the internet.',
        fr: 'Les mêmes pages que le site, rendues ici dans ton thème. Rien n’est récupéré sur Internet.',
    })}</p>
    <div class="dh-pg-stats">
      <span><b>${pages.length}</b> ${tr({ en: 'pages', fr: 'pages' })}</span>
      <span><b>${totalDia}</b> ${tr({ en: 'diagrams', fr: 'diagrammes' })}</span>
      <span><b>~${mins(totalWords)}</b> ${tr({ en: 'min to read it all', fr: 'min pour tout lire' })}</span>
      <span class="dh-pg-off">${svg('check', 13)} ${tr({ en: 'available offline', fr: 'disponible hors ligne' })}</span>
    </div>
    ${groups.map((s) => {
        const inSec = pages.filter((p) => p.section === s);
        return `
      <div class="dh-pg-sec">
        <div class="dh-pg-sec-h">
          <h4>${tr(SECTION_TITLE[s] || { en: s, fr: s })}</h4>
          <span class="dh-pg-sec-n">${inSec.length}</span>
          ${SECTION_BLURB[s] ? `<p class="dh-pg-sec-s">${tr(SECTION_BLURB[s])}</p>` : ''}
        </div>
        <div class="dh-pgs">${inSec.map(card).join('')}</div>
      </div>`;
    }).join('')}`;
}
/** What each section of the site is for — the titles alone ("Reference") do not say. */
const SECTION_BLURB = {
    root: {
        en: 'Start here if you have never opened BMM.',
        fr: 'Commence ici si tu n’as jamais ouvert BMM.',
    },
    'getting-started': {
        en: 'Installing BMM and getting through the first launch.',
        fr: 'Installer BMM et passer le premier lancement.',
    },
    features: {
        en: 'One page per screen — what it does and how to use it.',
        fr: 'Une page par écran — ce qu’il fait et comment s’en servir.',
    },
    'how-it-works': {
        en: 'What happens under the hood, and why it was built that way.',
        fr: 'Ce qui se passe sous le capot, et pourquoi c’est construit ainsi.',
    },
    reference: {
        en: 'Exhaustive lists to look things up in: actions, endpoints, deeplinks, keys.',
        fr: 'Les listes exhaustives à consulter : actions, endpoints, deeplinks, touches.',
    },
};
/** A bundled page on its own — the body is filled in by openPage() once fetched. */
function pageReaderView(path) {
    const pages = _manifest || [];
    const at = pages.findIndex((p) => p.path === path);
    const meta = at >= 0 ? pages[at] : undefined;
    const prev = at > 0 ? pages[at - 1] : null;
    const next = at >= 0 && at < pages.length - 1 ? pages[at + 1] : null;
    // Previous/Next follow mkdocs.yml's nav, which sync-docs put into the manifest — the same
    // order the website walks, so leaving the app mid-read and picking it up on the site works.
    const step = (p, dir) => p ? `
    <button class="dh-step dh-step-${dir}" data-page="${escapeHtml(p.path)}">
      <span class="dh-step-dir">${dir === 'prev'
        ? `${svg('back', 14)} ${tr({ en: 'Previous', fr: 'Précédent' })}`
        : `${tr({ en: 'Next', fr: 'Suivant' })} ${svg('arrow', 14)}`}</span>
      <span class="dh-step-t">${escapeHtml(tr(p.title))}</span>
    </button>` : '<span></span>';
    return `
    <div class="dh-reader" data-reader="${escapeHtml(path)}">
      <article class="dh-article dh-wide">
        <h2>${meta ? escapeHtml(tr(meta.title)) : escapeHtml(path)}</h2>
        <div class="dh-content"><p class="dh-lead">${tr({ en: 'Loading…', fr: 'Chargement…' })}</p></div>
        <nav class="dh-steps">${step(prev, 'prev')}${step(next, 'next')}</nav>
        <div class="dh-rels">
          <button class="dh-rel" data-view2="pages">${svg('arrow', 15)} ${tr({ en: 'All pages', fr: 'Toutes les pages' })}</button>
          <button class="dh-rel dh-rel-ext" data-ext="${DOCS_SITE}${escapeHtml(path)}/">${svg('ext', 15)} ${tr({ en: 'Open on the site', fr: 'Ouvrir sur le site' })}</button>
        </div>
      </article>
      <aside class="dh-aside">
        <div class="dh-aside-box">
          <div class="dh-aside-h">${tr({ en: 'On this page', fr: 'Sur cette page' })}</div>
          <div class="dh-toc" data-toc></div>
        </div>
        <div class="dh-aside-box">
          <div class="dh-aside-h">${tr({ en: 'Documentation', fr: 'Documentation' })}</div>
          <div class="dh-nav">${navList(path)}</div>
        </div>
      </aside>
    </div>`;
}
/** The whole documentation, grouped and in the site's order — the app's equivalent of the site's
 *  sidebar. Only shown when the window is wide enough to carry it (see .dh-reader in the CSS). */
function navList(current) {
    const pages = _manifest || [];
    const out = [];
    // '\0' as an escape, not a raw NUL byte: written literally it makes the whole file
    // read as BINARY to grep and friends, which silently drops it from any source search.
    let section = '\0';
    for (const p of pages) {
        if (p.section !== section) {
            section = p.section;
            out.push(`<div class="dh-nav-sec">${escapeHtml(tr(SECTION_TITLE[section] || { en: section, fr: section }))}</div>`);
        }
        out.push(`<button class="dh-nav-i${p.path === current ? ' on' : ''}" data-page="${escapeHtml(p.path)}">${escapeHtml(tr(p.title))}</button>`);
    }
    return out.join('');
}
/** Build the "on this page" list from the headings that were just rendered. */
function buildToc(reader) {
    const box = reader.querySelector('[data-toc]');
    const body = reader.querySelector('.dh-content');
    if (!box || !body)
        return;
    const heads = [...body.querySelectorAll('h3, h4')];
    // A table of contents with one entry is a label, not a contents list.
    if (heads.length < 2) {
        box.closest('.dh-aside-box')?.setAttribute('hidden', '');
        return;
    }
    box.closest('.dh-aside-box')?.removeAttribute('hidden');
    box.innerHTML = heads.map((h) => {
        if (!h.id)
            h.id = slugify(h.textContent || '');
        return `<button class="dh-toc-i dh-toc-${h.tagName.toLowerCase()}" data-anchor="${escapeHtml(h.id)}">${escapeHtml(h.textContent || '')}</button>`;
    }).join('');
}
async function openPages() { await loadManifest(); go({ view: 'pages' }); paint(); }
/** Every bundled documentation page, as search hits for the Ctrl+K palette.
 *
 *  Lives here rather than in the search module because the manifest and openPage() are this
 *  file's to own — a provider elsewhere would need both, and would be a second place that has
 *  to know how a doc route is built.
 *
 *  Titles and summaries are matched in BOTH languages whichever one is displayed: people
 *  search in the language they think in. Only titles and summaries, not page bodies — the
 *  bodies are fetched one at a time and pulling all 36 to answer a keystroke is not a trade
 *  worth making. */
export async function docsSearchHits() {
    const pages = await loadManifest();
    const fr = getLang?.() === 'fr';
    return pages.map((p) => ({
        id: `doc:${p.path}`,
        kind: 'doc',
        title: (fr ? p.title.fr : p.title.en) || p.title.en || p.path,
        sub: p.section || p.path,
        keywords: `${p.title.en} ${p.title.fr} ${p.summary?.en || ''} ${p.summary?.fr || ''} ${p.path}`,
        run: () => { void openPage(p.path); },
    }));
}
async function openPage(path, hash) {
    await loadManifest();
    _pendingHash = hash;
    go({ view: 'page', page: path }); // paint() → fillPage(), including on a repaint
}
// The anchor an incoming link asked for, handed to the next fillPage.
let _pendingHash;
// One fill at a time: a repaint mid-fetch must not let the older response land last.
let _fillSeq = 0;
let _filled = ''; // path+lang currently in the reader
/** Fetch a bundled page and put it in the reader shell that paint() just drew. */
async function fillPage(path) {
    const lang = getLang?.() === 'fr' ? 'fr' : 'en';
    const key = `${lang}/${path}`;
    const body = host?.querySelector('[data-reader] .dh-content');
    if (!body)
        return;
    // Already showing this exact page in this language, and the shell was not re-drawn: nothing
    // to do. Without this, every paint would re-fetch and re-render the page under the reader.
    if (_filled === key && !body.querySelector('.dh-lead'))
        return;
    const ticket = ++_fillSeq;
    const hash = _pendingHash;
    _pendingHash = undefined;
    const md = await fetchDocPage(path);
    if (ticket !== _fillSeq || !body.isConnected)
        return;
    if (!md) {
        body.innerHTML = `<p>${tr({ en: 'That page is not bundled in this build.', fr: 'Cette page n’est pas embarquée dans ce build.' })}</p>`;
        return;
    }
    body.innerHTML = renderDocMarkdown(stripTitle(md));
    _filled = key;
    anchorise(body, hash);
    const reader = body.closest('.dh-reader');
    if (reader)
        buildToc(reader);
    // Switching pages kept the previous scroll position, so a jump from halfway down one page
    // landed halfway down the next — most visibly with next/previous, where you scroll to the
    // bottom to press the button and then arrive mid-page.
    //
    // Skipped when an anchor was requested: anchorise() has just scrolled to it, and this would
    // immediately undo that. Instant rather than smooth — a page change is not a jump within a
    // page, and animating it looks like the content moved on its own.
    if (!hash && reader)
        reader.scrollIntoView({ block: 'start', behavior: 'auto' });
    await hydrateDocPage(body);
}
/** Swap the article body for the full bundled page (or back). */
async function showFullPage(rawPath, btn, hash, auto = false) {
    // Normalised HERE rather than at each call site, because they disagreed: the automatic
    // open passes `docsPath` with its slashes stripped, while the button passes the raw
    // data-fullpage attribute. The identity check below then failed on the first press, so
    // pressing "short version" re-fetched the full page instead of toggling — it only looked
    // like the view jumped to the top, and the SECOND press worked because the first had
    // finally stored the button's spelling of the path.
    const path = rawPath.replace(/^\/+|\/+$/g, '');
    const article = document.querySelector('.dh-article');
    const body = article?.querySelector('.dh-content');
    if (!article || !body)
        return;
    const setLabel = (b, which) => {
        const lbl = b?.querySelector('.dh-rel-lbl');
        if (lbl)
            lbl.textContent = b.getAttribute(`data-lbl-${which}`) || lbl.textContent;
    };
    // An explicit press of the toggle always returns to the short version when a full page is
    // on screen. Keyed on "a full page is shown" rather than on which one: the button says
    // "short version", and it must mean it even if the paths ever drift apart again.
    if (btn && !auto && article.dataset.full) { // toggle back to the short version
        body.innerHTML = article.dataset.shortHtml || body.innerHTML;
        delete article.dataset.full;
        btn.classList.remove('on');
        setLabel(btn, 'full');
        return;
    }
    if (!article.dataset.shortHtml)
        article.dataset.shortHtml = body.innerHTML;
    // On an explicit press, say something is happening. On the automatic open, leave the short
    // version on screen until the page is ready — blanking it would flash on every article.
    if (!auto)
        body.innerHTML = `<p class="dh-lead">${tr({ en: 'Loading the full page…', fr: 'Chargement de la page complète…' })}</p>`;
    const md = await fetchDocPage(path);
    if (!md) {
        // The bundle is generated from a sibling repo, so it can legitimately be absent.
        body.innerHTML = article.dataset.shortHtml;
        if (auto)
            return; // nothing was promised, so say nothing
        try {
            const { toast } = await import('../ui/app.js');
            toast(tr({ en: 'That page is not bundled in this build.', fr: 'Cette page n’est pas embarquée dans ce build.' }), 'info');
        }
        catch { /* the short version is already back on screen */ }
        return;
    }
    body.innerHTML = renderDocMarkdown(stripTitle(md));
    article.dataset.full = path;
    btn?.classList.add('on');
    setLabel(btn, 'short');
    // Only scroll when the reader asked for it. paint() calls this on every article open, and
    // yanking the view on arrival would be disorienting.
    if (!auto)
        article.scrollIntoView({ block: 'start', behavior: 'smooth' });
    anchorise(body, hash);
    await hydrateDocPage(body);
}
// ── the bundled BMM Docs pages ───────────────────────────────────────────────
// scripts/sync-docs.mjs copies the site's markdown into assets/docs/<lang>/. Rendering it here
// means the app shows the SAME page the site does — the short in-app article stays as the quick
// answer, and this is the full one, in BMM's theme and with its buttons.
const _pageCache = new Map();
/** Drop the page's own H1.
 *  Both surfaces that render a bundled page — the article and the standalone reader — already
 *  put the title in their own heading, so keeping the markdown's `# Title` printed it twice. */
function stripTitle(md) {
    return md.replace(/^\s*#\s+.*(\r?\n)+/, '');
}
async function fetchDocPage(path) {
    const lang = (getLang?.() === 'fr') ? 'fr' : 'en';
    const clean = path.replace(/^\/+|\/+$/g, '');
    for (const l of [lang, 'en']) { // fall back to English when a page has no FR twin
        const key = `${l}/${clean}`;
        if (_pageCache.has(key))
            return _pageCache.get(key);
        try {
            const res = await fetch(`assets/docs/${key}.md`);
            if (!res.ok)
                continue;
            const md = await res.text();
            _pageCache.set(key, md);
            return md;
        }
        catch { /* try the next */ }
    }
    return null;
}
function parseColor(c) {
    const s = c.trim();
    let m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4)
            h = h.split('').map((x) => x + x).join('');
        if (h.length !== 6 && h.length !== 8)
            return null;
        const at = (i) => parseInt(h.slice(i, i + 2), 16);
        return [at(0), at(2), at(4), h.length === 8 ? at(6) / 255 : 1];
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        if (p.length >= 3 && p.slice(0, 3).every((x) => Number.isFinite(x))) {
            return [p[0], p[1], p[2], p.length > 3 && Number.isFinite(p[3]) ? p[3] : 1];
        }
    }
    return null;
}
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** Composite `c` over an opaque base — the only way a translucent token becomes a usable colour. */
function over(c, base) {
    const a = c[3];
    return [c[0] * a + base[0] * (1 - a), c[1] * a + base[1] * (1 - a), c[2] * a + base[2] * (1 - a), 1];
}
const luma = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
/** The mermaid configuration for the CURRENT theme, built from the live design tokens. */
function mermaidTheme() {
    const css = getComputedStyle(document.documentElement);
    const raw = (n, f) => (css.getPropertyValue(n) || '').trim() || f;
    // The card the diagram sits on — everything translucent flattens against this.
    const page = parseColor(raw('--bmm-bg-base', '#0a0e17')) || [10, 14, 23, 1];
    const base = page[3] >= 0.999 ? page : over(page, [0, 0, 0, 1]);
    const col = (name, fallback) => {
        const p = parseColor(raw(name, fallback)) || parseColor(fallback) || [128, 128, 128, 1];
        const f = p[3] >= 0.999 ? p : over(p, base);
        return toHex(f[0], f[1], f[2]);
    };
    /** A tint of `name` laid over the card — for fills that must read as a colour, not a block. */
    const tint = (name, fallback, alpha) => {
        const p = parseColor(raw(name, fallback)) || parseColor(fallback) || [128, 128, 128, 1];
        const f = over([p[0], p[1], p[2], alpha], base);
        return toHex(f[0], f[1], f[2]);
    };
    const bg = toHex(base[0], base[1], base[2]);
    // These three are the tokens the theme editor already exposes for diagrams.
    const node = col('--bmm-diagram-node', '#161b22');
    const nodeBorder = col('--bmm-diagram-node-border', '#3b82f6');
    const nodeText = col('--bmm-diagram-node-text', '#f1f5f9');
    const line = col('--bmm-text-muted', '#7c8698');
    const soft = col('--bmm-border-hover', '#2a3242');
    // The subgraph box, barely raised off the card. --bmm-surface-* is the overlay TINT (white on
    // dark themes, black on light ones), so this stays a lift in both directions.
    const surface = [
        Number(raw('--bmm-surface-r', '255')) || 0,
        Number(raw('--bmm-surface-g', '255')) || 0,
        Number(raw('--bmm-surface-b', '255')) || 0, 1
    ];
    const clusterRGB = over([surface[0], surface[1], surface[2], 0.045], base);
    const cluster = toHex(clusterRGB[0], clusterRGB[1], clusterRGB[2]);
    const warn = col('--bmm-warning', '#f59e0b');
    const noteBg = tint('--bmm-warning', '#f59e0b', 0.14); // annotations read warm on any theme
    return {
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'loose',
        htmlLabels: true,
        // With htmlLabels, a node label is real HTML inside a foreignObject — so it INHERITS the
        // page's CSS. mermaid, though, measures it in a scratch element it appends to <body>, which
        // does not inherit .dh-content's line-height: 1.7. It therefore sized every box for 13×1.31
        // and then drew text at 13×1.7, and the second line of every two-line label was cut off.
        // Baking the line-height into the SVG's own stylesheet makes both passes agree wherever the
        // diagram ends up.
        themeCSS: '.nodeLabel,.edgeLabel,.label,.actor,.messageText,.noteText,.loopText'
            + '{line-height:1.35;} .nodeLabel p,.edgeLabel p{margin:0;}',
        // Tell mermaid which way round the surface is, so anything it still derives itself lands on
        // the readable side. Getting this wrong is how light themes ended up with white-on-white.
        darkMode: luma(base) < 0.5,
        // useMaxWidth:false — with it on, mermaid stretches/squashes the drawing to the column, and a
        // wide left-to-right flowchart got crushed to a 57px-tall strip with unreadable labels. Off,
        // it keeps its natural size and .dh-mermaid scrolls instead, exactly like the website does.
        flowchart: { curve: 'basis', nodeSpacing: 46, rankSpacing: 46, useMaxWidth: false, padding: 12, subGraphTitleMargin: { top: 6, bottom: 10 } },
        sequence: { useMaxWidth: false, mirrorActors: true, boxMargin: 8, noteMargin: 10, messageAlign: 'center' },
        themeVariables: {
            background: bg,
            fontFamily: (getComputedStyle(document.documentElement).getPropertyValue('--bmm-font-sans') || '').trim()
                || 'Inter, system-ui, sans-serif',
            fontSize: '13px',
            // flowchart / graph
            primaryColor: node, primaryTextColor: nodeText, primaryBorderColor: nodeBorder,
            secondaryColor: cluster, secondaryTextColor: nodeText, secondaryBorderColor: soft,
            tertiaryColor: bg, tertiaryTextColor: nodeText, tertiaryBorderColor: soft,
            mainBkg: node, nodeBorder, nodeTextColor: nodeText,
            lineColor: line, textColor: nodeText, titleColor: nodeText,
            clusterBkg: cluster, clusterBorder: soft,
            // Edge labels sit ON the connector and need a backing plate, or the line runs through the
            // text. Unset, mermaid paints that plate white and it punches a bright hole through every
            // dark theme. The cluster shade rather than the page shade: these labels almost always sit
            // inside a subgraph, and the page colour read as a black box floating on top of one.
            edgeLabelBackground: cluster, labelBackground: cluster, labelColor: nodeText,
            // sequenceDiagram — none of this was set before, which is why the actors, the lifelines
            // and the notes all came out in mermaid's own derived colours.
            actorBkg: node, actorBorder: nodeBorder, actorTextColor: nodeText, actorLineColor: line,
            signalColor: line, signalTextColor: nodeText,
            labelBoxBkgColor: node, labelBoxBorderColor: nodeBorder, labelTextColor: nodeText,
            loopTextColor: nodeText, activationBkgColor: cluster, activationBorderColor: nodeBorder,
            noteBkgColor: noteBg, noteBorderColor: warn, noteTextColor: nodeText,
            sequenceNumberColor: bg, altBackground: cluster,
        },
    };
}
/** Resize a rendered diagram to the box it ACTUALLY draws into.
 *
 *  mermaid computes its viewBox from the layout it planned, but the layout is planned from label
 *  sizes it measures in a scratch element — and the app's own stylesheets reach into that. Measured
 *  with every stylesheet index.html loads: 54 of the 56 bundled diagrams drew outside their own
 *  viewBox, by up to 169px, and an SVG clips at its viewBox. That is the cut-off arrows and the
 *  half-drawn decision diamonds.
 *
 *  Rather than chase which rule causes it — the answer would only hold until the next stylesheet
 *  changes — take the drawing's real bounds and make the box fit them. This is measured after
 *  layout, so it is correct whatever the ambient CSS turns out to do. */
function fitDiagram(host) {
    const svg = host.querySelector('svg');
    if (!svg)
        return;
    let bb;
    try {
        bb = svg.getBBox();
    }
    catch {
        return;
    } // not laid out yet — leave it alone
    if (!(bb.width > 0) || !(bb.height > 0))
        return;
    // Room for stroke widths and arrow heads, which getBBox does not fully account for.
    const pad = 10;
    const x = bb.x - pad, y = bb.y - pad, w = bb.width + pad * 2, h = bb.height + pad * 2;
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    svg.setAttribute('width', String(Math.ceil(w)));
    svg.setAttribute('height', String(Math.ceil(h)));
    svg.style.maxWidth = 'none';
}
// Each render pass gets a ticket. A pass whose ticket is stale — the reader navigated, or
// switched language, while its diagrams were still rendering — drops its output instead of
// writing SVG into a detached node.
let _hydrateSeq = 0;
/** Render mermaid sources and wire content tabs inside a freshly injected page. */
async function hydrateDocPage(host) {
    host.querySelectorAll('[data-tabs]').forEach((box) => {
        box.addEventListener('click', (e) => {
            const b = e.target.closest('.dh-tab');
            if (!b)
                return;
            const id = b.getAttribute('data-tab');
            box.querySelectorAll('.dh-tab').forEach((x) => x.classList.toggle('on', x === b));
            box.querySelectorAll('.dh-tabpane').forEach((x) => x.classList.toggle('on', x.getAttribute('data-pane') === id));
        });
    });
    // Syntax highlighting — the shared helper, same as every other markdown surface.
    try {
        const { highlightIn } = await import('../ui/code-highlight.js');
        highlightIn(host);
    }
    catch { /* code stays readable unhighlighted */ }
    // Recording / clip cards. md-lite cannot speak the reader's language, so the one-line
    // explanation under the title is filled in here.
    host.querySelectorAll('.dh-clip').forEach((el) => {
        const sub = el.querySelector('[data-clip-sub]');
        if (!sub)
            return;
        const kind = el.getAttribute('data-kind');
        // Deliberately says nothing about WHERE the file is. Whether it ships with the app or is
        // fetched on demand changes nothing the reader can act on.
        sub.textContent = kind === 'video'
            ? tr({ en: 'Play the clip', fr: 'Lire le clip' })
            : tr({ en: 'Play the recorded session', fr: 'Rejouer la session enregistrée' });
    });
    const blocks = [...host.querySelectorAll('.dh-mermaid')];
    if (!blocks.length)
        return;
    // Fetched on demand: mermaid is 3.3 MB and most pages of the hub have no diagram at all.
    const m = await ensureMermaid().catch(() => null);
    if (!m?.render)
        return; // leave the placeholder rather than a broken box
    const ticket = ++_hydrateSeq;
    // The interactive-diagram viewer initialises mermaid with a hard-coded dark palette, which is
    // unreadable on the light themes. Re-initialise from the live design tokens before rendering a
    // doc page, so a diagram inherits whatever theme is active.
    try {
        m.initialize(mermaidTheme());
    }
    catch { /* keep whatever configuration is already in place */ }
    for (let n = 0; n < blocks.length; n++) {
        const el = blocks[n];
        const src = el.getAttribute('data-mermaid') || '';
        try {
            const { svg } = await m.render(`dh-mmd-${ticket}-${n}`, src);
            if (ticket !== _hydrateSeq || !el.isConnected)
                return; // superseded — this page is gone
            el.innerHTML = svg;
            el.classList.add('ok');
            fitDiagram(el);
        }
        catch {
            if (ticket !== _hydrateSeq || !el.isConnected)
                return;
            // A diagram the app's mermaid build cannot parse shows its source instead of nothing.
            el.innerHTML = `<pre class="dh-code"><code>${src.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`;
            el.classList.add('ok');
        }
    }
}
/** Re-render the diagrams on screen after a theme switch — their colours are baked into the SVG
 *  at render time, so without this a new theme leaves every open diagram in the old palette. */
function rethemeDiagrams() {
    const body = host?.querySelector('.dh-content');
    if (!body || !body.querySelector('.dh-mermaid'))
        return;
    body.querySelectorAll('.dh-mermaid').forEach((el) => {
        const src = el.getAttribute('data-mermaid');
        if (!src)
            return; // a block that fell back to source: leave it
        el.classList.remove('ok');
        el.innerHTML = `<div class="dh-mermaid-ph">◇ diagram</div>`;
    });
    void hydrateDocPage(body);
}
/** Play a recording or a clip embedded in a bundled page — IN the app, always.
 *
 *  A clip too large to bundle used to turn its card into a link that threw the reader out to a
 *  browser. It does not any more: the bytes come off the website, the player is BMM's own. The
 *  reader sees a play button either way, because from where they sit there is no difference.
 *
 *  Sources are tried in order — the bundled copy first, since it works offline and instantly —
 *  and only if BOTH fail does the card say so, still as a button you can press again. */
async function playClip(card) {
    const sources = [card.getAttribute('data-clip'), card.getAttribute('data-clip-remote')]
        .filter((s) => !!s);
    if (!sources.length)
        return;
    const kind = card.getAttribute('data-kind');
    const say = (msg) => {
        const sub = card.querySelector('[data-clip-sub]');
        if (sub)
            sub.textContent = tr(msg);
        card.classList.remove('dh-clip-busy');
    };
    card.classList.add('dh-clip-busy');
    say({ en: 'Loading…', fr: 'Chargement…' });
    if (kind === 'video') {
        for (const src of sources) {
            const ok = await new Promise((resolve) => {
                const v = document.createElement('video');
                v.preload = 'metadata';
                v.src = src;
                v.addEventListener('loadedmetadata', () => resolve(true), { once: true });
                v.addEventListener('error', () => resolve(false), { once: true });
            });
            if (!ok)
                continue;
            const v = document.createElement('video');
            v.className = 'dh-clip-video';
            v.src = src;
            v.controls = true;
            v.autoplay = true;
            v.playsInline = true;
            card.replaceWith(v);
            return;
        }
        say({ en: 'This clip could not be loaded — press to try again.', fr: 'Ce clip n’a pas pu être chargé — appuie pour réessayer.' });
        return;
    }
    for (const src of sources) {
        // Probe before handing it over: playReplayFromUrl toasts on failure, and a toast per source
        // would blame the reader twice for one missing file.
        try {
            const res = await fetch(src);
            if (!res.ok)
                continue;
            const bundle = await res.json();
            const events = Array.isArray(bundle) ? bundle : bundle?.events;
            if (!Array.isArray(events) || events.length < 2)
                continue;
            card.classList.remove('dh-clip-busy');
            say({ en: 'Play the recorded session', fr: 'Rejouer la session enregistrée' });
            await playReplay(src);
            return;
        }
        catch { /* try the next source */ }
    }
    say({ en: 'This recording could not be loaded — press to try again.', fr: 'Cet enregistrement n’a pas pu être chargé — appuie pour réessayer.' });
}
async function playReplay(url) {
    if (!url)
        return;
    try {
        const m = await import('../features/settings/replay-watcher.js');
        m.playReplayFromUrl?.(url);
    }
    catch { /* ignore */ }
}
async function launchTutorial(id, part, step) {
    // Deep-link straight into the requested tutorial/part/step when we have it.
    if (id) {
        try {
            const [{ startTutorialEngine }, { TUTORIALS }] = await Promise.all([import('../ui/tutorial-engine.js'), import('../ui/tutorial-data.js')]);
            const tut = (TUTORIALS || []).find((x) => x.id === id);
            if (tut && startTutorialEngine) {
                startTutorialEngine(tut, part || undefined, step || undefined, () => { });
                return;
            }
        }
        catch { /* fall through to the hub */ }
    }
    try {
        const hub = await import('../ui/tutorial-hub.js');
        hub.openTutorialHub?.();
    }
    catch { /* ignore */ }
}
// Navigate the docs view + open a specific place. Exposed on window so Settings (and anywhere)
// can deep-link here — replaces the old openHelpTo(faq.*) that targeted the removed markup.
function showDocs() { const n = document.querySelector('.nav-item[data-view="docs"]'); n?.click(); }
function openArticle(catId, artId) {
    const c = CATEGORIES.find((x) => x.id === catId);
    const f = findArticle(artId);
    if (c && f)
        route = { ...route, view: 'art', part: c.part, catId, artId };
    showDocs();
    paint();
}
// Map the old openHelpTo(faq.*) keys onto the rebuilt FAQ articles.
const LEGACY_HELP = {
    'faq.qPat': ['faq', 'faq-pat'],
    'faq.qIo': ['faq', 'faq-disk-full'],
    'faq.qDiskFull': ['faq', 'faq-disk-full'],
    'faq.qDeleted': ['faq', 'faq-deleted-mod'],
};
/** Build the whole Help & Other page into #view-docs. Called once at app startup. */
export function initDocsHub() {
    host = document.getElementById('view-docs');
    if (!host)
        return;
    renderAll();
    // Load the page index up front: paint() consults it to decide whether an article has a
    // documentation page to show, and that decision is synchronous. Repaint once it lands so the
    // very first article opened is not the only one that misses out.
    void loadManifest().then(() => { if (route.view === 'art')
        paint(); });
    host.addEventListener('click', onClick);
    // Re-render on language switch — but KEEP the current route so you stay on the same page.
    document.addEventListener('langChanged', () => renderAll());
    // A theme switch repaints the app through CSS, but a rendered diagram carries its colours
    // inside its own SVG, so it has to be drawn again. Debounced: the theme editor re-applies a
    // preview on every keystroke, and a full mermaid pass per keystroke would crawl.
    let reTheme = null;
    window.addEventListener('bmm:theme-applied', () => {
        if (reTheme != null)
            window.clearTimeout(reTheme);
        reTheme = window.setTimeout(() => { try {
            rethemeDiagrams();
        }
        catch { /* keep the old drawing */ } }, 220);
    });
    // (Ctrl/⌘+K now opens the app-wide command palette — see core/commands.ts — which includes a
    // "Search the documentation" command that focuses this search.)
    // Public deep-link hooks (used by Settings' FAQ/PAT/disk buttons; supersedes old openHelpTo).
    window.openDocsArticle = openArticle;
    // Open an article by id alone (category resolved from the id) — used by the
    // bmm://docs/open?article=<id> deeplink so BMM Docs pages can link into the app.
    window.openDocsArticleById = (artId) => {
        const f = findArticle(artId);
        if (f)
            openArticle(f.cat.id, f.art.id);
        else
            window.openDocsHome();
    };
    window.openDocsHome = () => { route = { ...route, view: 'hub', catId: undefined, artId: undefined }; showDocs(); paint(); };
    window.openHelpTo = (key) => {
        const map = LEGACY_HELP[key];
        if (map)
            openArticle(map[0], map[1]);
        else
            window.openDocsHome();
    };
}
//# sourceMappingURL=docs-hub.js.map