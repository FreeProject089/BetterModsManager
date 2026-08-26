# Changelog v1.0.0 (depuis 74d7fa9)

Cette version marque la transition vers l'étape 1.0, en se concentrant sur l'utilité multiplateforme, les groupes d'exécution automatisés et l'intégration avancée de l'IA.

## [MAJEUR] Module Launch Pack (Groupes d'Applications)
### Moteur d'Exécution Invisible
- Implémentation d'un lanceur spécialisé basé sur VBScript (launcher.vbs) pour permettre l'exécution silencieuse de groupes d'applications sans fenêtres de console visibles.
- Ajout du support natif pour les scripts PowerShell (.ps1) en utilisant le flag -WindowStyle Hidden.
- Support étendu aux exécutables standards (.exe) et aux scripts batch (.bat, .cmd).
- Mise en œuvre d'un pipeline de génération automatique d'icônes utilisant la bibliothèque 'image' pour convertir les images sources (PNG, JPG, BMP) en fichiers .ico compatibles Windows (filtrage Lanczos3 256x256).
- Ajout de la génération de raccourcis Windows (.lnk) via les objets COM PowerShell, garantissant des icônes personnalisées persistantes et la configuration du répertoire de travail.

### Gestion et Interface Utilisateur
- Création d'une nouvelle vue d'administration des Launch Packs dans le menu Paramètres.
- Implémentation d'une modale de suppression premium en glassmorphism avec support i18n dynamique pour l'injection de paramètres.
- Ajout de la synchronisation automatique du système de fichiers : la suppression d'un pack supprime désormais de manière récursive les scripts de lancement, les icônes et les raccourcis associés du répertoire AppData.

## [MAJEUR] Serveur MCP & CLI Avancé
### Intégration du Model Context Protocol (MCP)
- Développement d'un binaire autonome (bmm-mcp-server.exe) dédié au Model Context Protocol.
- Implémentation d'un serveur JSON-RPC complet sur les entrées/sorties standard (stdio) pour une intégration fluide avec les agents IA comme Claude Desktop et Gemini.
- Exposition de plus de 25 outils spécialisés au protocole, notamment :
    - Gestion de profils (Liste, Obtenir l'actif, Définir l'actif).
    - Opérations sur la bibliothèque de mods (Liste, Obtenir, Basculer, Rechercher).
    - Commandes moteur et synchronisation (Sync, Exporter la config).
    - Outils de diagnostic (Statistiques, Liste/Lecture/Analyse de rapports de crash).
    - Outils de dépôt (Générer un dépôt, Démarrer le serveur, Génération de serveur léger).
    - Accès à la documentation et à l'i18n (Lecture de docs, Lecture de fichiers de langue).

### Interface en Ligne de Commande Avancée
- Intégration d'un CLI complet dans le binaire MCP.
- Ajout de retours terminal haute fidélité incluant une bannière ASCII personnalisée et des niveaux de sortie colorés.
- Implémentation de sous-commandes complètes pour toutes les opérations de base (mods, profiles, sync, stats, crashes, launchpacks).
- Ajout de l'auto-détection de l'environnement : le CLI localise désormais automatiquement le répertoire de données BMM et les fichiers de configuration.

## [NOUVEAU] UI/UX & Polissage Premium
### Centre d'Aide et Navigation
- **Help & Other** : Refonte de la section Documentation en "Help & other" pour offrir un hub unifié regroupant guides, diagrammes interactifs et ressources techniques.
- **Gestion des Tooltips** : Implémentation d'un système d'aide contextuelle centralisé (`window.showTaskyHelp`) piloté par la mascotte Tasky, offrant des explications instantanées pour presque chaque élément de l'interface.
- **Éléments Décoratifs** : Ajout de composants décoratifs haute fidélité incluant des bordures de redimensionnement affinées, des poignées de coin et des superpositions glassmorphiques pour un ressenti plus premium.
- **Polissage de Tasky** : Amélioration des animations et du positionnement interactif de la mascotte pendant les phases d'onboarding et d'aide.
- **Historique des Modifications** : Implémentation d'un système complet de suivi des changements pour les métadonnées des mods (Auteur, Version, Description, Tags, Liens, Dépendances).
    - **Filtrage Intelligent** : Ajout de filtres par type d'action pour retrouver rapidement des modifications spécifiques.
    - **Gestion de la Rétention** : Paramétrage de la durée de conservation de l'historique (ex: 30 jours) avec option de nettoyage manuel.
    - **Interface Premium** : Rendu des entrées d'historique avec horodatage précis et badges dynamiques identifiant les champs modifiés.


### [MAJEUR] Mapper Visuel & Analyse de Répertoires
- **Analyse Structurelle en Arbre** : Implémentation d'un mapper visuel haute performance pour explorer la structure physique des collections de mods.
- **Moteur de Parcours Récursif** : Développement d'un moteur Rust multi-threadé supportant une **Profondeur de Récursion Infinie** et une **Détection de Cycles** active (vérification inode/chemin).
- **Analytics de Mods en Temps Réel** : Ajout d'un compteur de mods global effectuant des scans préemptifs pour afficher des statistiques de collection en direct.
- **Scrolling Virtuel** : Optimisation de la vue en arbre pour gérer plus de 10 000 fichiers à 60 FPS via la virtualisation dynamique des nœuds.
- **Contrôles de Fichiers Interactifs** : Intégration Shell pour "Ouvrir dans l'Explorateur" et "Copier le chemin relatif" directement depuis l'arborescence du mapper.

## [AMÉLIORÉ] Moteur Backend & Logique Core
### Renforcement du Cœur Rust
- Implémentation d'une nouvelle stratégie centralisée de gestion des erreurs utilisant une énumération AppError personnalisée et l'intégration de 'anyhow' pour une meilleure clarté de diagnostic.
- Refonte du moteur de mapping de répertoires (Mapper) pour améliorer la fiabilité lors de l'analyse de structures de mods profondément imbriquées.
- Correction des problèmes critiques d'échappement pour le Windows Script Host (WSH) en implémentant l'échappement des guillemets pour les chemins de fichiers dans VBScript.
- Correction de l'échappement des chaînes PowerShell pour la génération de raccourcis en doublant les guillemets simples.
- Affinement de la séquence d'activation des mods pour garantir des opérations de fichiers atomiques et une résolution de conflits cohérente.

### Gestion des Ressources
- Implémentation d'un moteur de nettoyage en arrière-plan pour purger les fichiers de log orphelins et les artéfacts de synchronisation temporaires.
- Optimisation de la file d'attente de calcul SHA-256 pour réduire la charge CPU pendant les vérifications d'intégrité en arrière-plan.

## [AMÉLIORÉ] Internationalisation (i18n)
- Atteinte d'une couverture i18n de 100 % pour l'anglais et le français.
- Élimination de toutes les chaînes codées en dur restantes dans les modules Mapper, Paramètres et Launch Pack.
- Mise à jour de l'aide i18n du frontend pour supporter l'injection de paramètres et le contenu HTML dynamique dans les chaînes traduites.

## [NOUVEAU] Affichage de l'espace disque par profil
- Chaque carte de profil affiche désormais l'espace disque total occupé par son dossier de mods (ex: `1,4 Go`), chargé de manière asynchrone en arrière-plan après le rendu de la vue Profils.
- Un spinner de chargement s'affiche pendant le calcul ; une icône disque accompagne la taille formatée finale.
- Implémenté via une nouvelle commande Rust `get_folder_size` (parcours récursif de répertoire) enregistrée dans le gestionnaire d'invocation Tauri.

