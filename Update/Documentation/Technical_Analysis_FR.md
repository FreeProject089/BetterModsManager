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
| `active_profile_id` | `Option<String>` | UUID du profil actuellement sélectionné |
| `custom_tags` | `Vec<TagDef>` | Étiquettes de taxonomie définies par l'utilisateur (nom + couleur) |
| `disk_limits` | `HashMap<String, u64>` | Limites d'E/S disque par chemin (Mo/s) |
| `settings` | `AppSettings` | Préférences/configuration de l'app |
| `launch_packs` | `Vec<LaunchPack>` | Groupes de lancement d'applications |
| `installed_plugins` | `Vec<InstalledPlugin>` | Manifestes des plugins installés |
| `plugin_permissions` | `HashMap<String, Vec<String>>` | Permissions accordées par id de plugin |
| `modpacks` | `Vec<LocalModpack>` | Modpacks `.bmp` stockés localement |

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
| `author` | `Option<String>` | Attribution de l'auteur |
| `description` | `Option<String>` | Description libre |
| `dependencies` | `Vec<String>` | Dépendances déclarées du mod |
| `mod_folder_path` | `PathBuf` | Chemin absolu vers le dossier racine du mod sur le disque |
| `enabled` | `bool` | Indique si le mod est actuellement actif dans le jeu |
| `status` | `ModStatus` | Enum: `Enabled`, `Disabled`, `Error(String)` |
| `installed_files` | `Vec<String>` | Chemins des fichiers injectés dans la RACINE du jeu |
| `tags` | `Vec<String>` | Noms des tags assignés |
| `download_links` | `Vec<DownloadLink>` | Liens web (GitHub, NexusMods, etc.) avec type et label |
| `install_notes` | `String` | Instructions de placement/installation (héritées du `.MM`) |
| `activation_order` | `u32` | Ordre d'activation (0 = premier appliqué), pour la résolution de conflits |
| `file_hashes` | `Option<HashMap<String,String>>` | Map SHA-256 par fichier pour le moteur d'intégrité |
| `content_id` | `Option<String>` | Empreinte de contenu déterministe (voir §46) |

---

## 5. Backend — Le moteur de copie intelligent (Smart Copy)

Le cœur de la gestion des mods de BMM est le moteur de copie physique empilée (**Stacked Physical Copy**) : les commandes `enable_mod`/`disable_mod` et `apply_mod_stacked`/`unapply_mod_stacked`/`run_mod_io_worker` sont dans `src-tauri/src/commands/mods.rs`, tandis que les primitives bas-niveau de copie par blocs + throttling sont dans `src-tauri/src/fs_utils.rs`.

### Flux d'activation (commande `enable_mod`)

| Étape | Fonction | Action |
| :--- | :--- | :--- |
| 1 | `MOD_OP_LOCK.lock()` | Acquiert un Mutex global pour bloquer toute opération concurrente |
| 2 | `apply_mod_stacked()` | Parcourt récursivement chaque fichier dans le dossier du mod |
| 3 | Vérification de conflit | Pour chaque fichier de mod, vérifie si un fichier existe déjà au chemin RACINE du jeu |
| 4 | Sauvegarde | En cas de conflit, le fichier original du jeu est déplacé vers `backup_path` |
| 5 | Injection | Le fichier de mod est copié vers le chemin RACINE du jeu |
| 6 | Suivi | Tous les chemins de fichiers installés sont stockés dans `ModEntry.installed_files` |
| 7 | Mise à jour de l'état | `mod.enabled = true`, `profile.active_mods` mis à jour, `state.save()` appelé |
| 8 | Journal d'historique | Un événement "Enabled" horodaté est écrit |

### Flux de désactivation (commande `disable_mod`)

| Étape | Fonction | Action |
| :--- | :--- | :--- |
| 1 | `MOD_OP_LOCK.lock()` | Acquiert le Mutex global |
| 2 | Résolution de fichiers | Fusionne `installed_files` avec `list_mod_files()` via `HashSet` |
| 3 | `unapply_mod_stacked()` | Supprime la copie installée de la RACINE du jeu |
| 4 | Restauration | Déplace le fichier original sauvegardé depuis `backup_path` vers son emplacement d'origine |
| 5 | Mise à jour de l'état | `mod.enabled = false`, retiré de `profile.active_mods`, `state.save()` appelé |
| 6 | Journal d'historique | Un événement "Disabled" horodaté est écrit |

### Vérification sélective des conflits (v0.9.7)

Permet une réduction de 80% des appels IPC en ne traitant que les mods actifs et le mod cible.

### Limitation des E/S disque (v0.9.7)

- **Transfert par morceaux (Chunked Transfer)** : Copie par morceaux de 2 Mo.
- **Régulation adaptative** : Mise en veille calculée selon la limite Mo/s.
- **Détection par disque** : Détection automatique du disque physique pour appliquer les limites.

### Cache de vérification des conflits (v0.9.9)

- **Logique** : Avant de scanner un dossier de mod, BMM compare sa date de dernière modification (`mtime`) avec un cache de métadonnées stocké via `std::fs::metadata().modified()`.
- **Optimisation des E/S** : (v0.9.9) Le système de surveillance des disques met désormais en cache la liste des disques matériels lors des opérations groupées, évitant ainsi des rafraîchissements redondants.
- **Exploitation du Cache** : (v0.9.9) Le moteur `apply_mod_stacked` exploite maintenant le `mod_files_cache` global pour déterminer la propriété des fichiers, éliminant les scans de disque récursifs pour les mods déjà actifs.
- **Gain de performance** : Ces optimisations combinées permettent une activation jusqu'à 90% plus rapide pour les mods ayant des chaînes de dépendances complexes.

### Pourquoi la copie physique plutôt que les liens symboliques (Symlinks)

| Méthode | Stabilité | Compatible Anti-Cheat | Support lecteur réseau |
| :--- | :--- | :--- | :--- |
| Symlinks | Faible (permissions Windows fragiles) | Non | Non |
| Copie physique BMM | Haute | Oui | Oui |

---

## 6. Backend — Sécurité des accès concurrents (Concurrency)

- `MOD_OP_LOCK: Mutex<()>` : Empêche les opérations simultanées.
- `Arc<Mutex<AppData>>` : Garantit la cohérence séquentielle de l'état.
- `tauri::async_runtime::spawn_blocking()` : Décharge les E/S lourdes vers des threads dédiés.

---

## 7. Backend — Moteur d'installation de masse (Format .MM)

### Flux d'installation depuis une liste de mods

