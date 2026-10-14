// Plain-words explanations of every benchmark, English and French. Keyed by Criterion group,
// JS suite prefix, hyperfine file or memory-collector operation. `explain(metric)` finds the
// entry for one metric; an unknown benchmark gets a generic line rather than nothing.

const L = (en, fr) => ({ en, fr });

export const SOURCES = {
  criterion: L('Rust, in-process (Criterion): the real Rust code BMM runs, timed many times inside one process. The interval is Criterion\'s 95 % bootstrap confidence interval of the mean.',
    'Rust, dans le processus (Criterion) : le vrai code Rust de BMM, chronométré de nombreuses fois dans un seul processus. L\'intervalle est l\'intervalle de confiance à 95 % de la moyenne calculé par Criterion (bootstrap).'),
  js: L('Interface (Node micro-benchmarks): the interface code, timed in batches after a warm-up. The interval is ±1.96 standard errors (95 %).',
    'Interface (micro-benchmarks Node) : le code de l\'interface, chronométré par lots après un échauffement. L\'intervalle vaut ±1,96 erreur type (95 %).'),
  hyperfine: L('End to end (hyperfine): a whole process starts, does one real operation and exits; this is the wait a person actually feels. The interval is ±1.96·σ/√n over the runs.',
    'De bout en bout (hyperfine) : un processus complet démarre, fait une vraie opération et s\'arrête ; c\'est l\'attente réellement ressentie. L\'intervalle vaut ±1,96·σ/√n sur les exécutions.'),
  mem: L('Memory collector (one run): time and peak extra heap of each operation, measured once. No interval, so only large changes count.',
    'Collecteur mémoire (une exécution) : temps et pic de mémoire supplémentaire de chaque opération, mesurés une fois. Pas d\'intervalle : seuls les grands écarts comptent.'),
};

