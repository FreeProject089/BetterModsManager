# Architecture technique et analyse du code source - Better Mod Manager (BMM)

Ce document fournit une analyse complète de l'architecture logicielle, des moteurs internes, des modèles de données et des stratégies d'implémentation de Better Mod Manager.

---

## 1. Vue d'ensemble de l'architecture

BMM est construit sur le **framework Tauri v1**, une stack de bureau privilégiant Rust qui fournit une interface utilisateur basée sur WebView avec un backend Rust haute performance.

| Couche | Technologie | Responsabilité |
| :--- | :--- | :--- |
| **Backend Core** | Rust 1.70+, Commandes Tauri | E/S du système de fichiers, gestion d'état, extraction d'archives, requêtes réseau, contrôle de la concurrence |
| **Couche de pont** | Tauri IPC (Invoquer + Événements) | Passage de messages de type sûr entre Rust et JS sans mémoire partagée |
| **Frontend** | Vanilla ES6+ JavaScript | Rendu DOM, routage des vues, i18n, affichage des métadonnées des mods |
| **Style** | Vanilla CSS3 (Propriétés personnalisées) | Thème sombre piloté par des variables, mises en page Flexbox/Grid, animations d'images clés |
| **Persistance des données** | Fichiers JSON via `serde_json` | Profils, entrées de mods, tags et dernier profil actif stockés sur le disque |

---

## 2. Système automatisé de compilation et de versionnage

BMM implémente un système automatisé robuste pour assurer l'intégrité du versionnage sur l'ensemble de la pile applicative.

### Capture de la date au moment du build (`build.rs`)
Un script de build Rust dédié intercepte le processus de compilation pour capturer la date actuelle du système.
- **Logique** : Utilise la crate `chrono` pour formater la date UTC actuelle en `AAAA-MM-JJ`.
- **Injection** : La date est exportée en tant que variable d'environnement au moment de la compilation `BMM_BUILD_DATE`.
- **Persistance** : Cela garantit que la date de build est "gravée" dans le binaire et reste statique pour ce build spécifique.

### Synchronisation dynamique de l'interface utilisateur
Le frontend récupère ces informations au démarrage via des commandes Tauri spécialisées :
- `get_build_date` : Renvoie la date de build statique capturée lors de la compilation.
- `is_ptb_mode` : Vérifie `app.cfg` pour déterminer si les marqueurs PTB doivent être rendus.
- **Séquence de démarrage** : `initVersionDisplay()` dans `app.js` effectue une injection synchronisée dans la barre de titre, le pied de page et la vue des crédits après l'initialisation de l'i18n.

---

## 3. Backend — Gestion de l'état (State Management)

### Structure AppState

L'état global `AppState` enveloppe toutes les données mutables dans un `Arc<Mutex<AppData>>`, assurant un accès sécurisé par thread pour toutes les commandes Tauri concurrentes.

| Champ | Type | Description |
| :--- | :--- | :--- |
| `profiles` | `Vec<Profile>` | Tous les profils de jeu définis par l'utilisateur |
| `mods` | `Vec<ModEntry>` | Tous les mods enregistrés dans chaque profil |
| `tags` | `Vec<CustomTag>` | Étiquettes de taxonomie définies par l'utilisateur (nom + couleur) |
| `active_profile_id` | `Option<String>` | UUID du profil actuellement sélectionné |

### Stratégie de persistance

| Mécanisme | Emplacement | Déclencheur |
| :--- | :--- | :--- |
| Sérialisation JSON | `AppData/Roaming/bmm/` (Windows) | Appelé via `state.save()` après chaque mutation |
| Désérialisation au démarrage | Même chemin | `AppState::load()` au démarrage de l'application |
| Journal d'historique d'activité | Fichier JSON adjacent par profil | Écrit sur chaque appel à `enable_mod` / `disable_mod` |

---

## 4. Backend — Modèles de données

### Profile

| Champ | Type | Description |
| :--- | :--- | :--- |
| `id` | `String` (UUID v4) | Identifiant unique |
| `name` | `String` | Nom d'affichage |
| `game_name` | `String` | Nom de jeu compréhensible |
| `game_path` | `PathBuf` | Chemin absolu vers le répertoire RACINE du jeu |
| `mods_path` | `PathBuf` | Répertoire où les dossiers de mods sont stockés |
| `backup_path` | `PathBuf` | Répertoire où les fichiers originaux sont sauvegardés |
| `active_mods` | `Vec<String>` | Liste ordonnée des IDs de mods actuellement activés |
| `color` | `String` | Code hexadécimal de couleur d'accentuation pour le profil dans la sidebar |
| `icon` | `String` | Identifiant d'icône SVG |