| Étape | Mécanisme | Détail |
| :--- | :--- | :--- |
| 1 | Analyse (Parse) | `serde_json::from_str()` transforme le JSON en structure `ModList` |
| 2 | Création de profil | Création automatique du profil si demandé |
| 3 | Déduplication locale | Recherche de fichiers sur le disque pour éviter le téléchargement |
| 4 | Téléchargement HTML | Récupération via `reqwest` si nécessaire |
| 5 | Détection Zip | Utilisation des magic numbers pour une extraction fiable |
| 6 | Extraction | Écriture via `zip::ZipArchive` |
| 7 | Événements | Émission de `bmm://mod-download-progress` pour l'interface |
| 8 | Annulation | Vérification d'un `AtomicBool` à chaque itération |

### Moteur d'Intégrité Deep (v0.9.9)

- **Hashage SHA-256** : Vérification cryptographique complète de chaque fichier installé par rapport à sa source. Permet de détecter la corruption ou les modifications non autorisées qu'un simple test de taille de fichier ignorerait.
- **Isolation des threads** : Le calcul intensif des hashes est déchargé vers le pool de workers asynchrones `spawn_blocking` pour maintenir une interface fluide à 60 FPS.

---

## 8. Backend — Migration OvGME (`ovgme.rs`)

Analyse directe des fichiers `.dat` d'OvGME via `parse_utf16_string()`.

---

## 9. Frontend — Architecture modulaire

Le frontend est en **TypeScript** (`// @ts-nocheck`) sous `frontend/src/`, compilé vers `frontend/js/` (voir §22). Les modules sont regroupés en `core/` (transversal), `features/` (logique par page) et `ui/` : `core/api.ts` (pont IPC), `core/i18n.ts` (i18n), `core/utils.ts` (`escHtml`/`escAttr`), `core/links-config.ts` (registre `links.json`), `features/profiles/profiles.ts`, `features/mods/*.ts`, `ui/app.ts` (boot + routage).

---

## 10. Moteur d'internationalisation dynamique

Découverte dynamique des fichiers JSON dans `Lang/` et basculement instantané via `data-i18n`.

---

## 11. Frontend — Sécurité

- XSS : Échappement via `escHtml()`.
- Injection d'attributs : Échappement via `escAttr()`.
- Respect de la portée Tauri pour les accès fichiers.

---

## 12. Sommaire des spécifications techniques

| Paramètre | Implémentation |
| :--- | :--- |
| **RAM (Repos)** | ~60 Mo |
| **RAM (Actif)** | < 130 Mo |
| **Boot time** | < 1,5 s |
| **Backend** | Rust 1.70+ |
| **Frontend** | ES2022 JavaScript |

---

## 13. Système de crash et de logs (`crash.rs`)

- **LOG_BUFFER** : Buffer circulaire thread-safe.
- **Panic Hook** : Capture de backtrace et génération de rapport ZIP automatique.

---

## 14. Dépannage avancé (Menu Debug)

Visibilité contrôlée par `app.cfg`. Réinitialisation complète de l'état possible.

---

## 15. Moteur de mise à jour automatique (`autoupdate.rs`)

Updater asynchrone GitHub avec comparaison SemVer et détection intelligente d'assets.

---

## 16. Système PTB (Public Test Build)

Mode de distribution spécial avec notes de mise à jour thématiques.

---

## 17. Système Légal & EULA (v0.9.9)

- **Intégration Installateur** : Acceptation forcée de l'EULA dans les configurations NSIS et WiX/MSI.
- **Localisation Dynamique** : La commande backend `get_eula_text` sélectionne dynamiquement `EULA_{LANG}.md` avec un repli sur `EULA.md`.
- **Rendu Markdown** : Le frontend utilise l'utilitaire `renderMarkdown` pour afficher le texte légal avec un formatage complet dans une modale dédiée.
- **Gouvernance Communautaire** : Clauses formalisées sur les "Dépôts de serveurs et modération" pour protéger les hôtes communautaires.

---

## 18. Surveillance de performance en temps réel

Utilisation de `sysinfo`, rendu Canvas haute performance et scrubbing de timeline.

---

## 19. Moteur de documentation interactive

Pont Mermaid.js avec traduction dynamique des labels et gestion persistante du viewport.

---

## 20. Moteur Multimédia et Crédits

Arrière-plans vidéo `asset://` avec Intersection Observer pour économiser les ressources.

---

## 21. Système de Dépôt Serveur (Mode Serveur)

Serveur HTTP intégré, manifeste `repo.json` et Smart Sync basé sur SHA-256.

---

## 22. Javascript vers TypeScript (v0.9.9)

Transition complète vers Strictly Typed ESM pour une stabilité structurelle et sécurité IPC.

---

## 23. Algorithme de Recherche Sémantique et Score Pondéré

Correspondance pondérée (Perfect, Anchored, Keyword Ratio) avec badges de pourcentage de réussite.

---

## 24. Manipulation avancée des SVG & Highlighting (v0.9.9)

BMM v0.9.9 intègre un moteur de mise en évidence spécialisé pour les diagrammes Mermaid.js.
- **Prévention du découpage (Filter Clipping)** : Le système parcourt récursivement le DOM SVG pour forcer `overflow: visible` sur tous les parents, garantissant que les effets d'ombre portée (`drop-shadow`) ne sont jamais tronqués.
- **Effet de pulsation (Pulsing Glow)** : Utilise des images clés CSS pour créer un halo bleu non intrusif autour des nœuds trouvés via la recherche.

---

## 25. Threading de base et isolation des E/S

Isolation stricte des tâches lourdes dans `spawn_blocking` pour maintenir une interface fluide à 60 FPS.

---

## 26. Framework d'Animation UI Premium & Ergonomie (v0.9.9)

BMM v0.9.9 introduit une couche logique spécialisée pour les éléments interactifs haute fidélité.

### 26.1. Machine d'état des menus déroulants
Le système de dropdown global (`modals.ts`) utilise une machine d'état asynchrone pour gérer les phases d'entrée et de sortie.
- **Injection Portal** : Les menus sont clonés et injectés dans un `#global-dropdown-portal` de haut niveau.
- **Fermeture asynchrone** : La fonction `closeGlobalDropdown` implémente une suppression en deux étapes. Elle déclenche d'abord une animation CSS `.closing` avant de purger physiquement le DOM après une fenêtre de sécurité de 200 ms.

### 26.2. Période de grâce et récupération d'état
Pour résoudre les problèmes courants de perte de focus lors de mouvements de souris rapides :
- **Délai de grâce de 100 ms** : Le déclenchement de la fermeture est bufferisé par un timer de 100 ms.
- **"Rattrapage" de menu** : Entrer dans le dropdown ou revenir sur le bouton déclencheur annule le `dropTimer` et restaure immédiatement l'état `.open`, annulant la fermeture en cours d'animation.
- **Invisible Bridging** : Utilisation de pseudo-éléments (`::before`) pour créer un pont de survol invisible entre le bouton et le menu flottant, évitant les événements `mouseleave` accidentels.