/** what: what is measured; why: why a user cares. Unit and direction are added by the report. */
export const GROUPS = {
  archive_entries: { what: L('Listing the files inside a mod archive (zip, tar, tar.gz, 7z) without extracting it. Same 7 MiB mod in every format.',
    'Lister les fichiers d\'une archive de mod (zip, tar, tar.gz, 7z) sans l\'extraire. Le même mod de 7 Mio dans chaque format.'),
    why: L('BMM does this when you import or preview an archived mod: it is the delay before the file list appears.',
      'BMM le fait quand vous importez ou prévisualisez un mod archivé : c\'est le délai avant que la liste de fichiers s\'affiche.') },
  archive_extract_to: { what: L('Fully extracting the same mod archive to disk, per format (throughput counted on the uncompressed size).',
    'Extraire entièrement la même archive sur le disque, par format (débit compté sur la taille décompressée).'),
    why: L('This is the main cost of enabling an archived mod.', 'C\'est le coût principal de l\'activation d\'un mod archivé.') },
  archive_entry_count_invariant: { what: L('A correctness check (every format reports the same number of files), not a timing.',
    'Une vérification (chaque format annonce le même nombre de fichiers), pas une mesure de temps.'), why: L('Ignore the number.', 'Ignorez le nombre.'), ignore: true },
  blake3: { what: L('Hashing files with BLAKE3, BMM\'s local content hash (2 MiB files and 64 KiB files).',
    'Hacher des fichiers avec BLAKE3, l\'empreinte locale de BMM (fichiers de 2 Mio et de 64 Kio).'),
    why: L('Used for integrity checks and duplicate detection in your library.', 'Sert aux contrôles d\'intégrité et à la détection des doublons de la bibliothèque.') },
  sha256: { what: L('Hashing the same files with SHA-256, the format repositories and downloads use.',
    'Hacher les mêmes fichiers en SHA-256, le format des dépôts et des téléchargements.'),
    why: L('Paid when a repository is synced or a download is verified.', 'Payé à la synchronisation d\'un dépôt ou à la vérification d\'un téléchargement.') },
  dir_scan: { what: L('Walking a mod folder and listing its files: jwalk (what BMM ships), walkdir and plain std recursion, on small (200 tiny files), medium (120) and large (24 big files) mods.',
    'Parcourir un dossier de mod et lister ses fichiers : jwalk (ce que BMM utilise), walkdir et la récursion std, sur de petits (200 fichiers minuscules), moyens (120) et gros (24 gros fichiers) mods.'),
    why: L('Every library scan and every activation starts with this walk.', 'Chaque analyse de la bibliothèque et chaque activation commence par ce parcours.') },
  file_copy: { what: L('Copying a 3 MiB file: std::fs::copy versus the smart-I/O chunked copy (1 MiB and 256 KiB chunks).',
    'Copier un fichier de 3 Mio : std::fs::copy contre la copie par blocs « smart I/O » (blocs de 1 Mio et 256 Kio).'),
    why: L('Activation copies mod files into the game folder.', 'L\'activation copie les fichiers des mods dans le dossier du jeu.') },
  repo_json_parse: { what: L('Reading a repository manifest (repo.json) of 5, 50 and 500 mods into BMM\'s typed structure.',
    'Lire un manifeste de dépôt (repo.json) de 5, 50 et 500 mods dans la structure typée de BMM.'),
    why: L('Each repository sync reads one.', 'Chaque synchronisation de dépôt en lit un.') },
  repo_json_serialize: { what: L('Writing the same manifests back to JSON.', 'Réécrire ces manifestes en JSON.'),
    why: L('Paid when you host or export a repository.', 'Payé quand vous hébergez ou exportez un dépôt.') },
  repo_json_typed_vs_value: { what: L('Parsing the 500-mod manifest into typed structs versus an untyped JSON tree.',
    'Lire le manifeste de 500 mods en structures typées ou en arbre JSON non typé.'),
    why: L('Shows why BMM parses into typed structures.', 'Montre pourquoi BMM lit en structures typées.') },
  creator_cold_load: { what: L('Loading the creator key store from disk (unseal + validate), and reloading it warm.',
    'Charger le coffre de la clé créateur depuis le disque (déverrouillage + validation), puis le recharger à chaud.'),
    why: L('Happens the first time a signed action needs your creator key.', 'Arrive la première fois qu\'une action signée a besoin de votre clé créateur.') },
  creator_proof_build: { what: L('Building a creator proof: fingerprint + Ed25519 signature, cached fingerprint, signature only.',
    'Construire une preuve créateur : empreinte + signature Ed25519, empreinte en cache, signature seule.'),
    why: L('Paid each time you publish or sign something as a creator.', 'Payé à chaque publication ou signature en tant que créateur.') },
  creator_rotation: { what: L('Rotating the creator key and persisting the new store.', 'Faire tourner la clé créateur et enregistrer le nouveau coffre.'),
    why: L('Rare (a manual action), shown for completeness.', 'Rare (action manuelle), montré pour être complet.') },
  catalog_normalize: { what: L('NEW in 1.0.2. Converting a catalogue to the universal format and validating it: v1 apps, v1 plugins, and an already universal document, at 100, 1 000 and 5 000 items.',
    'NOUVEAU en 1.0.2. Convertir un catalogue au format universel et le valider : apps v1, plugins v1 et un document déjà universel, à 100, 1 000 et 5 000 éléments.'),
    why: L('Every catalogue refresh (apps, plugins, themes, …) goes through it before the list appears.', 'Chaque actualisation de catalogue (apps, plugins, thèmes, …) passe par là avant l\'affichage de la liste.') },
  repo_hash: { what: L('NEW in 1.0.2. Hashing a repository for « Validate » / « Convert » (SHA-256 plus a hash per 4 MiB chunk): one file after the other, in parallel (as the app does), and the cache-hit path (nothing read).',
    'NOUVEAU en 1.0.2. Hacher un dépôt pour « Valider » / « Convertir » (SHA-256 et une empreinte par bloc de 4 Mio) : fichier après fichier, en parallèle (comme l\'application), et le chemin du cache (rien n\'est relu).'),
    why: L('The wait after you press Validate on the Server Repo page, first time and again.', 'L\'attente après « Valider » sur la page Server Repo, la première fois et les suivantes.') },
};

