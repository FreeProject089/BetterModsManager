// Help & Other â€” the rebuilt documentation hub (replaces the old ~4700-line #view-docs markup
// + docs-ui.ts). A professional, data-driven hub that owns #view-docs. Features:
//   â€¢ TWO parts â€” "User" (learn every feature) and "Dev" (how BMM works under the hood).
//   â€¢ Breadcrumb navigation + a route the LANGUAGE switch preserves (you stay on the same page).
//   â€¢ Article media: embed a .bmmreplay (rrweb), an image, or inline SVG to illustrate a point.
//   â€¢ Search with TWO modes â€” classic (substring) and semantic (synonym/keyword expansion),
//     Algolia-style, focusable app-wide with Ctrl/âŒ˜+K.
//   â€¢ Deep links INTO the interactive tutorial at the right part+step, INTO any of the 44
//     Mermaid diagrams (reused as-is via window.openDiagram), and OUT to the full mkdocs site.
//   â€¢ Rebuilt FAQ; the Settings help buttons (PAT/GitHub, disk I/O) relink here.
//
// Content is co-located bilingual {en, fr} data â€” no Lang/*.json churn â€” picked via getLang().
import { getLang, t, getSynonyms } from '../core/i18n.js';
import { diagrams } from './interactive-docs.js';
import { renderDocMarkdown } from './md-lite.js';
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
};
const svg = (name, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ''}</svg>`;
// â”€â”€ the documentation content â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CATEGORIES = [
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• USER PART â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
        id: 'start', part: 'user', icon: 'rocket',
        title: { en: 'Getting started', fr: 'Prise en main' },
        blurb: { en: 'Install, first launch, and your first profile.', fr: 'Installation, premier lancement et premier profil.' },
        articles: [
            {
                id: 'what-is-bmm', tutorial: { id: 'basics' }, docsPath: '',
                title: { en: 'What is BetterModsManager?', fr: 'Quâ€™est-ce que BetterModsManager ?' },
                summary: { en: 'A fast, safe mod manager built around profiles, integrity checks and one-click sharing.', fr: 'Un gestionnaire de mods rapide et sÃ»r, bÃ¢ti autour des profils, des vÃ©rifications dâ€™intÃ©gritÃ© et du partage en un clic.' },
                keywords: 'bmm overview intro presentation aperÃ§u',
                body: {
                    en: '<p>BetterModsManager (BMM) organises your mods into <b>profiles</b> you can switch between instantly, verifies every file with cryptographic hashing, and lets you share a whole setup with one link. Itâ€™s game-agnostic: any game you can mod by placing files can be managed.</p><h4>Why itâ€™s different</h4><ul><li><b>Non-destructive</b> â€” activating a profile never touches your originals; BMM links or copies as needed, and backs up anything it replaces.</li><li><b>Fast</b> â€” a native Rust core scans thousands of files in seconds.</li><li><b>Safe</b> â€” BLAKE3/SHA integrity catches a corrupted download before it reaches your game.</li></ul>'
                        + '<h4>The screens, in one glance</h4><ul><li><b>Library</b> â€” your mods: add, enable/disable, verify, history.</li><li><b>Profiles</b> â€” one per game setup; switching swaps whatâ€™s deployed.</li><li><b>Modpacks</b> â€” saved recipes of mods to apply in one click.</li><li><b>Mapper</b> â€” fix mods whose folder shape doesnâ€™t match the game.</li><li><b>Server Repo</b> â€” subscribe to someoneâ€™s repo, or host your own.</li><li><b>.MM Lists</b> â€” import/export a mod list as a file.</li><li><b>App Catalog / Plugins</b> â€” install apps, themes and plugins; automate via the API.</li><li><b>Settings</b> â€” appearance, shortcuts, scheduler, launch packs, privacy, storage.</li></ul><p>Press <kbd>Ctrl/âŒ˜+K</kbd> anywhere to search all of it.</p>',
                    fr: '<p>BetterModsManager (BMM) organise vos mods en <b>profils</b> interchangeables en un instant, vÃ©rifie chaque fichier par hachage cryptographique et vous permet de partager une configuration complÃ¨te avec un seul lien. Il est agnostique du jeu : tout jeu moddable en plaÃ§ant des fichiers peut Ãªtre gÃ©rÃ©.</p><h4>Ce qui le distingue</h4><ul><li><b>Non destructif</b> â€” activer un profil ne touche jamais vos originaux ; BMM lie ou copie selon le besoin, et sauvegarde ce quâ€™il remplace.</li><li><b>Rapide</b> â€” un cÅ“ur natif en Rust scanne des milliers de fichiers en quelques secondes.</li><li><b>SÃ»r</b> â€” lâ€™intÃ©gritÃ© BLAKE3/SHA dÃ©tecte un tÃ©lÃ©chargement corrompu avant quâ€™il nâ€™atteigne le jeu.</li></ul>'
                        + '<h4>Les Ã©crans, en un coup dâ€™Å“il</h4><ul><li><b>BibliothÃ¨que</b> â€” vos mods : ajouter, activer/dÃ©sactiver, vÃ©rifier, historique.</li><li><b>Profils</b> â€” un par configuration de jeu ; changer Ã©change ce qui est dÃ©ployÃ©.</li><li><b>Modpacks</b> â€” des recettes de mods enregistrÃ©es, applicables en un clic.</li><li><b>Mapper</b> â€” corriger les mods dont lâ€™arborescence ne correspond pas au jeu.</li><li><b>DÃ©pÃ´t Serveur</b> â€” sâ€™abonner au dÃ©pÃ´t de quelquâ€™un, ou hÃ©berger le vÃ´tre.</li><li><b>Listes .MM</b> â€” importer/exporter une liste de mods en fichier.</li><li><b>App Catalog / Plugins</b> â€” installer applis, thÃ¨mes et plugins ; automatiser via lâ€™API.</li><li><b>RÃ©glages</b> â€” apparence, raccourcis, planificateur, launch packs, confidentialitÃ©, stockage.</li></ul><p>Appuyez sur <kbd>Ctrl/âŒ˜+K</kbd> nâ€™importe oÃ¹ pour chercher dans tout Ã§a.</p>',
                },
            },
            {
                id: 'first-profile', docsPath: 'getting-started/first-launch/', view: 'profiles', tutorial: { id: 'basics', part: 'profiles', step: 's1' }, diagram: 'profile-system',
                title: { en: 'Create your first profile', fr: 'CrÃ©er votre premier profil' },
                summary: { en: 'A profile = one game folder + the exact mods enabled in it. Here are the three folders it needs.', fr: 'Un profil = un dossier de jeu + les mods exacts qui y sont activÃ©s. Voici les trois dossiers quâ€™il demande.' },
                keywords: 'profile setup game path mods backup folder create profil dossier',
                // Authored in md-lite (the BCWEB-style directive markdown) â€” steps + a tip callout.
                body: {
                    en: `A **profile** ties one game folder to the exact set of mods you enable in it. Keep a clean
profile, a multiplayer one, and an experimental one side by side â€” each remembers its own enabled mods.

:::steps
:::step[Open Profiles â†’ New profile]
Go to the **Profiles** screen and click **New profile**.
:::
:::step[Fill in the three folders]
A profile keeps your library, your game, and your safety net in separate places, so you point it at three paths:
- **Game folder** â€” where the game actually reads its files (this is where enabled mods get deployed).
- **Mods folder** â€” where BMM keeps this profile's mod library on disk.
- **Backup folder** â€” where BMM stashes any original file it has to overwrite, so every change is reversible.

Also give it a **name** and a **game name** (the game name is what groups several profiles of the same game together).
:::
:::step[Pick a colour, then create]
Choose a colour and icon and confirm. BMM creates the profile and makes it **active** right away.
:::
:::

:::tip[What switching a profile really does]
Switching the active profile **moves no files** â€” it only changes which profile you're working in. Mods
you've already enabled **stay deployed** in the game; switching away never undeploys them. The one thing that
touches files is **enabling or disabling a mod** (it copies the files into the game and backs up whatever it
replaces, or removes them again). Your downloaded mods are never edited in place â€” BMM only links or copies them.
:::`,
                    fr: `Un **profil** relie un dossier de jeu Ã  l'ensemble exact des mods que vous y activez. Gardez un profil
propre, un profil multijoueur et un profil expÃ©rimental cÃ´te Ã  cÃ´te â€” chacun mÃ©morise ses propres mods activÃ©s.