---

## 27. Moteur de Modpacks — Format `.bmp` (v0.9.9)

BMM implémente un système complet de cycle de vie des modpacks dans `commands/modpack.rs`.

| Composant | Implémentation |
| :--- | :--- |
| **Modèle de données** | Struct `LocalModpack` contenant des métadonnées, un `Vec<ModpackModRef>` et des `ModpackFileRef` par fichier avec hashes SHA-256 |
| **Persistance** | Chaque modpack sérialisé en `<id>.json` dans `AppData/modpacks/` via `serde_json` |
| **Vérification d'intégrité** | `check_modpack_integrity` compare les fichiers locaux octet par octet contre le manifeste : Manquant, Corrompu ou Valide |
| **Moteur de réparation** | `repair_modpack_mod` supporte deux modes : Téléchargement Direct (extraction zip) et Dépôt Serveur (récupération fichier par fichier SHA-256) |
| **Récupération locale** | `find_file_by_hash_in_dir` scanne récursivement le répertoire cible pour trouver des fichiers correspondant au hash attendu avant tout téléchargement |
| **Événements de progression** | Émet des événements IPC `bmm://repair-progress` avec des pourcentages de progression par fichier |
| **Export/Import** | Intégration de dialogue de fichier via `tauri::api::dialog` pour le format `.bmp` avec évitement de collision UUID à l'import |

---

## 28. Intégration BetaHub & Proof-of-Work (v0.9.9)

BMM s'intègre avec BetaHub pour les rapports de bugs structurés.

| Composant | Implémentation |
| :--- | :--- |
| **Client API** | `betahub-api.ts` gère l'authentification, la soumission de rapports et la récupération de l'historique |
| **Système de Modale** | `betahub-modals.ts` (~63 Ko) fournit une UI complète pour la soumission de bugs/suggestions avec onglets de catégories |
| **Moteur PoW** | `betahub-pow.ts` implémente des défis proof-of-work SHA-256 pour prévenir le spam sans captchas |
| **Intégration Crash** | `crash-report.ts` chaîne `openBugReportModal()` avec le chemin du ZIP de crash pré-attaché depuis le flux de détection de crash |

---

## 29. Contrôle d'Accès Système (v0.9.9)

`security-modal.ts` implémente une porte de sécurité à deux modes pour le système de fichiers.

| Composant | Implémentation |
| :--- | :--- |
| **Modale de Sécurité** | Modale glassmorphique de premier lancement avec sélection par carte radio (Complet/Limité) |
| **Accès Complet** | `fs_security_mode = "full"` — accès au système de fichiers sans restriction sur tous les disques |
| **Accès Limité** | `fs_security_mode = "limited"` — interface JS restreinte aux dossiers définis dans les profils |
| **Commande Backend** | `apply_fs_security_mode_command` applique le mode sélectionné via la reconfiguration du scope Tauri |
| **Effet de Lueur** | Suivi `mousemove` via propriétés CSS personnalisées (`--x`, `--y`) pour des effets de survol premium à gradient radial |

---

## 30. Système d'Onboarding (v0.9.9)

`onboarding.ts` implémente un tutoriel guidé de première utilisation.

| Composant | Implémentation |
| :--- | :--- |
| **Définition des Étapes** | 14+ étapes définies comme objets typés avec `navTarget`, `selector`, `img` et `icon` |
| **Sélecteur de Langue** | L'étape -1 affiche un menu de langues complet avec intégration FlagCDN et re-rendu réactif sur les événements `langChanged` events |
| **Mise en Évidence** | Calcule le `getBoundingClientRect()` de l'élément cible relatif à `#app-window-outer` et superpose un anneau de focus avec `box-shadow: 0 0 0 9999px rgba(0,0,0,0.6)` |
| **Effet Machine à Écrire** | Rendu caractère par caractère à 18 ms d'intervalle via `setInterval` |
| **Persistance** | Flag booléen `onboarding_shown` dans `settings` empêche le ré-affichage aux lancements suivants |

---

## 31. Moteur d'Alertes Markdown (v0.9.9)

La fonction `renderMarkdown` dans `update-notes.ts` supporte désormais les alertes de style GitHub.

| Composant | Implémentation |
| :--- | :--- |
| **Parseur Regex** | Capture les patterns `<blockquote>\s*<p>\[!(NOTE\|TIP\|IMPORTANT\|WARNING\|CAUTION\|...)\]` dans le HTML rendu |
| **Support Bilingue** | Les équivalents français (`REMARQUE`, `ASTUCE`, `AVERTISSEMENT`, `ATTENTION`) pointent vers les mêmes classes d'alerte |
| **Classes CSS** | `.md-alert-note` (bleu), `.md-alert-tip` (vert), `.md-alert-important` (violet), `.md-alert-warning` (ambre), `.md-alert-caution` (rouge) |
| **Titres i18n** | Titres d'alertes récupérés via `t('update.alert.<type>')` pour un rendu localisé |

---

## 32. Télémétrie d'Interactions Frontend (v0.9.9)

`user-logger.ts` implémente une télémétrie frontend complète.

| Composant | Implémentation |
| :--- | :--- |
| **Logger de Clics** | Capture les clics boutons/liens via un handler `click` délégué avec traversée `closest()` |
| **Logger Clavier** | Suit `Ctrl+Alt+D` (DevTools), `Ctrl+Shift+F` (FSDM), `Ctrl+D` (bascule Menu Debug) |
| **Logger de Scroll** | Journalisation debounced (1s) de la position de défilement avec identification de la vue active |
| **Logger de Drop** | L'événement `drop` capture les noms de fichiers depuis `DataTransfer` |
| **Capture d'Erreurs** | `window.error` et `unhandledrejection` transmis à la commande backend `log_frontend_line` |
| **Focus/Blur** | Changements de focus de fenêtre journalisés pour aider à la reconstruction de la timeline de crash |

---

## 33. Module Launch Pack — Exécution Invisible & Pipeline de Ressources (v1.0.0)

BMM v1.0.0 implémente un moteur de regroupement d'applications et d'exécution silencieuse centré sur Windows.

| Composant | Implémentation |
| :--- | :--- |
| **Lanceur VBScript** | Génère des scripts `launcher.vbs` dynamiques utilisant `WScript.Shell.Run` avec `WindowStyle=0` (Masqué) pour empêcher les pop-ups de console pour les fichiers `.exe` et `.bat`. |
| **Furtivité PowerShell** | Utilise `powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass` pour une exécution de scripts non intrusive. |
| **Logique d'Échappement** | Échappement personnalisé des guillemets doubles pour les chaînes VBScript afin d'éviter les erreurs de syntaxe `800A0401` dans les chemins de fichiers longs. |
| **Pipeline d'Icônes** | Utilise la bibliothèque `image` (filtre Lanczos3) pour rééchantillonner les images sources dans un buffer `.ico` standardisé de 256x256. |
| **Moteur de Raccourcis** | Exécute dynamiquement un sous-processus PowerShell masqué pour s'interfacer avec les objets COM `WScript.Shell` afin de créer des raccourcis `.lnk` sur le bureau. |
| **Persistance des Ressources** | Stockage géré dans `AppData/Local/bmm/LaunchPacks/<id>/` avec nettoyage récursif automatique lors de la suppression d'un pack. |