## [CORRIGÉ] Annulation de l'export .MM
- Le bouton "Annuler" dans l'overlay de progression de l'export annule désormais réellement l'opération d'export en cours.
- Un champ dédié `export_cancelled: AtomicBool` a été ajouté à `AppState`. La commande Rust `export_modlist` vérifie ce flag à chaque itération de fichier et émet un événement `cancelled: true` lorsqu'il est déclenché.
- Une commande Tauri séparée `cancel_export_modlist` positionne le flag depuis le frontend.
- L'interface affiche correctement un toast "Export annulé" et revient à l'état inactif après l'annulation.

## [AMÉLIORÉ] Icônes de profil — Bibliothèque étendue
- Le sélecteur d'icônes lors de la création et de l'édition d'un profil propose désormais plus de 110 icônes organisées en 15 catégories : Tech, Transport, Médias, Sport, Nature, Lieux, Symboles et plus encore.
- Nouveaux cas SVG ajoutés dans `getProfileIconSvg` : `code`, `monitor`, `server`, `printer`, `keyboard`, `bluetooth`, `satellite`, `router`, `cloud`, `bus`, `truck`, `ship`, `bicycle`, `train`, `helicopter`, `film`, `tv`, `speaker`, `mic`, `trophy`, `medal`, `dumbbell`, `swords`, `shield-check`, `tree`, `leaf`, `flower`, `bird`, `fish`, `home`, `building`, `flag`, `castle`, `infinity`, `diamond`, `hexagon`, `fingerprint`, `sparkles`, `atom`, `crown` et bien d'autres.

## [NOUVEAU] Help & Other — Documentation Docker
- Ajout d'une carte de déploiement Docker complète dans l'onglet Avancé : qu'est-ce que Docker, comparaison avantages/inconvénients, exemple `docker-compose.yml`, explication du tunnel ngrok avec diagramme de flux visuel, et blocs de code pour la mise à jour du serveur Docker.
- Ajout d'une nouvelle section "Docker & Infrastructure" dans la FAQ avec 4 nouvelles entrées : Qu'est-ce que Docker, Qu'est-ce que ngrok, VPS vs. PC à la maison, et Comment mettre à jour un serveur Docker.
- Ajout d'une entrée FAQ expliquant la nouvelle fonctionnalité d'affichage de l'espace disque par profil.
- Tout le nouveau contenu est entièrement bilingue (EN/FR) avec les clés i18n ajoutées dans `en.json` et `fr.json`.

## [NOUVEAU] Browse des serveurs — Serveurs vérifiés uniquement
- Le navigateur de dépôts n'affiche désormais que les serveurs portant un champ `hash` dans `repos.json`, garantissant que seuls les dépôts validés par l'équipe BMM apparaissent dans la liste publique.
- Un badge vert "Verified" avec une icône de coche est affiché sur chaque carte de serveur listé.

## [AMÉLIORÉ] Documentation Docker — Refonte complète
- La carte de documentation Docker dans l'onglet Avancé est passée d'une mise en page inline personnalisée au format standard `glass-card`, identique aux cartes Launch Packs et MCP.
- Ajout d'un diagramme Mermaid dédié (`docker-deployment`) visualisant le flux complet de déploiement Docker + ngrok.
- Ajout d'un bouton "Voir le diagramme" dans l'en-tête de la carte Docker.
- Remplacement de l'icône Docker approximative par un SVG de baleine Docker correct.
- Ajout de boutons copie-presse-papiers sur tous les blocs de code dans la FAQ Docker.

## [AMÉLIORÉ] Bibliothèque de mods — Barre de filtres modernisée
- Refonte de la barre de filtres avec un conteneur glassmorphique (backdrop-filter, bordure subtile).
- Boutons de filtre modernisés : transitions fluides, élévation au survol, état actif avec lueur accent.
- Boîte de recherche, bouton vue compacte et listes déroulantes tous modernisés pour un look cohérent.

## [NOUVEAU] Browse des serveurs — Détection de la whitelist
- Badge vert "Whitelist" ou rouge "Open" selon la valeur de `whitelist_enabled` dans `repos.json`.
- Filtre déroulant "Whitelist ON / Sans whitelist" ajouté à la modale de navigation des serveurs.

## [NOUVEAU] Cartes de liens rapides (Help & Other)
- Deux cartes de liens rapides (Discord, GitHub) en haut de Help & Other, désactivables individuellement via `quicklink1_disabled=true` / `quicklink2_disabled=true` dans `app.cfg`.
- Nouvelle commande Rust `get_quicklinks_config`.

## [AMÉLIORÉ] Système de mise à jour incrémentale
- Remplacement du téléchargement complet de l'installeur par un système de mise à jour delta incrémentale.
- `check_for_update` retourne désormais `manifest_url` si un `update-manifest.json` est présent dans la release GitHub.
- Nouvelles commandes Rust : `fetch_update_manifest` et `apply_incremental_update`.
- La modale de mise à jour affiche un bouton "Mise à jour rapide (incrémentale)" avec barre de progression en temps réel. Les fichiers inchangés (hash SHA-256 identique) sont ignorés.

## [MAJEUR] Système de Plugins (Core Plugins / Cplugins)
### Architecture de plugins extensible
- Introduction d'un système de plugins complet avec un format de manifeste (`PluginManifest`) : `id`, `name`, `version`, `author`, `description`, `game`, `permissions`, `tags`, `website`, `folders` embarqués et une `modlist` déclarative.
- **Modes d'application** : un plugin peut appliquer une `modlist` (exiger/activer un ensemble de mods), exécuter des `scripts` embarqués, ou `both`.
- **Application stricte de la modlist** : `PluginModList` supporte un flag `strict` et des `required_mods` avec épinglage `sha256` optionnel. `compare_plugin_mods` rapporte ce qui manque/diffère avant l'application ; `apply_plugin_modlist` active l'ensemble requis.
- **Chemins d'installation** : installation depuis le catalogue de plugins distant (`fetch_plugin_catalog` → `install_plugin`) ou depuis un fichier `.bmmplug` local (`install_plugin_from_file`). Les plugins peuvent aussi être créés dans l'app (`create_local_plugin`) et exportés (`export_plugin`).
- **Permissions** : `set_plugin_permissions` / `get_plugin_permissions` contrôlent ce qu'un plugin peut faire ; l'exécution des scripts externes embarqués est protégée derrière une permission explicite "plugins non sûrs" (`run_plugin_scripts`).
- **Intégrité** : `compute_plugin_checksum` valide le contenu d'un plugin ; `toggle_plugin`, `uninstall_plugin`, `get_installed_plugins` et `open_plugin_folder` complètent la gestion du cycle de vie.
- **Génération de scripts** : `generate_script` produit des extraits d'automatisation prêts à l'emploi (cURL / PowerShell) ciblant l'API locale.

## [NOUVEAU] Serveur API REST local
- Ajout d'un serveur HTTP embarqué basé sur **Warp** sur `127.0.0.1:51274`, permettant aux outils externes et aux plugins de piloter BMM par programmation.
- **~40 endpoints** sous `/api/` couvrant : health/status, mods (liste, actifs, enable, disable, get/delete par id), profils (liste, get, create, update, delete, activate), plugins (liste, compare, apply), modpacks (liste, create, enable, disable, import, get/delete), dépôt (info, connect, list, sync, generate, host), export/import de données et de modlists, `creator-id`, `check-update` et `restart`.
- **Authentification par token** : `get_api_token` / `reset_api_token` gèrent un token d'API par installation ; le helper `generate_script` construit des extraits de requêtes authentifiées.
- Alimente l'explorateur d'API intégré et l'automatisation externe (ex : Stream Deck, scripts compagnons).