export const JS_SUITES = [
  ['mod-list filter+sort', { what: L('Filtering and sorting the mod list (search that mostly misses, sorted by name) for 200, 1 000 and 5 000 mods. « shipped » is the OLD implementation kept as a baseline; « optimized » is what BMM runs now.',
    'Filtrer et trier la liste des mods (recherche qui échoue le plus souvent, tri par nom) pour 200, 1 000 et 5 000 mods. « shipped » est l\'ANCIENNE implémentation gardée comme référence ; « optimized » est ce que BMM exécute maintenant.'),
    why: L('Runs on every keystroke in the library search box.', 'Tourne à chaque frappe dans la recherche de la bibliothèque.') }],
  ['mod-list sort only', { what: L('Sorting 5 000 mods by name, status and activation order (old vs current implementation).', 'Trier 5 000 mods par nom, état et ordre d\'activation (ancienne implémentation contre l\'actuelle).'),
    why: L('Changing the sort order of a big library.', 'Changer l\'ordre de tri d\'une grande bibliothèque.') }],
  ['i18n t()', { what: L('Looking up a translated string and filling its {placeholders}: one call, and a full screen of 200 strings.', 'Chercher une chaîne traduite et remplir ses {variables} : un appel, puis un écran complet de 200 chaînes.'),
    why: L('Every label on every page goes through it.', 'Chaque libellé de chaque page passe par là.') }],
  ['escHtml', { what: L('Escaping text before it is inserted in the page (plain text, text with < > & " \', and a mixed screen).', 'Échapper le texte avant de l\'insérer dans la page (texte simple, texte avec < > & " \', écran mélangé).'),
    why: L('Safety and speed of every list that shows mod names and descriptions.', 'Sécurité et rapidité de chaque liste qui affiche des noms et descriptions de mods.') }],
  ['activity registry', { what: L('NEW in 1.0.2. The activity centre registry: one task started, updated 10 times and finished (with a listener and history saved), and the overall progress over 20 running tasks.',
    'NOUVEAU en 1.0.2. Le registre du centre d\'activité : une tâche démarrée, mise à jour 10 fois et terminée (avec un abonné et l\'historique enregistré), et la progression globale de 20 tâches.'),
    why: L('Its overhead is added to every long operation; it must stay negligible.', 'Son coût s\'ajoute à chaque opération longue ; il doit rester négligeable.') }],
  ['catalogue normaliser JS', { what: L('NEW in 1.0.2. The interface\'s copy of the catalogue normaliser on a v1 apps catalogue of 100 and 1 000 items.',
    'NOUVEAU en 1.0.2. La copie du normaliseur de catalogues côté interface, sur un catalogue d\'apps v1 de 100 et 1 000 éléments.'),
    why: L('Catalogues read by the page itself (App catalogue, themes).', 'Les catalogues lus par la page elle-même (catalogue d\'apps, thèmes).') }],
];

export const E2E = {
  extract: { what: L('Starting a process and extracting the 7 MiB mod archive, per format.', 'Démarrer un processus et extraire l\'archive de 7 Mio, par format.'), why: L('Closest to « click Enable on an archived mod and wait ».', 'Le plus proche de « cliquer Activer sur un mod archivé et attendre ».') },
  entries: { what: L('Starting a process and listing an archive\'s files.', 'Démarrer un processus et lister les fichiers d\'une archive.'), why: L('Closest to previewing an archive.', 'Le plus proche de la prévisualisation d\'une archive.') },
  scan: { what: L('Starting a process and scanning an extracted mod folder.', 'Démarrer un processus et analyser un dossier de mod extrait.'), why: L('Closest to a library refresh of one mod.', 'Le plus proche de l\'actualisation d\'un mod de la bibliothèque.') },
};

export const MEM = {
  what: L('The same hot operations run once on a 49 MiB fixture, with the peak heap they add.', 'Les mêmes opérations, exécutées une fois sur un jeu de 49 Mio, avec le pic de mémoire qu\'elles ajoutent.'),
  why: L('Memory a long operation holds while you keep using BMM.', 'La mémoire qu\'une opération longue occupe pendant que vous continuez à utiliser BMM.'),
};

/** { what, why, ignore } for one metric, in `lang`. */
export function explain(m, lang = 'en') {
  let e = null;
  if (m.source === 'criterion') e = GROUPS[m.group];
  else if (m.source === 'js') e = JS_SUITES.find(([p]) => m.group.startsWith(p))?.[1];
  else if (m.source === 'hyperfine') e = E2E[m.group.replace(/^e2e /, '')];
  else if (m.source === 'mem') e = MEM;
  if (!e) return { what: lang === 'fr' ? 'Mesure sans description.' : 'No description for this benchmark yet.', why: '', ignore: false };
  return { what: e.what[lang], why: e.why[lang], ignore: !!e.ignore };
}

export function unitText(m, lang = 'en') {
  if (m.unit === 'KiB') return lang === 'fr' ? 'mémoire (Kio), plus bas = mieux' : 'memory (KiB), lower is better';
  return lang === 'fr' ? 'temps moyen par opération, plus bas = mieux' : 'mean time per operation, lower is better';
}