---

## 34. Serveur Model Context Protocol (MCP) (v1.0.0)

BMM v1.0.0 propose une implémentation JSON-RPC de niveau professionnel pour l'intégration de l'IA.

| Composant | Implémentation |
| :--- | :--- |
| **Protocole** | JSON-RPC 2.0 sur les flux d'entrées/sorties standard (stdio). |
| **Sérialisation** | Utilisation intensive de `serde` et `serde_json` pour les définitions d'outils typées et le mapping des résultats. |
| **Surface d'Outils** | ~50 outils atomiques exposés via le binaire `mcp-server`, couvrant toute la surface de commande de BMM. |
| **Pont d'État** | Le binaire MCP initialise une instance secondaire du moteur `AppState` pour accéder aux données locales sans nécessiter que l'interface principale de BMM soit lancée. |
| **Gestion Asynchrone** | Traitement des requêtes entièrement asynchrone utilisant `tokio` pour gérer les appels d'outils concurrents des agents IA. |

---

## 35. Interface en Ligne de Commande Unifiée (CLI) (v1.0.0)

Le nouveau CLI unifié offre une interface terminal puissante pour la gestion de BMM.

| Composant | Implémentation |
| :--- | :--- |
| **Parseur de Commandes** | Basé sur la bibliothèque `clap` (Command Line Argument Parser) avec des sous-commandes multi-niveaux et des arguments typés. |
| **Retours Visuels** | Intégration de `colored` pour les niveaux de log et `tabular` pour la présentation des données structurées dans le terminal. |
| **Moteur de Bannière** | Moteur de rendu d'art ASCII haute fidélité pour le branding et l'affichage de la version au démarrage. |
| **Découverte de l'Environnement** | Logique de résolution `PathBuf` automatique pour localiser le répertoire de données BMM à travers les différents profils utilisateurs Windows. |
| **Rapport d'Erreurs** | Intégration directe avec la nouvelle stratégie `AppError` pour des codes d'erreur cohérents entre le CLI et l'interface graphique. |

---

## 36. Polissage UI & Logique d'Aide Contextuelle (v1.0.0)

BMM v1.0.0 introduit un moteur d'assistance centralisé et de raffinement visuel.

| Composant | Implémentation |
| :--- | :--- |
| **Moteur d'Aide Tasky** | `window.showTaskyHelp(key, type)` déclenche des bulles localisées. Le moteur mappe les clés i18n aux positions DOM via `getBoundingClientRect()` par rapport à la vue active. |
| **Isolation des Tooltips** | Les bulles d'aide sont rendues dans un portail à z-index élevé pour éviter le découpage par les conteneurs parents `overflow: hidden`. |
| **Logique des Resize Strips** | Un moteur de redimensionnement personnalisé dans `titlebar.ts` écoute le `mousedown` sur les bandes de bordure et utilise `tauri::window::start_dragging` ou un calcul manuel des limites pour plus de précision. |
| **Tokens Glassmorphism** | Variables CSS standardisées (`--bmm-glass-bg`, `--bmm-glass-border`) utilisées sur tous les composants 1.0 pour une cohérence visuelle. |

---

## 37. Mapping de Répertoires & Analytics (v1.0.0)

Le moteur de Mapping de Répertoires (Mapper Visuel) est un scanner récursif haute performance conçu pour les collections de mods à grande échelle.

### 37.1. Moteur de Parcours Récursif (Rust)
La commande backend `scan_directory` implémente un parcours récursif multi-threadé.
- **Détection de Cycles** : Utilise un `HashSet` de combinaisons d'inodes/chemins pour détecter et interrompre la récursion infinie causée par des liens symboliques circulaires ou des boucles de dossiers.
- **Support de Profondeur Infinie** : (v1.0.0) Le parcours basé sur une pile est optimisé pour la mémoire, permettant une profondeur d'imbrication théoriquement infinie sans dépassement de pile.
- **Logique de Filtrage** : Implémente un système de liste noire pour ignorer les dossiers système cachés (`.git`, `System Volume Information`) et les artéfacts binaires non pertinents, gardant l'arborescence propre.

### 37.2. Statistiques de Mods en Temps Réel
BMM v1.0.0 introduit une télémétrie avancée pour la santé des profils.
- **Compteur Global de Mods** : La commande `get_profiles_with_stats` effectue un scan préemptif du répertoire `mods`. Elle différencie les dossiers de mods valides (contenant des fichiers) des entrées de métadonnées orphelines.
- **Pont d'État Réactif** : Les résultats sont transmis via un flux IPC asynchrone, permettant à l'UI de mettre à jour le badge "Total Mods" dans la sidebar et les cartes de profil sans bloquer l'interaction utilisateur.
- **Analyse de Propriété** : Le mapper corrèle la propriété des fichiers à travers plusieurs mods actifs, identifiant quel mod "possède" physiquement un fichier dans la racine du jeu à un instant T.

### 37.3. Rendu de l'Arborescence Frontend
Le module `Mapper.ts` gère la présentation visuelle de l'arborescence des répertoires.
- **Scrolling Virtuel** : Optimisé pour ne rendre que les nœuds visibles dans le viewport, permettant une interaction fluide à 60 FPS même avec des bibliothèques contenant plus de 10 000 fichiers.
- **Actions Contextuelles** : Chaque nœud de l'arbre est lié à une commande Shell native, activant les fonctionnalités "Ouvrir dans l'Explorateur" et "Copier le chemin relatif".
- **Taxonomie Visuelle** : Utilise une iconographie SVG distincte et des jetons de couleur pour différencier :
    - **Mods Racines** : Dossiers d'installation de base.
    - **Conteneurs d'Assets** : Sous-dossiers contenant des textures, scripts ou modèles.
    - **Payloads Binaires** : Fichiers `.exe` ou `.dll` qui déclenchent des vérifications de conflits prioritaires.

---

## 38. Moteur d'Historique des Modifications (v1.0.0)

BMM v1.0.0 introduit un système de suivi persistant pour toutes les mutations de métadonnées de mods.

