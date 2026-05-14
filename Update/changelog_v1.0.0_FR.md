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

---
*La version 1.0.0 représente la consolidation finale de l'ensemble des fonctionnalités de base.*