### ModEntry

| Champ | Type | Description |
| :--- | :--- | :--- |
| `id` | `String` (UUID v4) | Identifiant unique |
| `name` | `String` | Nom d'affichage |
| `version` | `String` | Chaîne de version sémantique |
| `author` | `String` | Attribution de l'auteur |
| `description` | `String` | Description libre |
| `mod_folder_path` | `PathBuf` | Chemin absolu vers le dossier racine du mod sur le disque |
| `enabled` | `bool` | Indique si le mod est actuellement actif dans le jeu |
| `status` | `ModStatus` | Enum: `Enabled`, `Disabled`, `AlreadyPresent` |
| `installed_files` | `Vec<String>` | Chemins des fichiers injectés dans la RACINE du jeu |
| `tags` | `Vec<String>` | Noms des tags assignés |
| `download_links` | `Vec<DownloadLink>` | Liens web (GitHub, NexusMods, etc.) avec type et label |
| `sort_priority` | `u32` | Priorité d'installation pour les listes .MM |

---

## 5. Backend — Le moteur de copie intelligent (Smart Copy)

Le cœur de la gestion des mods de BMM est le moteur de copie physique empilée (**Stacked Physical Copy**) dans `src-tauri/src/fs_utils.rs`.

### Flux d'activation (commande `enable_mod`)

| Étape | Fonction | Action |
| :--- | :--- | :--- |
| 1 | `MOD_OP_LOCK.lock()` | Acquiert un Mutex global pour bloquer toute opération concurrente |
| 2 | `apply_mod_stacked()` | Parcourt récursivement chaque fichier dans le dossier du mod |
| 3 | Vérification de conflit | Pour chaque fichier de mod, vérifie si un fichier existe déjà au chemin RACINE du jeu |
| 4 | Sauvegarde | En cas de conflit, le fichier original du jeu est déplacé vers `backup_path`, en préservant la structure exacte des sous-répertoires relatifs |
| 5 | Injection | Le fichier de mod est copié vers le chemin RACINE du jeu |
| 6 | Suivi | Tous les chemins de fichiers installés sont stockés dans `ModEntry.installed_files` |
| 7 | Mise à jour de l'état | `mod.enabled = true`, `profile.active_mods` est mis à jour, `state.save()` est appelé |
| 8 | Journal d'historique | Un événement "Enabled" horodaté est écrit dans le journal d'activité |

### Flux de désactivation (commande `disable_mod`)

| Étape | Fonction | Action |
| :--- | :--- | :--- |
| 1 | `MOD_OP_LOCK.lock()` | Acquiert le Mutex global |
| 2 | Résolution de fichiers | Fusionne `installed_files` (suivis) avec `list_mod_files()` (scannés) dans un ensemble dédupliqué via `HashSet` |
| 3 | `unapply_mod_stacked()` | Pour chaque fichier, supprime la copie installée de la RACINE du jeu |
| 4 | Restauration | Déplace le fichier original sauvegardé depuis `backup_path` vers son emplacement d'origine exact |
| 5 | Mise à jour de l'état | `mod.enabled = false`, retiré de `profile.active_mods`, `state.save()` est appelé |
| 6 | Journal d'historique | Un événement "Disabled" horodaté est écrit |

### Vérification sélective des conflits (introduite dans la v0.9.7)

Pour améliorer les performances lors de l'activation des mods, BMM utilise désormais la **Vérification sélective des conflits** :
- Seuls les mods actifs et le mod actuellement sélectionné sont traités pour les conflits.
- Cela permet une réduction allant jusqu'à 80 % des appels IPC et des opérations sur le système de fichiers lors de l'activation/désactivation en masse.

### Limitation des E/S disque (introduite dans la v0.9.7)

BMM s'attaque au problème du "gel système" courant dans les applications à fortes E/S :
- **Transfert par morceaux (Chunked Transfer)** : Les fichiers sont copiés par morceaux de 2 Mo plutôt qu'en un flux unique.
- **Régulation adaptative** : Après chaque morceau, le moteur se met en veille pendant une durée calculée en fonction de la limite en Mo/s définie par l'utilisateur.
- **Détection par disque** : Le limiteur détecte à quel disque physique appartient un chemin et applique automatiquement la limite correspondante.