| Composant | Implémentation |
| :--- | :--- |
| **Déclencheur de Suivi** | Intégré dans la commande `update_mod_metadata`. Compare l'état "avant" et "après" de chaque champ via `PartialEq`. |
| **Schéma d'Événement** | Structure `HistoryEntry` capturant : ID du mod, Horodatage (UNIX), Type d'action et une liste d'identifiants de champs modifiés. |
| **Stockage des Données** | Sérialisé sous forme de fichier `history.json` séparé par profil pour garantir des performances élevées et éviter de gonfler le fichier `mods.json` principal. |
| **Worker de Rétention** | Tâche de nettoyage en arrière-plan s'exécutant au démarrage de l'application, purgeant les entrées plus anciennes que le seuil défini par l'utilisateur (défaut : 30 jours). |
| **Recherche & Filtrage** | Le frontend utilise un état de filtre spécialisé pour effectuer des correspondances côté client sur la collection d'historique sans re-chargement depuis le disque. |

---

## 39. Architecture d'annulation d'export (v1.0.0)

BMM implémente un pattern d'annulation coopérative pour l'opération d'export `.MM`.

| Composant | Implémentation |
| :--- | :--- |
| **Flag AtomicBool** | `export_cancelled: Arc<AtomicBool>` ajouté à `AppState`. Réinitialisé à `false` au démarrage de chaque invocation de `export_modlist`. |
| **Point de contrôle** | La boucle d'export Rust inspecte `state.export_cancelled.load(Ordering::SeqCst)` avant de traiter chaque entrée de mod. |
| **Commande d'annulation** | La commande Tauri `cancel_export_modlist` positionne le flag à `true` via `state.export_cancelled.store(true, Ordering::SeqCst)`. |
| **Protocole d'événement** | Lorsque le flag est détecté, la boucle émet `bmm://export-progress` avec `cancelled: true`, puis retourne une `AppError::LockError`. |
| **Gestion Frontend** | Le flag JS `wasCancelled` est positionné lors du clic sur le bouton d'abandon. Le bloc `finally` le vérifie pour décider entre les toasts "Export annulé" et "Export terminé". |

---

## 40. Commande de taille de dossier (v1.0.0)

Une commande Tauri dédiée fournit une mesure récursive de l'utilisation du disque pour des répertoires arbitraires.

| Composant | Implémentation |
| :--- | :--- |
| **Commande** | `get_folder_size(path: String) -> u64` dans `commands/disk.rs` |
| **Algorithme** | Récursion `std::fs::read_dir` en profondeur d'abord. Chaque fichier régulier contribue `metadata().len()` octets. Les erreurs (permissions, liens symboliques cassés) sont ignorées silencieusement. |
| **Utilisation Frontend** | `profiles.js` appelle cette fonction pour chaque `mods_path` de profil après le rendu de la grille de cartes. Les résultats sont formatés via `formatBytes()` et injectés dans les spans `.profile-disk-usage`. |
| **Performance** | S'exécute de manière synchrone dans le thread de commande Tauri. Pour les très grandes bibliothèques (>50 Go), l'IIFE asynchrone isole l'appel bloquant, maintenant la grille réactive pendant la mesure. |

---

## 41. Vérification du Browse de serveurs (v1.0.0)

Le navigateur public de dépôts applique un filtre sur le champ `hash`.

| Composant | Implémentation |
| :--- | :--- |
| **Filtre de porte** | `renderRepoList()` applique `filtered.filter(r => r.hash && r.hash.length > 0)` avant tous les autres filtres. |
| **Contrat de schéma** | Les entrées de `repos.json` doivent porter un champ `hash` (défini par l'équipe BMM lors de la validation d'un serveur). Les entrées sans ce champ sont exclues silencieusement. |
| **Badge Vérifié** | Chaque carte affichée rend un badge vert "Verified" avec un SVG de coche dans la ligne du nom. |
| **Comportement de repli** | Si le `repos.json` distant est inaccessible, le navigateur affiche son état d'erreur/vide habituel — aucun serveur non vérifié ne passe. |

---

## 42. Registre de liens centralisé (v1.0.0)

Toutes les URLs externes sont découplées du code dans `frontend/assets/links.json`, chargé via `frontend/src/core/links-config.ts`.

| Composant | Implémentation |
| :--- | :--- |
| **Schéma** | Interface `BmmLinks` : `plugin_catalog`, `plugin_github`, `server_browse`, `contributors`, `autoupdate_api`, `apps_catalog`, plus les liens sociaux (`github_repo`, `discord`, `reddit`, `kofi`, `kofi_community`, `ed_forum`). |
| **Ordre de chargement** | `loadLinks()` tente `REMOTE_LINKS_URL` → `assets/links.json` local → `DEFAULTS` codés en dur. Le premier succès gagne ; chaque fusion est étalée sur `DEFAULTS` donc une clé manquante ne casse rien. |
| **Observabilité** | Un unique `console.log` rapporte la source résolue (`remote (...)`, `local file (...)` ou `built-in defaults`). |
| **Accesseur** | `getLinks()` retourne le `Readonly<BmmLinks>` en cache ; appelé par `repo.ts`, `plugins.ts`, `update-notes.ts`, `apps-catalog.ts` et `app.ts`. |
| **Passe-plat backend** | `fetch_plugin_catalog(catalog_url)` et `check_for_update(api_base_url)` acceptent l'URL du frontend, avec repli sur une constante Rust. |
| **Injection HTML à l'exécution** | `patchHtmlLinks()` s'exécute après `loadLinks()` et réécrit le `href` / `data-url` de chaque élément `[data-link-key]`, donc les liens statiques d'`index.html` suivent le JSON. |
| **Intégration mises à jour** | `links.json` est listé dans `TRACKED_FILES` de `scripts/gen-update-manifest.mjs`, donc l'updater incrémental peut patcher les URLs sans nouvel installeur. |

---

## 43. Moteur du Catalogue d'Apps (v1.0.0)

Le Catalogue d'Apps est implémenté dans `src-tauri/src/commands/apps.rs` (+ `models/app_catalog.rs`) et `frontend/src/features/apps/apps-catalog.ts`. L'état persiste dans `apps_state.json` dans le répertoire de données de l'app.

### Récupération du catalogue & chaîne de confiance
- `fetch_app_catalogs(catalog_url, extra_community_urls)` fusionne plusieurs catalogues par niveaux et attribue la confiance **par source**, jamais par le contenu JSON (`apply_trust()` écrase `official`/`partner` et tronque `tags` à 3).
  - **Niveau 0 — Officiel** : l'URL `apps_catalog` → `official = true`. Ses `partner_catalogs` définissent le Niveau 1 ; ses `community_imports` alimentent le Niveau 2.
  - **Niveau 1 — Partenaire** : les URLs dans les `partner_catalogs` officiels → `partner = true`.
  - **Niveau 2 — Communauté** : `community_imports` + sources ajoutées par l'utilisateur → aucun badge.
