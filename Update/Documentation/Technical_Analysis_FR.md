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

Architecture ES6 modulaire : `api.js`, `state.js`, `profiles.js`, `mods.js`, `i18n.js`, `utils.js`.

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

## 22. Migration Javascript vers TypeScript (v0.9.9)

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
| **Sélecteur de Langue** | L'étape -1 affiche un menu de langues complet avec intégration FlagCDN et re-rendu réactif sur les événements `langChanged` |
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

*Better Mod Manager est développé par FreeProject089 — Conçu pour une performance sans compromis, la sécurité des fichiers et une gestion moderne des mods.*