### Pourquoi la copie physique plutôt que les liens symboliques (Symlinks)

| Méthode | Stabilité | Compatible Anti-Cheat | Support lecteur réseau |
| :--- | :--- | :--- | :--- |
| Symlinks | Faible (permissions Windows fragiles) | Non (beaucoup d'AC bloquent les symlinks) | Non |
| Copie physique BMM | Haute | Oui | Oui |

---

## 6. Backend — Sécurité des accès concurrents (Concurrency)

| Mécanisme | Objectif |
| :--- | :--- |
| `MOD_OP_LOCK: Mutex<()>` (global statique, `lazy_static`) | Empêche deux opérations d'activation/désactivation de mods de s'exécuter simultanément |
| `Arc<Mutex<AppData>>` | Garantit que toutes les lectures/écritures de l'état de l'application sont séquentiellement cohérentes |
| `tauri::async_runtime::spawn_blocking()` | Décharge toutes les opérations d'E/S lourdes vers un pool de threads dédié, empêchant le thread UI d'être bloqué |

---

## 7. Backend — Moteur d'installation de masse (Format .MM)

### Flux d'installation depuis une liste de mods

| Étape | Mécanisme | Détail |
| :--- | :--- | :--- |
| 1 | Analyse (Parse) | `serde_json::from_str()` désérialise le JSON `.mm` en une structure typée `ModList` |
| 2 | Création de profil | Si `create_profile = true`, un nouveau `Profile` est créé et défini comme actif avant le début de tout téléchargement |
| 3 | Déduplication locale | Pour chaque entrée de mod, BMM recherche un nom de dossier correspondant dans le répertoire des mods de chaque profil existant. S'il est trouvé, le mod est copié localement via `fs_extra`. |
| 4 | Téléchargement HTTP | Si aucune correspondance locale n'existe, `reqwest::blocking::get()` récupère le fichier à partir de l'URL de téléchargement fournie |
| 5 | Détection Zip | Inspecte les 4 premiers octets (PK magic numbers) pour détecter les archives zip, quel que soit l'extension du fichier |
| 6 | Extraction | Parcourt les entrées zip, crée les répertoires et écrit les fichiers via `zip::ZipArchive` |
| 7 | Événements de progression | Après chaque mod, un événement `bmm://mod-download-progress` est émis via `window.emit()` avec `mod_index`, `total_mods`, `mod_name` et `progress` (0.0–100.0) |
| 8 | Annulation | Un `AtomicBool` dans l' `AppState` est vérifié à chaque itération de la boucle d'installation pour permettre une interruption initiée par l'utilisateur. |

### Logique d'annulation

L'annulation est implémentée à l'aide d'un `std::sync::atomic::AtomicBool` partagé au sein de l'`AppState`.
1. La commande `cancel_install_from_modlist` règle le flag à `true`.
2. La boucle d'installation dans `install_from_modlist` vérifie ce flag avant de traiter chaque mod de la liste.
3. Si `true`, la boucle s'arrête et renvoie un ensemble de résultats partiels au frontend.

### Schéma de données ModList

| Champ | Type | Description |
| :--- | :--- | :--- |
| `name` | `String` | Nom d'affichage de la liste |
| `game_name` | `String` | Nom du jeu cible |
| `game_path_hint` | `String` | Suggestion de chemin RACINE du jeu pour la création de profil |
| `description` | `String` | Description de la liste |
| `author` | `String` | Auteur de la liste |
| `mods` | `Vec<ModListEntry>` | Toutes les entrées de mods |

| Champ ModListEntry | Type | Description |
| :--- | :--- | :--- |
| `name` | `String` | Nom du mod |
| `version` | `String` | Chaîne de version |
| `download_links` | `Vec<DownloadLink>` | URLs HTTP + type de lien (**github**, **google_drive**, **mega**, **direct**, **other**) + label |
| `sort_priority` | `u32` | Valeur plus petite = priorité plus élevée dans l'ordre d'installation |
| `file_tree` | `Vec<ModFileEntry>` | Liste complète des chemins de fichiers relatifs (générée lors de l'export) |
| `tags` | `Vec<String>` | Labels de tags reportés du profil source |

---

## 8. Backend — Migration OvGME (`ovgme.rs`)

BMM peut directement analyser les fichiers de configuration binaires `.dat` propriétaires d'OvGME.

| Étape | Détail d'implémentation |
| :--- | :--- |
| **Découverte** | Recherche dans `C:\ProgramData\OvGME\` (avec repli sur `APPDATA`) des sous-répertoires contenant un fichier `game.dat` |
| **Analyse binaire** | La fonction `parse_utf16_string()` lit les données de chaîne encodées en UTF-16 LE à partir d'offsets d'octets fixes dans le format binaire |
| **Mappage de profil** | Les chemins extraits (racine du jeu, dossier des mods) sont mappés vers des structures natives BMM `Profile` et enregistrés dans l'état |

---

## 9. Frontend — Architecture modulaire

Le frontend a été refactorisé en une architecture ES6 modulaire pour assurer l'évolutivité et une maintenance facilitée.

### Modules principaux

| Module | Responsabilité |
| :--- | :--- |
| `api.js` | Pont IPC direct avec Tauri. Gère tous les appels `invoke` et les sélecteurs de fichiers. |
| `state.js` | Gestionnaire d'état centralisé. Synchronise l'environnement UI local avec le backend Rust. |
| `profiles.js` | Logique de gestion de profils, rendu de grille et sélection de profil actif. |
| `mods.js` | Logique de la bibliothèque de mods, activations et gestion des événements de conflit en temps réel. |
| `i18n.js` | Moteur d'internationalisation avec découverte dynamique des fichiers de langue. |
| `utils.js` | Fonctions utilitaires partagées (échappement HTML, assainissement de chaîne, formatage de date). |

---

## 10. Moteur d'internationalisation dynamique

La version 0.9.7 de BMM introduit un système i18n entièrement dynamique qui permet une extension des traductions sans configuration (zero-config).

### Détection et chargement
- **Commande Rust** : `get_available_languages` scanne le répertoire `Lang` en utilisant un résolveur de chemin récursif qui s'adapte aux environnements de développement et de production.
- **Synchronisation Frontend** : Le module `i18n.js` récupère cette liste et génère dynamiquement les éléments du sélecteur de langue, incluant les assets FlagCDN basés sur les codes ISO à 2 lettres.
- **Attributs de données** : Utilise les attributs `data-i18n` pour tous les éléments UI statiques, permettant un changement de langue instantané sans recharger l'application.

---

## 11. Frontend — Sécurité

| Menace | Atténuation | Implémentation |
| :--- | :--- | :--- |
| XSS via métadonnées de mod | Échappement des entités HTML | `escHtml()` convertit `<`, `>`, `"`, `&` en entités sûres avant toute injection `innerHTML` dans le DOM |
| Injection d'attributs | Échappement des attributs | `escAttr()` assainit les chaînes insérées dans les valeurs d'attributs HTML |
| Traversée de chemin (Path traversal) | Respect de la portée Tauri | Le backend Rust valide tous les chemins de fichiers par rapport aux limites du profil enregistré avant toute E/S |

---

## 12. Sommaire des spécifications techniques

| Paramètre | Implémentation |
| :--- | :--- |
| **Langage (Backend)** | Rust 1.70+ (Tauri v1) |
| **Langage (Frontend)** | ES2022 JavaScript — Architecture modulaire |
| **Réseau** | reqwest 0.11 (bloquant + async) |
| **Archivage** | zip-rs 0.6 |
| **Sérialisation d'état** | serde / serde_json |
| **Opérations fichiers** | std::fs + fs_extra 1.x |
| **Modèle de concurrence** | Arc + Mutex + tauri::async_runtime |
| **RAM au repos** | environ 60 Mo |
| **RAM active (E/S)** | Moins de 130 Mo |
| **Framerate UI** | 60 FPS |
| **Temps de démarrage à froid** | Moins de 1,5 seconde |
| **Infos Système** | `sysinfo 0.30` |
| **Traçage de crash** | `backtrace 0.3` |

---

## 13. Système de crash et de logs (`crash.rs`)

BMM implémente un système hybride de journalisation en temps réel pour prévenir la perte de données en cas de panique non gérée ou de fin brutale du processus.

### Flux de journalisation

| Mécanisme | Implémentation | Rôle |
| :--- | :--- | :--- |
| **LOG_BUFFER** | `VecDeque<String>` (cap 500) | Buffer circulaire thread-safe pour l'accès en mémoire et les instantanés d'état. |
| **Log de la session en cours** | `current_session.log` | Écriture sur disque en temps réel via `file.sync_all()`. Agit comme un fichier de "battement de cœur". |
| **Panic Hook** | `std::panic::set_hook` | Intercepte les erreurs fatales, génère un `backtrace` complet et déclenche la génération d'un ZIP avant la fermeture. |

### Mécanisme de récupération

Au démarrage de l'application, `init_session()` scanne le répertoire `com.bettermm.app/` :
1. Si `current_session.log` existe, BMM suppose que la session précédente a crashé ou a été tuée (Alt+F4).
2. `generate_report()` est appelé pour créer un `crash_AAAAMMDD_HHMMSS.zip` dans le dossier `Crashes/`.
3. L'ancien log est renommé puis remplacé par un nouveau log pour la session actuelle.

---

## 14. Dépannage avancé (Menu Debug)

La commande `is_debug_mode` contrôle la visibilité des outils de développement via `app.cfg`.

| Diagnostic | Logique |
| :--- | :--- |
| **Vérification Config** | `app_handle.path_resolver().resolve_resource("../app.cfg")` |
| **Réinitialisation État** | Écrase les données en mémoire `AppData` avec `Default::default()`, efface le fichier disque `data.json` et déclenche un `localStorage.clear()` côté frontend. |
| **Déclenchement Manuel** | Expose la commande `trigger_manual_crash_report` pour la validation du format ZIP. |

---

## 15. Moteur de mise à jour automatique (`autoupdate.rs`)

BMM inclut un vérificateur de mise à jour basé sur GitHub impémenté comme une commande Tauri asynchrone.

### Flux de vérification de mise à jour

| Étape | Implémentation | Détail |
| :--- | :--- | :--- |
| 1 | `check_for_update` | Commande Tauri asynchrone déclenchée par le frontend au démarrage ou via un bouton manuel |
| 2 | Requête HTTP | `reqwest::Client` avec `User-Agent: BetterModManager` interroge `https://api.github.com/repos/FreeProject089/BetterModsManager/releases/latest` |
| 3 | Analyse de version | Retire le préfixe `v` / `V` du `tag_name`, sépare en segments `MAJEUR.MINEUR.PATCH` |
| 4 | Comparaison SemVer | `is_newer_version()` compare chaque segment de gauche à droite ; renvoie `true` seulement si la dernière est strictement supérieure |
| 5 | Détection d'asset | Scanne le tableau `assets[]` pour trouver le `.msi` (priorité), puis le `.exe` / `.zip`, extrait le `browser_download_url` |
| 6 | Réponse | Renvoie `UpdateInfo { has_update, current_version, latest_version, release_url, release_notes, download_url }` |

### Gestion des erreurs

| Statut | Comportement |
| :--- | :--- |
| **404** | Renvoie `Err("NO_RELEASE")` — le frontend affiche un toast informatif plutôt qu'une erreur |
| **Échec Réseau** | Renvoie `Err("Network error: ...")` — le frontend affiche un toast d'erreur en manuel, reste silencieux en automatique |
| **Erreur de JSON** | Renvoie `Err("JSON parse error: ...")` |

### Intégration Frontend

| Mécanisme | Implémentation |
| :--- | :--- |
| **Activation auto-check** | `localStorage('bmm_auto_update_enabled')`, défaut `true` |
| **Check au démarrage** | `setTimeout(() => performUpdateCheck(false), 3000)` — non bloquant, pas de toast si à jour |
| **Vérification manuelle** | Bouton sidebar (`#btn-check-updates`) et bouton Paramètres (`#btn-settings-check-update`) |
| **Modale de mise à jour** | Élément DOM créé dynamiquement avec comparaison de version, notes de mise à jour Markdown et lien de téléchargement |

---

## 16. Système PTB (Public Test Build)

BMM supporte un mode de distribution PTB contrôlé via `app.cfg`.

### Détection

| Commande | Logique |
| :--- | :--- |
| `is_ptb_mode` | Lit `app.cfg` via `path_resolver().resolve_resource("../app.cfg")`, vérifie si `ptb=true` (insensible à la casse) |
| `get_ptb_notes` | Scanne à la fois le répertoire de ressources et la racine du projet dev pour tout fichier correspondant à `*PTB*.md`, renvoie son contenu sous forme de chaîne |

### Flux Frontend

| Étape | Détail |
| :--- | :--- |
| 1 | `checkPtbMode()` appelé pendant la séquence `main()` au démarrage |
| 2 | Invoque `is_ptb_mode` — si `false`, quitte silencieusement |
| 3 | Vérifie `sessionStorage('bmm_ptb_dismissed')` — si déjà fermé pour cette session, quitte |
| 4 | Invoque `get_ptb_notes` pour charger le contenu markdown du PTB |
| 5 | Rend le contenu via `marked.parse()` (avec repli `<br>`) |
| 6 | Affiche une modale à thème avec en-tête (icône + titre + badge PTB), corps défilant et bouton de fermeture bleu principal |
| 7 | À la fermeture, définit le flag `sessionStorage` pour empêcher le réaffichage jusqu'au prochain redémarrage de l'application |

---

## 17. Surveillance de performance en temps réel

Le Tableau de bord de performance est un sous-système de surveillance autonome.

| Couche | Implémentation |
| :--- | :--- |
| **Collecte de données** | La crate Rust `sysinfo` capture le CPU normalisé par cœur, la RAM globale et les E/S disque par processus. |
| **Visualisation** | Implémentation de style Chart.js réutilisable utilisant des Canvas et des chemins SVG personnalisés pour une efficacité maximale. |
| **Relecture (Timeline Replay)** | Stocke l'intégralité de la session de suivi dans des objets compressés en binaire, permettant un défilement d'image comme dans Premiere. |
| **Mode PiP** | Utilise une couche UI secondaire pour rester visible même quand le gestionnaire principal est réduit ou concentré sur une autre tâche. |

---

## 18. Moteur de documentation interactive

La version 0.9.8 de BMM intègre un pont Mermaid.js personnalisé pour une visualisation technique de haute fidélité.

| Fonctionnalité | Implémentation |
| :--- | :--- |
| **Traduction dynamique** | Une couche de mappage de clés spécialisée intercepte le rendu des nœuds Mermaid pour injecter des chaînes localisées depuis `fr.json`/`en.json`. |
| **Intégration Pan-Zoom** | Utilise la bibliothèque `svg-pan-zoom` avec un gestionnaire d'état persistant pour maintenir les coordonnées du viewport à travers les changements de vue. |
| **Pont d'explication** | Les info-bulles et les panneaux latéraux sont alimentés via le système `explanationPrefix`, liant les nœuds de diagramme à des clés i18n de niveau profond. |

---

## 19. Moteur Multimédia et Crédits

| Fonctionnalité | Implémentation |
| :--- | :--- |
| **Arrière-plans vidéo** | La page des Crédits présente un fond MP4 en boucle haute performance servi via le protocole `asset://`. |
| **Lecture consciente de l'état** | Un Intersection Observer spécialise met en pause le traitement vidéo quand la vue n'est pas visible, réduisant la charge CPU/GPU à 0 %. |

---

## 20. Système de Dépôt Serveur (Mode Serveur)

La version 0.9.8 de BMM introduit le système de **Dépôt Serveur**, une alternative robuste au partage basé sur les liens.

### 20.1. Architecture
- **Moteur d'hébergement** : Utilise un serveur HTTP intégré pour servir les fichiers de mods statiques et le manifeste `repo.json`. Aucune dépendance externe requise pour l'hébergement local.
- **Manifeste (repo.json)** : Un fichier JSON signé cryptographiquement (SHA-256) contenant l'état complet du dépôt.
- **Moteur Smart Sync** : Le client récupère le manifeste, effectue une comparaison locale par rapport à ses profils actifs et ne télécharge que le delta (fichiers manquants ou modifiés).

### 20.2. Sécurité et intégrité
- **Résistance aux collisions** : Utilise des empreintes SHA-256 pour garantir que les fichiers de mods ne sont pas corrompus pendant le transfert.
- **Isolation de chemin** : Le serveur limite strictement l'accès aux fichiers au dossier de dépôt désigné, empêchant les attaques par traversée de chemin.

---

### 21. Cohérence de l'UI et normalisation de l'état

### États vides unifiés
La version 0.9.8 de BMM implémente une stratégie de composants partagés pour les états vides à travers les vues.
- **Hijacking de l'état** : La logique `renderModList` détecte désormais l'absence d'un profil actif et redirige vers un conteneur dédié `empty-library-no-profile`, qui est un clone structurel du composant primaire `empty-profiles`.
- **Clarté cognitive** : Le système distingue explicitement entre "Aucun profil sélectionné" (État Global) et "Résultat vide" (État Contextuel), réduisant la confusion pour les nouveaux utilisateurs.
- **Interaction améliorée** : Le bouton "Comment ça marche" invoque correctement `window.openDocs` (aliasé en `openDiagram`), et le bouton de création de profil navigue de manière fluide entre les onglets avant d'ouvrir les modales.

### 22. Backend de la suite d'administration serveur

La suite d'administration exploite des modules Rust dédiés pour une gestion haute vitesse de l'IP et des IDs.

| Module | Responsabilité |
| :--- | :--- |
| `ban_manager.rs` | Gère la persistance des IPs et IDs de Créateurs bannis. Utilise un `HashSet` thread-safe pour des recherches en O(1) lors des tentatives de connexion. |
| `whitelist_manager.rs` | Gère l'état de la liste blanche du dépôt. Intégré à la couche de filtrage des requêtes du serveur HTTP. |
| `security.rs` | Fournit des utilitaires pour la génération d'ID de Créateur et le hachage avec sel (salted hashing) pour prévenir l'usurpation d'identité. |

### 23. Rendu Multimédia

| Couche | Implémentation |
| :--- | :--- |
| **Crédits BG** | Composant de lecteur vidéo personnalisé utilisant le protocole `asset://` pour contourner les restrictions de sécurité habituelles des navigateurs pour les fichiers vidéo locaux. |
| **Régulation** | L'observateur `on_view_changed` dans `credits.js` garantit que la lecture vidéo est strictement suspendue quand l'utilisateur navigue ailleurs, préservant les ressources pour les opérations sur les mods. |

## 24. Gestionnaire de liens profonds (Deep Link Manager - bmm://)

BMM implémente un gestionnaire de protocole personnalisé pour faciliter les installations de mods en un clic.

| Composant | Implémentation |
| :--- | :--- |
| **Enregistrement Registre** | Au démarrage, le backend s'assure que le protocole `bmm://` est enregistré dans le Registre Windows, pointant vers l'exécutable BMM. |
| **Analyse d'URL** | La classe `DeepLinkManager` gère les URIs `bmm://` entrants, analysant les paramètres de requête pour les métadonnées de mod et les liens de téléchargement. |
| **Extension dynamique de l'UI** | La modale One-Click étend dynamiquement sa hauteur (à 550px) si l'utilisateur sélectionne "Créer un nouveau profil", déclenchant une boucle de validation réactive pour les nouveaux chemins. |

---

## 25. Moteur Discord RPC

Le système Discord Rich Presence permet une synchronisation de l'activité en temps réel.

| Composant | Implémentation |
| :--- | :--- |
| **Intégration Backend** | Utilise la crate Rust `discord-rpc` pour communiquer avec le client Discord desktop via un socket IPC local. |
| **Synchronisation d'état** | Le frontend émet des événements `discord-update` chaque fois qu'un profil est changé ou qu'un mod est basculé, que le backend traduit ensuite en mises à jour d'activité Discord (Grande Image, Petite Image, Détails, État). |
| **Contrôle de confidentialité** | Contrôlé par un flag persistant dans `app.cfg`. Lorsqu'il est désactivé, la boucle de pulsation (heartbeat) est immédiatement interrompue. |

---

## 26. Moteur de Diagnostic de Conflits Avancé

La version 0.9.8 de BMM introduit une visualisation par graphique pour les collisions de fichiers de mods.

| Composant | Implémentation |
| :--- | :--- |
| **Matrice de collision** | Le backend génère une matrice de collision en comparant les `installed_files` de tous les mods actifs. |
| **Pont Mermaid** | Le frontend convertit cette matrice en une définition de diagramme de flux Mermaid.js. |
| **Couche d'interaction** | Implémente des gestionnaires de clics personnalisés sur les nœuds Mermaid. Cliquer sur un nœde de mod déclenche un événement `dispatchNavigation` vers la Bibliothèque de Mods avec le mod spécifique mis en évidence. |

---

*Better Mod Manager est développé par FreeProject089 — Conçu pour une performance sans compromis, la sécurité des fichiers et une gestion moderne des mods.*