- Les entrées sont dédupliquées par `id` (le niveau le plus élevé gagne). Un ensemble de visites + un plafond de 30 sources empêchent les boucles.

### Moteur d'installation
- `install_app(...)` télécharge dans un dossier géré `<install_path>/<id>/`, puis branche selon le type :
  - **zip** → extrait ; s'il contient un exe portable il est conservé (`is_managed = true`) et l'exe principal choisi par `pick_main_exe()` (score de nom, ignore les installeurs). S'il contient **seulement** un installeur, celui-ci est lancé via `run_installer_and_detect()`.
  - **exe/msi** (ou nom contenant `setup`/`install`) → `run_installer_and_detect()`.
  - **script** → conservé et enregistré comme cible de lancement.
- `run_installer_and_detect()` prend un instantané de `common_install_roots()` (Program Files, Program Files (x86), LocalAppData\Programs) **avant** le lancement, fait un `child.wait()` sur une tâche `spawn_blocking`, puis résout exe/dossier/désinstalleur depuis `find_registry_app()` (registre `DisplayIcon` / `InstallLocation` / `UninstallString`) avec un repli par diff de dossiers (`auto_detect_installed_exe()` + `match_score()`).

### Lancement, suivi d'utilisation & désinstallation
- `launch_app()` sélectionne un interpréteur selon l'extension (`.ps1`→PowerShell `-ExecutionPolicy Bypass`, `.bat`/`.cmd`→cmd, `.py`→python, `.vbs`→wscript, `.sh`→bash, sinon direct), puis lance un thread d'arrière-plan qui `wait()` la fin et ajoute les secondes écoulées à `usage_seconds`.
- `uninstall_app(app_id, delete_files, run_uninstaller)` :
  - `run_uninstaller` → résout la commande depuis l'état ou un lookup `find_registry_app()` en direct, la parse avec `parse_command()` (gère chemins entre guillemets + args) et la lance directement (l'OS gère l'UAC).
  - sinon supprime le dossier géré **avant** de modifier l'état (donc une suppression échouée laisse l'état intact).
- Commandes enregistrées : `fetch_app_catalogs`, `install_app`, `detect_app_executables`, `launch_app`, `get_apps_state`, `uninstall_app`, `toggle_app_favorite`, `add/remove_community_source`, `get_default_apps_path`, `set_app_exe_path`, `register_installed_exe`, `app_has_uninstaller`, `open_app_folder`, `clear_app_history`.

### Frontend
- Onglets : Browse / Installées / Favoris / Historique / Sources / Créer. L'état est rafraîchi via une lecture légère `get_apps_state` après chaque mutation (pas de polling).
- `renderMarkdown()` est un convertisseur Markdown→HTML sans dépendance (titres, gras/italique, code inline + bloc, listes, citations, liens, images) utilisé dans la modale de détail ; les URLs de README sont normalisées en raw via `toRawUrl()` pour éviter le CORS.

---

## 44. Architecture du Système de Plugins (v1.0.0)

Implémenté dans `src-tauri/src/commands/plugins.rs` avec les modèles dans `models/plugin.rs` ; le catalogue est récupéré depuis `plugin_catalog` de `links.json`.

| Composant | Implémentation |
| :--- | :--- |
| **Manifeste** | `PluginManifest` (id/name/version/author/description/game/permissions/tags/website/folders) plus `apply_mode` (`modlist`/`script`/`both`) et `has_scripts`/`scripts`. |
| **Modèle de modlist** | `PluginModList { strict, required_mods }` ; chaque `PluginModRequirement { name, optional, sha256 }`. `compare_plugin_mods` compare la bibliothèque active aux exigences ; `apply_plugin_modlist` active l'ensemble. |
| **Installation** | `install_plugin` (depuis le catalogue), `install_plugin_from_file` (`.bmmplug`), `create_local_plugin` (création dans l'app), `export_plugin`. `compute_plugin_checksum` valide le contenu. |
| **Permissions** | `get_plugin_permissions` / `set_plugin_permissions` ; l'exécution de scripts externes (`run_plugin_scripts`) est protégée derrière une permission "plugins non sûrs". |
| **Cycle de vie** | `toggle_plugin`, `uninstall_plugin`, `get_installed_plugins`, `open_plugin_folder`. |
| **Automatisation** | `generate_script` émet des extraits cURL / PowerShell ; `get_app_exe_path`, `write_text_file`, `write_zip_files` supportent les flux de création/export. |

## 45. Serveur API REST local (v1.0.0)

`src-tauri/src/api/mod.rs` lance un serveur **Warp** sur `API_PORT = 51274` (`127.0.0.1`), démarré au lancement de l'app.

| Aspect | Détail |
| :--- | :--- |
| **Routes** | ~75 endpoints via `path!("api" / ...)` : `health`, `status`, `mods` (+ `active`/`enable`/`disable`/`{id}`), `profiles` (+ `activate`/`{id}`), `plugins` (+ `compare`/`apply`), `modpacks` (+ `create`/`enable`/`disable`/`import`/`{id}`), `repo` (`info`/`connect`/`list`/`sync`/`gen`/`host`), `data` (`export`/`import`), `modlists` (`export`/`import`), `creator-id`, `check-update`, `restart`. |
| **Auth** | Un token par installation (`get_api_token` / `reset_api_token`) protège les routes mutantes ; SHA-256 est utilisé pour la gestion du token. |
| **Concurrence** | Partage `AppData` via `Arc` ; utilise un canal `oneshot` + `AtomicBool` pour un arrêt propre. |
| **Consommateurs** | L'explorateur d'API intégré, les scripts d'automatisation générés et les outils compagnons externes. |

## 46. Moteur ContentID (v1.0.0)

L'identité de mod déterministe se trouve dans `models/mod_entry.rs`.

| Fonction | Comportement |
| :--- | :--- |
| `derive_content_id(folder_path)` | Calcule un id stable à partir de l'ensemble des fichiers du mod — déterministe entre machines pour un contenu identique. |
| `content_id_from_file_hashes(hashes)` | Réduit la map de SHA-256 par fichier en un seul content id. |
| `update_content_id_from_hashes(entry)` | Rafraîchit `entry.content_id` depuis les `file_hashes` déjà calculés, le gardant synchronisé avec le moteur d'intégrité. |
| **Usage** | Correspondance de mods pour les listes `.MM`, modpacks, synchro de dépôt et la vérification "déjà présent" à l'import — le tout indexé sur `content_id` plutôt que sur le nom de dossier. |

---

## 47. Moteur du système de thèmes (v1.0.0)

Un moteur de thèmes à variables CSS appliqué à l'exécution. Frontend : `frontend/src/features/themes/theme-engine.ts` (application/observation) et `theme-editor.ts` (l'éditeur flottant). Backend : `src-tauri/src/commands/themes.rs` persiste les thèmes installés en fichiers `.json` dans un dossier `themes/` du répertoire de données, plus `import_theme`/`export_theme` (`.bmmtheme` = ZIP) et `fetch_theme_catalogs`.

