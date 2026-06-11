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

---
*La version 1.0.0 représente la consolidation finale de l'ensemble des fonctionnalités de base.*