## [NOUVEAU] Serveur API REST local
- Ajout d'un serveur HTTP embarqué basé sur **Warp** sur `127.0.0.1:51274`, permettant aux outils externes et aux plugins de piloter BMM par programme.
- **~40 endpoints** sous `/api/` couvrant : santé/statut, mods (lister, actifs, activer, désactiver, obtenir/supprimer par id), profils (lister, obtenir, créer, modifier, supprimer, activer), plugins (lister, comparer, appliquer), modpacks (lister, créer, activer, désactiver, importer, obtenir/supprimer), dépôt (info, connexion, liste, synchronisation, génération, hébergement), export & import de données/mod-lists, `creator-id`, `check-update` et `restart`.
- **Authentification par token** : `get_api_token` / `reset_api_token` gèrent un token d'API par installation ; l'assistant `generate_script` construit des extraits de requêtes authentifiées.
- Alimente l'explorateur d'API intégré et l'automatisation externe (Stream Deck, scripts compagnons…).

## [NOUVEAU] ContentID — Identité de mod déterministe
- Implémentation d'un système d'identité de contenu déterministe : `derive_content_id()` et `content_id_from_file_hashes()` produisent un `content_id` stable à partir des hash réels des fichiers d'un mod — les **mêmes fichiers sur n'importe quelle machine donnent le même ID**.
- Permet une reconnaissance fiable des mods entre machines (correspondance par contenu plutôt que par nom de dossier), alimentant la correspondance précise `.MM` / modpack / dépôt et la détection "déjà présent" dans le flux d'import.
- `update_content_id_from_hashes()` garde l'ID synchronisé avec les empreintes SHA-256 calculées par le moteur d'intégrité.

## [AMÉLIORÉ] Onboarding V2
- Refonte de l'onboarding de premier lancement en un moteur de tutoriel modulaire (`tutorial-engine`, `tutorial-store`, `tutorial-hub`, `tutorial-data`, `tutorial-events`).
- Flux piloté par étapes et événements, avec un Hub de tutoriel relançable, des actions BMM dispatchées et une aide contextuelle guidée par Tasky.

## [AMÉLIORÉ] Mémoire & Performance
- Réduction majeure de l'empreinte mémoire (~1,5 Go → ~500 Mo en moyenne en dev) grâce à un nettoyage agressif des ressources vidéo/marquee et au démontage des vues.
- **Chargement paresseux (lazy loading)** ajouté aux vues lourdes (Crédits, Mapper) : les médias et grands arbres DOM sont construits/détruits à la demande plutôt que gardés en mémoire.
- Corrections de lag du Mapper et réduction de l'usage CPU au repos.

## [AMÉLIORÉ] Dépôt Serveur — Browse GitHub & multi-plateforme
- Ajout d'un mode **browse de dépôts GitHub** pour découvrir les dépôts de serveurs hébergés sur GitHub directement depuis le navigateur.
- Ajout du **support `.zip`** au flux Server Repo et du **support Linux complet** pour le serveur autonome léger.
- Suivi de l'historique des dépôts et diverses améliorations UX du mode serveur.

## [MAJEUR] Module Catalogue d'Apps (Installation en un clic)
### Parcourir, installer & suivre des apps
- Ajout d'une vue dédiée **Catalogue d'Apps** dans la sidebar — un installeur en un clic pour les applications et outils compagnons.
- **Moteur d'installation** supportant `zip`, `exe`, `msi` et `script` (`.ps1`/`.bat`/`.cmd`/`.py`/`.vbs`/`.sh`) :
  - **Zip portable** → extrait dans un dossier géré par BMM, l'`.exe` principal est choisi automatiquement par correspondance de nom (ignore les installeurs/désinstalleurs).
  - **Installeur (exe/msi, ou installeur dans un zip)** → BMM lance l'assistant de l'installeur, puis **auto-détecte** le résultat avec **zéro action utilisateur** en comparant les dossiers d'installation + le registre Windows (`DisplayIcon`, `InstallLocation`, `UninstallString`) avant/après.
  - **Script** → sauvegardé et lancé via le bon interpréteur.
- **Suivi d'utilisation** : le temps de jeu est enregistré automatiquement en attendant la fin du processus lancé — aucune action manuelle.
- **Désinstallation intelligente** : les apps gérées proposent "garder les fichiers" / "tout supprimer" ; les apps installées par setup peuvent **lancer leur vrai désinstalleur Windows** (résolu en direct depuis le registre, même pour les apps installées avant le suivi).
- **Historique & Favoris** : journal install/lancement/désinstallation par app avec icônes SVG, et un onglet favoris.
- **Créateur de Catalogue** : construisez un `catalog.json` dans l'app (ajout d'apps, aperçu JSON, copie ou téléchargement) pour héberger et partager votre propre catalogue.
- **Modale de détail** : galerie d'images (miniature + captures), rendu Markdown complet du README (titres, listes, code, liens, images), table d'infos et actions colorées par catégorie.

### Modèle de confiance & catalogues communautaires
- Les badges (`Official`, `Partner`) sont attribués selon la **source du catalogue**, jamais par le JSON — un catalogue communautaire prétendant `"official": true` est silencieusement écrasé.
- La liste `partner_catalogs` du catalogue officiel accorde le badge Partner ; `community_imports` chaîne d'autres catalogues sans accorder de badge.
- Les utilisateurs peuvent ajouter leurs propres sources de catalogues communautaires ; le catalogue officiel peut importer automatiquement les catalogues partenaires/communautaires.