| Mécanisme | Détail |
| :--- | :--- |
| **Injection de tokens** | `applyTheme()` écrit les variables CSS `--bmm-*` dans des blocs `<style>` dédiés (vars / css / fonts / patch) ; les fichiers sources ne sont jamais modifiés. |
| **Patcheur inline** | Un `MutationObserver` réécrit les couleurs inline codées en dur sur le DOM inséré dynamiquement vers le token correspondant. |
| **Moteur de contraste** | Sur les thèmes `mode: 'light'`, `enforceLightContrast()` assombrit les textes/surfaces clairs illisibles via inline `!important` (`data-bmm-contrast`) ; nettoyé (`clearAllEnforced()`) au retour vers un thème sombre pour que les cartes dynamiques se restaurent sans rafraîchir. |
| **Overrides d'éléments** | L'outil pioche stocke des overrides par sélecteur (couleurs, états, CSS, swap SVG d'icône, image) appliqués en bloc CSS généré. |
| **Auto-palette** | `genPalette()` dérive un jeu de tokens complet et cohérent (sombre/clair) depuis une seule couleur HSL. |
| **Partage** | Export en `.bmmtheme`, lien `bmm://theme/import-inline`, ou installation depuis le catalogue de thèmes. |

---

## 48. Bac à sable de traduction (v1.0.0)

`frontend/src/features/settings/i18n-sandbox.ts` — un éditeur non destructif au-dessus du système i18n (§10). Les éditions vivent dans une map mémoire `_sandbox` et ne touchent le disque qu'à l'export.

| Mécanisme | Détail |
| :--- | :--- |
| **Modèle sandbox** | Les clés sont éditées par rapport à une langue de base ; `buildExportObject()` fusionne le fichier source complet avec les éditions, en préservant l'ordre et les clés meta. |
| **Mode pointeur** | Cliquer un élément résout sa clé `data-i18n` (ou fait remonter le texte codé en dur) par parcours du DOM. |
| **Scanner codé en dur** | `find_hardcoded_strings` (Rust) analyse la source à la recherche de littéraux sans clé i18n. |
| **Mode overlay** | Le modal se détache en overlay déplaçable/redimensionnable ; le `style` inline d'origine est capturé et restauré tel quel à la sortie (évite que le panneau reste à la taille overlay). |
| **Chemin d'installation** | Les `.json` exportés s'installent via `import_language` ; la commande `import_language_data(code, content)` accepte aussi du JSON brut. |

## 49. Navbar personnalisable & Pages en sandbox (`bmmpage://`)

La barre de navigation est configurable par l'utilisateur (réordonner/ajouter/retirer
des entrées), et les entrées personnalisées peuvent ouvrir des **pages en sandbox**
servies via un schéma dédié `bmmpage://`.

| Composant | Implémentation |
| :--- | :--- |
| **Schéma custom** | Les pages `bmmpage://` sont rendues dans un contexte isolé, tenant le markup/scripts des pages tierces à l'écart du cœur de l'app. |
| **Broker à permissions** | Un broker médie chaque appel privilégié tenté par une page en sandbox, n'accordant que les capacités explicitement autorisées (aucun accès ambiant aux commandes Tauri). |
| **Gestionnaire de deep-links** | `deep_link_manager` (cœur TS + JS) route les invocations externes `bmm://` / `bmmpage://`, y compris les deeplinks web → app d'**installation / d'ajout de source** depuis BetterCommunity Web. |

## 50. Planificateur de plugins & Actions par deeplink

`scheduler.ts` exécute des actions de génération de plugins/scripts selon un planning
en déclenchant des deeplinks à des horaires choisis.

| Composant | Implémentation |
| :--- | :--- |
| **Sources** | Les plugins sont ajoutés via des sources endpoint ou deeplink ; des docs HTML sont livrées à côté. |
| **Planificateur** | Exécution temporisée d'actions de génération de scripts, dispatchées via le gestionnaire de deep-links pour qu'un run planifié réutilise le même chemin qu'un run manuel. |
| **Catalogue web** | Le moteur de catalogue d'apps (§43) consomme aussi le flux `catalog.json` de BCWEB (apps/plugins/thèmes) pour que le contenu communautaire soit installable depuis BMM. |

## 51. Plateforme : Migration Tauri v2 & Spawn de processus caché

| Composant | Implémentation |
| :--- | :--- |
| **Tauri v2** | Migré vers Tauri v2 (compile au vert sur `cargo` + `tsc` ; validation runtime en cours). Modèle de capacités/permissions mis à jour en conséquence. |
| **Spawn caché** | Tous les spawns de processus en arrière-plan passent par les helpers `crate::commands::proc` pour qu'aucune fenêtre de console ne clignote (Windows `CREATE_NO_WINDOW`). |
| **Hub de tutoriels interactif** | `tutorial-engine.ts` alimente un hub de tutoriels in-app guidé pas à pas, superposé au système d'onboarding (§30). |

---

## 52. Registre de commandes & Palette (v1.0.0+)

Un seul registre (`frontend/src/core/commands.ts`) alimente À LA FOIS la palette Ctrl/⌘+K et le gestionnaire de raccourcis réassignables des Réglages.

| Composant | Implémentation |
| :--- | :--- |
| **Modèle de commande** | `{ id, category, title:{en,fr}, keywords, run(), defaultChord }` dans un registre `Map`. Catégories : nav / mods / profiles / repo / tools / settings / help. |
| **Commandes nav dynamiques** | `refreshNavCommands()` reconstruit les commandes `nav.*` depuis la navbar EN DIRECT (`.nav-item[data-view]` + `[data-custom-id]`) à chaque ouverture — les pages sandbox personnalisées sont des cibles de premier rang, réassignables. |
| **Assignations** | Les overrides utilisateur persistent dans `localStorage` (`bmm_cmd_bindings`) par-dessus les défauts ; un unique dispatcher keydown global matche les combinaisons (celles sans modificateur sont ignorées pendant la saisie). La détection de conflits alerte en cas de double assignation. |
| **Rendu de la palette** | L'overlay se monte dans `#app-window-outer` (le cadre arrondi et clippé de l'app) en `position:absolute` — c'est ce qui empêche le fond/l'ombre de baver dans la marge transparente de la webview OS. La recherche classique score par sous-chaîne ; la sémantique étend les tokens via la table `_synonyms` fusionnée des fichiers de langue. |
| **Actions** | Les commandes passent par les chemins UI exacts d'un humain (`clickNav`, `clickAfterNav`, helpers d'onglets), donc dialogues/confirmations s'appliquent toujours. La palette émet `bmm:action:palette-opened` pour le moteur de tutoriels. |