:::steps
:::step[Ouvrez Profils â†’ Nouveau profil]
Allez sur l'Ã©cran **Profils** et cliquez **Nouveau profil**.
:::
:::step[Renseignez les trois dossiers]
Un profil garde votre bibliothÃ¨que, votre jeu et votre filet de sÃ©curitÃ© Ã  des endroits distincts ; vous indiquez donc trois chemins :
- **Dossier du jeu** â€” lÃ  oÃ¹ le jeu lit rÃ©ellement ses fichiers (c'est lÃ  que les mods activÃ©s sont dÃ©ployÃ©s).
- **Dossier des mods** â€” lÃ  oÃ¹ BMM stocke sur le disque la bibliothÃ¨que de mods de ce profil.
- **Dossier de backup** â€” lÃ  oÃ¹ BMM met de cÃ´tÃ© chaque fichier original qu'il doit Ã©craser, pour que tout changement soit rÃ©versible.

Donnez-lui aussi un **nom** et un **nom de jeu** (le nom de jeu regroupe plusieurs profils d'un mÃªme jeu).
:::
:::step[Choisissez une couleur, puis crÃ©ez]
Choisissez une couleur et une icÃ´ne, puis confirmez. BMM crÃ©e le profil et le rend **actif** aussitÃ´t.
:::
:::

:::tip[Ce que fait vraiment le changement de profil]
Changer de profil actif **ne dÃ©place aucun fichier** â€” Ã§a change seulement le profil dans lequel vous travaillez.
Les mods dÃ©jÃ  activÃ©s **restent dÃ©ployÃ©s** dans le jeu ; revenir en arriÃ¨re ne les retire jamais. La seule chose
qui touche aux fichiers, c'est **activer ou dÃ©sactiver un mod** (Ã§a copie les fichiers dans le jeu et sauvegarde
ce qu'il remplace, ou les retire). Vos mods tÃ©lÃ©chargÃ©s ne sont jamais modifiÃ©s sur place â€” BMM ne fait que les lier ou les copier.
:::`,
                },
            },
            {
                id: 'scan', docsPath: 'how-it-works/scanning-cache/', view: 'library', tutorial: { id: 'basics', part: 'scan', step: 's0' }, diagram: 'mod-sync',
                title: { en: 'Scan & sync your mods', fr: 'Scanner et synchroniser vos mods' },
                summary: { en: 'Let BMM index what you already have and keep it up to date.', fr: 'Laissez BMM indexer ce que vous avez dÃ©jÃ  et le tenir Ã  jour.' },
                keywords: 'scan sync index refresh detect scanner',
                body: {
                    en: '<p>The first scan reads your mods folder and builds an index â€” names, versions, sizes and a <b>BLAKE3 content hash</b> per file. That index is what makes everything else fast: conflicts, integrity and sync all read it instead of re-walking the disk.</p><ul><li>Re-scans are <b>incremental</b>: a file whose size and modification time havenâ€™t changed keeps its cached hash (the <i>mtime cache</i>), so re-scanning thousands of files takes seconds.</li><li>Anything unrecognised is listed so you can name or map it.</li><li>The scan is <b>read-only</b> â€” it never modifies your files.</li><li>Run it any time from the Library (<b>Scan</b> button, or <kbd>Ctrl</kbd>+<kbd>K</kbd> â†’ â€œscanâ€); <b>Verify integrity</b> goes further and re-hashes content to catch silent corruption.</li></ul>'
                        + '<h4>Adding a mod â€” the ways in</h4><ul><li><b>Drag &amp; drop</b> a <code>.zip</code>/<code>.7z</code>/<code>.rar</code> archive or a folder straight onto the window.</li><li><b>Add a mod</b> button in the Library (or <kbd>Ctrl</kbd>+<kbd>M</kbd>) â†’ pick an archive or folder.</li><li><b>From a catalog</b> (App Catalog / BetterCommunity) â€” one click installs it.</li><li><b>From a server repo</b> â€” subscribe and sync; the mods come with it.</li></ul><p>Example: you download <code>HD-Texture-Pack.zip</code>. Drop it on BMM â†’ it appears in the Library (disabled). <b>Double-click the card</b> (or single-click the toggle) to enable it â€” see <button type="button" class="dh-xref" data-art="activation">Activate &amp; deactivate mods</button>. If the game acts like it isnâ€™t there, the archive was zipped from the wrong folder â€” fix it once with the <button type="button" class="dh-xref" data-art="mod-structure">Mapper</button>.</p>',
                    fr: '<p>Le premier scan lit votre dossier de mods et construit un index â€” noms, versions, tailles et un <b>hachage de contenu BLAKE3</b> par fichier. Cet index rend tout le reste rapide : conflits, intÃ©gritÃ© et synchro le lisent au lieu de reparcourir le disque.</p><ul><li>Les re-scans sont <b>incrÃ©mentaux</b> : un fichier dont la taille et la date de modification nâ€™ont pas changÃ© garde son hachage en cache (le <i>cache mtime</i>) â€” re-scanner des milliers de fichiers prend quelques secondes.</li><li>Tout Ã©lÃ©ment non reconnu est listÃ© pour le nommer ou le mapper.</li><li>Le scan est en <b>lecture seule</b> â€” il ne modifie jamais vos fichiers.</li><li>Lancez-le quand vous voulez depuis la BibliothÃ¨que (bouton <b>Scanner</b>, ou <kbd>Ctrl</kbd>+<kbd>K</kbd> â†’ Â« scan Â») ; <b>VÃ©rifier lâ€™intÃ©gritÃ©</b> va plus loin et re-hache le contenu pour dÃ©tecter une corruption silencieuse.</li></ul>'
                        + '<h4>Ajouter un mod â€” les entrÃ©es</h4><ul><li><b>Glisser-dÃ©poser</b> une archive <code>.zip</code>/<code>.7z</code>/<code>.rar</code> ou un dossier directement sur la fenÃªtre.</li><li>Bouton <b>Ajouter un mod</b> dans la BibliothÃ¨que (ou <kbd>Ctrl</kbd>+<kbd>M</kbd>) â†’ choisissez une archive ou un dossier.</li><li><b>Depuis un catalogue</b> (App Catalog / BetterCommunity) â€” un clic lâ€™installe.</li><li><b>Depuis un dÃ©pÃ´t serveur</b> â€” abonnez-vous et synchronisez ; les mods arrivent avec.</li></ul><p>Exemple : vous tÃ©lÃ©chargez <code>Pack-Textures-HD.zip</code>. DÃ©posez-le sur BMM â†’ il apparaÃ®t dans la BibliothÃ¨que (dÃ©sactivÃ©). <b>Double-cliquez la carte</b> (ou cliquez lâ€™interrupteur) pour lâ€™activer â€” voir <button type="button" class="dh-xref" data-art="activation">Activer et dÃ©sactiver des mods</button>. Si le jeu fait comme sâ€™il nâ€™Ã©tait pas lÃ , lâ€™archive a Ã©tÃ© zippÃ©e depuis le mauvais dossier â€” corrigez-le une fois avec le <button type="button" class="dh-xref" data-art="mod-structure">Mapper</button>.</p>',
                },
            },
            {
                id: 'staying-updated', docsPath: 'getting-started/install/', diagram: 'update-system',
                title: { en: 'Staying up to date', fr: 'Rester Ã  jour' },
                summary: { en: 'How BMM and your mods keep current â€” safely.', fr: 'Comment BMM et vos mods restent Ã  jour â€” en toute sÃ©curitÃ©.' },
                keywords: 'update updates version upgrade current mise Ã  jour mettre',
                body: {
                    en: '<p>BMM checks for new versions of itself and of any mod with a known source, and only fetches when something actually changed.</p><ul><li><b>Mods</b> â€” when an update is available BMM stages the new files and lets you review before applying; nothing is forced, and the rest of your profile is untouched.</li><li><b>The app</b> â€” its own updates are cryptographically <b>signed</b> and checked before installing, so a tampered build canâ€™t sneak in.</li><li>Want it hands-off? The <b>Scheduler</b> can run update checks on a timer.</li></ul><p>Curious how the check works? See <button type="button" class="dh-xref" data-art="update-system">Updates (app &amp; mods)</button>.</p>',
                    fr: '<p>BMM vÃ©rifie les nouvelles versions de lui-mÃªme et de tout mod ayant une source connue, et ne tÃ©lÃ©charge que si quelque chose a rÃ©ellement changÃ©.</p><ul><li><b>Les mods</b> â€” quand une mise Ã  jour est dispo, BMM prÃ©pare les nouveaux fichiers et vous laisse vÃ©rifier avant dâ€™appliquer ; rien nâ€™est forcÃ©, et le reste du profil nâ€™est pas touchÃ©.</li><li><b>Lâ€™app</b> â€” ses propres mises Ã  jour sont <b>signÃ©es</b> cryptographiquement et vÃ©rifiÃ©es avant installation, donc une version altÃ©rÃ©e ne peut pas se glisser.</li><li>Vous voulez que ce soit automatique ? Le <b>Planificateur</b> peut lancer les vÃ©rifs Ã  intervalle rÃ©gulier.</li></ul><p>Curieux du fonctionnement ? Voir <button type="button" class="dh-xref" data-art="update-system">Mises Ã  jour (app &amp; mods)</button>.</p>',
                },
            },
        ],
    },
    {
        id: 'mods', part: 'user', icon: 'layers',
        title: { en: 'Managing mods', fr: 'GÃ©rer les mods' },
        blurb: { en: 'Structure, activate, resolve conflicts, map and bundle.', fr: 'Structurer, activer, rÃ©soudre les conflits, mapper et regrouper.' },
        articles: [
            {
                id: 'mod-structure', docsPath: 'how-it-works/mapper/', tutorial: { id: 'basics', part: 'map' }, diagram: 'mod-mapper', view: 'mapper',
                title: { en: 'How a mod must be structured', fr: 'Comment un mod doit Ãªtre structurÃ©' },
                summary: { en: 'A mod is a folder that copies the gameâ€™s own folder tree â€” hereâ€™s what that means.', fr: 'Un mod est un dossier qui copie lâ€™arborescence du jeu â€” voici ce que Ã§a veut dire.' },
                keywords: 'structure ovgme folder tree config mapper arborescence dossier configuration store mirror',
                body: {
                    en: `<p>BMM applies your mods <b>without ever moving your originals</b> (the same idea as OvGME). The trick that makes that possible: <b>a mod is just a folder that mirrors the gameâ€™s own folder tree.</b> Whatever path a file needs inside the game, your mod recreates that exact path â€” so BMM can lay one straight over the other.</p>
<div class="dh-treecmp">
  <div class="dh-treecol">
    <div class="dh-treecol-h">â‘  The game folder â€” what your game already has</div>
    <div class="dh-tree-list">
      <div class="dh-fld dh-fld-0"><span class="fi">ðŸ“</span> Your Game <small>game root</small></div>
      <div class="dh-fld dh-fld-1"><span class="fi">ðŸ“</span> Data</div>
      <div class="dh-fld dh-fld-2"><span class="fi">ðŸ“</span> Textures</div>
      <div class="dh-fld dh-fld-3 dh-fld-mut"><span class="fi">ðŸ“„</span> the gameâ€™s own texturesâ€¦</div>
    </div>
  </div>
  <div class="dh-treecol dh-treecol-accent">
    <div class="dh-treecol-h">â‘¡ Your mod â€” the very same shape</div>
    <div class="dh-tree-list">
      <div class="dh-fld dh-fld-0"><span class="fi">ðŸ“</span> HD Texture Pack <small>= the mod</small></div>
      <div class="dh-fld dh-fld-1"><span class="fi">ðŸ“</span> Data</div>
      <div class="dh-fld dh-fld-2"><span class="fi">ðŸ“</span> Textures</div>
      <div class="dh-fld dh-fld-3 dh-fld-hit"><span class="fi">ðŸ“</span> HD Texture Pack <small>slots in here</small></div>
    </div>
  </div>
</div>
<div class="dh-treecmp-note">â†” the <code>Data / Textures</code> path is the same on both sides â€” so your mod drops straight onto the game.</div>
<p class="dh-diagnote">The exact folder names (<code>Data</code>, <code>Textures</code>, â€¦) are whatever <b>your</b> game uses â€” the rule is simply that your mod recreates that same path, from the game root down.</p>
<h4>Set up a profile per target folder</h4>
<p>Some games read mods from more than one place â€” often the <b>install folder</b> and a separate <b>user / config folder</b>. Give each one its own profile pointing at that folder.</p>
<p>Each profile also has its own <b>mods folder</b> (the â€œConfiguration â†’ mods folderâ€ line) where BMM stores that profileâ€™s mods.</p>
<h4>When a download has the wrong shape</h4>
<p>Plenty of archives ship the files loose, or zipped one folder too deep, so the parent folders the game expects are missing. Donâ€™t rebuild them by hand â€” open the <b>Mapper</b>, drag each file to where it belongs, and save. Nothing moves until you save, and the left pane shows the mod <i>as it will be</i>, so you can stage a dozen changes and check the result first.</p>
<p>Note what saving does: it <b>restructures the mod folder on disk</b>. It is not a mapping table replayed at each deploy, so a new version of the mod with the same wrong layout has to be re-mapped. Restructuring also changes the modâ€™s content id (unless it ships a <code>bmm.json</code> id) and invalidates its integrity baseline â€” re-run the check afterwards.</p>`,
                    fr: `<p>BMM applique vos mods <b>sans jamais dÃ©placer vos originaux</b> (le mÃªme principe quâ€™OvGME). Lâ€™astuce qui rend Ã§a possible : <b>un mod nâ€™est quâ€™un dossier qui copie lâ€™arborescence du jeu.</b> Quel que soit le chemin dont un fichier a besoin dans le jeu, votre mod recrÃ©e ce chemin exact â€” BMM peut alors poser lâ€™un directement sur lâ€™autre.</p>
<div class="dh-treecmp">
  <div class="dh-treecol">
    <div class="dh-treecol-h">â‘  Le dossier du jeu â€” ce que votre jeu a dÃ©jÃ </div>
    <div class="dh-tree-list">
      <div class="dh-fld dh-fld-0"><span class="fi">ðŸ“</span> Votre Jeu <small>racine du jeu</small></div>
      <div class="dh-fld dh-fld-1"><span class="fi">ðŸ“</span> Data</div>
      <div class="dh-fld dh-fld-2"><span class="fi">ðŸ“</span> Textures</div>
      <div class="dh-fld dh-fld-3 dh-fld-mut"><span class="fi">ðŸ“„</span> les textures dâ€™origine du jeuâ€¦</div>
    </div>
  </div>
  <div class="dh-treecol dh-treecol-accent">
    <div class="dh-treecol-h">â‘¡ Votre mod â€” exactement la mÃªme forme</div>
    <div class="dh-tree-list">
      <div class="dh-fld dh-fld-0"><span class="fi">ðŸ“</span> Pack de Textures HD <small>= le mod</small></div>
      <div class="dh-fld dh-fld-1"><span class="fi">ðŸ“</span> Data</div>
      <div class="dh-fld dh-fld-2"><span class="fi">ðŸ“</span> Textures</div>
      <div class="dh-fld dh-fld-3 dh-fld-hit"><span class="fi">ðŸ“</span> Pack de Textures HD <small>se glisse ici</small></div>
    </div>
  </div>
</div>
<div class="dh-treecmp-note">â†” le chemin <code>Data / Textures</code> est identique des deux cÃ´tÃ©s â€” votre mod se pose donc directement sur le jeu.</div>
<p class="dh-diagnote">Les noms de dossiers exacts (<code>Data</code>, <code>Textures</code>, â€¦) sont ceux que <b>votre</b> jeu utilise â€” la rÃ¨gle est simplement que votre mod recrÃ©e ce mÃªme chemin, depuis la racine du jeu.</p>
<h4>Un profil par dossier cible</h4>
<p>Certains jeux lisent les mods Ã  plusieurs endroits â€” souvent le <b>dossier dâ€™installation</b> et un <b>dossier utilisateur / config</b> sÃ©parÃ©. Donnez Ã  chacun son propre profil pointant sur ce dossier.</p>
<p>Chaque profil a aussi son propre <b>dossier des mods</b> (la ligne Â« Configuration â†’ dossier des mods Â») oÃ¹ BMM stocke les mods de ce profil.</p>
<h4>Quand un tÃ©lÃ©chargement a la mauvaise forme</h4>
<p>Beaucoup dâ€™archives livrent les fichiers en vrac, ou zippÃ©s un dossier trop bas, si bien que les dossiers parents attendus par le jeu manquent. Ne les reconstruisez pas Ã  la main â€” ouvrez le <b>Mappeur</b>, glissez chaque fichier Ã  sa place, et enregistrez. Rien ne bouge avant lâ€™enregistrement, et le volet de gauche montre le mod <i>tel quâ€™il sera</i> : vous pouvez donc prÃ©parer une dizaine de changements et vÃ©rifier le rÃ©sultat dâ€™abord.</p>
<p>Ã€ noter, ce que fait lâ€™enregistrement : il <b>restructure le dossier du mod sur le disque</b>. Ce nâ€™est pas une table rejouÃ©e Ã  chaque dÃ©ploiement, donc une nouvelle version du mod au mÃªme mauvais agencement doit Ãªtre re-mappÃ©e. La restructuration change aussi lâ€™id de contenu du mod (sauf sâ€™il embarque un id dans <code>bmm.json</code>) et invalide sa baseline dâ€™intÃ©gritÃ© â€” relancez le contrÃ´le ensuite.</p>`,
                },
            },
            {
                id: 'activation', docsPath: 'how-it-works/profiles-activation/', view: 'library', tutorial: { id: 'basics', part: 'activate' }, diagram: 'mod-activation',
                title: { en: 'Activate & deactivate mods', fr: 'Activer et dÃ©sactiver des mods' },
                summary: { en: 'Toggle mods on or off per profile without moving files by hand.', fr: 'Activez ou dÃ©sactivez des mods par profil sans dÃ©placer les fichiers Ã  la main.' },
                keywords: 'activate enable disable toggle deploy activer dÃ©sactiver',
                body: {
                    en: '<p>Toggling a mod stages it into the active profile: its files are linked or copied into the game folder, and any game file it replaces is <b>backed up first</b>. BMM tracks exactly which files belong to which mod, so deactivating removes only those â€” and puts the backed-up originals (or the next modâ€™s file) back. Cleanly, every time.</p><ul><li>Enable with a single click or a <b>double-click on the card</b>; batch-toggle a whole category, or everything, at once.</li><li>Activation is <b>transactional</b>: an interrupted deploy rolls back instead of leaving a half-state.</li><li>If two enabled mods ship the same file, the one you enabled <b>last</b> wins â€” see <button class="dh-xref" data-art="conflicts">Conflicts (who wins)</button>.</li></ul><h4>Enabling â‰  switching profiles</h4><p><b>Enabling/disabling a mod is the only thing that moves files.</b> Changing the active profile does not â€” it just picks which profile youâ€™re working in; whatever is already enabled stays deployed in the game. And profiles that point at the <b>same game + mods folders share their enabled mods</b> (so a mod canâ€™t be enabled in two of them at once); profiles with <i>different</i> folders are fully independent setups.</p>',
                    fr: '<p>Activer un mod le met en place dans le profil actif : ses fichiers sont liÃ©s ou copiÃ©s dans le dossier du jeu, et tout fichier du jeu quâ€™il remplace est <b>dâ€™abord sauvegardÃ©</b>. BMM sait exactement quels fichiers appartiennent Ã  quel mod : la dÃ©sactivation ne retire que ceux-lÃ  â€” et remet les originaux sauvegardÃ©s (ou le fichier du mod suivant). Proprement, Ã  chaque fois.</p><ul><li>Activez dâ€™un clic ou dâ€™un <b>double-clic sur la carte</b> ; basculez toute une catÃ©gorie, ou tout, dâ€™un coup.</li><li>Lâ€™activation est <b>transactionnelle</b> : un dÃ©ploiement interrompu est annulÃ© au lieu de laisser un Ã©tat incomplet.</li><li>Si deux mods activÃ©s fournissent le mÃªme fichier, le dernier activÃ© <b>gagne</b> â€” voir <button class="dh-xref" data-art="conflicts">Conflits (qui gagne)</button>.</li></ul><h4>Activer â‰  changer de profil</h4><p><b>Activer/dÃ©sactiver un mod est la seule chose qui dÃ©place des fichiers.</b> Changer de profil actif, non â€” Ã§a choisit juste le profil dans lequel vous travaillez ; ce qui est dÃ©jÃ  activÃ© reste dÃ©ployÃ© dans le jeu. Et les profils qui pointent vers les <b>mÃªmes dossiers jeu + mods partagent leurs mods activÃ©s</b> (un mod ne peut donc pas Ãªtre activÃ© dans deux dâ€™entre eux Ã  la fois) ; les profils avec des dossiers <i>diffÃ©rents</i> sont des configurations totalement indÃ©pendantes.</p>',
                },
            },
            {
                id: 'conflicts', docsPath: 'how-it-works/conflicts/', view: 'library', tutorial: { id: 'basics', part: 'conflicts' }, diagram: 'conflict-management',
                title: { en: 'Conflicts (who wins)', fr: 'Conflits (qui gagne)' },
                summary: { en: 'Two mods sharing a file: the one you enable LAST wins. BMM warns you first.', fr: 'Deux mods partageant un fichier : le dernier activÃ© gagne. BMM vous prÃ©vient avant.' },
                keywords: 'conflict overwrite order last enable resolve conflit ordre Ã©crase',
                body: {
                    en: '<p>Two mods are in <b>conflict</b> when they ship the same file. BMM doesnâ€™t hide it: before it deploys, it detects the overlap and shows you exactly which files two mods share.</p><h4>Who wins?</h4><p>The rule is simple â€” <b>whichever mod you enable last wins</b>. Its file overwrites the earlier one in the game folder. So your control is the <b>order you enable mods in</b>: enable the one you want to win last.</p><ul><li>BMM warns you when you activate and lists the overlapping files (you can open them to compare).</li><li>Nothing is lost: your original game files are backed up, and if you later disable the winning mod, BMM puts back the file from the next mod that provides it â€” or the original game file.</li></ul><p>There is <b>no per-file winner picker and no priority list</b> â€” itâ€™s the enable order, tracked per profile.</p>',
                    fr: '<p>Deux mods sont en <b>conflit</b> quand ils fournissent le mÃªme fichier. BMM ne le cache pas : avant de dÃ©ployer, il dÃ©tecte le chevauchement et vous montre exactement quels fichiers deux mods partagent.</p><h4>Qui gagne ?</h4><p>La rÃ¨gle est simple â€” <b>le dernier mod que vous activez gagne</b>. Son fichier Ã©crase le prÃ©cÃ©dent dans le dossier du jeu. Votre levier, câ€™est donc lâ€™<b>ordre dans lequel vous activez les mods</b> : activez en dernier celui qui doit gagner.</p><ul><li>BMM vous avertit Ã  lâ€™activation et liste les fichiers qui se chevauchent (vous pouvez les ouvrir pour comparer).</li><li>Rien nâ€™est perdu : vos fichiers de jeu dâ€™origine sont sauvegardÃ©s, et si vous dÃ©sactivez ensuite le mod gagnant, BMM remet le fichier du mod suivant qui le fournit â€” ou le fichier de jeu dâ€™origine.</li></ul><p>Il nâ€™y a <b>pas de sÃ©lecteur de gagnant par fichier ni de liste de prioritÃ©</b> â€” câ€™est lâ€™ordre dâ€™activation, mÃ©morisÃ© par profil.</p>',
                },
            },
            {
                id: 'modpacks', docsPath: 'features/modpacks/', view: 'modpacks', tutorial: { id: 'basics', part: 'modpacks' }, diagram: 'modpack-flow',
                title: { en: 'Modpacks', fr: 'Modpacks' },
                summary: { en: 'Bundle a curated set of mods into one shareable pack.', fr: 'Regroupez un ensemble de mods sÃ©lectionnÃ©s en un pack partageable.' },
                keywords: 'modpack bundle collection pack export import',
                body: {
                    en: '<p>A modpack is a saved recipe: a named set of mods, kept in the order and with the choices you picked. Apply it to a profile and BMM enables exactly those mods â€” nothing else in the profile is touched.</p><ul><li><b>Create</b> one from the Modpacks screen (or capture what you have enabled right now), then <b>quick-apply</b> it to any profile in one click.</li><li><b>Share</b> it â€” export the pack, or attach it to a server repo so subscribers can pull it; when hosted you choose who may download it (public, or a whitelist).</li><li>A modpack <b>references</b> mods, it doesnâ€™t re-bundle their files â€” so it stays tiny and always resolves to the current version of each mod.</li></ul>',
                    fr: '<p>Un modpack est une recette enregistrÃ©e : un ensemble de mods nommÃ©, dans lâ€™ordre et avec les choix que vous avez faits. Appliquez-le Ã  un profil et BMM active exactement ces mods â€” rien dâ€™autre dans le profil nâ€™est modifiÃ©.</p><ul><li><b>CrÃ©ez</b>-en un depuis lâ€™Ã©cran Modpacks (ou capturez ce que vous avez activÃ© maintenant), puis <b>appliquez-le</b> Ã  nâ€™importe quel profil en un clic.</li><li><b>Partagez</b>-le â€” exportez le pack, ou attachez-le Ã  un dÃ©pÃ´t serveur pour que les abonnÃ©s le rÃ©cupÃ¨rent ; une fois hÃ©bergÃ©, vous choisissez qui peut le tÃ©lÃ©charger (public ou liste blanche).</li><li>Un modpack <b>rÃ©fÃ©rence</b> les mods, il ne re-empaquette pas leurs fichiers â€” il reste minuscule et pointe toujours vers la version actuelle de chaque mod.</li></ul>',
                },
            },
        ],
    },
    {
        id: 'profiles', part: 'user', icon: 'save',
        title: { en: 'Profiles & backups', fr: 'Profils et sauvegardes' },
        blurb: { en: 'Isolated setups, shared storage, backups and launch packs.', fr: 'Configurations isolÃ©es, stockage partagÃ©, sauvegardes et launch packs.' },
        articles: [
            {
                id: 'shared-storage', docsPath: 'features/storage/',
                title: { en: 'Shared storage', fr: 'Stockage partagÃ©' },
                summary: { en: 'Keep one copy of a mod on disk, used by many profiles.', fr: 'Gardez une seule copie dâ€™un mod sur le disque, utilisÃ©e par plusieurs profils.' },
                keywords: 'shared storage dedupe link space disk stockage partagÃ© espace',
                body: {
                    en: '<p>Enable the same mod in three profiles and BMM still keeps <b>one</b> copy of its files on disk â€” each profile links to that shared copy instead of duplicating it. You get per-profile isolation without paying for it three times in space.</p><ul><li>Deduplication is by <b>content</b>: two mods (or two versions) that contain identical files share the stored bytes.</li><li>Editing or removing a mod in one profile never touches the others â€” each keeps its own view.</li><li>Open <b>Storage &amp; disk usage</b> in Settings to see how much space this is saving you.</li></ul>',
                    fr: '<p>Activez le mÃªme mod dans trois profils et BMM ne garde quâ€™<b>une</b> copie de ses fichiers sur le disque â€” chaque profil pointe vers cette copie partagÃ©e au lieu de la dupliquer. Vous gardez lâ€™isolation par profil sans la payer trois fois en espace.</p><ul><li>La dÃ©duplication se fait par <b>contenu</b> : deux mods (ou deux versions) contenant des fichiers identiques partagent les octets stockÃ©s.</li><li>Modifier ou supprimer un mod dans un profil ne touche jamais les autres â€” chacun garde sa propre vue.</li><li>Ouvrez <b>Stockage &amp; espace disque</b> dans les ParamÃ¨tres pour voir lâ€™espace ainsi Ã©conomisÃ©.</li></ul>',
                },
            },
            {
                id: 'backups', docsPath: 'features/profiles/', view: 'profiles', diagram: 'backup-system',
                title: { en: 'Backups', fr: 'Sauvegardes' },
                summary: { en: 'Snapshot a profile so you can always roll back.', fr: 'Prenez un instantanÃ© dâ€™un profil pour pouvoir toujours revenir en arriÃ¨re.' },
                keywords: 'backup snapshot restore rollback safety sauvegarde restaurer',
                body: {
                    en: '<p>Every profile has a <b>backup folder</b> (the third path you set when creating it). Two things use it:</p><ul><li><b>Automatic</b> â€” whenever deploying a mod would overwrite an existing game file, BMM copies the original into the backup folder first. Thatâ€™s what makes disabling a mod a clean, exact undo.</li><li><b>Manual snapshots</b> â€” take a snapshot before a big change; if it goes wrong, restore the profile exactly how it was, mods, order and choices included.</li></ul>',
                    fr: '<p>Chaque profil a un <b>dossier de backup</b> (le troisiÃ¨me chemin que vous dÃ©finissez Ã  sa crÃ©ation). Deux choses lâ€™utilisent :</p><ul><li><b>Automatique</b> â€” dÃ¨s que dÃ©ployer un mod Ã©craserait un fichier de jeu existant, BMM copie dâ€™abord lâ€™original dans le dossier de backup. Câ€™est ce qui fait de la dÃ©sactivation dâ€™un mod une annulation propre et exacte.</li><li><b>InstantanÃ©s manuels</b> â€” prenez un instantanÃ© avant un grand changement ; en cas de problÃ¨me, restaurez le profil exactement comme il Ã©tait, mods, ordre et choix compris.</li></ul>',
                },
            },
            {
                id: 'launch-packs', docsPath: 'features/launch-packs/', view: 'settings', diagram: 'launch-packs',
                title: { en: 'Launch packs', fr: 'Launch packs' },
                summary: { en: 'Group several apps into one silent, one-click launcher â€” with its own desktop shortcut.', fr: 'Groupez plusieurs applis en un lanceur silencieux Ã  un clic â€” avec son propre raccourci bureau.' },
                keywords: 'launch pack apps group launcher shortcut exe start lanceur',
                body: {
                    en: '<p>A <b>launch pack</b> is a named group of <b>applications</b> started together in one click â€” your game plus the companion tools you always open with it (a voice app, a tracker, a head-tracking toolâ€¦).</p><ul><li><b>Create</b> one in Settings: name it, then add executables (<code>.exe</code>, <code>.bat</code>, <code>.ps1</code>, <code>.cmd</code>, <code>.lnk</code>) via file picker or the built-in <b>app picker</b> that lists your installed programs, Steam-style. Add a custom icon if you like.</li><li><b>Run</b> it from the card â€” every app starts <b>silently</b> (no console windows flashing).</li><li>Each pack also gets its own <b>shortcut</b>, so you can launch it straight from the desktop without opening BMM.</li></ul><p>Curious how itâ€™s bundled? See <b>Developer â†’ Launch packs</b>.</p>',
                    fr: '<p>Un <b>launch pack</b> est un groupe nommÃ© dâ€™<b>applications</b> lancÃ©es ensemble en un clic â€” votre jeu plus les outils compagnons que vous ouvrez toujours avec (une appli vocale, un tracker, un outil de head-trackingâ€¦).</p><ul><li><b>CrÃ©ez</b>-en un dans les RÃ©glages : nommez-le, puis ajoutez des exÃ©cutables (<code>.exe</code>, <code>.bat</code>, <code>.ps1</code>, <code>.cmd</code>, <code>.lnk</code>) via le sÃ©lecteur de fichiers ou le <b>sÃ©lecteur dâ€™applis</b> intÃ©grÃ© qui liste vos programmes installÃ©s, faÃ§on Steam. Ajoutez une icÃ´ne si vous voulez.</li><li><b>Lancez</b>-le depuis sa carte â€” chaque appli dÃ©marre <b>silencieusement</b> (aucune fenÃªtre de console qui clignote).</li><li>Chaque pack reÃ§oit aussi son propre <b>raccourci</b>, pour le lancer depuis le bureau sans ouvrir BMM.</li></ul><p>Curieux de lâ€™assemblage ? Voir <b>DÃ©veloppeur â†’ Launch packs</b>.</p>',
                },
            },
        ],
    },
    {
        id: 'share', part: 'user', icon: 'share',
        title: { en: 'Sharing & hosting', fr: 'Partage et hÃ©bergement' },
        blurb: { en: 'Host a repo, subscribe & sync, catalogs and BetterCommunity.', fr: 'HÃ©berger un dÃ©pÃ´t, sâ€™abonner & synchro, catalogues et BetterCommunity.' },
        articles: [
            {
                id: 'server-host', view: 'repo', diagram: 'hosting-flow', docsPath: '',
                title: { en: 'Host your own repository', fr: 'HÃ©berger votre propre dÃ©pÃ´t' },
                summary: { en: 'Turn a profile into a hosted source others can subscribe to.', fr: 'Transformez un profil en source hÃ©bergÃ©e Ã  laquelle dâ€™autres peuvent sâ€™abonner.' },
                keywords: 'server repo host publish self-host manifest hosting dÃ©pÃ´t hÃ©berger squadron',
                body: {
                    en: '<p>Hosting turns a profile into a <b>source of truth</b> others subscribe to â€” a squadron, a community, or just keeping your own machines identical.</p>'
                        + '<h4>What BMM builds</h4><ul><li>A <b>manifest</b> (<code>repo.json</code>) listing every file with its <b>SHA-256</b> hash (plus 4&nbsp;MB chunk hashes, for efficient updates).</li><li>A cryptographic <b>signature</b> tied to your identity (an author id + ed25519 signature), so subscribers can confirm a repo really came from you.</li></ul>'
                        + '<h4>Serving it</h4><p>Open <b>Server Repo</b> and pick the profile to share. Then either run BMMâ€™s <b>built-in mini-server</b>, or generate a small standalone server (Node, or a <code>.bat</code>/<code>.sh</code> script) to run on a dedicated machine. Serve it over HTTP â€” <b>HTTPS is strongly recommended</b>. Hand out the resulting link.</p>'
                        + '<h4>Who can download it</h4><p>A self-hosted repo is <b>public by default</b>. You can restrict it two ways: a <b>whitelist / ban list</b>, matched automatically against a subscriberâ€™s linked account or device identity; and an optional <b>download password</b> â€” set it when generating the server, and subscribers are asked for it the first time they connect (BMM remembers it for later syncs). Leave it blank for an open repo. Keep this separate from the <b>admin password</b>, which protects only <b>your</b> serverâ€™s admin panel (pushing new versions) and is not a subscriber gate.</p>'
                        + '<h4>BetterCommunity is different</h4><p>The BetterCommunity hub adds things a repo you host yourself does <b>not</b> have: a <code>BCR-XXXX-XXXX</code> repo fingerprint, account-based (email / password) access, and managed hosting. Donâ€™t confuse the two.</p>',
                    fr: '<p>HÃ©berger transforme un profil en <b>source de vÃ©ritÃ©</b> Ã  laquelle dâ€™autres sâ€™abonnent â€” une escadrille, une communautÃ©, ou juste garder vos propres machines identiques.</p>'
                        + '<h4>Ce que BMM construit</h4><ul><li>Un <b>manifeste</b> (<code>repo.json</code>) listant chaque fichier avec son hachage <b>SHA-256</b> (plus des hachages de blocs de 4&nbsp;Mo, pour des mises Ã  jour efficaces).</li><li>Une <b>signature</b> cryptographique liÃ©e Ã  votre identitÃ© (un author id + signature ed25519), pour que les abonnÃ©s confirment quâ€™un dÃ©pÃ´t vient bien de vous.</li></ul>'
                        + '<h4>Le servir</h4><p>Ouvrez <b>DÃ©pÃ´t Serveur</b> et choisissez le profil Ã  partager. Puis lancez le <b>mini-serveur intÃ©grÃ©</b> de BMM, ou gÃ©nÃ©rez un petit serveur autonome (Node, ou un script <code>.bat</code>/<code>.sh</code>) Ã  exÃ©cuter sur une machine dÃ©diÃ©e. Servez-le en HTTP â€” <b>le HTTPS est fortement recommandÃ©</b>. Distribuez le lien obtenu.</p>'
                        + '<h4>Qui peut le tÃ©lÃ©charger</h4><p>Un dÃ©pÃ´t auto-hÃ©bergÃ© est <b>public par dÃ©faut</b>. Vous pouvez le restreindre de deux faÃ§ons : une <b>liste blanche / liste de bannis</b>, comparÃ©e automatiquement au compte liÃ© ou Ã  lâ€™identitÃ© dâ€™appareil dâ€™un abonnÃ© ; et un <b>mot de passe de tÃ©lÃ©chargement</b> optionnel â€” dÃ©finissez-le Ã  la gÃ©nÃ©ration du serveur, et les abonnÃ©s se le voient demander Ã  la premiÃ¨re connexion (BMM le retient pour les synchros suivantes). Laissez-le vide pour un dÃ©pÃ´t ouvert. Ã€ ne pas confondre avec le <b>mot de passe admin</b>, qui protÃ¨ge seulement le panneau dâ€™admin de <b>votre</b> serveur (pousser de nouvelles versions) et nâ€™est pas une barriÃ¨re pour les abonnÃ©s.</p>'
                        + '<h4>BetterCommunity, câ€™est autre chose</h4><p>Le hub BetterCommunity ajoute des choses quâ€™un dÃ©pÃ´t auto-hÃ©bergÃ© nâ€™a <b>pas</b> : une empreinte <code>BCR-XXXX-XXXX</code>, un accÃ¨s par compte (e-mail / mot de passe), et de lâ€™hÃ©bergement gÃ©rÃ©. Ne confondez pas les deux.</p>',
                },
            },
            {
                id: 'server-sync', view: 'repo', diagram: 'server-mode', docsPath: '',
                title: { en: 'Subscribe & keep in sync', fr: 'Sâ€™abonner et rester synchronisÃ©' },
                summary: { en: 'Point BMM at a repo link â€” get the exact same mods, and only fetch what changes.', fr: 'Pointez BMM sur un lien de dÃ©pÃ´t â€” mÃªmes mods exacts, et seul ce qui change est tÃ©lÃ©chargÃ©.' },
                keywords: 'subscribe sync update repo download manifest sâ€™abonner synchro mise Ã  jour',
                body: {
                    en: '<p>Subscribing points your BMM at a repoâ€™s link; you get the exact same mods, versions and order as the host, and stay converged as they update.</p>'
                        + '<h4>How a sync works</h4><p>Your BMM never blindly re-downloads. It fetches the <b>manifest</b> and compares it to what you already have:</p><ul><li>Unchanged files (same SHA-256) are <b>skipped</b>.</li><li>For a changed file, BMM compares 4&nbsp;MB <b>chunks</b> and Range-fetches only the mismatched ones â€” so a small change to a 10&nbsp;GB collection costs a few MB.</li><li>Every downloaded file is <b>verified against its SHA-256</b> before itâ€™s deployed.</li></ul>'
                        + '<h4>Getting updates</h4><p>BMM spots a new version by comparing the repoâ€™s <b>published version string</b> with what you installed. When it differs, the update checker flags it; applying re-runs the sync above â€” fetching only what actually changed and removing mods the host dropped.</p>',
                    fr: '<p>Sâ€™abonner pointe votre BMM sur le lien dâ€™un dÃ©pÃ´t ; vous obtenez exactement les mÃªmes mods, versions et ordre que lâ€™hÃ´te, et restez alignÃ©s Ã  mesure quâ€™il met Ã  jour.</p>'
                        + '<h4>Comment marche une synchro</h4><p>Votre BMM ne re-tÃ©lÃ©charge jamais Ã  lâ€™aveugle. Il rÃ©cupÃ¨re le <b>manifeste</b> et le compare Ã  ce que vous avez dÃ©jÃ  :</p><ul><li>Les fichiers inchangÃ©s (mÃªme SHA-256) sont <b>ignorÃ©s</b>.</li><li>Pour un fichier modifiÃ©, BMM compare les <b>blocs</b> de 4&nbsp;Mo et ne rÃ©cupÃ¨re (par Range) que ceux qui diffÃ¨rent â€” un petit changement dans 10&nbsp;Go coÃ»te quelques Mo.</li><li>Chaque fichier tÃ©lÃ©chargÃ© est <b>vÃ©rifiÃ© par son SHA-256</b> avant dâ€™Ãªtre dÃ©ployÃ©.</li></ul>'
                        + '<h4>Recevoir les mises Ã  jour</h4><p>BMM repÃ¨re une nouvelle version en comparant la <b>chaÃ®ne de version publiÃ©e</b> du dÃ©pÃ´t Ã  celle installÃ©e. Quand elle diffÃ¨re, le vÃ©rificateur de mises Ã  jour le signale ; appliquer relance la synchro ci-dessus â€” en ne rÃ©cupÃ©rant que ce qui a rÃ©ellement changÃ© et en retirant les mods que lâ€™hÃ´te a supprimÃ©s.</p>',
                },
            },
            {
                id: 'repo-admin', docsPath: 'features/repo/', view: 'repo', diagram: 'security-system',
                title: { en: 'Repo admin & monitoring', fr: 'Admin et monitoring du dÃ©pÃ´t' },
                summary: { en: 'Watch who downloads what, live â€” and manage your whitelist and bans.', fr: 'Voyez qui tÃ©lÃ©charge quoi, en direct â€” et gÃ©rez liste blanche et bannissements.' },
                keywords: 'admin monitoring whitelist ban clients downloads dashboard surveiller bannir',
                body: {
                    en: '<p>Hosting a repo comes with two host-side tools, both on the <b>Server Repo</b> screen:</p>'
                        + '<h4>Monitoring</h4><p>A live table, refreshed every second: each connected clientâ€™s IP, creator ID, protocol (<b>Local / LAN / WAN</b>), the file being downloaded with a progress bar and speed, and idle sessions. Totals up top: clients, combined speed, active files. From any row you can <b>whitelist</b> or <b>ban</b> that client in one click. It also aggregates a running standalone serverâ€™s <code>monitoring.json</code>, so you see both servers in one place.</p>'
                        + '<h4>Whitelist & bans</h4><p>Two managers with search, manual add (by IP and/or creator key), one-click removal, and JSON export. The whitelist has a master <b>on/off</b> switch â€” off means everyone may download (minus bans); on means only listed identities pass. Changes are pushed to a standalone server through its authenticated <code>/admin</code> endpoints.</p>'
                        + '<h4>The generated serverâ€™s endpoints</h4><ul><li><code>/dashboard</code> and <code>/monitoring.json</code> â€” public read-only status.</li><li><code>/admin/data</code>, <code>/admin/update</code>, <code>/admin/logs</code> â€” gated by the <b>admin password</b> (sent as an Authorization header, compared in constant time).</li></ul>',
                    fr: '<p>HÃ©berger un dÃ©pÃ´t sâ€™accompagne de deux outils cÃ´tÃ© hÃ´te, tous deux sur lâ€™Ã©cran <b>DÃ©pÃ´t Serveur</b> :</p>'
                        + '<h4>Monitoring</h4><p>Un tableau en direct, rafraÃ®chi chaque seconde : IP de chaque client connectÃ©, ID crÃ©ateur, protocole (<b>Local / LAN / WAN</b>), fichier en cours avec barre de progression et vitesse, et sessions inactives. Totaux en haut : clients, vitesse cumulÃ©e, fichiers actifs. Depuis chaque ligne, <b>autorisez</b> (liste blanche) ou <b>bannissez</b> ce client en un clic. Il agrÃ¨ge aussi le <code>monitoring.json</code> dâ€™un serveur autonome en cours dâ€™exÃ©cution â€” les deux serveurs au mÃªme endroit.</p>'
                        + '<h4>Liste blanche & bannissements</h4><p>Deux gestionnaires avec recherche, ajout manuel (par IP et/ou clÃ© crÃ©ateur), retrait en un clic et export JSON. La liste blanche a un interrupteur <b>on/off</b> : off = tout le monde peut tÃ©lÃ©charger (moins les bannis) ; on = seules les identitÃ©s listÃ©es passent. Les changements sont poussÃ©s vers un serveur autonome via ses endpoints <code>/admin</code> authentifiÃ©s.</p>'
                        + '<h4>Les endpoints du serveur gÃ©nÃ©rÃ©</h4><ul><li><code>/dashboard</code> et <code>/monitoring.json</code> â€” Ã©tat public en lecture seule.</li><li><code>/admin/data</code>, <code>/admin/update</code>, <code>/admin/logs</code> â€” protÃ©gÃ©s par le <b>mot de passe admin</b> (envoyÃ© en header Authorization, comparÃ© en temps constant).</li></ul>',
                },
            },
            {
                id: 'catalogs', docsPath: 'features/community/', view: 'apps', diagram: 'app-catalog',
                title: { en: 'Catalogs & BetterCommunity', fr: 'Catalogues et BetterCommunity' },
                summary: { en: 'Browse and install mods, apps and themes from community catalogs.', fr: 'Parcourez et installez mods, applis et thÃ¨mes depuis les catalogues.' },
                keywords: 'catalog community bettercommunity browse install apps themes catalogue',
                body: {
                    en: '<p>Catalogs are feeds of ready-to-install content â€” mods, apps, themes and plugins â€” that BMM reads from a URL. The <b>App Catalog</b> screen browses them; installing is one click (BMM handles the download and, for apps, the setup).</p><ul><li><b>Official</b> catalogs are curated; you can also add a <b>community</b> catalog by URL.</li><li>Install buttons are plain <code>bmm://</code> deeplinks, so a catalog can live on any website â€” or in the BetterCommunity hub.</li><li>Publish your own through <b>BetterCommunity</b>. Note itâ€™s a separate hosted service from a self-hosted server repo.</li></ul>',
                    fr: '<p>Les catalogues sont des flux de contenu prÃªt Ã  installer â€” mods, applis, thÃ¨mes et plugins â€” que BMM lit depuis une URL. Lâ€™Ã©cran <b>App Catalog</b> les parcourt ; lâ€™installation se fait en un clic (BMM gÃ¨re le tÃ©lÃ©chargement et, pour les applis, lâ€™installation).</p><ul><li>Les catalogues <b>officiels</b> sont sÃ©lectionnÃ©s ; vous pouvez aussi ajouter un catalogue <b>communautaire</b> par URL.</li><li>Les boutons dâ€™installation sont de simples deeplinks <code>bmm://</code>, un catalogue peut donc vivre sur nâ€™importe quel site â€” ou dans le hub BetterCommunity.</li><li>Publiez les vÃ´tres via <b>BetterCommunity</b>. Câ€™est un service hÃ©bergÃ©, distinct dâ€™un dÃ©pÃ´t serveur auto-hÃ©bergÃ©.</li></ul>',
                },
            },
        ],
    },
    {
        id: 'power', part: 'user', icon: 'bolt',
        title: { en: 'Power features', fr: 'Fonctions avancÃ©es' },
        blurb: { en: 'Themes, plugins & API, custom pages, integrations, scheduler.', fr: 'ThÃ¨mes, plugins & API, pages personnalisÃ©es, intÃ©grations, planificateur.' },
        articles: [
            {
                id: 'themes', docsPath: 'features/themes/', view: 'settings', diagram: 'theme-system',
                title: { en: 'Themes & appearance', fr: 'ThÃ¨mes et apparence' },
                summary: { en: 'Recolour BMM â€” pick a built-in theme or design and share your own.', fr: 'Recolorez BMM â€” choisissez un thÃ¨me intÃ©grÃ© ou crÃ©ez et partagez le vÃ´tre.' },
                keywords: 'theme appearance color dark light editor custom thÃ¨me apparence couleur',
                body: {
                    en: '<p>BMM ships <b>12 built-in themes</b> â€” dark ones (Default, Sombre, Void, Discord, Spotify, Nord, Glassâ€¦) and four light ones (Full White, Brutalist, Clay, Sakura). Switch in <b>Settings â†’ Themes</b>, or make your own.</p>'
                        + '<h4>The theme editor</h4><p>Open it from Settings â†’ <b>Open Theme Editor</b>. Four tabs:</p><ul><li><b>Simple</b> â€” every design token grouped with friendly labels: backgrounds, accent, borders, text, fonts, radii, buttons, effectsâ€¦ An <b>eyedropper</b> lets you click any element in the running app to jump straight to its token. Or pick one colour and let the <b>auto-palette</b> build a coherent theme around it.</li><li><b>+ Elements</b> â€” inject your own HTML/CSS anywhere (a badge, a bannerâ€¦), globally or per page.</li><li><b>CSS</b> â€” full custom CSS for power users, global and per-page.</li><li><b>Installed</b> â€” manage your themes and browse the <b>theme catalogue</b>.</li></ul><p>Everything previews <b>live</b> and nothing persists until you save â€” Discard restores what you had.</p>'
                        + '<h4>Save, share, import</h4><ul><li><b>Save asâ€¦</b> makes it yours; <b>Export</b> writes a shareable <code>.bmmtheme</code> file (a zip with the theme JSON + fonts/assets).</li><li><b>Share</b> copies a <code>bmm://</code> link â€” the recipient clicks it and the theme installs.</li><li>Light themes get automatic <b>contrast enforcement</b> (real WCAG ratios), so text stays readable even on themes that only change backgrounds.</li></ul><p>Themes are just data â€” they never touch your mods or profiles. Internals: <b>Developer â†’ Theme system</b>.</p>',
                    fr: '<p>BMM livre <b>12 thÃ¨mes intÃ©grÃ©s</b> â€” des sombres (Default, Sombre, Void, Discord, Spotify, Nord, Glassâ€¦) et quatre clairs (Full White, Brutalist, Clay, Sakura). Changez dans <b>RÃ©glages â†’ ThÃ¨mes</b>, ou crÃ©ez le vÃ´tre.</p>'
                        + '<h4>L\'Ã©diteur de thÃ¨mes</h4><p>Ouvrez-le depuis RÃ©glages â†’ <b>Ouvrir l\'Ã©diteur de thÃ¨mes</b>. Quatre onglets :</p><ul><li><b>Simple</b> â€” chaque token de design groupÃ© avec des libellÃ©s clairs : fonds, accent, bordures, texte, polices, rayons, boutons, effetsâ€¦ Une <b>pipette</b> permet de cliquer n\'importe quel Ã©lÃ©ment de l\'app pour sauter directement Ã  son token. Ou choisissez une seule couleur et laissez l\'<b>auto-palette</b> bÃ¢tir un thÃ¨me cohÃ©rent autour.</li><li><b>+ Ã‰lÃ©ments</b> â€” injectez votre propre HTML/CSS n\'importe oÃ¹ (un badge, une banniÃ¨reâ€¦), globalement ou par page.</li><li><b>CSS</b> â€” CSS libre pour utilisateurs avancÃ©s, global et par page.</li><li><b>InstallÃ©s</b> â€” gÃ©rez vos thÃ¨mes et parcourez le <b>catalogue de thÃ¨mes</b>.</li></ul><p>Tout se prÃ©visualise <b>en direct</b> et rien ne persiste avant d\'enregistrer â€” Annuler restaure l\'Ã©tat prÃ©cÃ©dent.</p>'
                        + '<h4>Enregistrer, partager, importer</h4><ul><li><b>Enregistrer sousâ€¦</b> le rend vÃ´tre ; <b>Exporter</b> Ã©crit un fichier <code>.bmmtheme</code> partageable (un zip avec le JSON du thÃ¨me + polices/assets).</li><li><b>Partager</b> copie un lien <code>bmm://</code> â€” le destinataire clique et le thÃ¨me s\'installe.</li><li>Les thÃ¨mes clairs bÃ©nÃ©ficient d\'un <b>renforcement de contraste</b> automatique (vrais ratios WCAG), le texte reste lisible mÃªme sur un thÃ¨me qui ne change que les fonds.</li></ul><p>Les thÃ¨mes ne sont que des donnÃ©es â€” ils ne touchent jamais vos mods ni vos profils. DÃ©tails internes : <b>DÃ©veloppeur â†’ SystÃ¨me de thÃ¨mes</b>.</p>',
                },
            },
            {
                id: 'plugins', view: 'plugins', diagram: 'mcp-server', docsPath: '',
                title: { en: 'Plugins & the API', fr: 'Plugins et API' },
                summary: { en: 'Add features BMM doesnâ€™t ship â€” and automate it from scripts or an AI assistant.', fr: 'Ajoutez des fonctions que BMM ne fournit pas â€” et automatisez-le depuis des scripts ou une IA.' },
                keywords: 'plugin api mcp automation script install extend plugins Ã©tendre',
                body: {
                    en: '<p>Not everything is built in â€” and it doesnâ€™t have to be. The <b>Plugins &amp; API</b> screen lets you install plugins that add new features, and add plugin sources so you can find more.</p><ul><li><b>Install a plugin</b> from a catalog or a file; enable or disable it any time.</li><li>Power users: BMM also exposes a <b>local API</b> and an <b>MCP server</b>, so scripts â€” or an AI assistant â€” can drive it (scan, activate, build packsâ€¦).</li></ul><p>Curious how that works? See <b>Developer â†’ MCP server &amp; local API</b>, or the full endpoint reference in the online docs.</p>',
                    fr: '<p>Tout nâ€™est pas intÃ©grÃ© â€” et Ã§a nâ€™a pas Ã  lâ€™Ãªtre. Lâ€™Ã©cran <b>Plugins &amp; API</b> vous laisse installer des plugins qui ajoutent des fonctions, et ajouter des sources de plugins pour en trouver dâ€™autres.</p><ul><li><b>Installez un plugin</b> depuis un catalogue ou un fichier ; activez-le ou dÃ©sactivez-le quand vous voulez.</li><li>Utilisateurs avancÃ©s : BMM expose aussi une <b>API locale</b> et un <b>serveur MCP</b>, pour que des scripts â€” ou une IA â€” le pilotent (scanner, activer, construire des packsâ€¦).</li></ul><p>Curieux du fonctionnement ? Voir <b>DÃ©veloppeur â†’ Serveur MCP et API locale</b>, ou la rÃ©fÃ©rence complÃ¨te des endpoints dans la doc en ligne.</p>',
                },
            },
            {
                id: 'custom-pages', docsPath: 'features/plugins/',
                title: { en: 'Custom pages', fr: 'Pages personnalisÃ©es' },
                summary: { en: 'Add your own sandboxed pages to the navbar.', fr: 'Ajoutez vos propres pages sandbox Ã  la barre de navigation.' },
                keywords: 'custom pages navbar bmmpage sandbox pages personnalisÃ©es',
                body: {
                    en: '<p>Build a sandboxed <code>bmmpage://</code> page â€” a mini app inside BMM â€” and pin it to the navbar. Each page only gets the permissions you grant it, so it canâ€™t reach anything you didnâ€™t allow. Great for a personal dashboard, a launcher, or a tool the community shares.</p><p>Curious how the sandbox works? See <b>Developer â†’ Extending BMM</b>.</p>',
                    fr: '<p>CrÃ©ez une page <code>bmmpage://</code> en sandbox â€” une mini-application dans BMM â€” et Ã©pinglez-la Ã  la barre de navigation. Chaque page nâ€™obtient que les permissions que vous accordez, elle ne peut donc rien atteindre que vous nâ€™avez pas autorisÃ©. IdÃ©al pour un tableau de bord perso, un lanceur, ou un outil partagÃ© par la communautÃ©.</p><p>Curieux du fonctionnement du sandbox ? Voir <b>DÃ©veloppeur â†’ Ã‰tendre BMM</b>.</p>',
                },
            },
            {
                id: 'translate-bmm', docsPath: 'how-it-works/extending/', view: 'settings', diagram: 'i18n-system',
                title: { en: 'Translate BMM (add a language)', fr: 'Traduire BMM (ajouter une langue)' },
                summary: { en: 'Create, edit and share a full translation â€” no rebuild, no coding.', fr: 'CrÃ©ez, Ã©ditez et partagez une traduction complÃ¨te â€” sans recompilation, sans coder.' },
                keywords: 'translate language translation locale sandbox import traduire langue traduction',
                body: {
                    en: '<p>BMMâ€™s languages are plain JSON files in the appâ€™s <code>Lang/</code> folder â€” adding one requires <b>no rebuild</b>. Everything you need is in <b>Settings â†’ Language</b>: a <b>Guide</b>, a downloadable <b>template</b>, an <b>Import</b> button, and the <b>Translation Sandbox</b>.</p>'
                        + '<h4>The comfortable way: the Translation Sandbox</h4><ul><li><b>Create new language</b> â€” give it a code (e.g. <code>de</code>, <code>pt-br</code>) and optionally seed it from an existing language.</li><li>Translate key by key with a searchable list, a <b>progress bar</b>, a â€œ<b>next missing</b>â€ jump, and side-by-side reference from other languages.</li><li>Preview any string <b>live</b> â€” as a toast, a tooltip, or swapped into the real UI.</li><li><b>Pick from screen</b>: click any text in BMM to jump straight to its key; a scanner also finds hardcoded strings.</li><li>Edits auto-save to the sandbox (never the live app); <b>Export</b> downloads the finished JSON, then import it to make it live.</li></ul>'
                        + '<h4>Good to know</h4><ul><li>Keep the <code>_info</code> block (name + flag â€” itâ€™s what the language picker shows) and the <code>_synonyms</code> groups (they power semantic search in your language).</li><li><b>French is the base</b>: a key you havenâ€™t translated falls back to FR; a key missing everywhere shows its raw id â€” easy to spot.</li><li>Share your language as the JSON file, or via a <code>bmm://</code> import link. <code>en</code>, <code>fr</code> and the template canâ€™t be deleted.</li></ul>',
                    fr: '<p>Les langues de BMM sont de simples fichiers JSON dans le dossier <code>Lang/</code> de lâ€™app â€” en ajouter une ne demande <b>aucune recompilation</b>. Tout est dans <b>RÃ©glages â†’ Langue</b> : un <b>Guide</b>, un <b>modÃ¨le</b> tÃ©lÃ©chargeable, un bouton <b>Importer</b>, et le <b>Bac Ã  sable de traduction</b>.</p>'
                        + '<h4>La voie confortable : le Bac Ã  sable de traduction</h4><ul><li><b>CrÃ©er une nouvelle langue</b> â€” donnez-lui un code (ex. <code>de</code>, <code>pt-br</code>) et amorcez-la Ã©ventuellement depuis une langue existante.</li><li>Traduisez clÃ© par clÃ© avec une liste cherchable, une <b>barre de progression</b>, un saut Â« <b>prochaine manquante</b> Â», et la rÃ©fÃ©rence des autres langues cÃ´te Ã  cÃ´te.</li><li>PrÃ©visualisez chaque texte <b>en direct</b> â€” en toast, en infobulle, ou substituÃ© dans la vraie UI.</li><li><b>Choisir Ã  lâ€™Ã©cran</b> : cliquez nâ€™importe quel texte de BMM pour sauter Ã  sa clÃ© ; un scanner trouve aussi les textes en dur.</li><li>Les Ã©ditions sâ€™enregistrent dans le bac Ã  sable (jamais lâ€™app en direct) ; <b>Exporter</b> tÃ©lÃ©charge le JSON fini â€” importez-le ensuite pour lâ€™activer.</li></ul>'
                        + '<h4>Bon Ã  savoir</h4><ul><li>Conservez le bloc <code>_info</code> (nom + drapeau â€” câ€™est ce quâ€™affiche le sÃ©lecteur) et les groupes <code>_synonyms</code> (ils alimentent la recherche sÃ©mantique dans votre langue).</li><li><b>Le franÃ§ais est la base</b> : une clÃ© non traduite retombe sur le FR ; une clÃ© absente partout affiche son id brut â€” facile Ã  repÃ©rer.</li><li>Partagez votre langue en fichier JSON, ou via un lien dâ€™import <code>bmm://</code>. <code>en</code>, <code>fr</code> et le modÃ¨le ne peuvent pas Ãªtre supprimÃ©s.</li></ul>',
                },
            },
            {
                id: 'command-palette', docsPath: 'features/command-palette/', view: 'settings',
                title: { en: 'Command palette & shortcuts', fr: 'Palette de commandes et raccourcis' },
                summary: { en: 'Press Ctrl/âŒ˜+K to jump anywhere or run any action â€” and rebind every shortcut.', fr: 'Ctrl/âŒ˜+K pour aller partout ou lancer nâ€™importe quelle action â€” et rÃ©assignez chaque raccourci.' },
                keywords: 'palette command ctrl k shortcut keyboard search rebind raccourci clavier recherche',
                body: {
                    en: '<p>Press <kbd>Ctrl/âŒ˜ + K</kbd> anywhere in BMM to open the <b>command palette</b> â€” one search box over every page and action. Start typing, use â†‘/â†“ and <kbd>Enter</kbd> to run.</p>'
                        + '<h4>What it can reach</h4><ul><li><b>Go to</b> any screen â€” including your own <b>custom navbar pages</b> (they show up automatically, so a page you pinned yesterday is searchable today).</li><li><b>Run actions</b> across the app: add a mod, scan, verify integrity, create/import a profile, sync or host a server repo, generate a server, check for updates, open storage or hashing stats, and more.</li><li>Two search modes: <b>Classic</b> (literal match) and <b>Semantic</b>, which expands your words through synonyms so â€œupdateâ€ also finds â€œupgrade / new versionâ€.</li></ul>'
                        + '<h4>Rebind anything</h4><p>The same actions are listed in <b>Settings â†’ Keyboard shortcuts</b>, where you can record a new key combo, reset to default, or clear a shortcut. Custom nav pages appear here too, so you can bind a hotkey straight to one. Combos with a modifier (Ctrl/Shift/Alt) are recommended so they donâ€™t clash with typing.</p>',
                    fr: '<p>Appuyez sur <kbd>Ctrl/âŒ˜ + K</kbd> nâ€™importe oÃ¹ dans BMM pour ouvrir la <b>palette de commandes</b> â€” une seule barre de recherche sur toutes les pages et actions. Tapez, utilisez â†‘/â†“ et <kbd>EntrÃ©e</kbd> pour exÃ©cuter.</p>'
                        + '<h4>Ce quâ€™elle atteint</h4><ul><li><b>Aller Ã </b> nâ€™importe quel Ã©cran â€” y compris vos <b>pages de navbar personnalisÃ©es</b> (elles apparaissent automatiquement : une page Ã©pinglÃ©e hier est cherchable aujourdâ€™hui).</li><li><b>Lancer des actions</b> partout : ajouter un mod, scanner, vÃ©rifier lâ€™intÃ©gritÃ©, crÃ©er/importer un profil, synchroniser ou hÃ©berger un dÃ©pÃ´t serveur, gÃ©nÃ©rer un serveur, vÃ©rifier les mises Ã  jour, ouvrir le stockage ou les stats de hachage, etc.</li><li>Deux modes : <b>Classique</b> (correspondance littÃ©rale) et <b>SÃ©mantique</b>, qui Ã©tend vos mots via des synonymes â€” Â« mise Ã  jour Â» trouve aussi Â« upgrade / nouvelle version Â».</li></ul>'
                        + '<h4>Tout rÃ©assigner</h4><p>Les mÃªmes actions sont listÃ©es dans <b>RÃ©glages â†’ Raccourcis clavier</b>, oÃ¹ vous pouvez enregistrer une nouvelle combinaison, revenir au dÃ©faut, ou effacer un raccourci. Les pages perso y figurent aussi, vous pouvez donc en lier une Ã  une touche. Les combinaisons avec un modificateur (Ctrl/Maj/Alt) sont recommandÃ©es pour ne pas gÃªner la saisie.</p>',
                },
            },
            {
                id: 'integrations', docsPath: 'features/community/', diagram: 'discord-rpc',
                title: { en: 'Discord & integrations', fr: 'Discord et intÃ©grations' },
                summary: { en: 'Show what youâ€™re doing on Discord, and other optional hooks.', fr: 'Affichez votre activitÃ© sur Discord, et autres intÃ©grations optionnelles.' },
                keywords: 'discord rpc rich presence integration integrations intÃ©gration',
                body: {
                    en: '<p>BMM can display your current activity as <b>Discord rich presence</b> â€” updating as you switch profiles or work. Itâ€™s optional and off by default; turn it on in <b>Settings</b>. Only the activity text youâ€™d expect is ever sent.</p>',
                    fr: '<p>BMM peut afficher votre activitÃ© en cours en <b>rich presence Discord</b> â€” mise Ã  jour quand vous changez de profil ou travaillez. Câ€™est optionnel et dÃ©sactivÃ© par dÃ©faut ; activez-le dans les <b>RÃ©glages</b>. Seul le texte dâ€™activitÃ© attendu est envoyÃ©.</p>',
                },
            },
            {
                id: 'scheduler', view: 'settings', diagram: 'scheduler', docsPath: 'features/scheduler/',
                title: { en: 'Scheduling & automation', fr: 'Planification & automatisation' },
                summary: { en: 'A real automation builder â€” triggers, conditions, loops and ~60 actions.', fr: 'Un vrai constructeur dâ€™automatisations â€” dÃ©clencheurs, conditions, boucles et ~60 actions.' },
                keywords: 'scheduler cron automate task timer trigger loop condition bmmpa planificateur automatiser boucle',
                body: {
                    en: `The **Scheduler** turns BMM into an automation tool: a task pairs a **trigger** (when) with a **workflow** (what) â€” and workflows can branch, loop and wait, not just run a flat list.

:::steps
:::step[Pick a trigger]
Every N minutes/hours, daily/weekly/monthly at a time, once, on app start, or manual (you run it).
:::
:::step[Build the workflow]
Add actions (~60 â€” activate a profile, enable a modpack, sync a repo, benchmark a disk, launch an appâ€¦), plus **IF/ELSE**, **LOOP** and **WAIT UNTIL** blocks, with per-run variables so a measured value can drive a later branch.
:::
:::step[Let it run]
While BMM is open a timer fires due tasks. Hit :kbd[â–¶] **Run now** any time, or **Test run** the unsaved draft.
:::
:::

:::tip[Run even when BMM is closed]
Flip this and the task registers with your OS scheduler, so it fires on time whether or not BMM is open. Deleting it in BMM removes the OS task too.
:::

It can drive [Launch Packs](doc:launch-packs), your [storage](doc:storage-manager) limits and [benchmarks](doc:benchmarks). Share a whole set with **Export/Import .BMMPA** â€” imports arrive disabled and never register OS tasks on their own. Find it in **Settings â†’ Scheduler**.`,
                    fr: `Le **Planificateur** transforme BMM en outil dâ€™automatisation : une tÃ¢che associe un **dÃ©clencheur** (quand) Ã  un **workflow** (quoi) â€” et un workflow peut se ramifier, boucler et attendre, pas seulement dÃ©rouler une liste plate.

:::steps
:::step[Choisis un dÃ©clencheur]
Toutes les N minutes/heures, chaque jour/semaine/mois Ã  une heure, une fois, au dÃ©marrage de lâ€™app, ou manuel (tu le lances).
:::
:::step[Construis le workflow]
Ajoute des actions (~60 â€” activer un profil, appliquer un modpack, synchroniser un dÃ©pÃ´t, benchmarker un disque, lancer une appâ€¦), plus des blocs **SI/SINON**, **BOUCLE** et **ATTENDRE**, avec des variables par exÃ©cution pour quâ€™une valeur mesurÃ©e pilote une branche suivante.
:::
:::step[Laisse-le tourner]
Tant que BMM est ouvert, une minuterie dÃ©clenche les tÃ¢ches dues. Fais :kbd[â–¶] **Lancer maintenant** Ã  tout moment, ou **Test** sur le brouillon non enregistrÃ©.
:::
:::

:::tip[ExÃ©cuter mÃªme quand BMM est fermÃ©]
Active Ã§a et la tÃ¢che sâ€™enregistre auprÃ¨s du planificateur de lâ€™OS : elle part Ã  lâ€™heure, que BMM soit ouvert ou non. La supprimer dans BMM supprime aussi la tÃ¢che OS.
:::

Il peut piloter les [Launch Packs](doc:launch-packs), tes limites de [stockage](doc:storage-manager) et les [benchmarks](doc:benchmarks). Partage tout un jeu avec **Exporter/Importer .BMMPA** â€” les imports arrivent dÃ©sactivÃ©s et nâ€™enregistrent jamais de tÃ¢ches OS tout seuls. Dans **RÃ©glages â†’ Planificateur**.`,
                },
            },
            {
                id: 'actions-reference', view: 'plugins', docsPath: 'reference/actions/', wide: true,
                title: { en: 'Action reference', fr: 'RÃ©fÃ©rence des actions' },
                summary: { en: 'Every action the scheduler and the script generator can perform â€” the complete list.', fr: 'Toutes les actions du planificateur et du gÃ©nÃ©rateur de scripts â€” la liste complÃ¨te.' },
                keywords: 'action list catalogue scheduler script generator deeplink endpoint condition variable liste catalogue planificateur gÃ©nÃ©rateur',
                body: {
                    en: `BMM has **two action catalogues**. They overlap in capability but are separate systems â€” pick by *who runs it*.

| | Where | What it drives |
|---|---|---|
| **Scheduled-task actions** | Settings â†’ Scheduler | Steps inside a workflow BMM runs on a trigger |
| **Script generator actions** | Plugins & API â†’ script generator | Blocks that emit a runnable script (\`bmm://\` deeplinks and/or HTTP calls) |

:::tip[Which one do I want?]
Use the **scheduler** when BMM should do it *by itself*. Use the **script generator** when you want a script you can run from outside BMM â€” a batch file, another tool, a game launcher.
:::

## Part 1 â€” Scheduled-task actions

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
| Export a mod list (.mmlist) | Writes a mod list | â€” |
| Import a mod list (.mmlist) | Reads a mod list back | â€” |
| Enable all mods | Enables everything in the profile | â€” |
| Disable all mods | Disables everything in the profile | â€” |
| Scan mods folder | Re-scans for new mods | â€” |
| Apply plugin | Applies a plugin's mod list | plugin id |
| Compare plugin | Compares against a plugin's list | plugin id |
| Delete plugin | Uninstalls a plugin | plugin id |
| Check mod updates | Checks mods for new versions | â€” |
| Auto-import Open Mod Manager mods | Imports mods from an OMM setup | â€” |
| Clear profile activity history | Wipes the profile's history | profile |
| Export modpack (.bmp) | Writes a modpack file | modpack, destination |

:::warning[Enable actions skip the integrity check]
*Enable mod*, *Enable modpack* and *Enable all mods* run with the SHA check bypassed â€” a scheduled run can't stop to ask you about a missing hash. Enable by hand if you want the prompt.
:::

#### Repo & sharing

| Action | What it does | You provide |
|---|---|---|
| Connect repo | Adds a remote repo | repo.json URL, name |
| Sync repo | Downloads and integrates a remote profile | repo URL, remote profile |
| Generate repo | Opens repo generation | â€” |
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
| Apply disk speed limit | Sets a per-disk MB/s cap â€” empty uses the suggested value from a preceding benchmark, \`0\` = unlimited | â€” |
| Performance Auto-Calibration | Turns auto-calibration on/off | â€” |
| Smart I/O | Turns Smart I/O on/off | â€” |
| Toggle a setting (advanced) | Flips **any** boolean setting by key | â€” |
| Check free disk space | Reads free space | \`disk.free_gb\`, \`disk.total_gb\`, \`disk.free_percent\` |

Those captured values are what the \`value\` condition compares against â€” that's how you build *â€œbenchmark the disk, and if it's slower than 50 MB/s, warn meâ€*.

#### Privacy & recorder

| Action | What it does |
|---|---|
| Telemetry consent | Turns telemetry on/off |
| Telemetry options | Replay / **Full (unmasked)** / benchmark reporting |
| Session recorder | Record on/off, **Full (unmasked)**, Rust log, JS log |
| Export replay | Exports the current recording |
| Import replay | Loads a \`.bmmreplay\` from a path or URL |

:::danger[â€œFullâ€ means unmasked]
Normally replays mask mod names, profile names and paths as \`â€¢â€¢â€¢â€¢\`. The *Full* switches turn that masking **off**. Don't schedule it unless you know where the data goes.
:::

#### System & flow

| Action | What it does | Notes |
|---|---|---|
| Show notification | Toasts a message | |
| Discord Rich Presence | Turns Discord RPC on/off | |
| Export data (backup) | Writes a backup â€” the filename template supports \`{date}\`, \`{time}\`, \`{datetime}\` | the *overwrite* collision mode **replaces** an existing backup |
| Set a value | Sets a variable for later conditions | |
| Check for BMM update | Checks for a new version | captures \`update.available\` |
| Clear API log | Empties the API log | |
| Clear resource monitor records | Empties the resource records | |
| Run another scheduled task | Runs another task and waits | sets \`lasttask.ok\` (1/0) â€” **a task calling itself recurses** |
| Restart BMM | Restarts the app | ends the running task |
| Open a URL / link | Opens a link in your browser | |
| Run custom command | **Runs an arbitrary program** | requires *Allow custom commands* on the task |
| Run \`bmm://\` deeplink | Fires any deeplink | can reach any deeplink action |

#### Logic & maths

| Action | What it does |
|---|---|
| Compute into a variable | Arithmetic (\`+ - * / % ^\`, parentheses, variables, functions). A real parser â€” **no \`eval\`** |
| Ternary | \`var = condition ? a : b\` |
| Rule table | Walks rows, **first match wins**, writes the result into a variable |
| Stop the task (guard clause) | Ends the task **cleanly** â€” not an error |

#### Conditions

Used by **IF**, **WAIT UNTIL** and **LOOP**. Every condition has a **NOT** box.

| Condition | True when |
|---|---|
| \`always\` | Always â€” no gate |
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
| \`commandSucceeds\` | An external command exits \`0\` â€” note this **runs the program** just to evaluate the condition |

:::note[Missing data is false, not an error]
If a \`value\` condition names a variable that was never captured, it's simply false â€” it won't fire on missing data.
:::

**Capturable variables:** \`disk.read_mbps\`, \`disk.write_mbps\`, \`disk.suggested_limit\`, \`benchmark.mbps\`, \`benchmark.total_ms\`, \`lasttask.ok\`, \`disk.free_gb\`, \`disk.total_gb\`, \`disk.free_percent\`, \`update.available\`, plus any variable you set yourself.

## Part 2 â€” Script generator actions

Each block is either a **deeplink** (\`bmm://â€¦\`), an **HTTP call** to BMM's local API, or a **native** operation (a wait, a loop, a print) that needs no API at all.

:::note[Deeplink or HTTP?]
In deeplink mode, actions that have a native \`bmm://\` URL emit one; everything else falls back to an HTTP call â€” and an HTTP call needs an API token. Anything without a dedicated deeplink can still be reached through the generic passthrough \`bmm://api?method=<M>&path=<path>&<field>=<value>\`.
:::

#### Mods

| Action | Emits |
|---|---|
| Enable mod | \`bmm://mod/enable?id=\` Â· \`POST /api/mods/enable\` |
| Disable mod | \`bmm://mod/disable?id=\` Â· \`POST /api/mods/disable\` |
| Switch profile | \`bmm://profile/activate?id=\` Â· \`POST /api/profiles/activate\` |
| Enable modpack | \`bmm://modpack/enable?id=\` Â· \`POST /api/modpacks/enable\` |
| Disable modpack | \`bmm://modpack/disable?id=\` Â· \`POST /api/modpacks/disable\` |
| Apply plugin | \`bmm://plugin/activate?id=\` Â· \`POST /api/plugins/apply\` |
| Compare plugin | \`bmm://plugin/compare?id=\` Â· \`POST /api/plugins/compare\` |
| Update modpack | \`PUT /api/modpacks/{id}\` |
| Delete mod | \`DELETE /api/mods/{id}\` |
| Update mod | \`PUT /api/mods/{id}\` â€” name, version, author, description |
| Create profile | \`POST /api/profiles\` â€” name, game, the three folders |
| Update profile | \`PUT /api/profiles/{id}\` |
| Delete profile | \`DELETE /api/profiles/{id}\` |
| Create modpack | \`POST /api/modpacks/create\` |
| Delete modpack | \`DELETE /api/modpacks/{id}\` |
| Run benchmark | \`bmm://benchmark/run?â€¦\` Â· \`POST /api/benchmark\` |
| Check mod updates | \`bmm://mod/check-updates\` Â· \`POST /api/mod/check-updates\` |

#### Repo

| Action | Emits |
|---|---|
| Sync repo | \`POST /api/repo/sync\` â€” URL, folders, speed cap, **download password**, overwrite, *delete extra* |
| Cancel sync | \`DELETE /api/repo/sync/cancel\` |
| Generate repo | \`POST /api/repo/gen\` â€” profile, output, author, port, admin password, zip, auto-start |
| Cancel gen | \`DELETE /api/repo/gen/cancel\` |
| Start HTTP host | \`POST /api/repo/host\` â€” folder, port, upload cap |
| Stop HTTP host | \`DELETE /api/repo/host\` |
| Update repo | \`POST /api/repo/update\` |
| Connect repo | \`POST /api/repo/connect\` |
| Remove repo | \`DELETE /api/repo\` |

:::warning[â€œDelete extraâ€ removes local files]
On *Sync repo*, that switch makes the local copy match the remote exactly â€” anything extra on your side is deleted.
:::

#### Apps

| Action | Emits |
|---|---|
| Install app | \`POST /api/apps/install\` â€” id, title, URL, file type |
| Launch app | \`POST /api/apps/launch\` |
| List installed apps | \`GET /api/apps\` |
| Uninstall app | \`DELETE /api/apps/{appId}\` â€” deregisters, files stay on disk |

#### Read â€” all \`GET\`, no token needed, print JSON

\`GET /api/status\` Â· \`/api/mods\` Â· \`/api/mods/active\` Â· \`/api/mods/all\` Â· \`/api/profiles\` Â· \`/api/plugins\` Â· \`/api/modpacks\` Â· \`/api/check-update\` Â· \`/api/creator-id\` Â· \`/api/health\` Â· \`/api/repo/list\` Â· \`/api/repo/info?url=&password=\`

:::warning[Repo info puts the password in the query string]
*Repo info* passes the download password as a URL parameter. Don't paste the generated line into a shared log or a chat.
:::

#### System

| Action | Emits |
|---|---|
| Wait | native pause (seconds) |
| Kill process | native â€” **force-terminates** a process by name |
| Open URL | native shell open |
| Show message | native popup, waits for the user |
| Launch game | native â€” **runs an arbitrary executable** |
| Log line | native print |
| Restart BMM | \`POST /api/restart\` |
| Run launch pack | \`bmm://launchpack/run?id=\` Â· \`POST /api/launchpack/run\` |
| Discord Rich Presence | \`bmm://discord/rpc?enabled=\` Â· \`POST /api/discord/rpc\` |
| Export data (backup) | \`bmm://data/export-auto?â€¦\` Â· \`POST /api/data/export-auto\` |
| Telemetry consent | \`bmm://telemetry/consent?enabled=\` Â· \`POST /api/telemetry/consent\` |
| Telemetry options | \`bmm://telemetry/set?â€¦\` Â· \`POST /api/telemetry/settings\` |
| Session recorder | \`bmm://recorder/set?â€¦\` Â· \`POST /api/recorder\` |
| Export replay | \`bmm://replay/export\` Â· \`POST /api/replay/export\` |
| Import replay | \`bmm://replay/import?â€¦\` Â· \`POST /api/replay/import\` |

#### Control flow

| Action | What it does |
|---|---|
| Run scheduled task | \`bmm://schedule/run?id=\` Â· \`POST /api/schedule/run\` â€” bridges to the scheduler |
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
| Verify file (hash â†’ variable) | SHA-256 of a file into a variable |
| Wait until file exists | Polls until it appears, or times out |
| Math (compute â†’ variable) | Arithmetic into a variable |
| Ternary | Conditional assignment |
| Guard clause (stop ifâ€¦) | Exits when a condition holds |

:::note[The two catalogues are separate on purpose]
The scheduler has **real nested steps** (IF / LOOP / WAIT UNTIL blocks that contain other steps). The generator, producing flat text, uses **block markers** instead (\`Ifâ€¦\` / \`Else\` / \`End block\`). Some actions exist only on one side: the scheduler owns the storage actions, *Enable/Disable all*, *Scan*, *Set theme* and raw deeplinks; the generator owns the full CRUD and read endpoints, *Kill process*, *Raw code* and the textual control flow.
:::

See also [API & deeplinks](doc:api-reference), [Scheduling & automation](doc:scheduler) and [Plugins & API](doc:plugins).`,
                    fr: `BMM a **deux catalogues dâ€™actions**. Leurs capacitÃ©s se recoupent mais ce sont deux systÃ¨mes distincts â€” choisis selon *qui lâ€™exÃ©cute*.

| | OÃ¹ | Ce que Ã§a pilote |
|---|---|---|
| **Actions de tÃ¢che planifiÃ©e** | RÃ©glages â†’ Planificateur | Des Ã©tapes dâ€™un workflow que BMM exÃ©cute sur un dÃ©clencheur |
| **Actions du gÃ©nÃ©rateur de scripts** | Plugins & API â†’ gÃ©nÃ©rateur de scripts | Des blocs qui produisent un script exÃ©cutable (deeplinks \`bmm://\` et/ou appels HTTP) |

:::tip[Lequel je veux ?]
Le **planificateur** quand BMM doit le faire *tout seul*. Le **gÃ©nÃ©rateur de scripts** quand tu veux un script lanÃ§able hors de BMM â€” un fichier batch, un autre outil, un lanceur de jeu.
:::

## Partie 1 â€” Actions de tÃ¢che planifiÃ©e

RegroupÃ©es exactement comme dans le menu dÃ©roulant des actions.

#### Mods & profils

| Action | Ce que Ã§a fait | Tu fournis |
|---|---|---|
| Activer un profil | Change le profil actif | profil |
| Activer un mod | Active un mod | mod |
| DÃ©sactiver un mod | DÃ©sactive un mod | mod |
| Activer un modpack | Active tous les mods dâ€™un modpack | modpack |
| DÃ©sactiver un modpack | DÃ©sactive tous les mods dâ€™un modpack | modpack |
| CrÃ©er un modpack | CrÃ©e un modpack vide | nom, profil |
| Ajouter un mod (depuis une URL) | TÃ©lÃ©charge et installe un mod | URL, nom |
| Exporter une liste de mods (.mmlist) | Ã‰crit une liste de mods | â€” |
| Importer une liste de mods (.mmlist) | Relit une liste de mods | â€” |
| Activer tous les mods | Active tout dans le profil | â€” |
| DÃ©sactiver tous les mods | DÃ©sactive tout dans le profil | â€” |
| Scanner le dossier mods | Recherche les nouveaux mods | â€” |
| Appliquer un plugin | Applique la liste de mods dâ€™un plugin | id du plugin |
| Comparer un plugin | Compare avec la liste dâ€™un plugin | id du plugin |
| Supprimer un plugin | DÃ©sinstalle un plugin | id du plugin |
| VÃ©rifier les mises Ã  jour de mods | Cherche de nouvelles versions | â€” |
| Auto-importer les mods Open Mod Manager | Importe depuis une install OMM | â€” |
| Effacer lâ€™historique dâ€™activitÃ© du profil | Vide lâ€™historique du profil | profil |
| Exporter un modpack (.bmp) | Ã‰crit un fichier modpack | modpack, destination |

:::warning[Les actions dâ€™activation sautent le contrÃ´le dâ€™intÃ©gritÃ©]
*Activer un mod*, *Activer un modpack* et *Activer tous les mods* tournent avec le contrÃ´le SHA contournÃ© â€” une exÃ©cution planifiÃ©e ne peut pas sâ€™arrÃªter pour te parler dâ€™un hash manquant. Active Ã  la main si tu veux la question.
:::

#### DÃ©pÃ´t & partage

| Action | Ce que Ã§a fait | Tu fournis |
|---|---|---|
| Connecter un dÃ©pÃ´t | Ajoute un dÃ©pÃ´t distant | URL du repo.json, nom |
| Synchroniser un dÃ©pÃ´t | TÃ©lÃ©charge et intÃ¨gre un profil distant | URL du dÃ©pÃ´t, profil distant |
| GÃ©nÃ©rer un dÃ©pÃ´t | Ouvre la gÃ©nÃ©ration de dÃ©pÃ´t | â€” |
| Mettre Ã  jour un dÃ©pÃ´t | Met Ã  jour un dossier de dÃ©pÃ´t | dossier du dÃ©pÃ´t |
| HÃ©berger un dÃ©pÃ´t (HTTP) | **Sert un dossier en HTTP** | dossier, port |

#### Apps & lancement

| Action | Ce que Ã§a fait | Tu fournis |
|---|---|---|
| Lancer une app | DÃ©marre une app enregistrÃ©e | app (ou chemin de lâ€™exe) |
| Ouvrir / lancer un fichier ou programme | **ExÃ©cute nâ€™importe quel fichier**, \`.exe\` compris | chemin |
| Ouvrir un dossier | Ouvre un dossier dans lâ€™explorateur | chemin |
| Installer une app | TÃ©lÃ©charge et installe une app | id, URL, titre |
| ExÃ©cuter un launch pack | Lance un Launch Pack | launch pack |

#### Apparence

| Action | Ce que Ã§a fait | Tu fournis |
|---|---|---|
| DÃ©finir le thÃ¨me | Applique un thÃ¨me | thÃ¨me |

#### Benchmarks & stockage

| Action | Ce que Ã§a fait | Capture |
|---|---|---|
| Lancer un benchmark | Lance le benchmark de lâ€™app (jeu de donnÃ©es, taille S/M/L/XL ou Mo perso) | \`benchmark.mbps\`, \`benchmark.total_ms\` |
| Benchmarker un disque | Mesure la vitesse lecture/Ã©criture dâ€™un disque | \`disk.read_mbps\`, \`disk.write_mbps\`, \`disk.suggested_limit\` |
| Appliquer une limite de vitesse disque | Pose un plafond Mo/s par disque â€” vide = la valeur suggÃ©rÃ©e par un benchmark prÃ©cÃ©dent, \`0\` = illimitÃ© | â€” |
| Auto-calibration des performances | Active/dÃ©sactive lâ€™auto-calibration | â€” |
| Smart I/O | Active/dÃ©sactive Smart I/O | â€” |
| Basculer un rÃ©glage (avancÃ©) | Inverse **nâ€™importe quel** rÃ©glage boolÃ©en par clÃ© | â€” |
| VÃ©rifier lâ€™espace disque libre | Lit lâ€™espace libre | \`disk.free_gb\`, \`disk.total_gb\`, \`disk.free_percent\` |

Ces valeurs capturÃ©es sont ce que la condition \`value\` compare â€” câ€™est comme Ã§a quâ€™on construit *Â« benchmarke le disque, et sâ€™il est sous 50 Mo/s, prÃ©viens-moi Â»*.

#### ConfidentialitÃ© & enregistreur

| Action | Ce que Ã§a fait |
|---|---|
| Consentement tÃ©lÃ©mÃ©trie | Active/dÃ©sactive la tÃ©lÃ©mÃ©trie |
| Options de tÃ©lÃ©mÃ©trie | Replay / **Complet (dÃ©masquÃ©)** / rapport de benchmark |
| Enregistreur de session | Enregistrement on/off, **Complet (dÃ©masquÃ©)**, log Rust, log JS |
| Exporter le replay | Exporte lâ€™enregistrement courant |
| Importer un replay | Charge un \`.bmmreplay\` depuis un chemin ou une URL |

:::danger[Â« Complet Â» veut dire dÃ©masquÃ©]
Normalement les replays masquent noms de mods, noms de profils et chemins en \`â€¢â€¢â€¢â€¢\`. Les interrupteurs *Complet* **coupent** ce masquage. Ne le planifie pas sans savoir oÃ¹ vont les donnÃ©es.
:::

#### SystÃ¨me & flux

| Action | Ce que Ã§a fait | Notes |
|---|---|---|
| Afficher une notification | Affiche un toast | |
| Discord Rich Presence | Active/dÃ©sactive Discord RPC | |
| Exporter les donnÃ©es (sauvegarde) | Ã‰crit une sauvegarde â€” le modÃ¨le de nom accepte \`{date}\`, \`{time}\`, \`{datetime}\` | le mode de collision *Ã©craser* **remplace** une sauvegarde existante |
| DÃ©finir une valeur | Pose une variable pour les conditions suivantes | |
| VÃ©rifier les mises Ã  jour de BMM | Cherche une nouvelle version | capture \`update.available\` |
| Effacer le journal API | Vide le journal API | |
| Effacer les relevÃ©s du moniteur de ressources | Vide les relevÃ©s | |
| ExÃ©cuter une autre tÃ¢che planifiÃ©e | Lance une autre tÃ¢che et attend | pose \`lasttask.ok\` (1/0) â€” **une tÃ¢che qui sâ€™appelle elle-mÃªme rÃ©curse** |
| RedÃ©marrer BMM | RedÃ©marre lâ€™app | met fin Ã  la tÃ¢che en cours |
| Ouvrir une URL / un lien | Ouvre un lien dans le navigateur | |
| Lancer une commande personnalisÃ©e | **ExÃ©cute un programme arbitraire** | exige *Autoriser les commandes personnalisÃ©es* sur la tÃ¢che |
| ExÃ©cuter un deeplink \`bmm://\` | DÃ©clenche nâ€™importe quel deeplink | peut atteindre toute action deeplink |

#### Logique & maths

| Action | Ce que Ã§a fait |
|---|---|
| Calculer dans une variable | ArithmÃ©tique (\`+ - * / % ^\`, parenthÃ¨ses, variables, fonctions). Un vrai parseur â€” **pas dâ€™\`eval\`** |
| Ternaire | \`var = condition ? a : b\` |
| Table de rÃ¨gles | Parcourt les lignes, **la premiÃ¨re qui correspond gagne**, Ã©crit le rÃ©sultat dans une variable |
| ArrÃªter la tÃ¢che (garde) | Termine la tÃ¢che **proprement** â€” pas une erreur |

#### Conditions

UtilisÃ©es par **SI**, **ATTENDRE JUSQUâ€™Ã€** et **BOUCLE**. Chaque condition a une case **NON**.

| Condition | Vraie quand |
|---|---|
| \`always\` | Toujours â€” aucune barriÃ¨re |
| \`value\` | Un nombre capturÃ© se compare (\`>\` \`<\` \`>=\` \`<=\` \`==\` \`!=\`) Ã  ton seuil |
| \`profileActive\` | Un profil donnÃ© est lâ€™actif |
| \`modEnabled\` / \`modDisabled\` | Un mod donnÃ© est activÃ© / dÃ©sactivÃ© |
| \`modpackActive\` / \`modpackInactive\` | Tous les mods dâ€™un modpack sont on / off |
| \`allModsActive\` | Tout est activÃ© dans le profil actif |
| \`appRunning\` / \`appNotRunning\` | Un processus (par nom dâ€™exe) tourne / ne tourne pas |
| \`fileExists\` | Un chemin existe |
| \`fileHash\` | Le hash dâ€™un fichier (blake3/sha256) correspond |
| \`fileSize\` | La taille dâ€™un fichier se compare |
| \`fileType\` | Lâ€™extension dâ€™un fichier correspond |
| \`fileName\` | Un nom de fichier contient une sous-chaÃ®ne |
| \`fileNewer\` | Un fichier a Ã©tÃ© modifiÃ© dans les N derniÃ¨res minutes |
| \`online\` | Il y a une connexion Internet |
| \`timeReached\` | Lâ€™horloge a passÃ© une heure |
| \`dayOfWeek\` | Aujourdâ€™hui est lâ€™un des jours choisis |
| \`timeRange\` | Lâ€™horloge est dans une plage (**passe minuit**) |
| \`commandSucceeds\` | Une commande externe sort en \`0\` â€” note que Ã§a **exÃ©cute le programme** juste pour Ã©valuer la condition |

:::note[Une donnÃ©e absente est fausse, pas une erreur]
Si une condition \`value\` nomme une variable jamais capturÃ©e, elle est simplement fausse â€” elle ne se dÃ©clenchera pas sur une donnÃ©e manquante.
:::

**Variables capturables :** \`disk.read_mbps\`, \`disk.write_mbps\`, \`disk.suggested_limit\`, \`benchmark.mbps\`, \`benchmark.total_ms\`, \`lasttask.ok\`, \`disk.free_gb\`, \`disk.total_gb\`, \`disk.free_percent\`, \`update.available\`, plus toute variable que tu poses toi-mÃªme.

## Partie 2 â€” Actions du gÃ©nÃ©rateur de scripts

Chaque bloc est soit un **deeplink** (\`bmm://â€¦\`), soit un **appel HTTP** Ã  lâ€™API locale de BMM, soit une opÃ©ration **native** (une attente, une boucle, un affichage) qui nâ€™a besoin dâ€™aucune API.

:::note[Deeplink ou HTTP ?]
En mode deeplink, les actions qui ont une URL \`bmm://\` native en Ã©mettent une ; tout le reste retombe sur un appel HTTP â€” et un appel HTTP exige un token dâ€™API. Tout ce qui nâ€™a pas de deeplink dÃ©diÃ© reste atteignable via le passe-plat gÃ©nÃ©rique \`bmm://api?method=<M>&path=<chemin>&<champ>=<valeur>\`.
:::

#### Mods

| Action | Ã‰met |
|---|---|
| Activer un mod | \`bmm://mod/enable?id=\` Â· \`POST /api/mods/enable\` |
| DÃ©sactiver un mod | \`bmm://mod/disable?id=\` Â· \`POST /api/mods/disable\` |
| Changer de profil | \`bmm://profile/activate?id=\` Â· \`POST /api/profiles/activate\` |
| Activer un modpack | \`bmm://modpack/enable?id=\` Â· \`POST /api/modpacks/enable\` |
| DÃ©sactiver un modpack | \`bmm://modpack/disable?id=\` Â· \`POST /api/modpacks/disable\` |
| Appliquer un plugin | \`bmm://plugin/activate?id=\` Â· \`POST /api/plugins/apply\` |
| Comparer un plugin | \`bmm://plugin/compare?id=\` Â· \`POST /api/plugins/compare\` |
| Mettre Ã  jour un modpack | \`PUT /api/modpacks/{id}\` |
| Supprimer un mod | \`DELETE /api/mods/{id}\` |
| Mettre Ã  jour un mod | \`PUT /api/mods/{id}\` â€” nom, version, auteur, description |
| CrÃ©er un profil | \`POST /api/profiles\` â€” nom, jeu, les trois dossiers |
| Mettre Ã  jour un profil | \`PUT /api/profiles/{id}\` |
| Supprimer un profil | \`DELETE /api/profiles/{id}\` |
| CrÃ©er un modpack | \`POST /api/modpacks/create\` |
| Supprimer un modpack | \`DELETE /api/modpacks/{id}\` |
| Lancer un benchmark | \`bmm://benchmark/run?â€¦\` Â· \`POST /api/benchmark\` |
| VÃ©rifier les mises Ã  jour de mods | \`bmm://mod/check-updates\` Â· \`POST /api/mod/check-updates\` |

#### DÃ©pÃ´t

| Action | Ã‰met |
|---|---|
| Synchroniser un dÃ©pÃ´t | \`POST /api/repo/sync\` â€” URL, dossiers, plafond de vitesse, **mot de passe de tÃ©lÃ©chargement**, Ã©craser, *supprimer les extras* |
| Annuler la synchro | \`DELETE /api/repo/sync/cancel\` |
| GÃ©nÃ©rer un dÃ©pÃ´t | \`POST /api/repo/gen\` â€” profil, sortie, auteur, port, mot de passe admin, zip, dÃ©marrage auto |
| Annuler la gÃ©nÃ©ration | \`DELETE /api/repo/gen/cancel\` |
| DÃ©marrer lâ€™hÃ©bergement HTTP | \`POST /api/repo/host\` â€” dossier, port, plafond dâ€™upload |
| ArrÃªter lâ€™hÃ©bergement HTTP | \`DELETE /api/repo/host\` |
| Mettre Ã  jour un dÃ©pÃ´t | \`POST /api/repo/update\` |
| Connecter un dÃ©pÃ´t | \`POST /api/repo/connect\` |
| Retirer un dÃ©pÃ´t | \`DELETE /api/repo\` |

:::warning[Â« Supprimer les extras Â» efface des fichiers locaux]
Sur *Synchroniser un dÃ©pÃ´t*, cet interrupteur aligne exactement la copie locale sur le distant â€” tout ce qui est en trop chez toi est supprimÃ©.
:::

#### Apps

| Action | Ã‰met |
|---|---|
| Installer une app | \`POST /api/apps/install\` â€” id, titre, URL, type de fichier |
| Lancer une app | \`POST /api/apps/launch\` |
| Lister les apps installÃ©es | \`GET /api/apps\` |
| DÃ©sinstaller une app | \`DELETE /api/apps/{appId}\` â€” dÃ©senregistre, les fichiers restent sur le disque |

#### Lecture â€” tous en \`GET\`, sans token, affichent le JSON

\`GET /api/status\` Â· \`/api/mods\` Â· \`/api/mods/active\` Â· \`/api/mods/all\` Â· \`/api/profiles\` Â· \`/api/plugins\` Â· \`/api/modpacks\` Â· \`/api/check-update\` Â· \`/api/creator-id\` Â· \`/api/health\` Â· \`/api/repo/list\` Â· \`/api/repo/info?url=&password=\`

:::warning[Repo info met le mot de passe dans la query string]
*Repo info* passe le mot de passe de tÃ©lÃ©chargement en paramÃ¨tre dâ€™URL. Ne colle pas la ligne gÃ©nÃ©rÃ©e dans un journal partagÃ© ou un chat.
:::

#### SystÃ¨me

| Action | Ã‰met |
|---|---|
| Attendre | pause native (secondes) |
| Tuer un processus | natif â€” **termine de force** un processus par nom |
| Ouvrir une URL | ouverture shell native |
| Afficher un message | popup native, attend lâ€™utilisateur |
| Lancer le jeu | natif â€” **exÃ©cute un exÃ©cutable arbitraire** |
| Ã‰crire une ligne de log | affichage natif |
| RedÃ©marrer BMM | \`POST /api/restart\` |
| ExÃ©cuter un launch pack | \`bmm://launchpack/run?id=\` Â· \`POST /api/launchpack/run\` |
| Discord Rich Presence | \`bmm://discord/rpc?enabled=\` Â· \`POST /api/discord/rpc\` |
| Exporter les donnÃ©es (sauvegarde) | \`bmm://data/export-auto?â€¦\` Â· \`POST /api/data/export-auto\` |
| Consentement tÃ©lÃ©mÃ©trie | \`bmm://telemetry/consent?enabled=\` Â· \`POST /api/telemetry/consent\` |
| Options de tÃ©lÃ©mÃ©trie | \`bmm://telemetry/set?â€¦\` Â· \`POST /api/telemetry/settings\` |
| Enregistreur de session | \`bmm://recorder/set?â€¦\` Â· \`POST /api/recorder\` |
| Exporter le replay | \`bmm://replay/export\` Â· \`POST /api/replay/export\` |
| Importer un replay | \`bmm://replay/import?â€¦\` Â· \`POST /api/replay/import\` |

#### ContrÃ´le de flux

| Action | Ce que Ã§a fait |
|---|---|
| ExÃ©cuter une tÃ¢che planifiÃ©e | \`bmm://schedule/run?id=\` Â· \`POST /api/schedule/run\` â€” passerelle vers le planificateur |
| Commentaire | Une ligne de commentaire ; nâ€™exÃ©cute rien |
| DÃ©finir une variable | Assigne une variable |
| Si le fichier existe / est absent | Ouvre un bloc conditionnel |
| Si variable == / != | Ouvre un bloc conditionnel |
| Si lâ€™appel API rÃ©ussit / Ã©choue | **ExÃ©cute lâ€™appel API liÃ©**, puis branche sur son rÃ©sultat |
| Sinon | Lâ€™autre branche |
| Fin de bloc | Ferme un \`if\` / \`else\` |
| Pause (attendre une touche) | Attend une frappe |
| ArrÃªter le script | Sort immÃ©diatement |
| Code brut | InsÃ¨re du code verbatim dans le script gÃ©nÃ©rÃ© |
| Boucle (rÃ©pÃ©ter N fois) / Fin de boucle | Une boucle comptÃ©e |
| VÃ©rifier un fichier (hash â†’ variable) | Le SHA-256 dâ€™un fichier dans une variable |
| Attendre quâ€™un fichier existe | Interroge jusquâ€™Ã  ce quâ€™il apparaisse, ou expire |
| Maths (calcul â†’ variable) | ArithmÃ©tique dans une variable |
| Ternaire | Assignation conditionnelle |
| Garde (arrÃªter siâ€¦) | Sort quand une condition est vraie |

:::note[Les deux catalogues sont sÃ©parÃ©s exprÃ¨s]
Le planificateur a de **vraies Ã©tapes imbriquÃ©es** (des blocs SI / BOUCLE / ATTENDRE qui contiennent dâ€™autres Ã©tapes). Le gÃ©nÃ©rateur, qui produit du texte plat, utilise Ã  la place des **marqueurs de bloc** (\`Siâ€¦\` / \`Sinon\` / \`Fin de bloc\`). Certaines actions nâ€™existent que dâ€™un cÃ´tÃ© : le planificateur dÃ©tient les actions de stockage, *Activer/DÃ©sactiver tout*, *Scanner*, *DÃ©finir le thÃ¨me* et les deeplinks bruts ; le gÃ©nÃ©rateur dÃ©tient le CRUD complet et les endpoints de lecture, *Tuer un processus*, *Code brut* et le contrÃ´le de flux textuel.
:::

Voir aussi [API & deeplinks](doc:api-reference), [Planification & automatisation](doc:scheduler) et [Plugins & API](doc:plugins).`,
                },
            },
            {
                id: 'api-reference', view: 'plugins', docsPath: 'reference/api/', wide: true,
                title: { en: 'API & deeplink reference', fr: 'RÃ©fÃ©rence API & deeplinks' },
                summary: { en: 'Every bmm:// deeplink and every HTTP endpoint â€” the complete list.', fr: 'Chaque deeplink bmm:// et chaque endpoint HTTP â€” la liste complÃ¨te.' },
                keywords: 'api deeplink endpoint bmm:// token permission curl http port 51274 rest liste complÃ¨te endpoints',
                body: {
                    en: `Two ways to drive BMM from outside: **deeplinks** (\`bmm://â€¦\`, no token, fired at the running window) and a **local HTTP API** (token, \`127.0.0.1\` only).

:::tip[Which one?]
A deeplink is a URL â€” anything that can open a link can trigger it (a \`.bat\`, a shortcut, a website) and it needs no secret. The HTTP API is for reading data back and for payloads a URL cannot express. If a thing exists as both, prefer the deeplink.
:::

## Transport

| | |
|---|---|
| Base URL | \`http://127.0.0.1:51274\` |
| Bind address | **\`127.0.0.1\` only** â€” never \`0.0.0.0\`, so nothing off-machine can reach it |
| Port | \`51274\` by default; override with \`api_port\` in settings (\`0\` = the default). Needs a restart |
| Effective port | Read it at runtime from \`GET /api/health\` â†’ \`port\` |
| Rate limiting | **None.** Do not expose this port |

:::warning[If the port is already taken, the API does not start at all]
It does **not** fall back to another port. If something already holds 51274 â€” typically a zombie instance after an in-app restart â€” the API is **disabled for that whole session** and a line goes to the crash log. The app keeps working normally, so a script failing to connect is the only symptom. Check \`GET /api/health\` first.
:::

**CORS.** In a release build, origins are limited to \`https://tauri.localhost\`, \`tauri://localhost\`, \`http://tauri.localhost\`, \`https://bettercommunity.ch\`, plus anything you add under **CORS** on this page (a lone \`*\` entry opts into allow-any). The list is read **once when the API starts**. \`curl\` and deeplinks send no \`Origin\`, so none of this affects them.

## Authenticating

\`\`\`bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:51274/api/mods
\`\`\`

\`Authorization: Bearer â€¦\` is the only accepted form, and it is compared in **constant time**.

| | Where it comes from | Scope |
|---|---|---|
| **Admin token** | A UUID v4 minted on first run. Rotate it on this page | Everything. Bypasses all permission checks |
| **Plugin token** | Issued per plugin | Only what that plugin has been granted |

The token is re-read on **every** request, so rotating takes effect immediately â€” no restart. For a plugin token the caller's identity comes **from the token**, never from the \`X-BMM-Plugin-Id\` header, so a plugin cannot escalate by forging it. The ten grants: \`app.read\` Â· \`app.write\` Â· \`catalog.read\` Â· \`catalog.write\` Â· \`modpacks.write\` Â· \`mods.write\` Â· \`plugins.read\` Â· \`plugins.write\` Â· \`profiles.write\` Â· \`repo.write\`

:::note[Read endpoints are not permission-gated]
There is no \`mods.read\` / \`profiles.read\`. Routes marked *no token* below are open to anything that can reach the port; routes marked *token* accept **any** valid token, including a plugin token with no permissions at all.
:::

| Status | Body |
|---|---|
| \`401\` | invalid or missing token |
| \`403\` | the plugin lacks a permission â€” the message names it and the route that grants it |
| \`400\` | bad JSON body |
| \`404\` / \`405\` / \`500\` | \`{"error":"â€¦"}\` |

## Deeplinks

Fired at the running window â€” **no token**. \`*\` marks a required parameter. Each one shows a toast on receipt, and a global kill switch refuses all of them.

\`\`\`bat
start "" "bmm://mod/enable?id=my-mod-folder"
\`\`\`

#### Mods, profiles, modpacks

| Deeplink | Params | Does |
|---|---|---|
| \`bmm://mod/enable\` | \`id\`* | Enables a mod in the active profile |
| \`bmm://mod/disable\` | \`id\`* | Disables it |
| \`bmm://profile/activate\` | \`id\`* (profile UUID) | Switches the active profile |
| \`bmm://modpack/enable\` | \`id\`* | Enables every mod in a modpack â€” \`id\` accepts a **modpack or a profile** id |
| \`bmm://modpack/disable\` | \`id\`* | The inverse |
| \`bmm://modpack/create\` | \`name\`*, \`profile\` | Creates a modpack from a profile's active mods |
| \`bmm://install\` | \`url\`*, \`name\` | Downloads a mod and opens the install dialog |

#### Plugins, repo & updates

| Deeplink | Params | Does |
|---|---|---|
| \`bmm://plugin/activate\` | \`id\`* | Applies the plugin's modlist (and disables the rest if strict) |
| \`bmm://plugin/compare\` | \`id\`* | Opens the modlist-vs-active comparison |
| \`bmm://plugin/delete\` | \`id\`* | Uninstalls it â€” registry, permissions and files |
| \`bmm://repo/connect\` | \`url\`*, \`name\` | Registers a remote repo (the parent folder is enough) |
| \`bmm://repo/sync\` | \`url\`*, \`profile\`*, \`game_dir\`, \`mods_dir\`, \`backup_dir\`, \`local_profile\`, \`password\` | Opens sync pre-filled and starts the fetch |
| \`bmm://repo/gen\` | â€” | Opens the Generation section |
| \`bmm://repo/update\` | \`dir\` | Opens Update, pre-filled |
| \`bmm://repo/host\` | \`dir\`, \`port\` | Opens Hosting, pre-filled |
| \`bmm://mod/check-updates\` | â€” | Runs the update check |
| \`bmm://mod/update\` | \`url\` | Pre-fills the connection, or runs the check if omitted |

#### Apps, themes, language

| Deeplink | Params | Does |
|---|---|---|
| \`bmm://app/install\` | \`id\`*, \`url\`*, \`title\`, \`type\`, \`path\` | Downloads and installs an app |
| \`bmm://app/launch\` | \`id\`*, \`exe\`* | Launches an installed app |
| \`bmm://theme/apply\` | \`id\`* | Activates an installed theme |
| \`bmm://theme/import\` | \`url\`* | Downloads and installs a \`.bmmtheme.json\` |
| \`bmm://theme/editor\` | â€” | Opens the theme editor |
| \`bmm://language/import\` | \`path\` | Imports a translation \`.json\` (picker if omitted) |

#### Automation, privacy, misc

| Deeplink | Params | Does |
|---|---|---|
| \`bmm://schedule/run\` | \`id\`* | Runs a scheduled task â€” the hook the Windows Scheduler uses |
| \`bmm://launchpack/run\` | \`id\`* | Runs a Launch Pack |
| \`bmm://benchmark/run\` | \`dataset\`, \`size\`, \`mb\`, \`mode\`, \`sources\`, \`profiles\`, \`folders\` | Opens the benchmark pre-configured. **Auto-runs unless \`mode=manual\`** |
| \`bmm://telemetry/consent\` | \`enabled\`* | Global telemetry consent; declining also purges the local queue |
| \`bmm://telemetry/set\` | \`replay\`, \`full\`, \`bench\` | Sub-options. \`full\` means **unmasked** |
| \`bmm://recorder/set\` | \`on\`, \`full\`, \`rust\`, \`js\` | Configures the local session recorder |
| \`bmm://replay/export\` | â€” | Exports the session as \`.bmmreplay\` |
| \`bmm://replay/import\` | \`path\`, \`url\` | Imports and plays a \`.bmmreplay\` |
| \`bmm://discord/rpc\` | \`enabled\`* | Discord Rich Presence |
| \`bmm://data/export-auto\` | \`dir\`*, \`name\`, \`increment\` | Unattended backup. \`name\` takes \`{date}\` \`{time}\` \`{datetime}\`; \`increment\` is \`paren\`, \`underscore\`, \`timestamp\` or \`overwrite\` |
| \`bmm://settings/layout\` | \`code\`* | Applies a shared card layout |
| \`bmm://docs/open\` | \`article\` | Opens Help & other, optionally at an article id |
| \`bmm://restart\` | â€” | Restarts the app |

#### Also works â€” previously undocumented

Handled by the router but missing from the list above for a long time. They are real and supported; several are what the BetterCommunity website generates.

| Deeplink | Params | Does |
|---|---|---|
| \`bmm://catalog/app/install\` | \`url\`, \`name\`, \`type\` | One-click install from a catalog feed (no \`url\` â†’ opens Apps) |
| \`bmm://catalog/plugin/install\` | \`url\`, \`name\` | Same, for a plugin |
| \`bmm://catalog/theme/install\` | \`url\`, \`name\` | Same, for a theme (validated as JSON first) |
| \`bmm://catalog/app/add-source\` | \`url\`* | Subscribes to a community app catalog (asks first) |
| \`bmm://catalog/plugin/add-source\` | \`url\`* | Subscribes to a plugin catalog |
| \`bmm://catalog/theme/add-source\` | \`url\`* | Subscribes to a theme catalog |
| \`bmm://language/import-inline\` | \`data\`* (base64url), \`code\`, \`gz\` | A whole translation carried in the link; \`gz=1\` for gzipped |
| \`bmm://theme/import-inline\` | \`data\`* (base64 JSON) | Installs **and activates** a theme from the link |
| \`bmm://settings/navbar\` | \`code\`* | Applies a shared navbar layout |
| \`bmm://benchmark/open\` | as \`benchmark/run\` | Same handler, **inverted default** â€” only auto-runs when \`mode=auto\` |
| \`bmm://import\` Â· \`bmm://download\` | \`url\`*, \`name\` | Aliases of \`bmm://install\` |

**Undocumented aliases:** \`telemetry/consent\` and \`telemetry/set\` accept \`consent\` for \`enabled\` and \`replayFull\` for \`full\`; \`benchmark/run\` also reads \`folders\`, and splits lists on \`;\` **or** \`|\`.

**Which ones ask first** â€” safe to hand to a user, because they confirm before acting: \`repo/connect\`, \`language/import\` with a bare \`path\`, every \`catalog/*/add-source\`, \`bmm://api\` for any non-GET method, and the install / import / download flow. URL parameters on \`repo/connect\`, \`repo/sync\` and \`catalog/*/add-source\` are rejected unless they are \`http(s)\`.

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
**It cannot express nested data.** Parameters are flat, so endpoints taking an array or object â€” \`choices\`, \`mod_overrides\`, \`permissions\`, \`updateSources\`, \`addProfiles\` â€” need a real HTTP client.

**It never gives you the response body.** You get a success/status toast and nothing else, so it is useless for reading data back. Use the HTTP API for that.
:::

## Endpoints

**Auth** â€” \`â€”\` = no token Â· \`token\` = any valid token Â· a permission name = that grant is required (the admin token bypasses it). **DL** = has a dedicated deeplink.

#### Reading

| Method | Path | Auth | Returns |
|---|---|---|---|
| \`GET\` | \`/api/health\` | â€” | \`{ok, service, port}\` â€” the liveness probe, and how to learn the real port |
| \`GET\` | \`/api/status\` | â€” | App version, active profile, mod/profile/plugin counts |
| \`GET\` | \`/api/check-update\` | â€” | Latest GitHub release vs current: \`has_update\`, \`release_url\` |
| \`GET\` | \`/api/mods\` | â€” | Visible mods of the active profile |
| \`GET\` | \`/api/mods/active\` | â€” | Only the enabled ones |
| \`GET\` | \`/api/mods/all\` | â€” | Every mod of **every** profile, grouped, plus \`total_mods\` |
| \`GET\` | \`/api/profiles\` | â€” | All profiles with their mod lists |
| \`GET\` | \`/api/plugins\` | â€” | Installed plugins (manifest + \`enabled\`) |
| \`GET\` | \`/api/modpacks\` | â€” | All saved modpacks |
| \`GET\` | \`/api/creator-id\` | â€” | This install's creator id |
| \`GET\` | \`/api/repo/info\` | â€” | Fetches a remote \`repo.json\`. Query \`url\`*, \`password\`. \`401\` if protected, \`502\` if the remote fails |
| \`GET\` | \`/api/repo/list\` | â€” | Registered remote repos |
| \`GET\` | \`/api/language/template\` | â€” | \`lang-template.json\`, a flat \`{"key": "English"}\` map |
| \`GET\` | \`/api/data\` | token | **Full \`data.json\` dump** |
| \`GET\` | \`/api/apps\` | \`app.read\` | Apps installed through the catalog |
| \`GET\` | \`/api/apps/permissions\` | token | \`plugin_id â†’ [permissions]\` |
| \`GET\` | \`/api/apps/permissions/:id\` | token | One plugin's permissions |
| \`GET\` | \`/api/catalog\` | \`catalog.read\` | The local app catalog |

:::danger[GET /api/data is the whole database]
It returns everything, \`settings\` included â€” and \`settings\` holds the admin token and the plugin tokens. Any token that can call it can read the admin token and mint itself full access. Treat granting it as equivalent to handing over admin rights.
:::

#### Mods & profiles

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/mods/enable\` | \`mods.write\` | \`mod_id\`* | âœ“ |
| \`POST\` | \`/api/mods/disable\` | \`mods.write\` | \`mod_id\`* | âœ“ |
| \`PUT\` | \`/api/mods/:id\` | \`mods.write\` | \`name\`, \`version\`, \`author\`, \`description\`, \`tags[]\`, \`install_notes\` | |
| \`DELETE\` | \`/api/mods/:id\` | \`mods.write\` | â€” Â· removes the entry, **keeps the files** | |
| \`POST\` | \`/api/mod/config\` | \`mods.write\` | \`modId\`*, \`repoModId\`, \`updateUrl\`, \`directUrl\`, \`updateSources[]\` | |
| \`POST\` | \`/api/profiles\` | \`profiles.write\` | \`name\`*, \`game_path\`*, \`mods_path\`*, \`backup_path\`*, \`game_name\`, \`color\`, \`icon\` Â· **not** activated | |
| \`POST\` | \`/api/profiles/activate\` | \`profiles.write\` | \`profile_id\`* | âœ“ |
| \`PUT\` | \`/api/profiles/:id\` | \`profiles.write\` | \`name\`, \`color\`, \`icon\`, and the three paths | |
| \`DELETE\` | \`/api/profiles/:id\` | \`profiles.write\` | â€” Â· refuses the active profile | |

#### Modpacks & plugins

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/modpacks/create\` | \`modpacks.write\` | \`name\`*, \`mod_ids[]\`, \`source_profile_id\`, \`description\`, \`game_name\`, \`sr_link\`, \`multi_profile\`, \`skip_integrity_check\`, \`dependency_mode\`, \`mod_overrides[]\` â†’ \`201\` | âœ“ |
| \`POST\` | \`/api/modpacks/enable\` | \`modpacks.write\` | \`modpack_id\`* (legacy \`profile_id\` also accepted) | âœ“ |
| \`POST\` | \`/api/modpacks/disable\` | \`modpacks.write\` | idem | âœ“ |
| \`PUT\` | \`/api/modpacks/:id\` | \`modpacks.write\` | any of the create fields | |
| \`DELETE\` | \`/api/modpacks/:id\` | \`modpacks.write\` | â€” Â· irreversible, local mods kept | |
| \`POST\` | \`/api/plugins/compare\` | \`plugins.read\` | \`plugin_id\`* â†’ \`missing_required\`, \`strict_extra\` | âœ“ |
| \`POST\` | \`/api/plugins/apply\` | \`plugins.write\` | \`plugin_id\`*, \`force_strict\` â†’ \`enabled\`, \`not_found\` | âœ“ |
| \`DELETE\` | \`/api/plugins/:id\` | token | â€” Â· registry + permissions + files | âœ“ |

#### Server repo

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/repo/connect\` | \`repo.write\` | \`url\`*, \`name\` | âœ“ |
| \`DELETE\` | \`/api/repo\` | \`repo.write\` | \`url\`* Â· files kept | |
| \`POST\` | \`/api/repo/sync\` | \`repo.write\` | \`url\`*, \`choices[]\`*, \`gameDir\`, \`modsDir\`, \`backupDir\`, \`creatorId\`, \`password\`, \`overwriteAll\`, \`deleteExtra\`, \`downloadLimit\` â†’ \`202 {job_id}\`. **One at a time** (\`409\`) | âœ“ |
| \`DELETE\` | \`/api/repo/sync/cancel\` | token | â€” Â· stops at the next mod boundary | |
| \`POST\` | \`/api/repo/gen\` | \`repo.write\` | \`profileIds[]\`*, \`outputDir\`*, \`authorName\`*, \`seed\`, \`generateServer\`, \`port\`, \`uploadLimit\`, \`adminPassword\`, \`useCloudflare\`, \`useUpnp\`, \`autoStart\`, \`lang\`, \`serverVersion\` (number), \`serverType\` (\`std\`/\`lux\`), \`lightweight\`, \`zipOutput\`, \`useDocker\`, \`dockerOs\` â†’ \`202\` | âœ“ |
| \`DELETE\` | \`/api/repo/gen/cancel\` | token | â€” | |
| \`POST\` | \`/api/repo/update\` | token | \`repoDir\`*, \`authorName\`, \`removeModIds[]\`, \`removeProfileIds[]\`, \`addProfiles[]\`, \`modChangelogs{}\` â†’ \`202\` | âœ“ |
| \`POST\` | \`/api/repo/host\` | token | \`serveDir\`*, \`port\`, \`uploadLimit\` â†’ \`202\`, \`409\` if already serving | âœ“ |
| \`DELETE\` | \`/api/repo/host\` | token | â€” | |
| \`POST\` | \`/api/mod/check-updates\` | token | â€” â†’ \`202\` | âœ“ |
| \`POST\` | \`/api/mod/update\` | token | \`repoUrl\` â†’ \`202\` | âœ“ |

#### Apps & catalog

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/apps/install\` | \`app.write\` | \`appId\`*, \`appTitle\`*, \`downloadUrl\`*, \`fileType\`*, \`installPath\`, \`version\`, \`category\`, \`thumb\` â†’ \`202\` | âœ“ |
| \`POST\` | \`/api/apps/launch\` | \`app.write\` | \`appId\`*, \`exePath\`* | âœ“ |
| \`DELETE\` | \`/api/apps/:id\` | \`app.write\` | â€” Â· deregisters, files kept | |
| \`PUT\` | \`/api/apps/permissions/:id\` | token | \`permissions[]\`* Â· **replaces** the list; \`[]\` revokes everything | |
| \`POST\` | \`/api/catalog/new\` | \`catalog.write\` | \`name\`, \`description\`, \`partner_catalogs[]\`, \`community_imports[]\`, \`apps[]\` â†’ \`201\` | |
| \`POST\` | \`/api/catalog/apps\` | \`catalog.write\` | \`id\`*, \`title\`*, \`download\`* (\`url\`, \`file_type\`), \`description\`, \`category\`, \`price\`, \`tags\` (max 3), \`requirements\`, \`md_link\` â†’ \`201\` | |
| \`PUT\` | \`/api/catalog/apps/:id\` | \`catalog.write\` | \`title\`, \`description\`, \`version\`, \`category\`, \`download\` | |
| \`DELETE\` | \`/api/catalog/apps/:id\` | \`catalog.write\` | â€” | |

#### Import / export â€” these drive the UI

Each opens the matching in-app flow and returns \`202\`. They are **not** headless; the one exception is \`data/export-auto\`.

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/data/export\` Â· \`/api/data/import\` | token | â€” | |
| \`POST\` | \`/api/data/export-auto\` | token | \`dir\`*, \`name\`, \`increment\` Â· **unattended**, no dialog | âœ“ |
| \`POST\` | \`/api/modlists/export\` Â· \`/api/modlists/import\` | token | â€” Â· \`.mmlist\`, metadata only, no mod files | |
| \`POST\` | \`/api/modpacks/import\` | token | \`path\` | |
| \`POST\` | \`/api/modpacks/export\` | token | \`id\`*, \`destDir\` | |
| \`POST\` | \`/api/plugins/import\` | token | â€” | |
| \`POST\` | \`/api/plugins/export\` | token | \`id\`* â†’ \`.bmmplug\` | |
| \`POST\` | \`/api/language/import\` | token | \`path\` Â· the filename becomes the language code; \`template.json\` is refused | âœ“ |
| \`POST\` | \`/api/profiles/import/ovgme\` | token | â€” Â· scans the OvGME folder | |
| \`POST\` | \`/api/profiles/import/omm\` | token | â€” Â· OpenModManager \`.omm\`/\`.omx\` | |

#### Automation & privacy

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/schedule/run\` | token | \`id\`* | âœ“ |
| \`POST\` | \`/api/launchpack/run\` | token | \`id\`* | âœ“ |
| \`POST\` | \`/api/benchmark\` | token | \`dataset\`, \`size\`, \`mode\`, \`sources[]\`, \`profiles[]\` | âœ“ |
| \`POST\` | \`/api/telemetry/consent\` | token | \`enabled\`* | âœ“ |
| \`POST\` | \`/api/telemetry/settings\` | token | \`replay\`, \`full\`, \`bench\` | âœ“ |
| \`POST\` | \`/api/recorder\` | token | \`on\`, \`full\`, \`rust\`, \`js\` | âœ“ |
| \`POST\` | \`/api/replay/export\` | token | â€” | âœ“ |
| \`POST\` | \`/api/replay/import\` | token | \`path\`, \`url\` | âœ“ |
| \`POST\` | \`/api/discord/rpc\` | token | \`enabled\`* | âœ“ |
| \`POST\` | \`/api/restart\` | token | â€” Â· the API is briefly unavailable | âœ“ |

## Known inconsistencies

Recorded because this page and the server do not agree on every detail:

- **Permission gates are narrower than they look.** \`mod/check-updates\`, \`mod/update\`, \`repo/update\`, \`repo/host\` (both methods), both cancel routes, \`DELETE /api/plugins/:id\` and every \`/api/apps/permissions*\` route are **token-only** â€” a plugin token with zero permissions passes them.
- **\`POST /api/repo/gen\`** takes \`serverVersion\` (a number) **and** \`serverType\` (\`"std"\` / \`"lux"\`) â€” the string goes in \`serverType\`.
- **\`POST /api/repo/host\`** drives the native Server Repo UI and returns \`202\`, not \`200\`.
- **\`bmm://telemetry/settings\`** is **not routed** â€” only \`bmm://telemetry/set\` works.
- Error responses re-add \`access-control-allow-origin: *\` unconditionally, even in release.

Every \`/api/\` request emits an event carrying method, path and status â€” that is what produces the toasts and the API log on the Plugins & API page, so you can watch external calls arrive without instrumenting your own script.

See also [Action reference](doc:actions-reference) and [Plugins & API](doc:plugins).`,
                    fr: `Deux faÃ§ons de piloter BMM depuis lâ€™extÃ©rieur : les **deeplinks** (\`bmm://â€¦\`, sans token, envoyÃ©s Ã  la fenÃªtre en cours) et une **API HTTP locale** (token, \`127.0.0.1\` uniquement).

:::tip[Lequel choisir ?]
Un deeplink est une URL â€” tout ce qui sait ouvrir un lien peut le dÃ©clencher (un \`.bat\`, un raccourci, un site) et Ã§a ne demande aucun secret. Lâ€™API HTTP sert Ã  **relire** des donnÃ©es et Ã  envoyer des payloads quâ€™une URL ne peut pas exprimer. Si la chose existe sous les deux formes, prÃ©fÃ¨re le deeplink.
:::

## Transport

| | |
|---|---|
| URL de base | \`http://127.0.0.1:51274\` |
| Adresse dâ€™Ã©coute | **\`127.0.0.1\` uniquement** â€” jamais \`0.0.0.0\`, rien hors de la machine nâ€™y accÃ¨de |
| Port | \`51274\` par dÃ©faut ; surchargeable via \`api_port\` dans les rÃ©glages (\`0\` = le dÃ©faut). NÃ©cessite un redÃ©marrage |
| Port effectif | Ã€ lire Ã  lâ€™exÃ©cution sur \`GET /api/health\` â†’ \`port\` |
| Limitation de dÃ©bit | **Aucune.** Nâ€™expose pas ce port |

:::warning[Si le port est dÃ©jÃ  pris, lâ€™API ne dÃ©marre pas du tout]
Elle ne **bascule pas** sur un autre port. Si quelque chose occupe dÃ©jÃ  51274 â€” typiquement une instance zombie aprÃ¨s un redÃ©marrage in-app â€” lâ€™API est **dÃ©sactivÃ©e pour toute la session** et une ligne part dans le journal de crash. Lâ€™app continue de fonctionner normalement, donc le seul symptÃ´me est un script qui nâ€™arrive pas Ã  se connecter. Commence par \`GET /api/health\`.
:::

**CORS.** En build release, les origines sont limitÃ©es Ã  \`https://tauri.localhost\`, \`tauri://localhost\`, \`http://tauri.localhost\`, \`https://bettercommunity.ch\`, plus ce que tu ajoutes sous **CORS** sur cette page (une entrÃ©e \`*\` seule = tout autoriser). La liste est lue **une seule fois au dÃ©marrage de lâ€™API**. \`curl\` et les deeplinks nâ€™envoient pas dâ€™\`Origin\`, rien de tout Ã§a ne les concerne.

## Sâ€™authentifier

\`\`\`bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:51274/api/mods
\`\`\`

\`Authorization: Bearer â€¦\` est la seule forme acceptÃ©e, et la comparaison est faite en **temps constant**.

| | Dâ€™oÃ¹ il vient | PortÃ©e |
|---|---|---|
| **Token admin** | Un UUID v4 gÃ©nÃ©rÃ© au premier lancement. Rotation sur cette page | Tout. Contourne tous les contrÃ´les de permission |
| **Token plugin** | Ã‰mis par plugin | Uniquement ce qui a Ã©tÃ© accordÃ© Ã  ce plugin |

Le token est relu Ã  **chaque** requÃªte : une rotation prend effet immÃ©diatement, sans redÃ©marrage. Pour un token plugin, lâ€™identitÃ© de lâ€™appelant vient **du token**, jamais de lâ€™en-tÃªte \`X-BMM-Plugin-Id\` : un plugin ne peut donc pas sâ€™Ã©lever en le forgeant. Les dix droits : \`app.read\` Â· \`app.write\` Â· \`catalog.read\` Â· \`catalog.write\` Â· \`modpacks.write\` Â· \`mods.write\` Â· \`plugins.read\` Â· \`plugins.write\` Â· \`profiles.write\` Â· \`repo.write\`

:::note[Les endpoints de lecture ne sont pas soumis aux permissions]
Il nâ€™existe pas de \`mods.read\` / \`profiles.read\`. Les routes marquÃ©es *sans token* sont ouvertes Ã  tout ce qui atteint le port ; celles marquÃ©es *token* acceptent **nâ€™importe quel** token valide, y compris un token plugin sans aucune permission.
:::

| Statut | Corps |
|---|---|
| \`401\` | token invalide ou absent |
| \`403\` | le plugin manque dâ€™une permission â€” le message la nomme, ainsi que la route qui lâ€™accorde |
| \`400\` | corps JSON invalide |
| \`404\` / \`405\` / \`500\` | \`{"error":"â€¦"}\` |

## Deeplinks

EnvoyÃ©s Ã  la fenÃªtre en cours â€” **sans token**. \`*\` marque un paramÃ¨tre obligatoire. Chacun affiche un toast Ã  la rÃ©ception, et un coupe-circuit global les refuse tous.

\`\`\`bat
start "" "bmm://mod/enable?id=mon-dossier-de-mod"
\`\`\`

#### Mods, profils, modpacks

| Deeplink | Params | Effet |
|---|---|---|
| \`bmm://mod/enable\` | \`id\`* | Active un mod dans le profil actif |
| \`bmm://mod/disable\` | \`id\`* | Le dÃ©sactive |
| \`bmm://profile/activate\` | \`id\`* (UUID du profil) | Change le profil actif |
| \`bmm://modpack/enable\` | \`id\`* | Active tous les mods dâ€™un modpack â€” \`id\` accepte un id de **modpack ou de profil** |
| \`bmm://modpack/disable\` | \`id\`* | Lâ€™inverse |
| \`bmm://modpack/create\` | \`name\`*, \`profile\` | CrÃ©e un modpack depuis les mods actifs dâ€™un profil |
| \`bmm://install\` | \`url\`*, \`name\` | TÃ©lÃ©charge un mod et ouvre la boÃ®te dâ€™installation |

#### Plugins, dÃ©pÃ´t & mises Ã  jour

| Deeplink | Params | Effet |
|---|---|---|
| \`bmm://plugin/activate\` | \`id\`* | Applique la modlist du plugin (et dÃ©sactive le reste si strict) |
| \`bmm://plugin/compare\` | \`id\`* | Ouvre la comparaison modlist / mods actifs |
| \`bmm://plugin/delete\` | \`id\`* | Le dÃ©sinstalle â€” registre, permissions et fichiers |
| \`bmm://repo/connect\` | \`url\`*, \`name\` | Enregistre un dÃ©pÃ´t distant (le dossier parent suffit) |
| \`bmm://repo/sync\` | \`url\`*, \`profile\`*, \`game_dir\`, \`mods_dir\`, \`backup_dir\`, \`local_profile\`, \`password\` | Ouvre la synchro prÃ©-remplie et lance la rÃ©cupÃ©ration |
| \`bmm://repo/gen\` | â€” | Ouvre la section GÃ©nÃ©ration |
| \`bmm://repo/update\` | \`dir\` | Ouvre Mise Ã  jour, prÃ©-rempli |
| \`bmm://repo/host\` | \`dir\`, \`port\` | Ouvre HÃ©bergement, prÃ©-rempli |
| \`bmm://mod/check-updates\` | â€” | Lance la vÃ©rification des mises Ã  jour |
| \`bmm://mod/update\` | \`url\` | PrÃ©-remplit la connexion, ou lance la vÃ©rification si omis |

#### Apps, thÃ¨mes, langue

| Deeplink | Params | Effet |
|---|---|---|
| \`bmm://app/install\` | \`id\`*, \`url\`*, \`title\`, \`type\`, \`path\` | TÃ©lÃ©charge et installe une app |
| \`bmm://app/launch\` | \`id\`*, \`exe\`* | Lance une app installÃ©e |
| \`bmm://theme/apply\` | \`id\`* | Active un thÃ¨me installÃ© |
| \`bmm://theme/import\` | \`url\`* | TÃ©lÃ©charge et installe un \`.bmmtheme.json\` |
| \`bmm://theme/editor\` | â€” | Ouvre lâ€™Ã©diteur de thÃ¨me |
| \`bmm://language/import\` | \`path\` | Importe une traduction \`.json\` (sÃ©lecteur si omis) |

#### Automatisation, confidentialitÃ©, divers

| Deeplink | Params | Effet |
|---|---|---|
| \`bmm://schedule/run\` | \`id\`* | ExÃ©cute une tÃ¢che planifiÃ©e â€” le hook utilisÃ© par le Planificateur Windows |
| \`bmm://launchpack/run\` | \`id\`* | ExÃ©cute un Launch Pack |
| \`bmm://benchmark/run\` | \`dataset\`, \`size\`, \`mb\`, \`mode\`, \`sources\`, \`profiles\`, \`folders\` | Ouvre le benchmark prÃ©configurÃ©. **Se lance automatiquement sauf si \`mode=manual\`** |
| \`bmm://telemetry/consent\` | \`enabled\`* | Consentement tÃ©lÃ©mÃ©trie global ; refuser purge aussi la file locale |
| \`bmm://telemetry/set\` | \`replay\`, \`full\`, \`bench\` | Sous-options. \`full\` veut dire **non masquÃ©** |
| \`bmm://recorder/set\` | \`on\`, \`full\`, \`rust\`, \`js\` | Configure lâ€™enregistreur de session local |
| \`bmm://replay/export\` | â€” | Exporte la session en \`.bmmreplay\` |
| \`bmm://replay/import\` | \`path\`, \`url\` | Importe et joue un \`.bmmreplay\` |
| \`bmm://discord/rpc\` | \`enabled\`* | Discord Rich Presence |
| \`bmm://data/export-auto\` | \`dir\`*, \`name\`, \`increment\` | Sauvegarde sans intervention. \`name\` accepte \`{date}\` \`{time}\` \`{datetime}\` ; \`increment\` vaut \`paren\`, \`underscore\`, \`timestamp\` ou \`overwrite\` |
| \`bmm://settings/layout\` | \`code\`* | Applique une disposition de cartes partagÃ©e |
| \`bmm://docs/open\` | \`article\` | Ouvre Aide & autres, Ã©ventuellement sur un id dâ€™article |
| \`bmm://restart\` | â€” | RedÃ©marre lâ€™app |

#### Fonctionnent aussi â€” jusquâ€™ici non documentÃ©s

GÃ©rÃ©s par le routeur mais longtemps absents de la liste ci-dessus. Ils sont rÃ©els et supportÃ©s ; plusieurs sont ceux que gÃ©nÃ¨re le site BetterCommunity.

| Deeplink | Params | Effet |
|---|---|---|
| \`bmm://catalog/app/install\` | \`url\`, \`name\`, \`type\` | Installation en un clic depuis un flux de catalogue (sans \`url\` â†’ ouvre Apps) |
| \`bmm://catalog/plugin/install\` | \`url\`, \`name\` | Idem, pour un plugin |
| \`bmm://catalog/theme/install\` | \`url\`, \`name\` | Idem, pour un thÃ¨me (validÃ© comme JSON dâ€™abord) |
| \`bmm://catalog/app/add-source\` | \`url\`* | Sâ€™abonne Ã  un catalogue dâ€™apps communautaire (demande confirmation) |
| \`bmm://catalog/plugin/add-source\` | \`url\`* | Sâ€™abonne Ã  un catalogue de plugins |
| \`bmm://catalog/theme/add-source\` | \`url\`* | Sâ€™abonne Ã  un catalogue de thÃ¨mes |
| \`bmm://language/import-inline\` | \`data\`* (base64url), \`code\`, \`gz\` | Une traduction entiÃ¨re portÃ©e par le lien ; \`gz=1\` si gzippÃ©e |
| \`bmm://theme/import-inline\` | \`data\`* (JSON base64) | Installe **et active** un thÃ¨me depuis le lien |
| \`bmm://settings/navbar\` | \`code\`* | Applique une disposition de navbar partagÃ©e |
| \`bmm://benchmark/open\` | comme \`benchmark/run\` | MÃªme handler, **dÃ©faut inversÃ©** â€” ne se lance que si \`mode=auto\` |
| \`bmm://import\` Â· \`bmm://download\` | \`url\`*, \`name\` | Alias de \`bmm://install\` |

**Alias non documentÃ©s :** \`telemetry/consent\` et \`telemetry/set\` acceptent \`consent\` pour \`enabled\` et \`replayFull\` pour \`full\` ; \`benchmark/run\` lit aussi \`folders\`, et dÃ©coupe les listes sur \`;\` **ou** \`|\`.

**Lesquels demandent confirmation** â€” sÃ»rs Ã  donner Ã  un utilisateur, parce quâ€™ils confirment avant dâ€™agir : \`repo/connect\`, \`language/import\` avec un \`path\` nu, tous les \`catalog/*/add-source\`, \`bmm://api\` pour toute mÃ©thode autre que GET, et le flux install / import / download. Les paramÃ¨tres URL de \`repo/connect\`, \`repo/sync\` et \`catalog/*/add-source\` sont rejetÃ©s sâ€™ils ne sont pas en \`http(s)\`.

## Le passe-plat \`bmm://api\`

Tout endpoint sans deeplink dÃ©diÃ© reste atteignable :

\`\`\`
bmm://api?method=POST&path=/api/mods/enable&mod_id=mon-mod
\`\`\`

- \`method\` vaut \`GET\` par dÃ©faut ; \`path\` est **obligatoire et doit commencer par \`/api/\`**.
- Tous les autres paramÃ¨tres deviennent le payload : une query string pour \`GET\`/\`DELETE\`, un **corps JSON** sinon, avec \`"true"\` / \`"false"\` / les entiers convertis en vrais types.
- Le **token admin est attachÃ© automatiquement** : un lien passe-plat sâ€™exÃ©cute avec tous les droits.
- Toute mÃ©thode autre que \`GET\` **demande confirmation** dâ€™abord.

:::warning[Deux limites dures]
**Il ne peut pas exprimer de donnÃ©es imbriquÃ©es.** Les paramÃ¨tres sont plats, donc les endpoints qui prennent un tableau ou un objet â€” \`choices\`, \`mod_overrides\`, \`permissions\`, \`updateSources\`, \`addProfiles\` â€” exigent un vrai client HTTP.

**Il ne te rend jamais le corps de la rÃ©ponse.** Tu obtiens un toast succÃ¨s/statut et rien dâ€™autre : inutile pour relire des donnÃ©es. Passe par lâ€™API HTTP.
:::

## Endpoints

**Auth** â€” \`â€”\` = sans token Â· \`token\` = nâ€™importe quel token valide Â· un nom de permission = ce droit est requis (le token admin le contourne). **DL** = possÃ¨de un deeplink dÃ©diÃ©.

#### Lecture

| MÃ©thode | Chemin | Auth | Renvoie |
|---|---|---|---|
| \`GET\` | \`/api/health\` | â€” | \`{ok, service, port}\` â€” la sonde de vie, et le moyen de connaÃ®tre le vrai port |
| \`GET\` | \`/api/status\` | â€” | Version de lâ€™app, profil actif, nombre de mods/profils/plugins |
| \`GET\` | \`/api/check-update\` | â€” | DerniÃ¨re release GitHub vs actuelle : \`has_update\`, \`release_url\` |
| \`GET\` | \`/api/mods\` | â€” | Mods visibles du profil actif |
| \`GET\` | \`/api/mods/active\` | â€” | Uniquement les activÃ©s |
| \`GET\` | \`/api/mods/all\` | â€” | Tous les mods de **tous** les profils, groupÃ©s, plus \`total_mods\` |
| \`GET\` | \`/api/profiles\` | â€” | Tous les profils avec leurs listes de mods |
| \`GET\` | \`/api/plugins\` | â€” | Plugins installÃ©s (manifest + \`enabled\`) |
| \`GET\` | \`/api/modpacks\` | â€” | Tous les modpacks sauvegardÃ©s |
| \`GET\` | \`/api/creator-id\` | â€” | Lâ€™id crÃ©ateur de cette installation |
| \`GET\` | \`/api/repo/info\` | â€” | RÃ©cupÃ¨re un \`repo.json\` distant. Query \`url\`*, \`password\`. \`401\` si protÃ©gÃ©, \`502\` si le distant Ã©choue |
| \`GET\` | \`/api/repo/list\` | â€” | DÃ©pÃ´ts distants enregistrÃ©s |
| \`GET\` | \`/api/language/template\` | â€” | \`lang-template.json\`, une map plate \`{"clÃ©": "English"}\` |
| \`GET\` | \`/api/data\` | token | **Dump complet de \`data.json\`** |
| \`GET\` | \`/api/apps\` | \`app.read\` | Apps installÃ©es via le catalogue |
| \`GET\` | \`/api/apps/permissions\` | token | \`plugin_id â†’ [permissions]\` |
| \`GET\` | \`/api/apps/permissions/:id\` | token | Les permissions dâ€™un plugin |
| \`GET\` | \`/api/catalog\` | \`catalog.read\` | Le catalogue dâ€™apps local |

:::danger[GET /api/data câ€™est toute la base]
Il renvoie tout, \`settings\` inclus â€” et \`settings\` contient le token admin et les tokens de plugins. Nâ€™importe quel token capable de lâ€™appeler peut lire le token admin et se fabriquer un accÃ¨s total. Accorder cet endpoint Ã©quivaut Ã  cÃ©der les droits admin.
:::

#### Mods & profils

| MÃ©thode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/mods/enable\` | \`mods.write\` | \`mod_id\`* | âœ“ |
| \`POST\` | \`/api/mods/disable\` | \`mods.write\` | \`mod_id\`* | âœ“ |
| \`PUT\` | \`/api/mods/:id\` | \`mods.write\` | \`name\`, \`version\`, \`author\`, \`description\`, \`tags[]\`, \`install_notes\` | |
| \`DELETE\` | \`/api/mods/:id\` | \`mods.write\` | â€” Â· retire lâ€™entrÃ©e, **garde les fichiers** | |
| \`POST\` | \`/api/mod/config\` | \`mods.write\` | \`modId\`*, \`repoModId\`, \`updateUrl\`, \`directUrl\`, \`updateSources[]\` | |
| \`POST\` | \`/api/profiles\` | \`profiles.write\` | \`name\`*, \`game_path\`*, \`mods_path\`*, \`backup_path\`*, \`game_name\`, \`color\`, \`icon\` Â· **pas** activÃ© | |
| \`POST\` | \`/api/profiles/activate\` | \`profiles.write\` | \`profile_id\`* | âœ“ |
| \`PUT\` | \`/api/profiles/:id\` | \`profiles.write\` | \`name\`, \`color\`, \`icon\`, et les trois chemins | |
| \`DELETE\` | \`/api/profiles/:id\` | \`profiles.write\` | â€” Â· refuse le profil actif | |

#### Modpacks & plugins

| MÃ©thode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/modpacks/create\` | \`modpacks.write\` | \`name\`*, \`mod_ids[]\`, \`source_profile_id\`, \`description\`, \`game_name\`, \`sr_link\`, \`multi_profile\`, \`skip_integrity_check\`, \`dependency_mode\`, \`mod_overrides[]\` â†’ \`201\` | âœ“ |
| \`POST\` | \`/api/modpacks/enable\` | \`modpacks.write\` | \`modpack_id\`* (lâ€™ancien \`profile_id\` est aussi acceptÃ©) | âœ“ |
| \`POST\` | \`/api/modpacks/disable\` | \`modpacks.write\` | idem | âœ“ |
| \`PUT\` | \`/api/modpacks/:id\` | \`modpacks.write\` | nâ€™importe quel champ de crÃ©ation | |
| \`DELETE\` | \`/api/modpacks/:id\` | \`modpacks.write\` | â€” Â· irrÃ©versible, les mods locaux sont conservÃ©s | |
| \`POST\` | \`/api/plugins/compare\` | \`plugins.read\` | \`plugin_id\`* â†’ \`missing_required\`, \`strict_extra\` | âœ“ |
| \`POST\` | \`/api/plugins/apply\` | \`plugins.write\` | \`plugin_id\`*, \`force_strict\` â†’ \`enabled\`, \`not_found\` | âœ“ |
| \`DELETE\` | \`/api/plugins/:id\` | token | â€” Â· registre + permissions + fichiers | âœ“ |

#### DÃ©pÃ´t serveur

| MÃ©thode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/repo/connect\` | \`repo.write\` | \`url\`*, \`name\` | âœ“ |
| \`DELETE\` | \`/api/repo\` | \`repo.write\` | \`url\`* Â· fichiers conservÃ©s | |
| \`POST\` | \`/api/repo/sync\` | \`repo.write\` | \`url\`*, \`choices[]\`*, \`gameDir\`, \`modsDir\`, \`backupDir\`, \`creatorId\`, \`password\`, \`overwriteAll\`, \`deleteExtra\`, \`downloadLimit\` â†’ \`202 {job_id}\`. **Un seul Ã  la fois** (\`409\`) | âœ“ |
| \`DELETE\` | \`/api/repo/sync/cancel\` | token | â€” Â· sâ€™arrÃªte Ã  la prochaine frontiÃ¨re de mod | |
| \`POST\` | \`/api/repo/gen\` | \`repo.write\` | \`profileIds[]\`*, \`outputDir\`*, \`authorName\`*, \`seed\`, \`generateServer\`, \`port\`, \`uploadLimit\`, \`adminPassword\`, \`useCloudflare\`, \`useUpnp\`, \`autoStart\`, \`lang\`, \`serverVersion\` (nombre), \`serverType\` (\`std\`/\`lux\`), \`lightweight\`, \`zipOutput\`, \`useDocker\`, \`dockerOs\` â†’ \`202\` | âœ“ |
| \`DELETE\` | \`/api/repo/gen/cancel\` | token | â€” | |
| \`POST\` | \`/api/repo/update\` | token | \`repoDir\`*, \`authorName\`, \`removeModIds[]\`, \`removeProfileIds[]\`, \`addProfiles[]\`, \`modChangelogs{}\` â†’ \`202\` | âœ“ |
| \`POST\` | \`/api/repo/host\` | token | \`serveDir\`*, \`port\`, \`uploadLimit\` â†’ \`202\`, \`409\` si dÃ©jÃ  en service | âœ“ |
| \`DELETE\` | \`/api/repo/host\` | token | â€” | |
| \`POST\` | \`/api/mod/check-updates\` | token | â€” â†’ \`202\` | âœ“ |
| \`POST\` | \`/api/mod/update\` | token | \`repoUrl\` â†’ \`202\` | âœ“ |

#### Apps & catalogue

| MÃ©thode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/apps/install\` | \`app.write\` | \`appId\`*, \`appTitle\`*, \`downloadUrl\`*, \`fileType\`*, \`installPath\`, \`version\`, \`category\`, \`thumb\` â†’ \`202\` | âœ“ |
| \`POST\` | \`/api/apps/launch\` | \`app.write\` | \`appId\`*, \`exePath\`* | âœ“ |
| \`DELETE\` | \`/api/apps/:id\` | \`app.write\` | â€” Â· dÃ©senregistre, fichiers conservÃ©s | |
| \`PUT\` | \`/api/apps/permissions/:id\` | token | \`permissions[]\`* Â· **remplace** la liste ; \`[]\` rÃ©voque tout | |
| \`POST\` | \`/api/catalog/new\` | \`catalog.write\` | \`name\`, \`description\`, \`partner_catalogs[]\`, \`community_imports[]\`, \`apps[]\` â†’ \`201\` | |
| \`POST\` | \`/api/catalog/apps\` | \`catalog.write\` | \`id\`*, \`title\`*, \`download\`* (\`url\`, \`file_type\`), \`description\`, \`category\`, \`price\`, \`tags\` (3 max), \`requirements\`, \`md_link\` â†’ \`201\` | |
| \`PUT\` | \`/api/catalog/apps/:id\` | \`catalog.write\` | \`title\`, \`description\`, \`version\`, \`category\`, \`download\` | |
| \`DELETE\` | \`/api/catalog/apps/:id\` | \`catalog.write\` | â€” | |

#### Import / export â€” ceux-ci pilotent lâ€™interface

Chacun ouvre le flux in-app correspondant et renvoie \`202\`. Ils ne sont **pas** headless ; la seule exception est \`data/export-auto\`.

| MÃ©thode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/data/export\` Â· \`/api/data/import\` | token | â€” | |
| \`POST\` | \`/api/data/export-auto\` | token | \`dir\`*, \`name\`, \`increment\` Â· **sans intervention**, aucune boÃ®te de dialogue | âœ“ |
| \`POST\` | \`/api/modlists/export\` Â· \`/api/modlists/import\` | token | â€” Â· \`.mmlist\`, mÃ©tadonnÃ©es seules, aucun fichier de mod | |
| \`POST\` | \`/api/modpacks/import\` | token | \`path\` | |
| \`POST\` | \`/api/modpacks/export\` | token | \`id\`*, \`destDir\` | |
| \`POST\` | \`/api/plugins/import\` | token | â€” | |
| \`POST\` | \`/api/plugins/export\` | token | \`id\`* â†’ \`.bmmplug\` | |
| \`POST\` | \`/api/language/import\` | token | \`path\` Â· le nom de fichier devient le code de langue ; \`template.json\` est refusÃ© | âœ“ |
| \`POST\` | \`/api/profiles/import/ovgme\` | token | â€” Â· scanne le dossier OvGME | |
| \`POST\` | \`/api/profiles/import/omm\` | token | â€” Â· OpenModManager \`.omm\`/\`.omx\` | |

#### Automatisation & confidentialitÃ©

| MÃ©thode | Chemin | Auth | Corps | DL |
|---|---|---|---|---|
| \`POST\` | \`/api/schedule/run\` | token | \`id\`* | âœ“ |
| \`POST\` | \`/api/launchpack/run\` | token | \`id\`* | âœ“ |
| \`POST\` | \`/api/benchmark\` | token | \`dataset\`, \`size\`, \`mode\`, \`sources[]\`, \`profiles[]\` | âœ“ |
| \`POST\` | \`/api/telemetry/consent\` | token | \`enabled\`* | âœ“ |
| \`POST\` | \`/api/telemetry/settings\` | token | \`replay\`, \`full\`, \`bench\` | âœ“ |
| \`POST\` | \`/api/recorder\` | token | \`on\`, \`full\`, \`rust\`, \`js\` | âœ“ |
| \`POST\` | \`/api/replay/export\` | token | â€” | âœ“ |
| \`POST\` | \`/api/replay/import\` | token | \`path\`, \`url\` | âœ“ |
| \`POST\` | \`/api/discord/rpc\` | token | \`enabled\`* | âœ“ |
| \`POST\` | \`/api/restart\` | token | â€” Â· lâ€™API est briÃ¨vement indisponible | âœ“ |

## IncohÃ©rences connues

ConsignÃ©es parce que cette page et le serveur ne sâ€™accordent pas sur tous les dÃ©tails :

- **Les barriÃ¨res de permission sont plus Ã©troites quâ€™elles nâ€™y paraissent.** \`mod/check-updates\`, \`mod/update\`, \`repo/update\`, \`repo/host\` (les deux mÃ©thodes), les deux routes dâ€™annulation, \`DELETE /api/plugins/:id\` et toutes les routes \`/api/apps/permissions*\` sont **token seul** â€” un token plugin sans aucune permission y passe.
- **\`POST /api/repo/gen\`** prend \`serverVersion\` (un nombre) **et** \`serverType\` (\`"std"\` / \`"lux"\`) â€” la chaÃ®ne va dans \`serverType\`.
- **\`POST /api/repo/host\`** pilote lâ€™UI native DÃ©pÃ´t Serveur et renvoie \`202\`, pas \`200\`.
- **\`bmm://telemetry/settings\`** nâ€™est **pas routÃ©** â€” seul \`bmm://telemetry/set\` fonctionne.
- Les rÃ©ponses dâ€™erreur rajoutent \`access-control-allow-origin: *\` sans condition, mÃªme en release.

Chaque requÃªte \`/api/\` Ã©met un Ã©vÃ©nement portant la mÃ©thode, le chemin et le statut â€” câ€™est ce qui produit les toasts et le journal API de la page Plugins & API : tu peux donc voir arriver les appels externes sans instrumenter ton propre script.

Voir aussi [RÃ©fÃ©rence des actions](doc:actions-reference) et [Plugins & API](doc:plugins).`,
                },
            },
            {
                id: 'benchmarks', docsPath: 'how-it-works/performance/', view: 'settings', diagram: 'blake3-hashing',
                title: { en: 'Benchmarks & performance', fr: 'Benchmarks et performances' },
                summary: { en: 'Measure how fast BMM scans, hashes and deploys on your machine.', fr: 'Mesurez la vitesse de scan, de hachage et de dÃ©ploiement sur votre machine.' },
                keywords: 'benchmark performance speed hash blake3 measure performances vitesse',
                body: {
                    en: '<p>The built-in benchmark suite measures the three things BMM does most â€” <b>scanning</b> a folder, <b>hashing</b> file content (BLAKE3), and <b>copying / deploying</b> â€” and reports throughput for your actual disk and CPU.</p><ul><li>Run it to compare drives (an SSD vs. a network share), or to sanity-check a sync that felt slow.</li><li>Results stay local â€” nothing is uploaded.</li><li>Find it in <b>Settings</b>; for the internals, see <b>Developer â†’ BLAKE3 hashing</b>.</li></ul>',
                    fr: '<p>La suite de benchmarks intÃ©grÃ©e mesure les trois opÃ©rations que BMM fait le plus â€” <b>scanner</b> un dossier, <b>hacher</b> le contenu (BLAKE3) et <b>copier / dÃ©ployer</b> â€” et rapporte le dÃ©bit pour votre disque et votre CPU rÃ©els.</p><ul><li>Lancez-la pour comparer des disques (un SSD contre un partage rÃ©seau), ou vÃ©rifier une synchro qui a semblÃ© lente.</li><li>Les rÃ©sultats restent locaux â€” rien nâ€™est envoyÃ©.</li><li>Trouvez-la dans les <b>RÃ©glages</b> ; pour les dÃ©tails, voir <b>DÃ©veloppeur â†’ Hachage BLAKE3</b>.</li></ul>',
                },
            },
            {
                id: 'storage-manager', view: 'settings', docsPath: 'features/storage/',
                title: { en: 'Storage & disk I/O', fr: 'Stockage & E/S disque' },
                summary: { en: 'Per-disk speed limits, space alerts, and Smart I/O.', fr: 'Limites de vitesse par disque, alertes dâ€™espace, et Smart I/O.' },
                keywords: 'storage disk io space cache ssd hdd throttle smart limit stockage disque espace',
                body: {
                    en: `The **Storage Manager** (**Settings â†’ Storage**) shows every disk with a live space breakdown, and controls how hard BMM pushes your drives.

:::tip[Smart I/O â€” the one to know]
On by default: mod copies use a bounded thread pool with tiny yields so the interface stays smooth. Turn it **off** to saturate every CPU core for maximum speed.
:::

- **Per-disk speed limit** in MB/s (\`0\` = unlimited) â€” stop a slow HDD or a cloud drive from lagging the whole machine during a big copy.
- **Benchmark a disk** â†’ read/write MB/s plus a suggested limit you can apply in one click.
- **Auto Performance Calibration** benchmarks the disks your profiles use and sets sensible limits for you.
- **Low-space alerts** with warning/critical thresholds colour the per-disk bars before a drive fills.

:::tip[Archived mods save space]
A \`.zip\` / \`.7z\` / \`.rar\` mod stays compressed in your mods folder; BMM extracts it to a temp cache only when needed. There's no "clear cache" button â€” the OS manages temp.
:::

Automate it from the [Scheduler](doc:scheduler): benchmark a disk, apply a limit, or check free space and branch on the result.`,
                    fr: `Le **Gestionnaire de Stockage** (**RÃ©glages â†’ Stockage**) montre chaque disque avec une rÃ©partition dâ€™espace en direct, et contrÃ´le jusquâ€™oÃ¹ BMM sollicite tes disques.

:::tip[Smart I/O â€” celui Ã  connaÃ®tre]
ActivÃ© par dÃ©faut : les copies de mods utilisent un pool de threads bornÃ© avec de petites pauses pour garder lâ€™interface fluide. DÃ©sactive-le pour saturer tous les cÅ“urs CPU et une vitesse maximale.
:::

- **Limite de vitesse par disque** en Mo/s (\`0\` = illimitÃ©) â€” empÃªche un HDD lent ou un disque cloud de ralentir toute la machine pendant une grosse copie.
- **Benchmarker un disque** â†’ Mo/s lecture/Ã©criture plus une limite suggÃ©rÃ©e applicable en un clic.
- **Auto-calibration des performances** benchmarke les disques de tes profils et te fixe des limites raisonnables.
- **Alertes dâ€™espace faible** avec seuils avertissement/critique qui colorent les barres par disque avant saturation.

:::tip[Les mods archivÃ©s Ã©conomisent de la place]
Un mod \`.zip\` / \`.7z\` / \`.rar\` reste compressÃ© dans ton dossier de mods ; BMM ne lâ€™extrait dans un cache temporaire quâ€™au besoin. Pas de bouton Â« vider le cache Â» â€” lâ€™OS gÃ¨re le temp.
:::

Automatise-le depuis le [Planificateur](doc:scheduler) : benchmarke un disque, applique une limite, ou vÃ©rifie lâ€™espace libre et branche sur le rÃ©sultat.`,
                },
            },
            {
                id: 'offline', docsPath: 'features/privacy-telemetry/', diagram: 'offline-mode',
                title: { en: 'Offline mode', fr: 'Mode hors ligne' },
                summary: { en: 'No connection? BMM pauses online features and keeps everything local working.', fr: 'Pas de connexion ? BMM met en pause les fonctions en ligne et garde tout le local fonctionnel.' },
                keywords: 'offline connection internet network banner hors ligne connexion rÃ©seau',
                body: {
                    en: '<p>BMM doesnâ€™t just trust the OS â€œconnectedâ€ flag â€” that only says a network interface exists. It <b>probes</b> two lightweight endpoints; if neither answers within 5 seconds, youâ€™re offline.</p><ul><li>A discreet <b>â€œno connectionâ€ banner</b> appears, and network features (repo syncs, catalogs, update checks) pause with a warning toast instead of failing cryptically.</li><li><b>Everything local keeps working</b> â€” your library, profiles, activation, the mapper, themes. Nothing is removed.</li><li>Recovery is automatic: while offline BMM re-probes every <b>15 seconds</b>, and the banner slides away the moment a probe answers. Online, a 2-minute re-check catches connections that died silently.</li></ul>',
                    fr: '<p>BMM ne se fie pas au simple drapeau Â« connectÃ© Â» de lâ€™OS â€” il dit seulement quâ€™une interface rÃ©seau existe. Il <b>sonde</b> deux endpoints lÃ©gers ; si aucun ne rÃ©pond sous 5 secondes, vous Ãªtes hors ligne.</p><ul><li>Un <b>bandeau Â« pas de connexion Â»</b> discret apparaÃ®t, et les fonctions rÃ©seau (synchros de dÃ©pÃ´ts, catalogues, vÃ©rifs de mise Ã  jour) se mettent en pause avec un toast dâ€™avertissement au lieu dâ€™Ã©chouer cryptiquement.</li><li><b>Tout le local continue de fonctionner</b> â€” bibliothÃ¨que, profils, activation, mapper, thÃ¨mes. Rien nâ€™est retirÃ©.</li><li>La reprise est automatique : hors ligne, BMM re-sonde toutes les <b>15 secondes</b>, et le bandeau disparaÃ®t dÃ¨s quâ€™une sonde rÃ©pond. En ligne, une re-vÃ©rification toutes les 2 minutes attrape les connexions mortes en silence.</li></ul>',
                },
            },
            {
                id: 'privacy-telemetry', view: 'settings', diagram: 'telemetry-pipeline', docsPath: 'features/privacy-telemetry/',
                title: { en: 'Privacy & telemetry', fr: 'ConfidentialitÃ© et tÃ©lÃ©mÃ©trie' },
                summary: { en: 'Strictly opt-in analytics: whatâ€™s collected, what never is, and how to export or erase it.', fr: 'TÃ©lÃ©mÃ©trie strictement opt-in : ce qui est collectÃ©, ce qui ne lâ€™est jamais, et comment lâ€™exporter ou lâ€™effacer.' },
                keywords: 'privacy telemetry analytics gdpr consent data replay rrweb confidentialitÃ© donnÃ©es rgpd consentement enregistrement',
                // A real recording, played by the app's own viewer, so "masked session replay" is
                // something you can look at rather than a claim you have to take on trust. Streamed from
                // the docs site on click â€” a replay is a ~25 MB JSON event stream, far too big to bundle.
                media: {
                    kind: 'replay',
                    src: DOCS_SITE + 'assets/replays/bmm-demo.bmmreplay',
                    caption: {
                        en: 'A real masked session â€” names and paths are recorded as â€¢â€¢â€¢â€¢. Loads on click (~25 MB, from the docs site).',
                        fr: 'Une vraie session masquÃ©e â€” noms et chemins sont enregistrÃ©s en â€¢â€¢â€¢â€¢. Se charge au clic (~25 Mo, depuis le site de doc).',
                    },
                },
                body: {
                    en: '<p>Telemetry in BMM is <b>opt-in</b>: until you explicitly accept the consent dialog, <b>nothing is collected at all</b> â€” and declining also wipes anything previously buffered.</p>'
                        + '<p>The player above is the same one the app uses for any <code>.bmmreplay</code>. It replays the <b>DOM</b>, not a video â€” text stays selectable text â€” and it shows the masking as it is actually stored: the unmasked values never enter the file, so there is nothing to leak afterwards.</p>'
                        + '<h4>If you opt in</h4><ul><li>Whatâ€™s sent: pages visited, clicks (<b>labels only â€” never what you type</b>), performance samples, errors, and an anonymous hardware profile. No file paths, no mod contents, no name or e-mail; your identity is an anonymous id.</li><li><b>Session replay</b> (optional, on by default when telemetry is on) records the UI <b>masked</b>: mod names, profile names and paths appear as <code>â€¢â€¢â€¢â€¢</code>. Unmasking is a separate, explicit toggle.</li><li>Everything buffers to a <b>local file (10 MB cap)</b> first, and is only uploaded as gzip batches over <b>HTTPS</b> â€” if no endpoint is configured, data never leaves your machine.</li></ul>'
                        + '<h4>Where a recording lives while itâ€™s being made</h4><p>The local session recorder writes to disk <b>as it goes</b> instead of holding the session in the app: events are appended to a spool in batches (512 KB or 200 events, flushed at least every 3s), and the core assembles the <code>.bmmreplay</code> by streaming â€” so it costs about half a megabyte of memory whatever the session length, even when you export it. History is a rolling <b>512 MB</b> window on disk; oldest segments go first, and since each starts with a full snapshot, what remains always plays. If BMM is killed you lose at most the last few seconds.</p>'
                        + '<p>The DevTools <b>Replay Studio</b> is the exception: it keeps events in memory because it needs them for pause-compression and the trim, so it is capped at 64 MB and <b>stops the take</b> there rather than growing â€” what it already has stays complete and playable.</p>'
                        + '<h4>Your controls (Settings â†’ Privacy)</h4><ul><li>Master toggle plus separate toggles for the 7-day benchmark/extra-hardware report and session replay.</li><li><b>Export</b> the raw buffer as JSON any time.</li><li>See every <b>sent packet</b> (event names and counts only) and request its <b>deletion</b> â€” honoured within 72 hours.</li></ul>',
                    fr: '<p>La tÃ©lÃ©mÃ©trie de BMM est <b>opt-in</b> : tant que vous nâ€™acceptez pas explicitement la boÃ®te de consentement, <b>rien nâ€™est collectÃ© du tout</b> â€” et refuser efface aussi tout ce qui aurait Ã©tÃ© mis en tampon.</p>'
                        + '<p>Le lecteur ci-dessus est celui que lâ€™app utilise pour nâ€™importe quel <code>.bmmreplay</code>. Il rejoue le <b>DOM</b>, pas une vidÃ©o â€” le texte reste du texte sÃ©lectionnable â€” et il montre le masquage tel quâ€™il est rÃ©ellement stockÃ© : les valeurs dÃ©masquÃ©es nâ€™entrent jamais dans le fichier, il nâ€™y a donc rien Ã  fuiter ensuite.</p>'
                        + '<h4>Si vous acceptez</h4><ul><li>Ce qui part : pages visitÃ©es, clics (<b>libellÃ©s seulement â€” jamais ce que vous tapez</b>), Ã©chantillons de performance, erreurs, et un profil matÃ©riel anonyme. Pas de chemins de fichiers, pas de contenu de mods, ni nom ni e-mail ; votre identitÃ© est un id anonyme.</li><li>Le <b>replay de session</b> (optionnel, actif par dÃ©faut quand la tÃ©lÃ©mÃ©trie lâ€™est) enregistre lâ€™UI <b>masquÃ©e</b> : noms de mods, de profils et chemins sâ€™affichent en <code>â€¢â€¢â€¢â€¢</code>. Le dÃ©masquage est un interrupteur sÃ©parÃ© et explicite.</li><li>Tout sâ€™accumule dâ€™abord dans un <b>fichier local (plafond 10 Mo)</b>, envoyÃ© uniquement en lots gzip via <b>HTTPS</b> â€” sans endpoint configurÃ©, les donnÃ©es ne quittent jamais votre machine.</li></ul>'
                        + '<h4>OÃ¹ vit un enregistrement pendant quâ€™il se fait</h4><p>Lâ€™enregistreur de session local Ã©crit sur le disque <b>au fil de lâ€™eau</b> au lieu de garder la session dans lâ€™app : les Ã©vÃ©nements sont ajoutÃ©s Ã  un spool par lots (512 Ko ou 200 Ã©vÃ©nements, vidÃ©s au moins toutes les 3 s), et le cÅ“ur assemble le <code>.bmmreplay</code> en streaming â€” Ã§a coÃ»te donc environ un demi-mÃ©gaoctet de mÃ©moire quelle que soit la durÃ©e, mÃªme Ã  lâ€™export. Lâ€™historique est une fenÃªtre glissante de <b>512 Mo</b> sur le disque ; les plus vieux segments partent en premier, et comme chacun commence par un snapshot complet, ce qui reste se lit toujours. Si BMM est tuÃ©, tu perds au pire les derniÃ¨res secondes.</p>'
                        + '<p>Le <b>Replay Studio</b> des DevTools fait exception : il garde les Ã©vÃ©nements en mÃ©moire parce quâ€™il en a besoin pour la compression des pauses et le trim, il est donc plafonnÃ© Ã  64 Mo et <b>arrÃªte la prise</b> Ã  ce moment-lÃ  au lieu de grossir â€” ce quâ€™il a dÃ©jÃ  reste complet et lisible.</p>'
                        + '<h4>Vos contrÃ´les (RÃ©glages â†’ ConfidentialitÃ©)</h4><ul><li>Interrupteur principal plus des interrupteurs sÃ©parÃ©s pour le rapport benchmark/matÃ©riel Ã©tendu (7 jours) et le replay de session.</li><li><b>Exportez</b> le tampon brut en JSON Ã  tout moment.</li><li>Consultez chaque <b>paquet envoyÃ©</b> (noms et comptes dâ€™Ã©vÃ©nements seulement) et demandez sa <b>suppression</b> â€” honorÃ©e sous 72 heures.</li></ul>',
                },
            },
        ],
    },
    {
        id: 'faq', part: 'user', icon: 'life',
        title: { en: 'FAQ & troubleshooting', fr: 'FAQ et dÃ©pannage' },
        blurb: { en: 'Common questions and quick fixes.', fr: 'Questions frÃ©quentes et solutions rapides.' },
        articles: [
            {
                id: 'faq-pat', view: 'settings', docsPath: '',
                title: { en: 'GitHub rate limits & Personal Access Token (PAT)', fr: 'Limites GitHub et jeton dâ€™accÃ¨s personnel (PAT)' },
                summary: { en: 'Why some GitHub actions hit a limit, and how a PAT raises it.', fr: 'Pourquoi certaines actions GitHub atteignent une limite, et comment un PAT lâ€™augmente.' },
                keywords: 'pat github token rate limit api 403 jeton limite',
                body: {
                    en: '<p>Unauthenticated GitHub requests are capped at ~60/hour. Adding a <b>Personal Access Token (PAT)</b> raises this to 5 000/hour.</p><h4>Create one</h4><ul><li>On GitHub â†’ <b>Settings â†’ Developer settings â†’ Personal access tokens</b>.</li><li>A <b>read-only</b>, public-scope token is enough â€” BMM only reads public releases/catalogs.</li><li>Paste it in BMM <b>Settings</b>; itâ€™s stored locally and never shared.</li></ul>',
                    fr: '<p>Les requÃªtes GitHub non authentifiÃ©es sont limitÃ©es Ã  ~60/heure. Ajouter un <b>jeton dâ€™accÃ¨s personnel (PAT)</b> monte cette limite Ã  5 000/heure.</p><h4>En crÃ©er un</h4><ul><li>Sur GitHub â†’ <b>Settings â†’ Developer settings â†’ Personal access tokens</b>.</li><li>Un jeton <b>en lecture seule</b>, portÃ©e publique, suffit â€” BMM ne lit que des releases/catalogues publics.</li><li>Collez-le dans les <b>RÃ©glages</b> de BMM ; il est stockÃ© localement et jamais partagÃ©.</li></ul>',
                },
            },
            {
                id: 'faq-disk-full', docsPath: 'features/storage/', diagram: 'faq-disk-full',
                title: { en: 'My disk is filling up', fr: 'Mon disque se remplit' },
                summary: { en: 'Where BMM stores data and how to reclaim space safely.', fr: 'OÃ¹ BMM stocke ses donnÃ©es et comment rÃ©cupÃ©rer de lâ€™espace en sÃ©curitÃ©.' },
                keywords: 'disk full space cache clean storage io disque espace cache',
                body: {
                    en: '<p>Space goes to four places, each with its own remedy:</p><ul><li><b>Duplicated mods</b> â€” enable <b>shared storage</b> so one copy serves every profile, and open <b>Settings â†’ Storage &amp; disk usage</b> to see exactly what each area weighs.</li><li><b>Backups</b> â€” every overwritten game file lands in your profileâ€™s backup folder. Prune snapshots you no longer need; the automatic per-file backups are cleaned when a mod is disabled.</li><li><b>Caches</b> â€” the hash cache and extracted-archive cache can be cleared from Settings; they rebuild on demand.</li><li><b>Session recordings</b> â€” crash/session replays are capped by retention limits you control (default <b>30 sessions / 2&nbsp;GB</b>, in the Crash Reports &amp; Sessions manager). Lower them if space is tight.</li></ul><p>During big deploys BMM also throttles disk I/O so the app stays responsive (see the disk-I/O limiter diagram).</p>',
                    fr: '<p>Lâ€™espace part dans quatre endroits, chacun avec son remÃ¨de :</p><ul><li><b>Mods dupliquÃ©s</b> â€” activez le <b>stockage partagÃ©</b> pour quâ€™une seule copie serve tous les profils, et ouvrez <b>RÃ©glages â†’ Stockage &amp; espace disque</b> pour voir ce que pÃ¨se chaque zone.</li><li><b>Sauvegardes</b> â€” chaque fichier de jeu Ã©crasÃ© atterrit dans le dossier de backup du profil. Supprimez les instantanÃ©s devenus inutiles ; les backups automatiques par fichier sont nettoyÃ©s Ã  la dÃ©sactivation dâ€™un mod.</li><li><b>Caches</b> â€” le cache de hachage et le cache dâ€™archives extraites se vident depuis les RÃ©glages ; ils se reconstruisent Ã  la demande.</li><li><b>Enregistrements de session</b> â€” les replays de crash/session sont plafonnÃ©s par des limites de rÃ©tention que vous contrÃ´lez (dÃ©faut <b>30 sessions / 2&nbsp;Go</b>, dans le gestionnaire Rapports de plantage &amp; Sessions). Baissez-les si lâ€™espace manque.</li></ul><p>Pendant les gros dÃ©ploiements, BMM limite aussi les E/S disque pour rester rÃ©actif (voir le diagramme du limiteur dâ€™E/S).</p>',
                },
            },
            {
                id: 'faq-deleted-mod', docsPath: 'reference/troubleshooting/', diagram: 'faq-deleted-mod',
                title: { en: 'I deleted a mod by mistake', fr: 'Jâ€™ai supprimÃ© un mod par erreur' },
                summary: { en: 'How to recover, and why profiles make this rare.', fr: 'Comment rÃ©cupÃ©rer, et pourquoi les profils rendent cela rare.' },
                keywords: 'deleted recover restore mistake backup supprimÃ© rÃ©cupÃ©rer',
                body: {
                    en: '<p>Check these, in order â€” deleting from a profile rarely removes the only copy:</p><ul><li><b>Another profile still has it?</b> With shared storage, other profiles keep pointing at the same stored copy â€” re-add it to this profile from the Library.</li><li><b>It came from a server repo?</b> Re-run the sync: the client compares the manifest to your disk and re-downloads exactly the missing files.</li><li><b>You have a snapshot?</b> Restore the profile backup taken before the change.</li><li><b>It replaced game files?</b> Disabling/removing a mod puts the backed-up originals back automatically â€” your game is never left half-modded.</li></ul><p>The <b>History</b> button in the Library shows recent operations, which helps pin down what happened when.</p>',
                    fr: '<p>VÃ©rifiez ceci, dans lâ€™ordre â€” supprimer dâ€™un profil retire rarement la seule copie :</p><ul><li><b>Un autre profil lâ€™a encore ?</b> Avec le stockage partagÃ©, les autres profils pointent toujours vers la mÃªme copie stockÃ©e â€” rÃ©-ajoutez-le Ã  ce profil depuis la BibliothÃ¨que.</li><li><b>Il venait dâ€™un dÃ©pÃ´t serveur ?</b> Relancez la synchro : le client compare le manifeste Ã  votre disque et re-tÃ©lÃ©charge exactement les fichiers manquants.</li><li><b>Vous avez un instantanÃ© ?</b> Restaurez la sauvegarde de profil prise avant le changement.</li><li><b>Il remplaÃ§ait des fichiers du jeu ?</b> DÃ©sactiver/retirer un mod remet automatiquement les originaux sauvegardÃ©s â€” le jeu nâ€™est jamais laissÃ© Ã  moitiÃ© moddÃ©.</li></ul><p>Le bouton <b>Historique</b> de la BibliothÃ¨que montre les opÃ©rations rÃ©centes â€” utile pour comprendre ce qui sâ€™est passÃ© quand.</p>',
                },
            },
            {
                id: 'faq-crash', docsPath: 'reference/troubleshooting/', diagram: 'crash-reporting',
                title: { en: 'Reporting a crash', fr: 'Signaler un plantage' },
                summary: { en: 'What BMM collects, where reports live, and how to share one.', fr: 'Ce que BMM collecte, oÃ¹ sont les rapports et comment en partager un.' },
                keywords: 'crash report bug log support diagnostics plantage rapport',
                body: {
                    en: '<p>On a crash BMM writes a <b>self-contained zip</b> â€” logs, system info, and the rolling session recording from right before the crash â€” so a report arrives with enough to reproduce the issue.</p><h4>Where to find and use them</h4><ul><li>Open <b>Settings â†’ Crash Reports &amp; Sessions</b>. The manager lists crash reports and saved sessions.</li><li><b>Analyze</b> opens a reportâ€™s metadata, logs and files in-app, and can <b>play the attached session recording</b> so you can watch what happened.</li><li><b>Export</b> copies the zip anywhere (to attach to a bug report); <b>Open</b> jumps to the folder; <b>Delete</b> removes it.</li><li>Reports stay <b>local</b> until you share them. Retention limits (default 30 sessions / 2&nbsp;GB) keep the folder from growing forever.</li></ul><p>The in-app bug reporter can attach a session recording to a BetaHub report â€” see <b>Developer â†’ BetaHub reporting</b>.</p>',
                    fr: '<p>En cas de plantage, BMM Ã©crit un <b>zip autonome</b> â€” journaux, infos systÃ¨me, et lâ€™enregistrement de session glissant dâ€™avant le crash â€” pour quâ€™un rapport arrive avec de quoi reproduire le problÃ¨me.</p><h4>OÃ¹ les trouver et les utiliser</h4><ul><li>Ouvrez <b>RÃ©glages â†’ Rapports de plantage &amp; Sessions</b>. Le gestionnaire liste rapports et sessions enregistrÃ©es.</li><li><b>Analyser</b> ouvre les mÃ©tadonnÃ©es, journaux et fichiers du rapport dans lâ€™app, et peut <b>rejouer lâ€™enregistrement de session joint</b> pour voir ce qui sâ€™est passÃ©.</li><li><b>Exporter</b> copie le zip oÃ¹ vous voulez (Ã  joindre Ã  un bug report) ; <b>Ouvrir</b> saute au dossier ; <b>Supprimer</b> le retire.</li><li>Les rapports restent <b>locaux</b> tant que vous ne les partagez pas. Des limites de rÃ©tention (dÃ©faut 30 sessions / 2&nbsp;Go) empÃªchent le dossier de grossir sans fin.</li></ul><p>Le rapporteur de bugs intÃ©grÃ© peut joindre un enregistrement Ã  un rapport BetaHub â€” voir <b>DÃ©veloppeur â†’ Rapports BetaHub</b>.</p>',
                },
            },
        ],
    },
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• DEV PART â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
        id: 'arch', part: 'dev', icon: 'cpu',
        title: { en: 'Architecture', fr: 'Architecture' },
        blurb: { en: 'How BMM is built â€” the stack, threads and layout.', fr: 'Comment BMM est bÃ¢ti â€” stack, threads et dÃ©coupage.' },
        articles: [
            devArticle('code-stack', { en: 'The stack â€” and why itâ€™s lean', fr: 'La stack â€” et pourquoi elle est lÃ©gÃ¨re' }, { en: 'Tauri shell, a native Rust core and a TypeScript UI â€” and why that stays small.', fr: 'Coquille Tauri, cÅ“ur natif Rust et UI TypeScript â€” et pourquoi Ã§a reste lÃ©ger.' }, 'stack rust tauri typescript lightweight memory ram electron', {
                en: '<p>BMM is a <b>Tauri</b> app: the UI is TypeScript running in the OS\'s native webview, and every real operation â€” scanning, hashing, copying, networking â€” is a compiled <b>Rust</b> core. The UI never touches the disk directly; it calls the core over a single typed <code>invoke()</code> channel, and all state lives in the core.</p><p>Unlike an Electron app â€” which bundles a whole copy of Chromium (~150&nbsp;MB) and runs its logic in JavaScript â€” BMM reuses the OS webview and does the heavy work natively. So it idles at a few dozen MB, runs file operations at native speed, and the UI can reload at any time without losing your session.</p>',
                fr: '<p>BMM est une app <b>Tauri</b> : l\'interface est en TypeScript dans la webview native de l\'OS, et chaque opÃ©ration rÃ©elle â€” scan, hachage, copie, rÃ©seau â€” est un cÅ“ur <b>Rust</b> compilÃ©. L\'interface ne touche jamais le disque directement ; elle appelle le cÅ“ur via un unique canal typÃ© <code>invoke()</code>, et tout l\'Ã©tat vit dans le cÅ“ur.</p><p>Contrairement Ã  une app Electron â€” qui embarque une copie complÃ¨te de Chromium (~150&nbsp;Mo) et exÃ©cute sa logique en JavaScript â€” BMM rÃ©utilise la webview de l\'OS et fait le gros du travail nativement. Il tourne donc au repos Ã  quelques dizaines de Mo, exÃ©cute les opÃ©rations fichier Ã  vitesse native, et l\'interface peut se recharger sans perdre votre session.</p>',
            }),
            devArticle('engine-threads', { en: 'Engine & threads', fr: 'Moteur et threads' }, { en: 'How work is split across threads to keep the UI responsive.', fr: 'Comment le travail est rÃ©parti sur les threads pour garder lâ€™UI rÃ©active.' }, 'threads async engine concurrency', {
                en: '<p>Long jobs never run on the UI thread, and big applies and unapplies do not run in the app at all â€” they go to a <b>separate process</b>, the same executable re-invoked as a mod worker, which starts without booting the webview at all. It demotes itself to Windows <b>background IO priority</b>, so the kernel keeps disk bandwidth for the window. Cancelling is a hard kill of that process â€” instant and reliable however stuck the IO is â€” followed by an inverse-op undo pass, so a cancelled deploy does not leave half a mod behind.</p><p>There are <b>three thread pools</b>, each capped for its own reason: the global one (capped, with 512 KB stacks, so it cannot hog the CPU and lag the OS), the hashing pool (max 4), and the copy pool (1â€“2, forced to 1 on the OS drive). A single global lock means one mod operation at a time.</p><p>Inside the app the rule is: hold a lock to collect metadata, never to do I/O. Every heavy path takes a lightweight snapshot under the lock and releases it before reading a single file â€” that is what used to freeze the window on big mods.</p>',
                fr: '<p>Les longues tÃ¢ches ne tournent jamais sur le thread de l\'interface, et les grosses applications/dÃ©sapplications ne tournent pas du tout dans l\'app â€” elles partent dans un <b>processus sÃ©parÃ©</b>, le mÃªme exÃ©cutable rÃ©invoquÃ© en worker de mods, qui dÃ©marre sans lancer le webview. Il se rÃ©trograde en <b>prioritÃ© I/O de fond</b> Windows, le noyau garde donc de la bande passante disque pour la fenÃªtre. Annuler, c\'est tuer ce processus â€” instantanÃ© et fiable quel que soit le blocage des I/O â€” suivi d\'une passe d\'annulation en opÃ©ration inverse, donc un dÃ©ploiement annulÃ© ne laisse pas la moitiÃ© d\'un mod.</p><p>Il y a <b>trois pools de threads</b>, chacun plafonnÃ© pour sa propre raison : le global (plafonnÃ©, piles de 512 Ko, pour ne pas monopoliser le CPU et faire ramer l\'OS), le pool de hachage (max 4), et le pool de copie (1â€“2, forcÃ© Ã  1 sur le disque systÃ¨me). Un verrou global signifie une seule opÃ©ration de mod Ã  la fois.</p><p>Dans l\'app, la rÃ¨gle est : tenir un verrou pour collecter des mÃ©tadonnÃ©es, jamais pour faire des I/O. Chaque chemin lourd prend un instantanÃ© lÃ©ger sous le verrou et le relÃ¢che avant de lire le moindre fichier â€” c\'est ce qui figeait la fenÃªtre sur les gros mods.</p>',
            }),
            devArticle('mod-architecture', { en: 'Mod data model', fr: 'ModÃ¨le de donnÃ©es des mods' }, { en: 'How a mod, its files and its metadata are represented.', fr: 'Comment un mod, ses fichiers et ses mÃ©tadonnÃ©es sont reprÃ©sentÃ©s.' }, 'model data mod files', {
                en: '<p>A mod is modelled as a set of files â€” each with a destination path, size, modification time and content hash â€” plus metadata (name, version, author, source). Everything else in BMM (conflict detection, integrity, sync) reads that model rather than re-walking the disk, which is what makes those operations cheap.</p>',
                fr: '<p>Un mod est modÃ©lisÃ© comme un ensemble de fichiers â€” chacun avec un chemin de destination, une taille, une date de modification et un hachage de contenu â€” plus des mÃ©tadonnÃ©es (nom, version, auteur, source). Tout le reste dans BMM (dÃ©tection de conflits, intÃ©gritÃ©, synchro) lit ce modÃ¨le au lieu de reparcourir le disque, ce qui rend ces opÃ©rations peu coÃ»teuses.</p>',
            }),
        ],
    },
    {
        id: 'engine', part: 'dev', icon: 'bolt',
        title: { en: 'Core engine', fr: 'Moteur central' },
        blurb: { en: 'Hashing, integrity, caching and I/O throttling.', fr: 'Hachage, intÃ©gritÃ©, cache et limitation dâ€™E/S.' },
        articles: [
            devArticle('blake3-hashing', { en: 'BLAKE3 hashing', fr: 'Hachage BLAKE3' }, { en: 'The fast content hash behind change detection and integrity.', fr: 'Le hachage de contenu rapide derriÃ¨re la dÃ©tection de changement et lâ€™intÃ©gritÃ©.' }, 'blake3 hash sha checksum', {
                en: '<p>Every file gets a <b>BLAKE3</b> content fingerprint â€” a short value that changes completely if a single byte does. Local hashes are stored tagged <code>b3:</code>; an untagged one is read as a legacy SHA-256, so old baselines and modpacks keep verifying after the switch.</p><p>BLAKE3 was chosen because it can parallelise <i>within</i> one large file â€” and the hot path <b>deliberately declines to</b>. Hashing runs on a pool capped to about half your cores (max 4), with a sequential mmap per file, precisely because BLAKE3 is fast enough to saturate every core and freeze the window while a library is imported. Parallelism comes from hashing several <i>files</i> at once, not one file across all cores.</p><p>SHA-256 survives in three places on purpose: legacy baselines, the repo wire format, and the <code>content_id</code> fingerprint â€” which had to keep its algorithm so the migration would not change any mod\'s identity.</p>',
                fr: '<p>Chaque fichier reÃ§oit une empreinte de contenu <b>BLAKE3</b> â€” une valeur courte qui change complÃ¨tement si un seul octet change. Les hashs locaux sont stockÃ©s prÃ©fixÃ©s <code>b3:</code> ; un hash non prÃ©fixÃ© est lu comme un SHA-256 legacy, donc les anciennes baselines et les anciens modpacks continuent de se vÃ©rifier aprÃ¨s le changement.</p><p>BLAKE3 a Ã©tÃ© choisi parce qu\'il sait parallÃ©liser <i>Ã  l\'intÃ©rieur</i> d\'un gros fichier â€” et le chemin chaud <b>refuse dÃ©libÃ©rÃ©ment</b> de s\'en servir. Le hachage tourne sur un pool plafonnÃ© Ã  environ la moitiÃ© des cÅ“urs (max 4), avec un mmap sÃ©quentiel par fichier, prÃ©cisÃ©ment parce que BLAKE3 est assez rapide pour saturer tous les cÅ“urs et figer la fenÃªtre pendant l\'import d\'une bibliothÃ¨que. Le parallÃ©lisme vient du hachage de plusieurs <i>fichiers</i> Ã  la fois, pas d\'un fichier sur tous les cÅ“urs.</p><p>SHA-256 survit Ã  trois endroits exprÃ¨s : les baselines legacy, le format de transport des dÃ©pÃ´ts, et l\'empreinte <code>content_id</code> â€” qui devait garder son algorithme pour que la migration ne change l\'identitÃ© d\'aucun mod.</p>',
            }),
            devArticle('integrity-engine', { en: 'Integrity engine', fr: 'Moteur dâ€™intÃ©gritÃ©' }, { en: 'How every file is verified before it reaches your game.', fr: 'Comment chaque fichier est vÃ©rifiÃ© avant dâ€™atteindre le jeu.' }, 'integrity verify corrupt intÃ©gritÃ©', {
                en: '<p>Checking a mod compares its stored baseline against the disk and returns three lists: <b>missing</b> (the baseline has it, the disk does not), <b>modified</b> (present, but the content hash changed) and <b>added</b> (on disk, unknown to the baseline).</p><p>Two behaviours nobody guesses: the <b>first</b> check on a mod never fails â€” with no baseline yet, BMM hashes everything and stores that as the baseline, so only the <i>second</i> check can report a problem. And a failed result is <b>remembered</b>: it sets a flag that draws the warning icon in the Library and survives a restart.</p><p>Where a hash actually <i>blocks</i> something: a catalog download is SHA-256 verified before it can run (if the catalog carries no hash, BMM says so and asks); a repo sync compares before downloading, per chunk during, and re-verifies after; applying a modpack checks unless that pack has <i>skip integrity check</i>. Enabling a mod from the <b>scheduler bypasses the check</b> â€” a background run cannot stop to ask you.</p>',
                fr: '<p>VÃ©rifier un mod compare sa baseline stockÃ©e au disque et renvoie trois listes : <b>missing</b> (la baseline l\'a, le disque non), <b>modified</b> (prÃ©sent, mais le hash de contenu a changÃ©) et <b>added</b> (sur le disque, inconnu de la baseline).</p><p>Deux comportements que personne ne devine : le <b>premier</b> contrÃ´le d\'un mod n\'Ã©choue jamais â€” sans baseline, BMM hache tout et le stocke comme baseline, seul le <i>deuxiÃ¨me</i> contrÃ´le peut donc signaler un problÃ¨me. Et un rÃ©sultat en Ã©chec est <b>mÃ©morisÃ©</b> : il pose un drapeau qui dessine l\'icÃ´ne d\'avertissement dans la BibliothÃ¨que et survit Ã  un redÃ©marrage.</p><p>LÃ  oÃ¹ un hash <i>bloque</i> rÃ©ellement quelque chose : un tÃ©lÃ©chargement de catalogue est vÃ©rifiÃ© en SHA-256 avant toute exÃ©cution (si le catalogue ne porte aucun hash, BMM le dit et demande) ; une synchro de dÃ©pÃ´t compare avant le tÃ©lÃ©chargement, par chunk pendant, et re-vÃ©rifie aprÃ¨s ; appliquer un modpack contrÃ´le, sauf si ce pack a <i>ignorer le contrÃ´le d\'intÃ©gritÃ©</i>. Activer un mod depuis le <b>planificateur contourne le contrÃ´le</b> â€” une exÃ©cution de fond ne peut pas s\'arrÃªter pour te demander.</p>',
            }),
            devArticle('mtime-cache', { en: 'mtime cache', fr: 'Cache mtime' }, { en: 'Skip re-hashing unchanged files using modification times.', fr: 'Ã‰viter de re-hacher les fichiers inchangÃ©s via les dates de modification.' }, 'mtime cache incremental', {
                en: '<p>Re-scanning gigabytes on every launch would be pointless â€” almost nothing changes between runs. There are actually <b>two caches, keyed differently</b>, and the distinction is the whole design:</p><ul><li>The <b>file list</b> is keyed on the mod <i>folder\'s</i> modification time. Same mtime as stored â†’ reuse the list verbatim, without even walking the directory.</li><li>The <b>file hashes</b> are keyed per file, and are recomputed by an integrity check rather than by a scan.</li></ul><p>If reading the metadata fails, BMM logs it and resets the stored mtime rather than trusting a zero â€” a failure becomes a re-scan, never a false cache hit.</p><p>The honest limit: editing a file <i>in place</i> may leave the parent folder\'s mtime untouched, so the cached list stays valid (correctly â€” the list did not change) but nothing prompts a re-hash. That is exactly why the hashes are a separate cache with a separate trigger: run an integrity check when you want the truth. Re-hashing itself is a throttled background queue â€” one mod at a time, on the capped hash pool, with a pause between each.</p>',
                fr: '<p>Re-scanner des gigaoctets Ã  chaque lancement serait inutile â€” presque rien ne change entre deux sessions. Il y a en fait <b>deux caches, avec des clÃ©s diffÃ©rentes</b>, et cette distinction est tout le design :</p><ul><li>La <b>liste de fichiers</b> a pour clÃ© la date de modification du <i>dossier</i> du mod. MÃªme mtime que celle stockÃ©e â†’ rÃ©utiliser la liste telle quelle, sans mÃªme parcourir le dossier.</li><li>Les <b>hashs de fichiers</b> ont pour clÃ© le fichier, et sont recalculÃ©s par un contrÃ´le d\'intÃ©gritÃ©, pas par un scan.</li></ul><p>Si la lecture des mÃ©tadonnÃ©es Ã©choue, BMM le journalise et remet Ã  zÃ©ro la mtime stockÃ©e plutÃ´t que de faire confiance Ã  un zÃ©ro â€” un Ã©chec devient un re-scan, jamais un faux succÃ¨s de cache.</p><p>La limite honnÃªte : Ã©diter un fichier <i>sur place</i> peut laisser la mtime du dossier parent intacte, donc la liste en cache reste valide (Ã  juste titre â€” la liste n\'a pas changÃ©) mais rien ne dÃ©clenche un re-hachage. C\'est exactement pour Ã§a que les hashs sont un cache sÃ©parÃ© avec un dÃ©clencheur sÃ©parÃ© : lance un contrÃ´le d\'intÃ©gritÃ© quand tu veux la vÃ©ritÃ©. Le re-hachage lui-mÃªme est une file de fond bridÃ©e â€” un mod Ã  la fois, sur le pool de hash plafonnÃ©, avec une pause entre chacun.</p>',
            }),
            devArticle('disk-io-limiter', { en: 'Disk I/O limiter', fr: 'Limiteur dâ€™E/S disque' }, { en: 'Keep the app responsive during big copies.', fr: 'Garder lâ€™app rÃ©active pendant les grosses copies.' }, 'io disk throttle limiter', {
                en: '<p>Copying at full tilt can peg a drive and make the whole system stutter â€” BMM included. Every copy takes one of <b>three routes</b>:</p><ul><li><b>Throttled</b> â€” you set a MB/s cap for that disk: 128 KB chunks, paced to hit the rate.</li><li><b>Smart I/O</b> â€” no cap: 1 MiB chunks with a short yield on a ~16 MiB <i>byte budget</i>. The older 256 KB + per-chunk sleep cost about 37% versus full speed; budgeting the yield keeps the window responsive and wins most of that back.</li><li><b>Full speed</b> â€” Smart I/O off and no cap: the OS does the whole copy.</li></ul><p>Parallelism is capped at 2 threads so copies never saturate every core, and if the game or backup folder sits on your <b>OS drive</b> it drops to a single thread whatever the setting says â€” Windows itself needs the headroom.</p><p><b>BMM never hard-links or symlinks.</b> Every deployed file is a real copy. That costs disk space, and it is why the game folder works with tools that do not understand links, survives a mods folder on another drive, and stays intact if BMM is uninstalled.</p>',
                fr: '<p>Copier Ã  fond peut monopoliser un disque et faire saccader tout le systÃ¨me â€” BMM compris. Chaque copie prend l\'une de <b>trois routes</b> :</p><ul><li><b>BridÃ©e</b> â€” tu poses un plafond Mo/s pour ce disque : blocs de 128 Ko, cadencÃ©s pour tenir le dÃ©bit.</li><li><b>Smart I/O</b> â€” sans plafond : blocs de 1 Mio avec un court yield sur un <i>budget d\'octets</i> de ~16 Mio. L\'ancien 256 Ko + pause par bloc coÃ»tait environ 37% par rapport Ã  la pleine vitesse ; budgÃ©tiser le yield garde la fenÃªtre rÃ©active et rÃ©cupÃ¨re l\'essentiel.</li><li><b>Pleine vitesse</b> â€” Smart I/O coupÃ© et aucun plafond : l\'OS fait toute la copie.</li></ul><p>Le parallÃ©lisme est plafonnÃ© Ã  2 threads pour que les copies ne saturent jamais tous les cÅ“urs, et si le dossier du jeu ou de sauvegarde est sur ton <b>disque systÃ¨me</b>, Ã§a descend Ã  un seul thread quel que soit le rÃ©glage â€” Windows lui-mÃªme a besoin de la marge.</p><p><b>BMM ne fait jamais de hard-link ni de lien symbolique.</b> Chaque fichier dÃ©ployÃ© est une vraie copie. Ã‡a coÃ»te de l\'espace disque, et c\'est pour Ã§a que le dossier du jeu fonctionne avec les outils qui ne comprennent pas les liens, survit Ã  un dossier mods sur un autre disque, et reste intact si BMM est dÃ©sinstallÃ©.</p>',
            }),
            devArticle('semantic-search', { en: 'Semantic search', fr: 'Recherche sÃ©mantique' }, { en: 'How the fuzzy/synonym search matches what you mean.', fr: 'Comment la recherche floue/synonymes comprend votre intention.' }, 'search semantic fuzzy synonym', {
                en: '<p>Beyond exact matches, semantic mode expands your query with synonyms and tolerates typos, so "delete" also finds "remove" and "uninstall". Results are scored by how many of the expanded terms they contain, so the closest matches rank first â€” the same engine powers the docs search and the Ctrl+K command palette.</p>',
                fr: '<p>Au-delÃ  des correspondances exactes, le mode sÃ©mantique Ã©tend votre requÃªte avec des synonymes et tolÃ¨re les fautes de frappe : Â« supprimer Â» trouve aussi Â« retirer Â» et Â« dÃ©sinstaller Â». Les rÃ©sultats sont classÃ©s selon le nombre de termes Ã©tendus qu\'ils contiennent, donc les plus proches remontent en premier â€” le mÃªme moteur alimente la recherche de la doc et la palette Ctrl+K.</p>',
            }),
        ],
    },
    {
        id: 'sync', part: 'dev', icon: 'db',
        title: { en: 'Data & sync', fr: 'DonnÃ©es et synchro' },
        blurb: { en: 'Profiles, syncing, resumable downloads and updates.', fr: 'Profils, synchro, tÃ©lÃ©chargements repris et mises Ã  jour.' },
        articles: [
            devArticle('profile-system', { en: 'Profile system', fr: 'SystÃ¨me de profils' }, { en: 'How isolated profiles are modelled and switched.', fr: 'Comment les profils isolÃ©s sont modÃ©lisÃ©s et basculÃ©s.' }, 'profile system switch', {
                en: '<p>A profile is a small record â€” a name, <b>three folders</b> (game, mods, backup) and an ordered list of which mods are on. It stores no files, so you can keep a dozen for almost nothing.</p><p><b>Switching a profile moves no files at all.</b> It sets one pointer and saves â€” nothing is deployed, nothing is removed, and whatever is already in the game folder stays exactly where it is. What changes is which list you are now editing. Only enabling and disabling touch the game folder. This is the single most common surprise in BMM, so it is worth repeating: switching does not swap your loadout.</p><p>A mod belongs to a profile by <b>path prefix</b> â€” its folder sits under that profile\'s mods folder â€” not by a stored id. And profiles that share <i>both</i> the game and mods folders have their active lists reconciled with each other, because there is only one game folder underneath. To keep genuinely separate loadouts, give each profile its own mods folder.</p>',
                fr: '<p>Un profil est un petit enregistrement â€” un nom, <b>trois dossiers</b> (jeu, mods, sauvegarde) et une liste ordonnÃ©e des mods actifs. Il ne stocke aucun fichier, tu peux donc en garder une douzaine pour presque rien.</p><p><b>Changer de profil ne dÃ©place aucun fichier.</b> Ã‡a pose un pointeur et sauvegarde â€” rien n\'est dÃ©ployÃ©, rien n\'est retirÃ©, et ce qui est dÃ©jÃ  dans le dossier du jeu reste exactement oÃ¹ il est. Ce qui change, c\'est la liste que tu Ã©dites dÃ©sormais. Seuls activer et dÃ©sactiver touchent au dossier du jeu. C\'est la surprise la plus frÃ©quente dans BMM, donc autant le rÃ©pÃ©ter : changer de profil ne permute pas ton loadout.</p><p>Un mod appartient Ã  un profil par <b>prÃ©fixe de chemin</b> â€” son dossier se trouve sous le dossier mods de ce profil â€” pas par un id stockÃ©. Et les profils qui partagent <i>Ã  la fois</i> le dossier de jeu et le dossier mods ont leurs listes actives rÃ©conciliÃ©es entre elles, parce qu\'il n\'y a qu\'un seul dossier de jeu en dessous. Pour garder des loadouts vraiment sÃ©parÃ©s, donne Ã  chaque profil son propre dossier mods.</p>',
            }),
            devArticle('mod-sync', { en: 'Mod sync', fr: 'Synchro des mods' }, { en: 'Reconciling on-disk mods with the index.', fr: 'RÃ©concilier les mods sur disque avec lâ€™index.' }, 'sync reconcile index', {
                en: '<p>Sync reconciles what\'s on disk with the index: new files are hashed and added, changed ones re-hashed, missing ones flagged. It\'s incremental (it leans on the mtime cache) and strictly read-only â€” it builds knowledge, it never rewrites your mods.</p>',
                fr: '<p>La synchro rÃ©concilie ce qui est sur le disque avec l\'index : les nouveaux fichiers sont hachÃ©s et ajoutÃ©s, les modifiÃ©s re-hachÃ©s, les manquants signalÃ©s. Elle est incrÃ©mentale (elle s\'appuie sur le cache mtime) et strictement en lecture seule â€” elle construit une connaissance, elle ne rÃ©Ã©crit jamais vos mods.</p>',
            }),
            devArticle('resumable-downloads', { en: 'Resumable downloads', fr: 'TÃ©lÃ©chargements repris' }, { en: 'How interrupted downloads pick up where they left off.', fr: 'Comment un tÃ©lÃ©chargement interrompu reprend oÃ¹ il sâ€™est arrÃªtÃ©.' }, 'download resume range', {
                en: '<p>A download records how many bytes it already holds. If it\'s interrupted, it asks the server for the <b>remaining range</b> instead of starting over â€” so a dropped connection on a large mod costs seconds, not the whole file. The finished file is then hash-verified before it\'s trusted.</p>',
                fr: '<p>Un tÃ©lÃ©chargement note combien d\'octets il possÃ¨de dÃ©jÃ . S\'il est interrompu, il demande au serveur la <b>plage restante</b> au lieu de tout recommencer â€” une connexion coupÃ©e sur un gros mod coÃ»te des secondes, pas le fichier entier. Le fichier terminÃ© est ensuite vÃ©rifiÃ© par hachage avant d\'Ãªtre considÃ©rÃ© fiable.</p>',
            }),
            devArticle('update-system', { en: 'Updates (app & mods)', fr: 'Mises Ã  jour (app & mods)' }, { en: 'How BMM and your mods check for and apply updates.', fr: 'Comment BMM et vos mods vÃ©rifient et appliquent les mises Ã  jour.' }, 'update version release mod', {
                en: '<p>Whether it\'s a mod or the app itself, BMM compares the source\'s published version with what you have and only fetches when they differ.</p><ul><li><b>Mods</b> â€” for each mod with a known source, the new files are <b>staged</b> without disturbing the rest of the profile; you review what changed and apply. Non-destructive, like everything else.</li><li><b>The app</b> â€” its updates are cryptographically <b>signed</b> and checked before installing, so an intercepted download can\'t slip in a tampered build.</li></ul><p>Every downloaded file is hash-verified before it\'s trusted.</p>',
                fr: '<p>Qu\'il s\'agisse d\'un mod ou de l\'app elle-mÃªme, BMM compare la version publiÃ©e de la source avec la vÃ´tre et ne tÃ©lÃ©charge que si elles diffÃ¨rent.</p><ul><li><b>Les mods</b> â€” pour chaque mod ayant une source connue, les nouveaux fichiers sont <b>prÃ©parÃ©s</b> sans toucher au reste du profil ; vous examinez ce qui change et appliquez. Non destructif, comme le reste.</li><li><b>L\'app</b> â€” ses mises Ã  jour sont <b>signÃ©es</b> cryptographiquement et vÃ©rifiÃ©es avant installation, donc un tÃ©lÃ©chargement interceptÃ© ne peut pas glisser une version altÃ©rÃ©e.</li></ul><p>Chaque fichier tÃ©lÃ©chargÃ© est vÃ©rifiÃ© par hachage avant d\'Ãªtre considÃ©rÃ© fiable.</p>',
            }),
        ],
    },
    {
        id: 'extend', part: 'dev', icon: 'puzzle',
        title: { en: 'Extending BMM', fr: 'Ã‰tendre BMM' },
        blurb: { en: 'Plugins, the API, MCP, custom pages and catalogs.', fr: 'Plugins, API, MCP, pages personnalisÃ©es et catalogues.' },
        articles: [
            devArticle('mcp-server', { en: 'MCP server & local API', fr: 'Serveur MCP et API locale' }, { en: 'Drive BMM from scripts or an AI client.', fr: 'Piloter BMM depuis des scripts ou un client IA.' }, 'mcp api plugin automation endpoint', {
                en: '<p>Everything the UI can do, it does by asking the core. That same core is exposed as a <b>local HTTP API</b> (bound to localhost) and as an <b>MCP server</b> (over stdio, not a public port), so plugins, scripts and AI assistants can scan, activate, build packs and more. The full endpoint reference lives in the online docs.</p>',
                fr: '<p>Tout ce que l\'interface sait faire, elle le fait en demandant au cÅ“ur. Ce mÃªme cÅ“ur est exposÃ© comme <b>API HTTP locale</b> (sur localhost) et comme <b>serveur MCP</b> (via stdio, pas un port public), donc plugins, scripts et assistants IA peuvent scanner, activer, construire des packs, etc. La rÃ©fÃ©rence complÃ¨te des endpoints est dans la documentation en ligne.</p>',
            }, ''),
            devArticle('app-catalog', { en: 'App catalog', fr: 'Catalogue dâ€™applis' }, { en: 'How catalog feeds are fetched and installed.', fr: 'Comment les flux de catalogue sont rÃ©cupÃ©rÃ©s et installÃ©s.' }, 'catalog feed install', {
                en: '<p>A catalog is a JSON feed of installable items (apps, tools). BMM fetches it, shows the entries, and installs straight from them â€” the same pipeline whether the feed is official or community-hosted, and every download is hash-checked before it lands.</p>',
                fr: '<p>Un catalogue est un flux JSON d\'Ã©lÃ©ments installables (applis, outils). BMM le rÃ©cupÃ¨re, affiche les entrÃ©es et installe directement depuis elles â€” le mÃªme pipeline que le flux soit officiel ou communautaire, et chaque tÃ©lÃ©chargement est vÃ©rifiÃ© par hachage avant d\'atterrir.</p>',
            }),
            devArticle('launch-packs', { en: 'Launch packs', fr: 'Launch packs' }, { en: 'How app groups launch silently â€” the VBScript bridge.', fr: 'Comment les groupes dâ€™applis se lancent en silence â€” le pont VBScript.' }, 'launch pack apps vbs shortcut silent', {
                en: '<p>A launch pack is an <b>application group</b>. Creating one builds a small folder holding the pack\'s icon (converted to a 256Ã—256 <code>.ico</code>) and a generated <code>launcher.vbs</code> that starts each executable <b>invisibly</b> â€” no console windows â€” plus a <code>.lnk</code> shortcut targeting that script, so the pack is launchable from the desktop. The Steam-style app picker scans the Windows registry\'s Uninstall hives and Start-Menu shortcuts to list installed programs, and per-exe icons are extracted lazily. Shortcut names are sanitised against path traversal.</p>',
                fr: '<p>Un launch pack est un <b>groupe d\'applications</b>. Sa crÃ©ation construit un petit dossier contenant l\'icÃ´ne du pack (convertie en <code>.ico</code> 256Ã—256) et un <code>launcher.vbs</code> gÃ©nÃ©rÃ© qui dÃ©marre chaque exÃ©cutable <b>de faÃ§on invisible</b> â€” aucune fenÃªtre de console â€” plus un raccourci <code>.lnk</code> ciblant ce script, pour lancer le pack depuis le bureau. Le sÃ©lecteur d\'applis faÃ§on Steam scanne les ruches Uninstall du registre Windows et les raccourcis du menu DÃ©marrer, et les icÃ´nes par exe sont extraites Ã  la demande. Les noms de raccourcis sont assainis contre la traversÃ©e de chemins.</p>',
            }),
            devArticle('theme-system', { en: 'Theme system', fr: 'SystÃ¨me de thÃ¨mes' }, { en: 'How themes tokenise the UI â€” and how you make your own.', fr: 'Comment les thÃ¨mes tokenisent lâ€™UI â€” et comment crÃ©er le vÃ´tre.' }, 'theme editor tokens css couleurs', {
                en: '<p>The whole UI is drawn from CSS <b>design tokens</b> â€” the <code>--bmm-*</code> custom properties defined in one file (<code>tokens.css</code>), which is the <b>official theming surface</b>: backgrounds, borders, accent (with r/g/b channel triplets for tints), semantic colours, text, fonts, spacing, radii, shadows, wallpaper/images, and even animation speed (<code>--bmm-anim-speed: 0</code> disables all animations).</p><p>A theme is a JSON object (<code>id</code>, <code>name</code>, <code>mode: dark|light</code>, a <code>vars</code> map of token overrides, plus optional fonts, assets, per-page CSS, element overrides and HTML swaps), stored under the app data <code>themes/</code> folder; a <code>.bmmtheme</code> file is that JSON zipped with its assets. Built-ins are plain files in a bundled folder â€” 12 ship today.</p><p>Two runtime mechanisms make ANY theme complete: an inline-style <b>patch observer</b> rewrites hardcoded colours to tokens as the DOM changes, and on light themes a <b>contrast enforcer</b> fixes too-light text against real WCAG ratios (reversible, opt-out). Applying a theme only writes &lt;style&gt; blocks â€” never source files.</p>',
                fr: '<p>Toute l\'interface est dessinÃ©e Ã  partir de <b>tokens</b> CSS â€” les propriÃ©tÃ©s <code>--bmm-*</code> dÃ©finies dans un seul fichier (<code>tokens.css</code>), la <b>surface de thÃ©matisation officielle</b> : fonds, bordures, accent (avec triplets r/g/b pour les teintes), couleurs sÃ©mantiques, texte, polices, espacements, rayons, ombres, fond d\'Ã©cran/images, et mÃªme la vitesse d\'animation (<code>--bmm-anim-speed: 0</code> coupe toutes les animations).</p><p>Un thÃ¨me est un objet JSON (<code>id</code>, <code>name</code>, <code>mode: dark|light</code>, une map <code>vars</code> de tokens, plus optionnellement polices, assets, CSS par page, overrides d\'Ã©lÃ©ments et swaps HTML), stockÃ© dans le dossier <code>themes/</code> des donnÃ©es de l\'app ; un fichier <code>.bmmtheme</code> est ce JSON zippÃ© avec ses assets. Les intÃ©grÃ©s sont de simples fichiers dans un dossier embarquÃ© â€” 12 aujourd\'hui.</p><p>Deux mÃ©canismes runtime rendent N\'IMPORTE quel thÃ¨me complet : un <b>observateur de patch</b> rÃ©Ã©crit les couleurs en dur vers les tokens au fil du DOM, et sur les thÃ¨mes clairs un <b>renforceur de contraste</b> corrige le texte trop clair selon de vrais ratios WCAG (rÃ©versible, dÃ©sactivable). Appliquer un thÃ¨me n\'Ã©crit que des blocs &lt;style&gt; â€” jamais les fichiers sources.</p>',
            }),
            devArticle('one-click-install', { en: 'One-click install', fr: 'Installation en un clic' }, { en: 'The deeplink flow behind install buttons.', fr: 'Le flux deeplink derriÃ¨re les boutons dâ€™installation.' }, 'deeplink install oneclick', {
                en: '<p>Install buttons on the web use a <code>bmm://</code> <b>deeplink</b> the app registers with the OS. Clicking one hands the request to the running app, which confirms with you before acting â€” so an install is one click, with no copy-pasting URLs and no silent action.</p>',
                fr: '<p>Les boutons d\'installation sur le web utilisent un <b>deeplink</b> <code>bmm://</code> que l\'app enregistre auprÃ¨s de l\'OS. Cliquer sur l\'un transmet la requÃªte Ã  l\'app en cours, qui confirme avec vous avant d\'agir â€” une installation en un clic, sans copier-coller d\'URL ni action silencieuse.</p>',
            }),
        ],
    },
    {
        id: 'ops', part: 'dev', icon: 'server',
        title: { en: 'Deploy & operations', fr: 'DÃ©ploiement et exploitation' },
        blurb: { en: 'Hosting, Docker, security, telemetry and reporting.', fr: 'HÃ©bergement, Docker, sÃ©curitÃ©, tÃ©lÃ©mÃ©trie et rapports.' },
        articles: [
            devArticle('security-system', { en: 'Security model', fr: 'ModÃ¨le de sÃ©curitÃ©' }, { en: 'Trust boundaries, path guards and signed payloads.', fr: 'FrontiÃ¨res de confiance, gardes de chemins et charges signÃ©es.' }, 'security cwe path signing sÃ©curitÃ©', {
                en: '<p>BMM treats the UI and anything from the network as <b>untrusted</b> and verifies at the core. Path operations reject <code>..</code> / absolute escapes and stay confined to their target folder; downloads are hash-checked before deploy; app and package updates must pass a <b>signature</b> check. Extensions are confined too â€” custom pages via a permission broker, MCP over stdio, the API on localhost.</p>',
                fr: '<p>BMM considÃ¨re l\'interface et tout ce qui vient du rÃ©seau comme <b>non fiable</b> et vÃ©rifie au cÅ“ur. Les opÃ©rations de chemin rejettent <code>..</code> / les Ã©chappements absolus et restent confinÃ©es Ã  leur dossier cible ; les tÃ©lÃ©chargements sont vÃ©rifiÃ©s par hachage avant dÃ©ploiement ; les mises Ã  jour de l\'app et des paquets doivent passer un contrÃ´le de <b>signature</b>. Les extensions sont aussi confinÃ©es â€” pages perso via un courtier de permissions, MCP via stdio, API sur localhost.</p>',
            }, ''),
            devArticle('i18n-system', { en: 'Translation (i18n) system', fr: 'SystÃ¨me de traduction (i18n)' }, { en: 'External JSON dictionaries, FR fallback, live switching â€” and how to add a language.', fr: 'Dictionnaires JSON externes, repli FR, bascule en direct â€” et comment ajouter une langue.' }, 'i18n translation language locale synonym traduction langue', {
                en: '<p>Every UI string resolves through <code>t(key)</code> against per-language JSON files in <code>Lang/</code> â€” plain keyâ†’string maps, loaded from disk at startup. Lookup order: the active language â†’ the <b>French</b> dictionary (FR is the base language) â†’ the raw key itself, so a missing translation is visible instead of silent.</p><ul><li><b>Live switching</b>: changing language re-applies every <code>data-i18n</code> attribute immediately and fires a <code>langChanged</code> event for dynamic modules â€” no restart.</li><li><b>Adding a language</b> is dropping a new JSON file in <code>Lang/</code>: it appears in the picker (with the name/flag from its <code>_info</code>) without a rebuild.</li><li>Each file can also ship <code>_synonyms</code> groups â€” they merge across languages to power the <b>semantic search</b> in the palette and the docs.</li></ul>',
                fr: '<p>Chaque texte de lâ€™UI se rÃ©sout via <code>t(clÃ©)</code> contre des fichiers JSON par langue dans <code>Lang/</code> â€” de simples maps clÃ©â†’texte, chargÃ©es du disque au dÃ©marrage. Ordre de rÃ©solution : la langue active â†’ le dictionnaire <b>franÃ§ais</b> (le FR est la langue de base) â†’ la clÃ© brute elle-mÃªme, pour quâ€™une traduction manquante soit visible plutÃ´t que silencieuse.</p><ul><li><b>Bascule en direct</b> : changer de langue rÃ©-applique immÃ©diatement chaque attribut <code>data-i18n</code> et Ã©met un Ã©vÃ©nement <code>langChanged</code> pour les modules dynamiques â€” sans redÃ©marrage.</li><li><b>Ajouter une langue</b> = dÃ©poser un nouveau JSON dans <code>Lang/</code> : elle apparaÃ®t dans le sÃ©lecteur (avec le nom/drapeau de son <code>_info</code>) sans recompilation.</li><li>Chaque fichier peut aussi fournir des groupes <code>_synonyms</code> â€” fusionnÃ©s entre langues pour alimenter la <b>recherche sÃ©mantique</b> de la palette et des docs.</li></ul>',
            }),
            devArticle('docker-deployment', { en: 'Docker deployment', fr: 'DÃ©ploiement Docker' }, { en: 'Running the community/server pieces in containers.', fr: 'ExÃ©cuter les briques communautÃ©/serveur en conteneurs.' }, 'docker deploy container', {
                en: '<p>The community and server-side pieces (the web hub, repo hosting) run as containers via Docker Compose, so a host can bring the whole stack up reproducibly and update it in place. This is for people self-hosting the infrastructure, not for using BMM itself.</p>',
                fr: '<p>Les briques communautÃ© et cÃ´tÃ© serveur (le hub web, l\'hÃ©bergement de dÃ©pÃ´ts) tournent en conteneurs via Docker Compose : un hÃ©bergeur peut monter toute la stack de faÃ§on reproductible et la mettre Ã  jour sur place. C\'est pour ceux qui auto-hÃ©bergent l\'infrastructure, pas pour utiliser BMM lui-mÃªme.</p>',
            }),
            devArticle('hosting-flow', { en: 'Hosting flow (publish â†’ subscribe)', fr: 'Flux dâ€™hÃ©bergement (publier â†’ sâ€™abonner)' }, { en: 'The end-to-end path, and how a hosted repo is served.', fr: 'Le chemin complet, et comment un dÃ©pÃ´t hÃ©bergÃ© est servi.' }, 'hosting flow publish subscribe dedicated server manifest', {
                en: '<p>Publishing turns a profile into a repo with a <b>manifest</b> (files + their hashes) and access rules. Subscribing points a client at its link; the client diffs the manifest against what it already has, pulls <b>only the difference</b>, and verifies each transferred file by hash â€” which is why a small update to a huge collection costs a few MB. It then stays in sync as the owner updates. That\'s the whole path, from one person\'s setup to a group running the exact same thing.</p>',
                fr: '<p>Publier transforme un profil en dÃ©pÃ´t avec un <b>manifeste</b> (fichiers + leurs hachages) et des rÃ¨gles d\'accÃ¨s. S\'abonner pointe un client sur son lien ; le client compare le manifeste Ã  ce qu\'il possÃ¨de, ne tire que la <b>diffÃ©rence</b>, et vÃ©rifie chaque fichier transfÃ©rÃ© par hachage â€” d\'oÃ¹ le coÃ»t de quelques Mo pour une petite mise Ã  jour d\'une Ã©norme collection. Il reste ensuite synchronisÃ© Ã  mesure que le propriÃ©taire met Ã  jour. C\'est tout le chemin, de la configuration d\'une personne Ã  un groupe faisant exactement la mÃªme chose.</p>',
            }),
            devArticle('crash-reporting', { en: 'Crash reporting', fr: 'Rapports de plantage' }, { en: 'What a report contains and how itâ€™s built.', fr: 'Ce que contient un rapport et comment il est construit.' }, 'crash report diagnostics', {
                en: '<p>On a crash BMM writes a self-contained zip â€” logs, system info, and the rolling session recording â€” that you can review and share. A clean exit writes a lighter session log; the expensive parts (a full system snapshot, the recording) are collected only for real crashes, so closing the app stays fast.</p>',
                fr: '<p>En cas de plantage, BMM Ã©crit un zip autonome â€” journaux, infos systÃ¨me et l\'enregistrement de session glissant â€” que vous pouvez relire et partager. Une fermeture propre Ã©crit un journal plus lÃ©ger ; les parties coÃ»teuses (instantanÃ© systÃ¨me complet, enregistrement) ne sont collectÃ©es que pour de vrais plantages, pour que fermer l\'app reste rapide.</p>',
            }),
            devArticle('discord-rpc', { en: 'Discord RPC', fr: 'Discord RPC' }, { en: 'Rich presence integration.', fr: 'IntÃ©gration de la rich presence.' }, 'discord rpc presence', {
                en: '<p>BMM can show your current activity as Discord <b>rich presence</b>, updating as you switch profiles or work. It\'s an optional integration you turn on in Settings â€” off by default, and it sends only the activity text you\'d expect.</p>',
                fr: '<p>BMM peut afficher votre activitÃ© en cours en <b>rich presence</b> Discord, mise Ã  jour quand vous changez de profil ou travaillez. C\'est une intÃ©gration optionnelle activÃ©e dans les RÃ©glages â€” dÃ©sactivÃ©e par dÃ©faut, et elle n\'envoie que le texte d\'activitÃ© attendu.</p>',
            }),
            devArticle('betahub-reporting', { en: 'BetaHub reporting', fr: 'Rapports BetaHub' }, { en: 'In-app bug reporting pipeline.', fr: 'Pipeline de signalement de bugs intÃ©grÃ©.' }, 'betahub bug report', {
                en: '<p>The in-app bug reporter packages your description plus context â€” and optionally a session recording â€” and sends it through the BetaHub pipeline, so a report arrives with enough to reproduce the issue instead of a bare "it broke".</p>',
                fr: '<p>Le rapporteur de bugs intÃ©grÃ© empaquette votre description plus le contexte â€” et Ã©ventuellement un enregistrement de session â€” et l\'envoie via le pipeline BetaHub, pour qu\'un rapport arrive avec de quoi reproduire le problÃ¨me au lieu d\'un simple Â« Ã§a a plantÃ© Â».</p>',
            }),
        ],
    },
];
// Factory for the Dev articles. Each carries a REAL explanation (`body`); we only append a short
// pointer to the matching interactive diagram â€” never a placeholder, and never a repeat of the
// summary shown above the article.
function devArticle(diagramId, title, summary, keywords, body, docsPath = '#') {
    return {
        id: diagramId, title, summary, diagram: diagramId, docsPath: docsPath === '#' ? undefined : docsPath, keywords,
        body: {
            en: `${body.en}<p class="dh-diagnote">Open the interactive diagram (button below) to follow this step by step â€” pan, zoom and hover each node.</p>`,
            fr: `${body.fr}<p class="dh-diagnote">Ouvrez le diagramme interactif (bouton ci-dessous) pour suivre Ã©tape par Ã©tape â€” dÃ©placez, zoomez et survolez chaque nÅ“ud.</p>`,
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
// â”€â”€ rendering: chrome (header, part toggle, search) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function chrome() {
    const seg = (p, label, sub) => `<button class="dh-seg ${route.part === p ? 'on' : ''}" data-part="${p}"><span>${tr(label)}</span><small>${tr(sub)}</small></button>`;
    return `
  <div class="dh">
    <div class="dh-top">
      <div class="dh-heading">
        <h1>${tr({ en: 'Help & documentation', fr: 'Aide et documentation' })}</h1>
        <p>${tr({ en: 'Everything about BMM â€” searchable, with hands-on tutorials and interactive diagrams.', fr: 'Tout sur BMM â€” recherchable, avec des tutoriels guidÃ©s et des diagrammes interactifs.' })}</p>
      </div>
      <div class="dh-actions">
        <button class="dh-btn dh-btn-primary" data-act="tutorial">${svg('play', 16)} ${tr({ en: 'Interactive tutorial', fr: 'Tutoriel interactif' })}</button>
        <a class="dh-btn" href="${DOCS_SITE}" target="_blank" rel="noreferrer">${svg('ext', 16)} ${tr({ en: 'Full docs', fr: 'Docs complÃ¨tes' })}</a>
      </div>
    </div>
    <div class="dh-parts">
      ${seg('user', { en: 'User guide', fr: 'Guide utilisateur' }, { en: 'Use every feature', fr: 'Utiliser chaque fonction' })}
      ${seg('dev', { en: 'Developer', fr: 'DÃ©veloppeur' }, { en: 'How it works inside', fr: 'Comment Ã§a marche' })}
    </div>
    <div class="dh-searchbar">
      ${svg('search', 18)}
      <input type="search" class="dh-search" placeholder="${tr({ en: 'Search the docsâ€¦', fr: 'Rechercher dans la docâ€¦' })}" autocomplete="off" spellcheck="false">
      <div class="dh-modes">
        <button class="dh-mode ${route.mode === 'classic' ? 'on' : ''}" data-mode="classic" data-tooltip="${tr({ en: 'Exact text match', fr: 'Correspondance exacte' })}">${tr({ en: 'Classic', fr: 'Classique' })}</button>
        <button class="dh-mode ${route.mode === 'semantic' ? 'on' : ''}" data-mode="semantic" data-tooltip="${tr({ en: 'Match meaning & synonyms', fr: 'Sens et synonymes' })}">${tr({ en: 'Semantic', fr: 'SÃ©mantique' })}</button>
      </div>
      <kbd class="dh-kbd">Ctrl K</kbd>
    </div>
    <div class="dh-crumbs"></div>
    <div class="dh-body"></div>
  </div>`;
}
function crumbs() {
    const home = `<button class="dh-crumb" data-view2="hub">${tr({ en: 'Help', fr: 'Aide' })}</button>`;
    const partName = route.part === 'dev' ? { en: 'Developer', fr: 'DÃ©veloppeur' } : { en: 'User guide', fr: 'Guide utilisateur' };
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
        ${a.diagram ? `<span class="dh-tag dh-tag-dia">${svg('diagram', 11)} ${tr({ en: 'Diagram', fr: 'Diagramme' })}</span>` : ''}
        ${a.media ? `<span class="dh-tag dh-tag-med">${svg('play', 11)} ${tr({ en: 'Demo', fr: 'DÃ©mo' })}</span>` : ''}
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
        return `<figure class="dh-media"><button class="dh-replay" data-replay="${m.src}">${svg('play', 20)} <span>${tr({ en: 'Play session recording', fr: 'Lire lâ€™enregistrement' })}</span></button>${cap}</figure>`;
    return '';
}
function articleView(cat, a) {
    const rel = [
        a.view ? `<button class="dh-rel dh-rel-open" data-nav="${a.view}">${svg('arrow', 15)} ${tr({ en: 'Open', fr: 'Ouvrir' })} ${navLabel(a.view)} ${tr({ en: 'in BMM', fr: 'dans BMM' })}</button>` : '',
        a.tutorial ? `<button class="dh-rel dh-rel-tut" data-tut="${a.tutorial.id}" data-tut-part="${a.tutorial.part || ''}" data-tut-step="${a.tutorial.step || ''}">${svg('play', 15)} ${tr({ en: 'Try it in the tutorial', fr: 'Essayer dans le tutoriel' })}</button>` : '',
        a.diagram ? `<button class="dh-rel dh-rel-dia" data-diagram="${a.diagram}">${svg('diagram', 15)} ${tr({ en: 'Open the diagram', fr: 'Ouvrir le diagramme' })}</button>` : '',
        `<a class="dh-rel dh-rel-ext" href="${DOCS_SITE}${a.docsPath || ''}" target="_blank" rel="noreferrer">${svg('ext', 15)} ${tr({ en: 'Read full docs', fr: 'Lire la doc complÃ¨te' })}</a>`,
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
    <div class="dh-cat-head">${svg('diagram', 24)}<div><h2>${tr({ en: 'Interactive diagrams', fr: 'Diagrammes interactifs' })}</h2><p>${tr({ en: 'Click any diagram to explore it â€” pan, zoom and hover the nodes.', fr: 'Cliquez un diagramme pour lâ€™explorer â€” dÃ©placez, zoomez et survolez les nÅ“uds.' })}</p></div></div>
    <div class="dh-dias">${items}</div>`;
}
// â”€â”€ search (classic + semantic) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        return `<div class="dh-empty">${svg('search', 26)}<p>${tr({ en: 'No results for', fr: 'Aucun rÃ©sultat pour' })} â€œ${escapeHtml(q)}â€.</p><p class="dh-empty-sub">${route.mode === 'classic' ? tr({ en: 'Try Semantic mode, the full docs, or the tutorial.', fr: 'Essayez le mode SÃ©mantique, la doc complÃ¨te ou le tutoriel.' }) : tr({ en: 'Try the full documentation or the interactive tutorial.', fr: 'Essayez la documentation complÃ¨te ou le tutoriel interactif.' })}</p></div>`;
    }
    const artHtml = arts.length ? `<div class="dh-sec-h">${tr({ en: 'Articles', fr: 'Articles' })} Â· ${arts.length}</div><div class="dh-arts">${arts.map(({ art }) => articleCard(art)).join('')}</div>` : '';
    const diaHtml = dias.length ? `<div class="dh-sec-h">${tr({ en: 'Diagrams', fr: 'Diagrammes' })} Â· ${dias.length}</div><div class="dh-dias">${dias.map((d) => `<button class="dh-dia" data-diagram="${d.id}"><span class="dh-dia-ic">${svg('diagram', 18)}</span><span class="dh-dia-t">${d.title}</span></button>`).join('')}</div>` : '';
    return artHtml + diaHtml;
}
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// â”€â”€ controller â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function bodyHtml() {
    switch (route.view) {
        case 'search': return searchView(route.q || '');
        case 'diagrams': return diagramsView();
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
        go({ view: v2.getAttribute('data-view2') === 'diagrams' ? 'diagrams' : 'hub', q: '' });
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
// can deep-link here â€” replaces the old openHelpTo(faq.*) that targeted the removed markup.
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
    host.addEventListener('click', onClick);
    // Re-render on language switch â€” but KEEP the current route so you stay on the same page.
    document.addEventListener('langChanged', () => renderAll());
    // (Ctrl/âŒ˜+K now opens the app-wide command palette â€” see core/commands.ts â€” which includes a
    // "Search the documentation" command that focuses this search.)
    // Public deep-link hooks (used by Settings' FAQ/PAT/disk buttons; supersedes old openHelpTo).
    window.openDocsArticle = openArticle;
    // Open an article by id alone (category resolved from the id) â€” used by the
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