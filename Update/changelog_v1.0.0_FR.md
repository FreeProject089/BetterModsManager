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

---
*La version 1.0.0 représente la consolidation finale de l'ensemble des fonctionnalités de base.*