## 53. Mot de passe de téléchargement des dépôts (v1.0.0+)

Une porte optionnelle côté abonnés pour les dépôts auto-hébergés, distincte d'`admin_password` (qui ne protège que le panneau `/admin` de l'hôte).

| Couche | Implémentation |
| :--- | :--- |
| **Serveur généré** | `DOWNLOAD_PASSWORD` est injecté dans `server.express.js` ; s'il est non vide, chaque requête de contenu (repo.json + fichiers de mods) doit porter `X-Repo-Password` (ou `?pw=`) sous peine de 401. `/dashboard`, `/monitoring.json`, `/admin/*` et l'accès local sont exemptés. La comparaison est en temps constant (`crypto.timingSafeEqual`, CWE-208) — comme la porte admin `Authorization`, dans les templates mono-dépôt et hub. |
| **Client Rust** | `fetch_repo_info(url, creator_id, password)` et `SyncArgs.password` envoient le header ; un 401 distant remonte comme l'erreur typée `repo.errPasswordRequired`. |
| **Frontend** | Sur cette erreur, l'abonné reçoit une invite thémée ; le mot de passe est retenu pour la session (`setRepoPassword`) et passé à `sync_server_repo`. Les formulaires hôte (mini-serveur + export) exposent un champ « mot de passe de téléchargement (optionnel) ». |
| **API / automatisation** | `GET /api/repo/info?password=`, `POST /api/repo/sync {password}`, les champs du Quick Test des Plugins, et le deeplink `bmm://repo/sync` (`&password=`) le transmettent tous — le deeplink a aussi été re-câblé pour réellement pré-remplir et piloter le formulaire de synchro via `bmm:repo-focus`. |

## 54. Mode hors ligne & pipeline de télémétrie (v1.0.0+)

| Sous-système | Implémentation |
| :--- | :--- |
| **Détection hors ligne** | `core/offline.ts` sonde deux endpoints légers (timeout 5 s) au lieu de croire `navigator.onLine` ; l'état hors ligne affiche un bandeau, émet `bmm-connectivity`, et gate les fonctions via `requireOnline()` / `safeFetch()`. Re-sonde toutes les 15 s hors ligne / 120 s en ligne. |
| **Consentement télémétrie** | Opt-in uniquement (`settings.analytics_consent: Option<bool>`, `None` = jamais demandé → rien de collecté ; refuser efface le tampon). Sous-interrupteurs : benchmark/matériel étendu, replay de session, démasquage du replay. |
| **Pipeline** | Les événements s'accumulent dans `analytics_queue.jsonl` (plafond 10 Mo) et partent en UN lot gzip (id de paquet) toutes les 90 s fenêtre visible ; la liste blanche d'endpoints n'accepte que `https://` (ou loopback). |
| **Replay de session** | rrweb sans capture de mouvements de souris, sélecteurs sensibles masqués par défaut, sous-arbres animés bloqués ; chunks gzip via `CompressionStream`. Fichiers `.bmmreplay` locaux + tampon de session de crash glissant, élagués par limites de rétention (défauts 30 / 2 Go). |
| **RGPD** | Export du tampon brut ; demandes de suppression par paquet honorées sous 72 h ; la liste des paquets envoyés ne montre que noms/comptes d'événements. |

### Addendum §34 — dépendance MCP
Le serveur MCP se compile désormais contre **rmcp 1.8** (transport stdio inchangé), effaçant RUSTSEC-2026-0189 ; `ServerInfo`/`Implementation` sont `#[non_exhaustive]` en 1.x et se construisent par mutation depuis `Default`.

---

*Better Mod Manager est développé par FreeProject089 — Conçu pour une performance sans compromis, la sécurité des fichiers et une gestion moderne des mods.*

## 55. Bibliothèque d'icônes : chargement et sharding (v1.0.0+)

Les packs sont des JSON générés hors ligne par `scripts/gen-icon-pack.mjs` depuis les
paquets npm `lucide` (ISC) et `simple-icons` (CC0) — jamais des dépendances d'exécution.
Format d'origine conservé : les `iconNode` de Lucide (`[balise, attributs][]`) et le chemin
unique 24×24 de Simple Icons. Le SVG est construit **au moment de l'affichage**, donc le
JSON reste de la donnée et non du markup.

Le pack de marques pèse 4,6 Mo. Il est écrit **deux fois** : entier pour le sélecteur (qui a
besoin de tous les noms pour chercher), et en **27 shards par première lettre** pour
l'affichage d'une référence stockée. Rendre `si:github` charge donc `si/g.json`. Sans ça,
un seul tag de marque tirait 4,6 Mo au démarrage — soit exactement le genre de coût qui
fait passer un gestionnaire pour lent.

Le rendu (`renderPackIcon`) est **synchrone** : les générateurs de cartes ne peuvent pas
attendre. Une référence dont le pack n'est pas encore chargé rend une chaîne vide, et le
rendu suivant trouve le glyphe — le préchauffage est donc lancé sans être attendu, jamais
devant `get_mods`.

## 56. Réservation d'espace des panneaux ancrés (v1.0.0+)

Trois panneaux peuvent s'ancrer au même bord. Chacun écrivait auparavant le `padding-right`
de `.app-shell` en style inline, si bien que le second écrasait la réservation du premier et
que fermer l'un supprimait le padding dont l'autre dépendait.

`ui/dock-space.ts` est le propriétaire unique : chaque panneau **déclare** sa largeur sous
son nom, la plus large gagne (ils se superposent au même bord), et libérer une déclaration
recalcule à partir de celles qui restent. Le module pose aussi `body.bmm-docked` et
`--bmm-dock-w` : un seul état sur lequel toutes les règles de mise en page s'appuient, au
lieu d'une classe par panneau.

## 57. Réactivité : commandes synchrones et thread principal (v1.0.0+)

En Tauri v2, une commande déclarée `#[tauri::command]` **sans** `(async)` s'exécute sur le
thread principal de la fenêtre. Toute commande qui parcourt le disque y gèle donc l'interface
pour la durée du parcours. C'était le cas de `get_mods`, qui reconstruit le cache de fichiers
après chaque activation de mod — la cause du gel signalé en production.

Règle retenue : **toute commande qui touche `read_dir`, `WalkDir` ou `metadata` sur une
arborescence de taille utilisateur est `(async)`**, pas seulement celles pour lesquelles un
gel a déjà été signalé.

Corollaire côté interface : une animation de `transform` n'est prise en charge par le
compositeur qu'une fois sa couche promue, et cette promotion est validée par le thread
principal. Un indicateur inséré pendant un travail lourd n'obtient jamais sa couche et reste
figé — ce qui ressemble à un gel sans en être un. `will-change: transform` réclame la couche
d'avance.