## [NOUVEAU] Registre de liens centralisé (`links.json`)
- Chaque URL externe (catalogue plugins, liste server-browse, contributeurs, API de mise à jour, catalogue d'apps, liens sociaux Discord/Reddit/Ko-fi/GitHub/forum ED) vit désormais dans un seul fichier éditable : `frontend/assets/links.json`.
- Chargé au démarrage avec un repli à 3 niveaux : **URL distante → fichier local intégré → valeurs par défaut**, avec une ligne de log indiquant la source utilisée.
- Les liens sociaux de la page Crédits, de la modale BetaHub et des liens rapides du navigateur de dépôts sont injectés dans le HTML à l'exécution via des attributs `data-link-key` — changez une entrée JSON et elle se propage partout, sans recompilation.
- `links.json` est suivi par le manifeste de mise à jour incrémentale, donc les URLs peuvent être changées via une release sans nouvelle build.

## [CORRIGÉ] Mapper — Tooltip de l'aperçu final masqué
- Les tooltips de diagnostic de structure dans la modale d'aperçu final du Mapper étaient masqués derrière le conteneur overflow de la modale et l'en-tête de tableau collant.
- Remplacement du tooltip CSS `::after` par un tooltip en position fixe attaché au body, qui suit le curseur et n'est jamais masqué.

## [AMÉLIORÉ] Outillage & Ajouts mineurs
- **Mode Benchmark avancé** : refonte du benchmark de performance avec une modale de perf avancée (`set_advanced_benchmark_mode`, `openAdvancedPerfModal`) et **export CSV** des résultats (`export_benchmark_csv`).
- **Bascule des Dev Tools** : ajout des commandes `open_devtools` / `close_devtools` / `is_devtools_open` pour ouvrir/fermer les outils de développement de la WebView depuis l'app (menu debug).
- **"Tout désactiver (Global)" sur les profils** : action en un clic sur la page Profils pour désactiver tous les mods actifs d'un coup (`disableAllRequestedMods()`), avec confirmation ; suppression de l'ancien bouton redondant "Mods Actifs (Global)".
- **Précision des tooltips Tasky** : les tooltips d'aide contextuelle suivent désormais le curseur correctement même si la souris s'arrête avant le déclenchement du debounce.

## [AMÉLIORÉ] Personnalisation, Partage & Finitions
- **Système de thèmes** : moteur de thèmes complet sans CSS (7 presets, auto-palette depuis une couleur, édition d'élément au clic droit, suivi des modifs). Correction de Discard/Tout annuler qui restaure désormais tout instantanément (y compris les cartes mods/profils dynamiques) sans rafraîchir ; la popup « Edit this element » apparaît toujours entièrement à l'écran et défile si la fenêtre est courte. Visuel de l'éditeur rafraîchi (style verre teinté par l'accent).
- **Bac à sable de traduction** : ajout d'un bouton **Partager** en un clic qui produit un lien `bmm://language/import-inline` embarquant toute la traduction (installée via la nouvelle commande `import_language_data`). Correction du bug de taille overlay→restauration qui laissait le panneau coincé en petit.
- **App Catalog & doc** : ajout de cartes Documentation pour l'App Catalog et l'éditeur de thèmes, et un guide Catalogues & Navigateurs expliquant chaque catalogue et comment ajouter plusieurs sources.
- **Discord Rich Presence** : les boutons d'activité sont pilotés par `links.json` (hébergé sur GitHub avec une copie locale en backup) — le bouton site pointe vers BetterCommunity par défaut, avec une bascule pour changer de lien, et un bouton **Copy Creator ID** quand un Creator ID existe.
- **Crédits** : ajout d'un lien vers le site BetterCommunity.
- **Rappel Ko-fi** : s'affiche à chaque démarrage (sauf si vous choisissez « Ne plus afficher »), avec un visuel rafraîchi.
- **Tutoriel interactif** : mis à jour pour les nouveaux systèmes (App Catalog, outil de traduction, système de thèmes, Plugins & API) avec des étapes qui mettent en surbrillance l'UI réelle.
- **BMM DevTools** : suppression du sous-onglet débogueur JS redondant ; les DevTools s'ouvrent depuis un bouton d'en-tête. Le vrai inspecteur Chrome/WebView2 fonctionne désormais en build release.
- **Réactif** : la fenêtre ne tasse plus ses barres d'outils en petite taille — le contenu garde sa mise en page et défile à la place.

## [CORRIGÉ] Installeur / Build
- Correction de l'échec de bundling MSI (`light.exe` LGHT0091 symbole dupliqué) en livrant le serveur MCP/CLI comme un `[[example]]` cargo (pour que tauri-bundler ne le récupère pas deux fois) tout en l'embarquant via le sidecar `externalBin`. Le `bmm-mcp-server` embarqué est reconstruit et à jour, et le CLI/MCP sont livrés dans le `.msi` et le `.exe`.
- WebView2 épinglé en `downloadBootstrapper` (silencieux) pour que l'installeur télécharge WebView2 s'il manque.

## [POST-1.0.0] Écosystème, Personnalisation & Intégration Web

### Navbar personnalisable & Pages en sandbox
- Les utilisateurs peuvent désormais personnaliser la navbar (réordonner/ajouter des
  entrées) et ouvrir des **pages `bmmpage://` en sandbox** rendues via un broker à
  permissions, isolant le contenu des pages tierces du cœur de l'app.

### Système de thèmes v2
- Moteur + éditeur de thèmes personnalisés complet : thématisation à base de tokens, un
  ensemble croissant de thèmes intégrés (BMM Sombre, White, Discord, Spotify, Brutal,
  Claude, Nord, Sakura…), et un **mode clair** de première classe. Les thèmes sont des
  fichiers `.bmmtheme.json` partageables.

### API Plugins & Planificateur
- Sources de plugins via endpoint/deeplink, docs HTML, et un **planificateur** qui
  exécute des actions de génération de scripts via deeplinks à des horaires choisis.

### Intégration BetterCommunity Web
- BMM consomme le flux **`catalog.json`** de BCWEB (apps/plugins/thèmes) et gère les
  **deeplinks d'installation / d'ajout de source** depuis le web, reliant l'app desktop
  au hub communautaire. La télémétrie est passée au dashboard réécrit (Rust/Axum/Postgres
  + React).

### Plateforme
- **Migration Tauri v2** (compile au vert, validation runtime en cours).
- Tous les spawns de processus en arrière-plan passent par des helpers de spawn caché
  (aucun flash de console).
- **Hub de tutoriels** interactif et un gestionnaire de crash étendu.

### Palette de commandes & raccourcis réassignables
- **Palette Ctrl/⌘+K** sur toute l'app : aller sur n'importe quel écran (y compris vos
  pages de navbar personnalisées, détectées en direct) ou lancer des actions — ajouter
  un mod, scanner, vérifier l'intégrité, importer un profil (OvGME/OMM), toute la
  surface Dépôt Serveur (onglets sync/host, générer un serveur, start/stop, monitoring,
  copier l'ID créateur), mises à jour de l'app, stats de stockage & hachage. Recherche
  classique + **sémantique** (étendue par synonymes).
- Chaque commande est **réassignable** depuis Réglages → Raccourcis clavier (enregistrer,
  réinitialiser, effacer ; alerte de conflit), remplaçant l'ancien système de 4 raccourcis
  codés en dur. Les pages perso ont aussi leurs raccourcis.
- Rendu de la palette corrigé : interaction (z-index/pointeur) et l'ombre/le fond qui
  débordaient hors de la fenêtre arrondie (montée désormais dans le cadre clippé).

### Dépôts serveur : mot de passe de téléchargement optionnel
- Les dépôts auto-hébergés peuvent exiger un **mot de passe de téléchargement** : défini à
  la génération du serveur ; les abonnés le saisissent une fois (envoyé en
  `X-Repo-Password`, mémorisé pour les synchros suivantes). Vide = dépôt ouvert. Distinct
  du mot de passe admin, qui ne protège que le panneau d'admin de l'hôte.
- Câblé de bout en bout : formulaires hôte (mini-serveur + export), invite abonné avec
  réessai, `GET /api/repo/info?password=` et `POST /api/repo/sync {password}`, le Quick
  Test des Plugins, et le deeplink `bmm://repo/sync` — également **réparé** (il naviguait
  sans pré-remplir ; il pilote maintenant le formulaire de synchro, en honorant
  url/dossiers/profil/password).

### Refonte de la documentation (Help & Other + BMM Docs)
- Help & Other reconstruit en hub bilingue piloté par les données (directives md-lite,
  séparation utilisateur/dev) avec une passe de véracité : conflits = **le dernier activé
  gagne** (pas de liste de priorité), hébergement vs synchro séparés, SHA-256 sur le
  réseau, exemples généralistes (aucun placeholder lié à un jeu).
- Nouveaux articles + **3 nouveaux diagrammes interactifs** (mode hors ligne, pipeline de
  télémétrie, système i18n) avec descriptions complètes des nœuds ; nouvelle couverture du
  mode hors ligne, de la confidentialité & télémétrie (modèle opt-in, replay masqué,
  suppression par paquet sous 72 h), de l'admin & monitoring des dépôts, des launch packs
  (corrigés : groupes d'applications, pas des bundles de mods), et de la traduction.
- Le site **BMM Docs** miroite le contenu in-app (sans les éléments interactifs) avec des
  diagrammes Mermaid, de nouvelles pages (palette de commandes, launch packs,
  confidentialité/télémétrie) et une référence API à jour.

### Sécurité
- **rmcp 0.16 → 1.8** efface RUSTSEC-2026-0189 (DNS rebinding du transport HTTP ; le
  serveur MCP de BMM est stdio-only donc inatteignable — l'advisory disparaît quand même).
  `cargo audit` : 0 vulnérabilité.
- Les templates de mini-serveur & hub-server générés comparent désormais les mots de passe
  en **temps constant** (`crypto.timingSafeEqual`, CWE-208), tant pour le mot de passe de
  téléchargement que pour la porte admin.
- npm : advisory dompurify corrigée (`npm audit fix` → 0).

### Correctifs
- `RangeError` du flush de session + perf/lag de l'enregistreur rrweb ; correctif OOM de
  la webview.
- Erreurs de fetch au démarrage (CORS links.json via le pont Rust, contributors.json,
  callbacks orphelins) ; fermeture de l'app plus rapide ; migration des données de
  l'ancien bundle id.
- Studios Replay/Animation : UX simplifiée, bascule de visibilité d'enregistrement,
  superposition du menu de presets, correctifs pointer-events.

---
*La version 1.0.0 représente la consolidation finale des fonctionnalités de base ; la
section ci-dessus suit le travail d'écosystème/personnalisation ajouté par-dessus.*

---

## [MAJEUR] Bibliothèque d'icônes partagée (Lucide + Simple Icons)

- **2017 icônes Lucide** et **3453 marques Simple Icons** disponibles partout dans BMM,
  plus tes propres images (PNG/JPG/SVG/WebP, 128 Ko max, embarquées).
- Une icône est une simple chaîne (`lucide:x`, `si:x`, `data:image/…`), donc elle voyage
  telle quelle dans **tous les partages** — profils exportés, dépôts, catalogues — sans
  une ligne de code supplémentaire.
- Un sélecteur unique (recherche sur les 5000+, onglets, import) branché sur trois
  surfaces : **tags personnalisés**, **icône visuelle de profil**, **création de plugin**.
- Chargement paresseux et **sharding par lettre** : afficher une icône de marque stockée
  télécharge ~150 Ko, pas les 4,6 Mo du pack complet (celui-ci n'arrive que si tu ouvres
  l'onglet Marques). Le budget de scripts au démarrage est inchangé.

## [NOUVEAU] Tags : icônes et dégradés

- Chaque tag peut porter une **icône** (bibliothèque ci-dessus) et un **dégradé** de deux
  couleurs au lieu d'une teinte plate.
- Les tags sont désormais **modifiables** (nouvelle commande `update_tag`) : le formulaire
  bascule en mode édition, avec un bouton Annuler explicite.
- Un rendu unique (`renderTagChip`) sert les cinq surfaces — grille de cartes, lignes de
  liste, panneau de détails, modale « +N », Paramètres — qui affichaient auparavant cinq
  variantes légèrement différentes du même tag.

## [MAJEUR] Planificateur : le contrôle de flux au complet

- **Pour chaque** : exécute le corps une fois par élément d'une collection *vivante* (mods
  activés / désactivés / tous, profils, modpacks, thèmes), avec substitution de
  `{item.id}`, `{item.name}` — ou n'importe quel champ — dans les paramètres d'action.
- **Switch** : des cas ordonnés, chacun avec sa condition ; le premier qui correspond
  s'exécute, sinon la branche par défaut.
- **do… while** : le corps s'exécute d'abord, la condition décide ensuite d'un autre tour.
- Les tâches écrites par une IA ou en ligne de commande sont **normalisées au chargement**,
  pour qu'une forme incomplète n'empêche jamais d'ouvrir l'éditeur.

## [MAJEUR] MCP & CLI : écrire, plus seulement lire

- `bmm_create_schedule` / `bmm_delete_schedule` (MCP) et `create-schedule` /
  `delete-schedule` (CLI, via `--file`, `--json` ou stdin) : une IA ou un script peut
  désormais **composer** une automatisation complète, blocs de contrôle inclus.
- `bmm_create_plugin_scaffold` / `create-plugin` : génère un **brouillon** de plugin
  (`plugin.json` + README) dans `plugin-drafts/<id>/`. Volontairement pas une
  installation — un plugin peut porter des scripts, donc l'installation reste le flux
  normal de l'app, avec ses permissions.
- Garde-fou : une tâche créée sans `enabled: true` explicite arrive **désactivée**, à
  inspecter avant de l'armer. Une *mise à jour* qui omet le champ conserve l'état existant.

## [NOUVEAU] Panneaux latéraux ancrables

- Le **tutoriel interactif**, l'**éditeur de thèmes** et le **bac à sable de traduction**
  peuvent s'ancrer au bord de la fenêtre en colonne pleine hauteur, largeur réglable à la
  poignée et mémorisée.
- L'app se réorganise autour d'eux : un propriétaire unique (`dock-space`) réserve
  l'espace, si bien qu'ouvrir deux panneaux n'écrase plus la réservation de l'autre.
- Chaque panneau **change de forme** selon le mode : le bac à sable empile ses deux
  colonnes en mode ancré, le tutoriel passe sa barre d'outils sur deux rangées.

## [AMÉLIORÉ] Éditeur de thèmes

- **Mode ancré** (voir ci-dessus) et menu **Fichier** regroupant Importer / Partager /
  Exporter.
- **Cliquer le libellé d'un token** fait clignoter tous les éléments réellement peints avec
  cette valeur — la façon la plus courte de comprendre ce qu'un token contrôle.
- Le **sélecteur d'élément** affiche enfin son mode d'emploi (clic droit / clic molette), et
  **Maj + clic droit** ouvre toujours l'éditeur précis d'élément.
- Le token **logo de la barre latérale** fonctionne (il était écrit mais aucune règle ne le
  lisait).
- Les groupes *Surfaces* et *Toasts* ont retrouvé leur icône et leur description.

## [CORRIGÉ] Réactivité et gel de l'interface

- **Activer un mod ne gèle plus l'application.** En Tauri v2, une commande synchrone
  s'exécute sur le thread principal : la reconstruction du cache de fichiers déclenchée par
  chaque activation bloquait donc toute la fenêtre. Les commandes qui parcourent le disque
  s'exécutent désormais sur un thread de travail.
- **Les indicateurs de chargement tournent réellement.** Ils n'étaient pas figés — ils
  étaient éteints. Une règle globale associe une durée de 0,01 ms à
  `animation-iteration-count: 1` sous `prefers-reduced-motion` : le spinner faisait un
  tour instantané puis s'arrêtait, strictement identique à une app plantée. Windows
  signale reduced-motion dès que Accessibilité > Effets visuels > « Effets d'animation »
  est désactivé, donc cela se déclenchait sur une machine standard, sans aucun réglage
  BMM en cause. Les indicateurs de progression sont désormais exemptés de cette règle et
  du coupe-circuit d'animation de l'app, et tournent à 2,4 s, volontairement lentement.
- La barre d'actions de la bibliothèque tient compte de l'espace pris par un panneau ancré.

## [NOUVEAU] Documentation

- Nouvelle page **« Créer son propre thème »** (FR + EN) : chaque token expliqué, groupe par
  groupe, le format `.bmmtheme` champ par champ, le dossier de dépôt direct, et un ordre de
  construction depuis zéro.
- La première page du PDF de la documentation porte l'auteur et l'édition exacte (version +
  horodatage du commit).

## [NOUVEAU] Le planificateur exécute votre code

- Une étape peut **Exécuter un script** — PowerShell, CMD, Bash ou Python — écrit dans la
  tâche. Le corps est enregistré dans un fichier temporaire et c'est le FICHIER qui est
  remis à l'interpréteur : rien de ce que vous écrivez n'est collé dans une ligne de
  commande, donc aucun échappement à réussir et aucun guillemet égaré ne peut changer ce
  qui s'exécute. `{item.name}` / `{item.id}` sont remplacés dans un POUR CHAQUE.
- Nommez une variable et la première ligne de sortie devient une valeur testable par les
  étapes suivantes — sinon un script ne pouvait que réussir ou échouer.
- **Les permissions sont désormais trois autorisations distinctes** — lancer des programmes
  externes, exécuter des scripts, déclencher des deeplinks — chacune nommant ce qu'elle
  débloque, au lieu d'une case « autoriser les commandes personnalisées ». Déclencher un
  deeplink n'était gardé par rien, alors que cela atteint tout ce que l'app expose. Les
  tâches existantes gardent leurs droits ; aucune ne gagne *exécuter des scripts*, cette
  capacité n'existant pas quand l'ancienne case a été cochée.
- Une commande planifiée ne gèle plus la fenêtre pendant son exécution.

## [NOUVEAU] Centre de notifications

- Une cloche à côté de **Vérifier les mises à jour** conserve chaque message que BMM vous a
  affiché, avec sa source, son heure et son texte. Un toast est une fenêtre de trois
  secondes sur un événement déjà passé ; si vous le manquiez, il n'existait aucun second
  endroit où regarder.

## [AMÉLIORÉ] Panneaux et diagnostics

- Tirer le bord d'un panneau ancré ne saccade plus : la largeur est écrite une fois par
  image et non une fois par événement souris.
- La bande basse du tutoriel a une **poignée de hauteur** — elle n'en avait aucune, et sa
  hauteur n'avait jamais été écrite une seule fois.
- Les pastilles de chapitre du tutoriel défilent à nouveau. Le gestionnaire était attaché à
  l'élément intérieur, qui n'a aucun débordement propre : chaque instruction de défilement
  ne faisait rien.
- **Les diagnostics exportés incluent l'environnement de la webview** : préférences
  d'accessibilité et de couleurs de l'OS, viewport et densité de pixels, erreurs récentes
  non capturées. C'est précisément là que vivait le bug du spinner, et rien ne le
  rapportait.
- Le modèle de page personnalisée *Notifier* est retiré ; il démontrait un appel que l'app
  fait déjà partout.

## [MAJEUR] Des tutoriels interactifs que tu écris, partages et publies

- **Un créateur de tutoriels**, dans le hub. Parties, étapes, la vue que chaque étape ouvre,
  l'élément qu'elle surligne, l'action qu'elle attend — tout le vocabulaire du moteur, depuis
  un formulaire. Un bouton **Tester** fait clignoter l'élément que le sélecteur trouve
  maintenant ; il dit clairement qu'il attrape les fautes de frappe, pas qu'il valide le
  tutoriel sur l'écran de quelqu'un d'autre.
- **Des documents `.bmmtut`.** Un tutoriel que tu écris est un fichier : signé avec ta clé de
  créateur, partageable, importable. L'import indique si la signature est **valide**, **non
  signée** ou **invalide** — un fichier modifié après signature est signalé, pas accepté en
  silence comme l'œuvre de son auteur.
- **Des catalogues de tutoriels.** Suis une adresse et installe les tutoriels qu'elle liste,
  avec le même bloc « source protégée » que les autres catalogues : mot de passe et clé
  d'identité, retenus par serveur.
- Les tutoriels personnalisés tournent sur le **même moteur** que les officiels. Leur texte
  est porté en clair puis matérialisé en clés de traduction à l'exécution : rien n'a changé
  dans le moteur, et les deux sortes ne peuvent pas diverger. Le texte partagé est
  **assaini** aux balises de mise en forme — un tutoriel affiche et surligne, il n'exécute
  jamais de code.
- `tutorial` est un **type d'index de catalogues** routable, et un type hébergeable sur
  BetterCommunity.

## [MAJEUR] Les serveurs générés peuvent être fermés

Chaque serveur généré par BMM — le Multi-Repo Hub, le standalone Express, et les légers v1 et
v2 en `.bat` **et** `.sh` — lit désormais un **`access.json`** dans le dossier qu'il sert.

- **Mot de passe de téléchargement, clés publiques autorisées, ou les deux**, lus au moment
  de la requête. Autoriser un abonné, c'est éditer un petit fichier : ni régénération ni
  réenvoi.
- Dans le hub, ce fichier est **par dossier de dépôt**, ce qu'exige réellement un accès par
  nœud.
- Le vérificateur est le fichier que fait tourner BetterCommunity, copié octet pour octet,
  avec un contrôle de build qui échoue s'ils divergent — deux implémentations de « ce client
  détient-il la clé » sont deux occasions de se contredire, et elles se contredisent en
  refusant une clé qui marche ailleurs.
- La porte se place après les bannissements et la liste blanche, et **avant** tout envoi. Ton
  tableau de bord et tes routes admin restent accessibles : lister une clé ne doit pas
  t'enfermer hors de ton propre serveur.
- Un export de hub **statique** ne peut rien appliquer — il n'y a aucun processus — et
  embarque maintenant un README qui le dit plutôt que de laisser supposer le contraire.

## [NOUVEAU] SSH, partout où il manquait

- **Mettre à jour depuis le serveur** lit aussi en **SFTP**, pas seulement en HTTP. Un
  serveur HTTP exige `autoindex` ; une machine SSH ne publie aucun index, et c'est justement
  le cas où les mods n'existent nulle part ailleurs.
- Les deux écrans de mise à jour portent un **bloc d'identifiants SSH** : choisis un serveur
  déjà configuré dans *Publier par SSH*, puis fournis les deux choses que BMM n'enregistre
  jamais — le mot de passe du compte et la phrase secrète de la clé. C'est aussi ce qui rend
  enfin utilisable un serveur authentifié par **mot de passe** depuis la boîte de dialogue.
- **Publier par SSH peut utiliser tes clés d'identité.** Une entrée du trousseau est un nom
  et un chemin, exactement ce dont SFTP a besoin. En choisir une remplit le champ ; l'inverse
  n'est volontairement pas câblé, car configurer un serveur ne doit pas changer l'identité
  que BMM présente ailleurs.
- Quand le test de connexion refuse une écriture, il dit **pourquoi** : le propriétaire et le
  mode du dossier distant, le compte utilisé, et la ligne `chown` qui corrige. `/srv`,
  `/var/www` et `/opt` appartiennent à root sur la plupart des distributions — tout le monde
  peut lister, seul root peut créer — et c'est invisible côté client.

## [NOUVEAU] Les clés d'identité forment un trousseau

- **Plusieurs clés nommées**, une par défaut, et une exception par serveur. Une identité
  professionnelle et une personnelle cohabitent sans échanger de fichiers.
- **ed25519, RSA et ECDSA** sont acceptés, des deux côtés de la preuve. Le format précédent
  n'acceptait qu'ed25519, ce qui revenait à dire à quelqu'un dont la seule clé est une `.ppk`
  RSA que sa clé, parfaitement valide, avait la mauvaise forme.
- Tous les sélecteurs de clé de l'application listent les mêmes clés par leur nom, et un
  choix fait pour une source est retenu pour l'origine de ce serveur.

## [NOUVEAU] MCP & CLI : automatisations et plugins complets

- **`bmm_list_actions`** (et `bmm-mcp-server actions`) liste tous les types d'action
  utilisables dans une étape du planificateur — généré depuis le registre de l'application,
  avec un contrôle de build pour qu'il ne périme pas. Il était déjà cité dans la description
  d'un autre outil et n'existait pas.
- **Les squelettes de plugin embarquent des scripts.** `bmm_create_plugin_scaffold` (et
  `create-plugin --script`) écrit les fichiers dans le brouillon et **dérive** `scripts`,
  `has_scripts` et `apply_mode` de ce qui a réellement été écrit — un manifeste qui déclare
  un script absent installe un plugin qui échoue à la première application.
- Coupler un plugin à une automatisation ne demandait aucune mécanique nouvelle :
  `plugin.apply`, `deeplink`, `http.request` et `custom.script` existaient déjà. Il fallait
  rendre le registre découvrable.

## [AMÉLIORÉ] Des correctifs qui méritent d'être nommés

- **Les cartes de modpack** ne clignotent plus au bord. Le survol ne change plus aucune
  géométrie : un scale est stable en théorie et le scintillement était toujours signalé — le
  seul effet de survol qui ne peut pas boucler est celui qui ne bouge rien.
- **Flappy Tasky** monte en difficulté. Chaque valeur suit une courbe sur les ~22 premiers
  points — y compris la gravité et l'impulsion, laissées constantes par la passe précédente
  alors que ce sont les deux nombres qui décident de la vitesse de chute.
- **Modale dans une modale** : « Gérer les clés » ferme les deux. Une modale ouverte depuis
  une autre est un frère dans le DOM, pas un enfant : remonter la chaîne des ancêtres ne
  pouvait structurellement pas atteindre l'extérieure.
- **Le sélecteur de clé** dit pourquoi il est vide. Un backend incapable de répondre
  ressemblait exactement à « vous n'avez aucune clé ».
- **Les titres de page** sont uniformes sur toutes les vues — une page portait un dégradé en
  30px quand les autres étaient en 22px sans dégradé.
- **« Dossier du jeu » devient « dossier de destination »** partout : application,
  documentation, tutoriels et messages d'erreur.


## [MAJEUR] BMMScript — les automatisations en texte

- **Un langage qui ne peut pas prendre de retard sur l'app.** BMMScript compile vers les
  BLOCS : le texte devient exactement les étapes que produit l'éditeur de blocs, et le même
  exécuteur les lance. Il ne contient aucune liste de noms d'actions, donc une action ajoutée à
  BMM est écrivable le jour même.
- **Dans les deux sens.** Une tâche écrite en code s'ouvre en blocs ; une tâche construite en
  blocs s'imprime en code. Aucune direction ne perd rien, sauf les commentaires et lignes vides.
- Grammaire complète : conditions avec groupes booléens, quatre sortes de boucles, branches
  `parallel`, `try`/`catch`, `switch`, variables typées, arithmétique, comparaisons, blocs
  partagés, sous-tâches en attendant ou non, et corps `script` bruts dans six moteurs, pris
  exactement tels qu'écrits.
- **Plusieurs tâches dans un fichier**, pour qu'un partage puisse emporter les deux qu'il
  appelle.
- **Une référence générée** — 75 actions avec leurs vrais noms de paramètres, 28 conditions,
  les valeurs lisibles — extraite du registre de BMM vers BMM Docs ET Aide & autres. La CI
  échoue si elle vieillit. Les noms de paramètres viennent de l'EXÉCUTEUR, pas des formulaires :
  `needs` est une forme de formulaire partagée par plusieurs actions, et en dériver donnait à
  trois actions de liste l'union des trois.
- **Une autocomplétion qui s'efface** : fermée dans les chaînes et les corps `script`, deux
  caractères avant de s'ouvrir, et **Entrée n'accepte jamais** — Entrée est un retour à la
  ligne, Tab accepte.
- La vérification en direct ne **projette plus le curseur à l'autre bout du fichier** pendant
  que vous tapez. Une demi-ligne est une erreur de syntaxe : elle se déclenchait à presque
  chaque pause.
- Les fichiers `.bmmscript` ouvrent un **écran de revue** au lieu de s'exécuter : compilés
  d'abord, chaque étape listée, chaque corps de script affiché en entier.

## [MAJEUR] Un seul écran de catalogue, pour tous les catalogues

BMM en avait fait pousser six indépendamment, et ils étaient en désaccord sur tout ce qui
n'était pas le contenu. L'un appelait le constructeur *Publier les miennes…* et l'autre
*Créer un catalogue*. L'un écrivait un dossier, l'autre un seul JSON. L'un avait le bloc
« cette source est protégée », trois autres non. Suivre un catalogue vivait sur un écran
différent d'en faire un, et l'écran des listes de mods avait deux boutons là où les autres
avaient des onglets. Qui en avait appris un en avait appris un.

Il y a maintenant **un** écran, et le TYPE est un paramètre — automatisations, listes de mods,
thèmes et tutoriels l'utilisent tous, avec trois onglets :

- **Parcourir** ce que contiennent les catalogues que tu suis.
- **Suivre** par adresse **ou par fichier**, voir ce que tu suis, en désactiver un ou le
  retirer. Les sources protégées sont traitées ici, une fois, pour tous les types. Coller un
  **index** de catalogues marche aussi : il suit ceux de ce type-là et laisse les autres.
- **En créer un** : choisis ce qui entre dedans, et décide **par entrée** si son fichier
  voyage avec le catalogue ou s'il est récupéré à une adresse.

La sortie est un choix entre **un `.bmmbundle`** — le `catalog.json` et chaque fichier qu'il
emballe, en une seule chose à envoyer, rien à héberger — et **un `catalog.json`** d'adresses,
pour du contenu qui vit déjà quelque part. Le mot « publier » a disparu de l'acte de créer :
faire un catalogue et le mettre quelque part sont deux actes différents, et un bouton qui dit
*Publier* promet le second en faisant le premier.

Les thèmes gardent un troisième choix par entrée, **le garder dans le catalogue** — le corps
écrit en ligne, ce que contient tout catalogue de thèmes publié jusqu'ici, et toujours leur
défaut.

Le catalogue de plugins garde son propre éditeur, parce que c'est celui qu'on rouvre pour le
modifier et que cet écran-ci écrit un fichier puis oublie. Les catalogues de modpacks gardent
le leur, parce qu'un `.cbmp` **est** déjà un bundle.

## [CORRIGÉ] Un `.mm` perdait trois choses, et aucune ne le disait

- **Les tags arrivaient en identifiants bruts.** Un tag nommé « Liveries » avec une icône
  s'affichait comme un UUID nu. Les définitions étaient dans le fichier depuis toujours —
  l'aperçu ne les lisait simplement pas.
- **Les notes d'installation ne voyageaient jamais.** L'export écrivait une chaîne vide :
  écrite par l'export, lue par l'import, vide entre les deux.
- **Un mod arrivait sans provenance.** D'où il vient et comment il se met à jour
  (`source_repo`, `repo_mod_id`, `update_url`, plus son `id` et son empreinte de contenu)
  n'étaient pas portés. `update_sources` l'était, ce qui rendait le trou facile à manquer —
  une liste arrivait avec une partie de son câblage de mise à jour et pas le reste : les mods
  avaient l'air corrects et ne se mettaient plus jamais à jour.

Tous les `.mm` jamais écrits s'ouvrent encore : les nouveaux champs sont tous optionnels.

## [NOUVEAU] Un catalogue peut porter ce que tu n'as pas installé

- **Modpacks :** le constructeur listait ta bibliothèque et rien d'autre — sans rien
  d'installé il disait « aucun pack » et s'arrêtait. Donne une adresse, ou passe un fichier
  `.bmp` qu'on t'a envoyé : il est lu et vérifié au moment où tu le choisis, puis embarqué
  dans le `.cbmp`. Sa signature est conservée telle quelle — re-signer mettrait ton nom sur
  le pack de quelqu'un d'autre.
- **Plugins :** même problème, en pire. L'emballage passait par l'export, qui ne sait exporter
  qu'un plugin installé : publier pour quelqu'un d'autre voulait dire installer, publier,
  désinstaller. Passe le `.bmmplug` à la place ; son manifeste remplit l'entrée.
- **Listes de mods :** l'onglet de création **est** un sélecteur de fichiers — BMM ne garde
  aucune bibliothèque de `.mm` — et on ne pouvait y répondre qu'une fois. Il y a un bouton
  pour en ajouter.

## [SÉCURITÉ] Une automatisation partagée pouvait s'accorder le droit d'exécuter des programmes

Les deux chemins d'import n'effaçaient qu'un seul champ — `osSchedule` — et gardaient le
reste. Un `.bmmpa` partagé pouvait donc arriver `enabled: true`, tenant `command` et `script`,
sur un intervalle d'une minute, et lancer des programmes une minute après l'import sans rien
demander ni rien montrer. Le modèle de permissions fonctionne parfaitement à l'exécution : le
fichier arrivait simplement en les tenant déjà.

Ça compte d'autant plus que les automatisations peuvent désormais être publiées en catalogue —
ces fichiers sont faits pour circuler entre inconnus.

Une tâche importée arrive maintenant **désactivée**, avec les quatre autorisations retirées, et
BMM dit ce que le fichier demandait. Tout le reste est conservé : l'automatisation est intacte
et à un interrupteur de fonctionner.

## [MAJEUR] Une phrase secrète qui est un verrou, pas un panneau sur une porte

Trois choses dans BMM peuvent contenir un secret — une sauvegarde, une liste de mods
partagée, tes clés d'identité — et les trois utilisent désormais la même enveloppe :
Argon2id vers une clé, AES-256-GCM pour sceller.

Argon2id parce que l'attaquant a le fichier et un temps illimité, et qu'un KDF gourmand en
mémoire est la seule chose qui rende coûteux de deviner une phrase tapée à la main. GCM
parce qu'une enveloppe altérée doit échouer à s'ouvrir plutôt que de se déchiffrer en quelque
chose de plausible. Les paramètres de coût voyagent AVEC le fichier : les relever plus tard
ne peut enfermer personne dehors de ce qu'il a déjà exporté.

- **Une sauvegarde** est scellée entière. Ouvre un `.DATABMM` verrouillé dans un outil zip :
  ce n'est plus un zip du tout — et c'est le point. Une invite qui se contente de faire
  refuser l'écran d'import laisse le contenu lisible à quiconque a 7-Zip.
- **Une liste de mods** garde un en-tête lisible — nom, auteur, jeu, nombre de mods — et
  scelle le reste. Un `.mm` est lu par BMM, par l'inspecteur de BetterCommunity et par
  quelqu'un qui décide s'il fait confiance : une liste que personne ne peut vérifier est pire
  qu'une liste au contenu privé. La signature est appliquée AVANT le verrou — une signature
  sur l'enveloppe ne dirait que qui a chiffré.
- **Les clés d'identité** peuvent voyager dans une sauvegarde, et BMM refuse de les écrire
  sans phrase secrète. C'est le seul export que supprimer le fichier après coup ne rattrape
  pas.

**Aucune récupération.** Pas de réinitialisation, pas d'indice, personne qui puisse l'ouvrir.
Perds la phrase et le fichier est perdu, pas refusé.

## [NOUVEAU] Créer une clé d'identité ne demande plus de terminal

Le sélecteur de clé se désactivait tout seul sur un trousseau vide — correct, et sans issue,
puisque le seul moyen d'avoir une clé était `ssh-keygen`. **Paramètres → Identity & API →
En créer une…** en fabrique une : ed25519 par défaut, ECDSA et RSA pour un hôte plus ancien.
La ligne publique va dans ton presse-papiers ; la moitié privée n'est jamais affichée,
seulement l'endroit où elle est allée.

Chaque type proposé est testé pour **signer**, pas seulement pour se générer — un type qui
produit un fichier inutilisable est une promesse rompue au moment où quelqu'un cherche à
joindre un serveur.

## [NOUVEAU] Une liste partagée peut porter les identifiants de ses sources

Décoché, les deux types, séparément, et seulement pour les hôtes que CETTE liste vise. Ça
vaut la peine de dire pourquoi c'est construit ainsi : BMM garde les mots de passe en mémoire
seulement et jamais sur disque, parce que les réglages finissent dans les sauvegardes et les
rapports de crash — les mettre dans un fichier qu'on donne annule ça exprès, et ce qui est
écrit doit être illisible sans la phrase.

L'import pose deux questions. Les mots de passe sont proposés pour la session, comme un que tu
aurais tapé. Les clés ont leur propre question et un avertissement direct : une clé de
signature, c'est qui tu es pour toute source qui demande — et un nom déjà sur ton trousseau
est ignoré, jamais écrasé.

## [AMÉLIORÉ] Le reste

- **Un mod dit d'où il vient.** Le panneau de détail savait dire « depuis un dépôt serveur »
  et rien d'autre : un mod ajouté à la main, un tiré d'un lien et un arrivé dans la liste de
  quelqu'un se ressemblaient tous. C'est dérivé des champs que lit l'updater, donc ça ne peut
  pas revendiquer une provenance qu'il contredit — et un dépôt livré sans sommes de contrôle
  a sa propre phrase.
- **Les mises à jour sont une section, pas une entrée de menu.** *Vérifier* et *Configurer*
  n'existaient que dans le menu ⋮ d'une carte — celui qu'on ouvre pour copier un id — à côté
  de ce qui met vraiment ce mod à jour, listé plutôt que compté.
- **Un lien du détail de mod peut atteindre un hôte protégé**, avec le même bloc que tous les
  écrans de catalogue. C'était le seul endroit de BMM à offrir un champ URL sans moyen de dire
  que l'adresse demande un mot de passe ou une clé. Les types de lien gagnent dépôt et http(s).
- **Les catalogues de dépôts suivis sont des lignes.** C'étaient des pastilles où un ● servait
  d'interrupteur — de la ponctuation faisant le travail d'un contrôle — avec l'adresse, l'état
  et la provenance repliés dans un seul tooltip. Le constructeur est en deux étapes numérotées
  au lieu de quatre libellés frères.
- **Les deux boîtes latérales du lecteur de docs se replient**, et s'en souviennent. Sur une
  page longue, le sommaire et l'arbre complet dépassent chacun la hauteur de l'écran : le
  second n'était atteignable qu'en passant par-dessus le premier.
- **Tout le bord haut de la fenêtre la déplace**, Tasky et la bande à côté de la barre de titre
  compris. Tasky portait l'attribut de déplacement mais son conteneur laisse passer les clics :
  ni lui ni l'attribut ne recevaient jamais d'appui.
- **Un thème lié n'embarque plus ses assets dans l'index.** L'entrée gardait tout sauf `vars`,
  donc un thème « lié » à une adresse portait quand même ses mégaoctets de base64 dans
  `catalog.json` et le lien ne servait à rien.
- **Trois poches de texte non traduit**, toutes invisibles pour le contrôle de parité parce que
  les clés existaient : l'en-tête du catalogue de thèmes (construit après le passage des
  traductions, donc son `data-i18n` n'était jamais lu), deux entrées françaises dont la valeur
  était le texte anglais, et les mots d'état de l'empreinte de contenu. Un balayage des 8150
  clés n'en a trouvé aucune autre.


- **Les includes d'un `.bmmpa` emportent les blocs partagés.** Une étape `call "bloc"` est un
  TYPE d'étape, pas une action : l'exportateur ne la voyait pas, et partager une tâche qui
  appelait un bloc livrait une tâche qui S'ARRÊTE au premier appel. Trois parcoureurs ont aussi
  appris les branches `parallel`.
- **La vue compacte s'étend au panneau de détail.** La hauteur du panneau est accrochée à
  l'écran : resserrer ses champs seuls ne l'a déplacé que de 22 px ; la boîte rétrécit aussi.
- **Conflits : une légende.** Intra et Inter étaient des mots colorés sans explication nulle
  part, et ce ne sont pas le même genre de problème. Plus un filtre **état**, et une liste vide
  qui distingue « aucun conflit » de « vos filtres ont tout masqué ».
- **La barre latérale court sur toute la hauteur de la fenêtre**, et les boutons de fenêtre
  sont à 7 px du cadre au lieu de 5.
- **Les réglages sont groupés par ce que vous faites** plutôt que par ordre d'écriture, et
  **Listes .MM** est à côté de **Modpacks**.
- L'avertissement CORS **« autoriser toute origine »** dit ce qu'il expose vraiment. Il
  affirmait que n'importe quel site pouvait lire vos réponses d'API — faux pour les
  soixante-dix routes derrière le jeton. Deux routes répondent sans jeton, et l'une d'elles
  renvoie le nom et le jeu de votre profil actif.
