# Guide de l'utilisateur et aperçu des fonctionnalités - Better Mod Manager (BMM)

Better Mod Manager est un gestionnaire de mods moderne et universel pour tout jeu PC. Il offre une sécurité totale des fichiers, une organisation claire et des outils de partage puissants via une interface de type station de travail haut de gamme.

---

## 1. Profils

Les profils sont la base de BMM. Chaque profil représente un environnement complet et isolé pour un jeu spécifique.

| Fonctionnalité | Description |
| :--- | :--- |
| **Support multi-jeux** | Créez un profil par jeu (DCS World, MSFS, Skyrim, etc.). Les mods ne croisent jamais les frontières entre les profils. |
| **Trois dossiers dédiés** | Chaque profil définit une **Racine du jeu** (où les fichiers sont installés), un **Dossier de mods** (où vit votre collection de mods) et un **Dossier de sauvegarde** (où les fichiers originaux sont enregistrés avant d'être écrasés). |
| **Personnalisation visuelle** | Chaque profil reçoit un nom unique, une couleur d'accentuation et une icône pour une identification visuelle instantanée. |
| **Import OvGME** | BMM lit les fichiers de configuration binaires OvGME `.dat` (`C:\ProgramData\OvGME`) et les convertit en profils natifs BMM en un clic. |
| **Suivi du profil actif** | BMM se souvient de votre dernier profil actif à travers les sessions et le restaure au prochain lancement. |

---

## 2. Bibliothèque de mods

La vue de la bibliothèque est votre centre de collections. Tous les mods pour le profil actif apparaissent ici.

| Fonctionnalité | Description |
| :--- | :--- |
| **Import par Glisser-Déposer** | Déposez un dossier ou un fichier `.zip` directement dans la fenêtre pour l'enregistrer instantanément. |
| **Scan de dossier** | Découvre et enregistre automatiquement tous les nouveaux dossiers et fichiers `.zip` présents dans le répertoire des mods du profil. |
| **Extraction Zip à l'import** | Lorsqu'un `.zip` est ajouté, BMM extrait automatiquement son contenu dans le répertoire des mods. |
| **Activation / Désactivation** | Un seul interrupteur active ou désactive n'importe quel mod. L'activation installe les fichiers dans le jeu. La désactivation restaure le jeu à son état d'origine exact. |
| **Activation / Désactivation en masse** | Activez ou désactivez tous les mods de la bibliothèque en une seule opération. |
| **Suppression permanente** | Les mods peuvent être supprimés définitivement du disque (avec une étape de confirmation). Seuls les mods inactifs peuvent être supprimés. |
| **Métadonnées de mod** | Chaque mod stocke un nom, une version, un auteur, une description et une liste de liens de téléchargement arbitraires. |
| **Tags personnalisés** | Créez des étiquettes réutilisables (ex: "Audio", "Cockpit", "Multijoueur") et assignez-les aux mods pour le filtrage. |
| **Recherche et Filtrage** | Recherchez des mods par nom, filtrez par état actif/inactif ou par tag. |
| **Ouvrir la racine du mod** | Ouvrez le dossier physique d'un mod directement dans l'Explorateur Windows à partir du menu contextuel du clic droit. |
| **Historique d'activité** | Chaque action d'activation/désactivation est horodatée et journalisée par profil pour un suivi d'audit. |
| **Bascule par double-clic** | Activez ou désactivez rapidement un mod en double-cliquant n'importe où sur sa carte. |

---

## 3. Sécurité des fichiers — Le moteur de copie intelligent (Smart Copy)

BMM n'utilise jamais de liens symboliques (symlinks). Toutes les opérations sur les fichiers sont physiques, garanties et réversibles.

| Opération | Ce qui se passe |
| :--- | :--- |
| **Activer un mod** | BMM parcourt l'arborescence des fichiers du mod et copie chaque fichier dans la RACINE du jeu. Si un fichier de jeu existe déjà au chemin cible, il est d'abord déplacé vers le dossier de sauvegarde. |
| **Désactiver un mod** | BMM supprime les fichiers installés et replace tous les originaux sauvegardés exactement là d'où ils venaient. |
| **Résolution de conflits** | Si deux mods actifs écrivent dans le même fichier, BMM suit la propriété du fichier et garantit que le bon fichier est toujours restauré. |
| **Verrouillage d'opération concurrente** | Un `MOD_OP_LOCK` global empêche deux opérations de s'exécuter simultanément. |

---

## 4. Détection de conflits

| Fonctionnalité | Description |
| :--- | :--- |
| **Avertissement pré-activation** | Avant d'activer un mod, BMM compare son arborescence de fichiers à tous les mods actifs pour prévenir les collisions. |
| **Priorité par ordre** | Le dernier mod activé a la priorité. |
| **Ignorer l'avertissement** | Option pour ne plus afficher l'alerte pour des combinaisons connues. |
| **Vérification sélective** | Analyse ciblée pour des performances maximales. |
| **Cache mtime** | (v0.9.9) Scans passés si les dossiers n'ont pas changé (accélération de 80%). |

---

## 5. Partage de mods — Le format .MM

Le format `.MM` est le standard de partage propriétaire de BMM basé sur JSON.

| Fonctionnalité | Description |
| :--- | :--- |
| **Export** | Exporte toute la collection d'un profil dans un seul fichier JSON partageable. |
| **Import** | Aperçu complet du contenu d'un fichier `.mm` avant installation. |
| **Installer depuis la liste** | Téléchargement et installation automatique en un clic. |
| **Mutualisation locale** | Récupération de fichiers existants sur le disque pour économiser la bande passante. |

---

## 6. Internationalisation dynamique

| Fonctionnalité | Description |
| :--- | :--- |
| **Auto-découverte** | Détection instantanée des fichiers `.json` dans `frontend/Lang`. |
| **Sélecteur unifié** | Menu déroulant premium avec drapeaux haute qualité (FlagCDN). |
| **Secours hors ligne** | Rendu textuel stylisé si Internet est indisponible. |

---

## 7. Système automatisé de versionnage et de build

BMM capture la date exacte de compilation (`BMM_BUILD_DATE`) et l'injecte dynamiquement dans l'UI (Crédits, barre de titre, footer).

---

## 8. Documentation interactive et diagrammes

| Fonctionnalité | Description |
| :--- | :--- |
| **Intégration Mermaid.js** | Visualisation technique haute définition des flux (Syncho, Backup, etc.). |
| **Localisation dynamique** | Traduction instantanée des labels de diagrammes. |
| **Mascottes Tasky** | Guide interactif par étapes au sein des diagrammes. |
| **Pan & Zoom interactif** | Navigation fluide à la souris avec fenêtre de vue persistante. |

---

## 9. Rapport d'intégrité

| Fonctionnalité | Description |
| :--- | :--- |
| **Vérification Deep** | (v0.9.9) Analyse SHA-256 de chaque fichier installé par rapport à l'original. |
| **Détection d'état** | Statut OK, Manquant ou Modifié rapporté avec précision. |

---

## 10. Explorateur d'archives

Naviguez dans l'arborescence complète des `.zip` sans extraction. Recherche en temps réel et accès direct Windows Explorer.

---

## 11. Notes de mise à jour

Changelog intégré supportant le Markdown complet avec accès aux archives historiques.

---

## 12. Rapports de crash et dépannage

| Fonctionnalité | Description |
| :--- | :--- |
| **Journalisation Live** | Sauvegarde en temps réel dans `current_session.log`. |
| **Crash Report Auto** | Génération automatique de ZIP de diagnostic au prochain démarrage après un crash. |
| **Rejoindre Discord** | Bouton de support direct intégré dans les rapports de crash. |

---

## 13. Système de mise à jour automatique

Vérification asynchrone via GitHub Releases avec modale de mise à jour dédiée et notes de version.

---

## 14. Mode PTB (Public Test Build)

Mode de distribution spécial pour tester les nouveautés avant la sortie officielle, incluant des badges visuels et des notes dédiées.

---

## 15. Gestion de la performance et du stockage

BMM propose une suite d'outils de diagnostic et d'optimisation haut de gamme pour garantir une stabilité et une réactivité maximales.

| Fonctionnalité | Description |
| :--- | :--- |
| **Limiteur d'E/S disque** | Empêche les gels système en plafonnant la vitesse de transfert lors de l'activation/désactivation des mods. Des limites personnalisées peuvent être définies par disque. |
| **Tableau de bord de performance** | Une superposition de surveillance en temps réel (PiP) suivant l'activité du CPU, de la RAM et du disque. Supporte le défilement de la chronologie et l'exportation des données historiques (CSV). |
| **Storage Manager** | Détecte les types de SSD/HDD, les systèmes de fichiers et auto-identifie les lecteurs cloud ou réseau. Alertes "Critique" et "Attention" entièrement localisées pour la v0.9.9. |
| **Rafraîchissement Disque Optimisé** | (v0.9.9) Les listes de disques sont rafraîchies une seule fois par opération groupée au lieu de par mod, garantissant une résolution ultra-rapide des dépendances. |
| **Intégration du Cache IO** | (v0.9.9) Le moteur de copie utilise le cache de fichiers global pour éviter les scans de disque redondants lors du déploiement des mods. |
| **Outil de Benchmark** | Testez les performances réelles de votre disque directement dans BMM pour trouver la limite de vitesse optimale. |
| **Guide de Performance Interactif** | Des diagrammes intégrés expliquent exactement comment le limiteur d'E/S et le moteur de transfert par morceaux fonctionnent ensemble. Inclut les nouveaux diagrammes **Cache de Conflits (mtime)** et **Moteur d'Intégrité Deep**. |

---

## 16. Dépôt Serveur (Mode Serveur)

Transformez BMM en serveur web pour héberger vos mods et permettre la synchronisation intelligente (Smart Sync) basée sur des manifestes SHA-256.

| Fonctionnalité | Description |
| :--- | :--- |
| **Serveur HTTP intégré** | BMM peut agir comme un serveur web, hébergeant vos profils directement depuis votre PC. |
| **Manifeste repo.json** | Génération automatique d'un manifeste contenant tous les fichiers, tailles et hachages SHA-256. |
| **Synchronisation Intelligente** | Les clients comparent leur état local avec le serveur et ne téléchargent que les fichiers manquants ou modifiés. |
| **Vérification de Sécurité** | Chaque fichier téléchargé est vérifié par rapport à son hachage cryptographique avant l'installation. |
| **Support Tunnels** | Support intégré pour le partage local (LAN) et public via UPnP ou redirection de port manuelle. |
| **Browse des serveurs vérifiés** | Le navigateur public de serveurs n'affiche que les dépôts portant un champ `hash` validé dans `repos.json`. Chaque serveur listé affiche un badge vert "Verified". |
| **Mot de passe de téléchargement (optionnel)** | L'hôte peut exiger un mot de passe côté abonnés : défini à la génération du serveur, demandé une fois aux abonnés (envoyé en `X-Repo-Password`, mémorisé pour les synchros suivantes). Vide = dépôt ouvert. Distinct du mot de passe admin, qui ne protège que le panneau d'admin de l'hôte. |

---

## 17. Suite d'administration serveur (v0.9.8)

Monitoring en direct, Whitelist, système de Ban par IP/ID et interface glassmorphic premium.

---

## 18. Améliorations de confort (v0.9.8)

Stabilité de la bibliothèque (états vides corrigés), sécurités RPC et nouveaux Crédits vidéo (auto-throttle).

---

## 19. Installation en un clic (bmm://)

Analyse automatique des liens profonds (Deep Links) pour installer des mods ou créer des profils en un clic depuis votre navigateur.

---

## 20. Discord Rich Presence

Affiche votre profil actif et votre statut de serveur sur Discord avec mise à jour réactive.

---

## 21. Diagnostic de conflits avancé

Graphique interactif Mermaid coloré pour visualiser et résoudre les collisions de fichiers complexes.

---

## 22. Recherche Sémantique & Interactive (v0.9.9)

| Fonctionnalité | Description |
| :--- | :--- |
| **Recherche Profonde** | Mode sémantique analysant les labels de diagrammes et métadonnées Tasky. |
| **Schémas Interactifs** | V0.9.9 ajoute les diagrammes **Moteur d'Intégrité Deep**, **Cache de Conflits**, et **Interactions Premium**. |
| **Surlignage Pulsé** | Mise en évidence visuelle (halo bleu) des nœuds de diagrammes trouvés via la recherche. |
| **Indicateurs de Couches** | FAQ enrichie d'icônes identifiant le contenu interactif. |
| **Secours Vidéo** | Basculement auto entre YouTube (online) et local MP4 (offline). |

---

## 23. Migration TypeScript (v0.9.9)

Refonte intégrale du frontend en TypeScript pour une stabilité structurelle et une sécurité IPC maximale.

---

## 24. Moteur Multi-threadé Hautes Performances

Backend Rust isolé garantissant une interface fluide à 60 FPS même lors de lourdes opérations fichiers.

---

## 25. Ergonomie et Interaction Premium (v0.9.9)

BMM v0.9.9 apporte un soin particulier aux micro-interactions et à la fluidité de l'interface.

| Fonctionnalité | Description |
| :--- | :--- |
| **Animations Subtiles** | Entrée et sortie animées (fondu + glissement) pour les menus déroulants d'actions. |
| **Période de Grâce** | Délai de 100 ms avant fermeture des menus pour éviter les clics/survols ratés lors de mouvements rapides. |
| **Menus "Rattrapables"** | Les menus en cours de fermeture peuvent être "rattrapés" au survol sans disparaître. |
| **Icônes Standardisées** : Harmonisation visuelle des chevrons et indicateurs pour un look "Vanguard" cohérent. |

---

## 26. Légal & Conformité (v0.9.9)

BMM assure une transparence légale et fournit des directives claires pour la sécurité de la communauté.

| Fonctionnalité | Description |
| :--- | :--- |
| **EULA Obligatoire** | Les utilisateurs doivent accepter le Contrat de Licence Utilisateur Final (EULA) lors du processus d'installation (NSIS et MSI). |
| **Lecteur EULA Intégré** | Accédez au document légal complet à tout moment depuis la page Crédits. Rendu Markdown de haute qualité. |
| **Contrat Localisé** | L'EULA s'adapte automatiquement à la langue de votre système (support EN/FR) pour une meilleure accessibilité. |
| **Clauses de Modération** | Définitions légales explicites pour la modération des dépôts de serveurs et la conduite des utilisateurs. |
| **Guide de Traduction** | Documentation complète pour permettre aux membres de la communauté de créer et de regrouper leurs propres versions localisées de l'EULA. |

---

## 27. Système de Modpacks — Le format .BMP (v0.9.9)

BMM introduit un système complet de cycle de vie des modpacks pour organiser, partager et vérifier des collections de mods.

| Fonctionnalité | Description |
| :--- | :--- |
| **Création & Gestion** | Regroupez plusieurs mods de n'importe quel profil dans un seul modpack avec métadonnées (nom, description, auteur, version). |
| **Manifeste SHA-256** | Chaque mod d'un modpack stocke un manifeste de fichiers complet avec des hashes SHA-256 par fichier pour la vérification d'intégrité. |
| **Export (.bmp)** | Exportez des modpacks en fichiers `.bmp` (Better ModPack) — un format basé sur JSON conçu pour le partage facile. |
| **Import (.bmp)** | Importez des modpacks depuis des fichiers `.bmp`. Un nouvel UUID est généré à l'import pour éviter les collisions. |
| **Vérification d'intégrité** | Vérifiez que tous les mods référencés dans un modpack sont présents localement et que leurs fichiers correspondent aux hashes SHA-256 enregistrés. |
| **Réparation automatique** | Les mods manquants ou corrompus peuvent être automatiquement re-téléchargés depuis leur source d'origine (Lien Direct ou Dépôt Serveur). |
| **Récupération locale** | Avant tout téléchargement, le moteur de réparation recherche sur le disque local les fichiers déplacés correspondant au hash attendu. |

---

## 28. Intégration BetaHub — Rapports de bugs (v0.9.9)

BMM s'intègre avec BetaHub pour des rapports de bugs structurés et des retours communautaires.

| Fonctionnalité | Description |
| :--- | :--- |
| **Onglets Bug & Suggestion** | Soumettez des bugs ou des suggestions de fonctionnalités via une interface modale dédiée. |
| **Protection Anti-Spam (PoW)** | Utilise des défis cryptographiques SHA-256 pour vérifier les soumissions authentiques sans captchas. |
| **Conception Privée** | Sépare strictement les détails publics du rapport des logs système privés et informations de contact. |
| **Flux Crash-to-Report** | Depuis la modale de crash, les utilisateurs peuvent ouvrir directement un rapport BetaHub pré-rempli avec le ZIP de diagnostic attaché. |
| **Historique des Rapports** | Consultez et suivez vos soumissions récentes avec des liens directs vers BetaHub. |

---

## 29. Contrôle d'Accès Système (v0.9.9)

BMM dispose d'un système de sécurité à deux niveaux pour équilibrer fonctionnalité et sécurité des fichiers.

| Fonctionnalité | Description |
| :--- | :--- |
| **Modale de Premier Lancement** | Une modale glassmorphique premium invite les utilisateurs à choisir leur mode de sécurité au premier démarrage. |
| **Mode Accès Complet** | Permet à BMM de gérer tous les jeux, mods et disques sans restriction. Recommandé pour les configurations multi-disques. |
| **Mode Accès Limité** | Restreint l'interface JS à n'accéder qu'aux dossiers explicitement définis dans les profils. Les opérations lourdes Rust restent non restreintes. |
| **Paramètre Persistant** | Le mode de sécurité choisi est sauvegardé dans les paramètres et appliqué à chaque lancement. |

---

## 30. Tutoriel d'Accueil Tasky (v0.9.9)

BMM propose un tutoriel interactif guidé par la mascotte Tasky.

| Fonctionnalité | Description |
| :--- | :--- |
| **Sélection de Langue** | Le tutoriel commence par un sélecteur de langue interactif avec aperçu des drapeaux. |
| **Guide Étape par Étape** | Tasky accompagne les nouveaux utilisateurs à travers les profils, la bibliothèque, le partage de mods, les outils de performance et la documentation. |
| **Animation Machine à Écrire** | Chaque explication est révélée avec un effet de texte premium type "machine à écrire". |
| **Mise en Évidence d'Éléments** | Les éléments UI ciblés sont mis en surbrillance avec un halo bleu pour guider l'attention de l'utilisateur. |
| **Passer & Naviguer** | Les utilisateurs peuvent passer le tutoriel à tout moment ou revenir aux étapes précédentes. |

---

## 31. Serveur Autonome Léger (v0.9.9)

Générez un script serveur minimal autonome qui fonctionne sans l'interface BMM.

| Fonctionnalité | Description |
| :--- | :--- |
| **Génération de Script** | Génère un script `.bat` pour lancer un serveur de mods ultra-léger pour les machines dédiées/headless. |
| **Tunnel Cloudflare** | Support intégré de Cloudflare Tunnel pour le partage via URL publique (activé par défaut). |
| **Redirection de Port UPnP** | Redirection de port automatique via UPnP pour les configurations LAN-friendly. |
| **Configurable** | Définissez le port, la limite de vitesse d'upload, le mot de passe et la version du serveur (v1/v2) directement depuis l'UI. |

---

## 32. Alertes Markdown de style GitHub (v0.9.9)

Le moteur de rendu Markdown de BMM supporte les blocs d'alerte de style GitHub pour une documentation enrichie.

| Fonctionnalité | Description |
| :--- | :--- |
| **5 Types d'Alertes** | `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` — chacun avec des couleurs et styles distincts. |
| **Syntaxe Bilingue** | Les équivalents français (`[!REMARQUE]`, `[!ASTUCE]`, `[!AVERTISSEMENT]`, `[!ATTENTION]`) sont également supportés. |
| **Titres Localisés** | Les titres d'alertes sont automatiquement traduits selon la langue active. |

---

## 33. Journalisation des Interactions Frontend (v0.9.9)

BMM capture la télémétrie détaillée des interactions frontend pour le diagnostic et l'investigation des crashs.

| Fonctionnalité | Description |
| :--- | :--- |
| **Suivi des Clics** | Tous les clics sur les boutons et les navigations de liens sont journalisés avec des labels pour le débogage. |
| **Raccourcis Clavier** | Les raccourcis courants (Ctrl+N, Ctrl+S, etc.) et les bascules de débogage (Ctrl+Alt+D) sont suivis. |
| **Journalisation Drag & Drop** | Les dépôts de fichiers sont enregistrés avec les noms de fichiers pour le dépannage des imports. |
| **Capture d'Erreurs** | Les erreurs JS non gérées et les promesses rejetées sont transmises au buffer de logs backend. |
| **Suivi Focus/Blur** | Les changements de focus de la fenêtre sont journalisés pour aider à identifier les problèmes liés au timing. |

---

## 34. Launch Packs — Groupes d'Applications (v1.0.0)

Les Launch Packs vous permettent de grouper plusieurs applications et scripts dans une seule unité d'exécution automatisée.

| Fonctionnalité | Description |
| :--- | :--- |
| **Exécution Multi-App** | Groupez des fichiers `.exe`, `.bat`, `.cmd` et `.ps1`. Tous les éléments d'un pack se lancent simultanément en un clic. |
| **Lanceur Invisible** | Utilise un backend VBScript spécialisé pour lancer les applications silencieusement. Les fenêtres de commande et les pop-ups de console sont masqués. |
| **Génération Auto d'Icônes** | BMM convertit automatiquement vos images sources (PNG, JPG) en fichiers `.ico` Windows de haute qualité pour vos raccourcis. |
| **Raccourcis Windows** | Générez un fichier `.lnk` natif sur votre bureau ou dans votre menu démarrer pointant directement vers votre pack invisible. |
| **PowerShell Furtif** | Les scripts PowerShell sont exécutés avec le flag `-WindowStyle Hidden` pour une expérience d'arrière-plan non intrusive. |
| **Gestion des Ressources** | BMM gère le cycle de vie des scripts de lancement et des icônes, assurant une suppression propre lors de la suppression d'un pack. |
| **Export / Import (`.bmmlaunch`)** | Un pack peut être donné. Le fichier porte les décisions — nom, programmes, icône inline — jamais le `launcher.vbs` ni le `.lnk`, pleins de chemins qui n'ont de sens que sur la machine qui les a faits ; l'import les regénère localement. Un fichier sans `kind: "bmm-launchpack"` est refusé, et les programmes dont le chemin n'existe pas sur le PC destinataire sont **signalés**, pas jetés en silence. |
| **Transporté par un dépôt serveur** | `launchpack` est un type d'extra, un dépôt peut donc faire suivre des packs. Une synchro n'en installe jamais un en silence : c'est une liste de programmes à lancer sur votre machine, elle est donc écrite puis proposée avec une confirmation. |
| **Lisible avant d'être lancé** | L'inspecteur de fichiers reconnaît `.bmmlaunch` — combien de programmes, chaque chemin imprimé tel qu'écrit, et lesquels passent par un shell (un `.ps1` s'exécute avec la stratégie d'exécution contournée). |

---

## 35. Serveur MCP & CLI Avancé (v1.0.0)

BMM v1.0.0 introduit une automatisation de niveau professionnel via le Model Context Protocol et un nouveau CLI unifié.

| Fonctionnalité | Description |
| :--- | :--- |
| **Model Context Protocol** | Connectez BMM à des agents IA comme Claude ou Gemini. Gérez vos mods, profils et synchros via une conversation en langage naturel. |
| **Binaire Unifié** | Le `bmm-mcp-server.exe` agit à la fois comme un serveur de protocole JSON-RPC et une interface en ligne de commande autonome. |
| **Contrôle Terminal Complet** | Presque toutes les opérations BMM sont disponibles via CLI : synchro de mods, liste de profils, recherche ou lancement de packs. |
| **Diagnostics à Distance** | Accédez aux statistiques d'installation et analysez les rapports de crash directement depuis un terminal distant ou un script. |
| **Sortie CLI Soignée** | Comprend une bannière ASCII haute fidélité, des niveaux de logs colorés et des sorties de table structurées pour une meilleure lisibilité. |
| **Prêt pour l'Automatisation** | Conçu pour les utilisateurs avancés qui souhaitent scripter leur gestion de mods ou l'intégrer dans des systèmes de home cockpit. |

---

## 36. Centre d'Aide & Autres (v1.0.0)

La vue Documentation a été étendue et renommée "Help & other" pour servir de hub de ressources complet.

| Fonctionnalité | Description |
| :--- | :--- |
| **Hub Unifié** | Regroupe les guides d'utilisation, l'analyse technique, les FAQ et les diagrammes interactifs en un seul endroit. |
| **Diagrammes Interactifs** | Visualisations Mermaid.js haute fidélité de la logique interne de BMM avec support pan/zoom. |
| **Ressources Recherchables** | Tous les articles d'aide et FAQ sont consultables avec un score de pertinence pondéré. |
| **Légal & EULA** | Accès aux conditions d'utilisation et aux contrats de licence directement dans l'application. |

---

## 37. Polissage UI & Aide Contextuelle (v1.0.0)

BMM v1.0.0 propose des raffinements visuels significatifs et un système d'assistance plus intelligent.

| Fonctionnalité | Description |
| :--- | :--- |
| **Tooltips Contextuels** | Le survol de presque n'importe quel élément UI affiche une bulle "Tasky Help" avec des explications claires. |
| **Contrôles de Fenêtre Affinés** | Nouvelles bandes de redimensionnement haute fidélité et poignées de coin pour une gestion plus précise. |
| **Glassmorphism 2.0** | Effets translucides améliorés et bordures de 1px sur toutes les modales et cartes. |
| **Compteur de Mods par Profil** | Les cartes de profil affichent désormais un décompte en temps réel des mods enregistrés, également reflété dans le Mapper. |
| **Mascotte Tasky** | Animations et positionnement améliorés pour Tasky lors de l'onboarding et des interactions d'aide. |

---

## 38. Mapper Visuel & Analyse de Répertoire (v1.0.0)

Le Mapper Visuel offre une analyse structurelle approfondie de votre collection de mods, garantissant que votre arborescence d'installation est exactement comme vous le souhaitez.

| Fonctionnalité | Description |
| :--- | :--- |
| **Arborescence Interactive** | Explorez la structure physique des fichiers de chaque mod de votre bibliothèque via un arbre interactif haute performance. |
| **Analytics de Mods en Temps Réel** | La vue Mapper affiche des statistiques en direct, incluant le nombre total de mods par profil et le décompte individuel des fichiers par mod. |
| **Profondeur de Récursion Infinie** | (v1.0.0) Le moteur de parcours de répertoire supporte désormais une profondeur d'imbrication infinie avec détection de cycles, idéal pour les mods de scènes complexes ou d'appareils haute fidélité. |
| **Interaction Dynamique des Nœuds** | Développez ou réduisez des branches entières de répertoires. Identifiez instantanément les dossiers "Racines" vs "Secondaires" grâce à un code couleur visuel. |
| **Accès Direct aux Fichiers** | Cliquez avec le bouton droit sur n'importe quel fichier ou dossier dans l'arborescence pour ouvrir son emplacement physique dans l'Explorateur Windows ou copier son chemin d'installation relatif. |
| **Scan Propulsé par le Backend** | Utilise un moteur Rust multi-threadé pour le scan, garantissant que l'interface reste réactive même lors de l'analyse de bibliothèques contenant des dizaines de milliers de fichiers. |

---

## 39. Espace disque par profil (v1.0.0)

Chaque carte de profil affiche l'espace disque total occupé par son dossier de mods.

| Fonctionnalité | Description |
| :--- | :--- |
| **Chargement asynchrone** | La taille du disque est calculée en arrière-plan après le rendu de la grille de profils, avec un spinner affiché pendant le calcul. |
| **Affichage formaté** | La taille est affichée en unités lisibles (B, Ko, Mo, Go, To) à côté d'une icône disque sur la carte du profil. |
| **Propulsé par Rust** | Basé sur une commande Tauri récursive `get_folder_size` qui parcourt l'arborescence sans bloquer l'interface. |
| **Par profil** | Chaque dossier de mods de profil est mesuré indépendamment. Les profils dont les chemins sont inaccessibles n'affichent rien. |

---

## 40. Annulation de l'export .MM (v1.0.0)

L'opération d'export .MM peut désormais être annulée en cours de progression sans corrompre la sortie ni bloquer l'interface.

| Fonctionnalité | Description |
| :--- | :--- |
| **Annulation en cours** | Un bouton "Annuler" dans l'overlay de progression appelle la commande Tauri `cancel_export_modlist`. |
| **Flag AtomicBool** | Un flag dédié `export_cancelled` dans `AppState` est vérifié par la boucle d'export Rust à chaque itération de fichier. |
| **Remise à zéro propre** | Après l'annulation, l'overlay se ferme, les boutons se réactivent et un toast "Export annulé" s'affiche. |
| **Sécurité des fichiers partiels** | Le fichier d'export annulé est écarté ; aucun fichier `.mm` incomplet n'est laissé sur le disque. |

---

## 41. Bibliothèque d'icônes de profil étendue (v1.0.0)

Le sélecteur d'icônes de profil propose désormais plus de 110 icônes réparties en 15 catégories thématiques.

| Catégorie | Exemples |
| :--- | :--- |
| **Tech** | monitor, server, code, keyboard, mouse, printer, bluetooth, satellite, router, cloud |
| **Transport** | bus, truck, ship, bicycle, train, helicopter |
| **Médias** | film, tv, speaker, mic, clapperboard, disc |
| **Sport** | trophy, medal, dumbbell, bike, swords |
| **Nature** | tree, leaf, flower, bird, fish, bug |
| **Lieux** | home, building, flag, castle, tent |
| **Symboles** | infinity, diamond, hexagon, fingerprint, sparkles, atom, crown, layers |
| **Outils** | pen, ruler, compass, scissors, book, bookmark, lock, search, filter |

---

## 42. Historique des Modifications (v1.0.0)

Le système d'Historique des Modifications fournit un journal d'audit détaillé de tous les changements apportés aux métadonnées de votre collection de mods.

| Fonctionnalité | Description |
| :--- | :--- |
| **Suivi des Métadonnées** | Enregistre automatiquement les changements de noms, versions, auteurs, descriptions, tags et liens de téléchargement. |
| **Détail par Champ** | Chaque entrée identifie exactement quels champs ont été modifiés (ex: "Modifié : Auteur, Tags"). |
| **Audit Historique** | Consultez la date et l'heure exactes de chaque mise à jour de métadonnées. |
| **Filtrage d'Actions** | Filtrez la liste d'historique pour afficher uniquement des types spécifiques de modifications. |
| **Contrôle de Rétention** | Choisissez la durée de conservation de l'historique (ex: 30 jours, 6 mois) pour gérer l'espace disque. |
| **Nettoyage Manuel** | Effacez l'intégralité du journal d'historique en un seul clic via la modale de gestion. |
| **Vue Premium** | Design de liste glassmorphique avec badges et indicateurs haute fidélité. |

---

## 43. Catalogue d'Apps (v1.0.0)

Le Catalogue d'Apps est un installeur en un clic pour les applications et outils compagnons, piloté par un `catalog.json` hébergeable.

| Fonctionnalité | Description |
| :--- | :--- |
| **Parcourir & Filtrer** | Grille de cartes avec miniature, badges, recherche et filtres catégorie/prix (Jeu/Utilitaire/Autre · Gratuit/Freemium/Payant). |
| **Installation en un clic** | Supporte `zip`, `exe`, `msi` et `script`. Les zips portables sont extraits et l'exécutable principal choisi automatiquement ; les installeurs lancent leur propre assistant. |
| **Détection zéro action** | Pour tout installeur, BMM prend un instantané des dossiers d'installation + du registre Windows avant de le lancer, puis compare après pour trouver l'exécutable à lancer et le désinstalleur — aucune sélection manuelle. |
| **Choix du dossier** | Les apps portables peuvent être installées dans un dossier personnalisé, par défaut le répertoire `Apps` géré par BMM. |
| **Suivi d'utilisation** | Le temps passé dans chaque app lancée est enregistré automatiquement à sa fermeture. |
| **Désinstallation intelligente** | Les apps gérées proposent garder/supprimer les fichiers ; les apps installées par setup peuvent lancer leur vrai désinstalleur Windows (résolu depuis le registre). |
| **Historique & Favoris** | Journal d'activité par app (install/lancement/désinstallation) avec icônes, plus un onglet favoris. |
| **Modale de détail** | Galerie d'images (miniature + captures), rendu Markdown complet du README, prérequis, statistiques d'usage et label de source. |
| **Créateur de Catalogue** | Construisez un `catalog.json` dans l'app — ajout d'apps via un formulaire, aperçu du JSON, puis copie ou téléchargement pour héberger votre propre catalogue. |
| **Modèle de confiance** | Les badges `Official` / `Partner` sont accordés selon la source du catalogue (le catalogue officiel et ses `partner_catalogs`), jamais par ce que prétend un JSON. |
| **Sources communautaires** | Ajoutez n'importe quelle URL de catalogue communautaire ; le catalogue officiel peut auto-importer les catalogues partenaires et communautaires. |

---

## 44. Registre de liens centralisé (v1.0.0)

Toutes les URLs externes utilisées par l'app sont regroupées dans un seul fichier éditable, `assets/links.json`, pour pouvoir changer les liens sans recompiler.

| Fonctionnalité | Description |
| :--- | :--- |
| **Source unique** | Catalogue plugins, liste server-browse, contributeurs, API de mise à jour, catalogue d'apps et tous les liens sociaux (Discord, Reddit, Ko-fi, GitHub, forum ED) dans un seul fichier JSON. |
| **Chargement à 3 niveaux** | Chargé au démarrage depuis une URL distante, avec repli sur le fichier local intégré, puis les valeurs par défaut. Une ligne de log indique la source utilisée. |
| **Injection HTML à l'exécution** | Les liens statiques de la page Crédits, de la modale BetaHub et des liens rapides du navigateur de dépôts se mettent à jour depuis le JSON via des attributs `data-link-key`. |
| **Compatible mises à jour** | `links.json` est suivi par le manifeste de mise à jour incrémentale, donc les URLs peuvent changer via une release sans rebuild complète. |

---

## 45. Système de Plugins (v1.0.0)

Les plugins étendent BMM avec des ensembles de mods curés, des scripts d'automatisation et du contenu embarqué, décrits par un manifeste.

| Fonctionnalité | Description |
| :--- | :--- |
| **Format de manifeste** | Chaque plugin déclare id, nom, version, auteur, description, jeu cible, permissions, tags, site web, dossiers embarqués et une modlist optionnelle. |
| **Modes d'application** | Un plugin peut appliquer une **modlist** déclarative, exécuter des **scripts** embarqués, ou **les deux**. |
| **Application stricte** | Les mods requis peuvent être marqués stricts et épinglés à un SHA-256. BMM compare votre bibliothèque aux exigences et rapporte ce qui manque avant d'appliquer. |
| **Sources d'installation** | Installation depuis le catalogue de plugins distant, depuis un fichier `.bmmplug` local, ou création de votre propre plugin dans l'app puis export. |
| **Permissions** | Les plugins demandent des permissions ; l'exécution de scripts externes embarqués nécessite un opt-in explicite "plugins non sûrs". |
| **Cycle de vie** | Activation/désactivation, désinstallation, ouverture du dossier du plugin et validation par checksum sont intégrés. |
| **Génération de scripts** | Génère des extraits cURL / PowerShell prêts à l'emploi qui pilotent BMM via l'API locale. |

---

## 46. API REST locale (v1.0.0)

BMM lance un serveur HTTP local sur `127.0.0.1:51274`, permettant aux outils externes et aux plugins de le contrôler par programmation.

| Fonctionnalité | Description |
| :--- | :--- |
| **~83 endpoints** | Mods, profils, plugins, modpacks, dépôt et import/export de données sont tous contrôlables via `/api/`. |
| **Auth par token** | Un token d'API par installation protège les endpoints ; il peut être consulté ou régénéré depuis la vue Plugins. |
| **Prêt pour l'automatisation** | Alimente les outils compagnons et les configurations de macros (ex : Stream Deck), ainsi que l'explorateur d'API intégré. |
| **Aides aux scripts** | Un clic génère des extraits de requêtes authentifiées pour n'importe quelle action. |

---

## 47. ContentID — Identité de mod (v1.0.0)

Chaque mod reçoit une empreinte de contenu déterministe pour que BMM reconnaisse le même mod entre machines, peu importe le nom de son dossier.

| Fonctionnalité | Description |
| :--- | :--- |
| **ID déterministe** | Les mêmes fichiers produisent toujours le même `content_id`, dérivé des hash réels des fichiers du mod. |
| **Correspondance entre machines** | Les modpacks, listes `.MM` et la synchro de dépôt font correspondre les mods par contenu, pas par nom — éliminant les fausses différences. |
| **Détection "déjà présent"** | Le flux d'import utilise ContentID pour détecter les mods que vous possédez déjà, évitant les doublons. |
| **Lié à l'intégrité** | L'ID reste synchronisé avec les empreintes SHA-256 du moteur d'intégrité. |

---

## 48. Système de thèmes (v1.0.0)

Un moteur de thèmes complet qui restyle 100% de BMM **sans aucune connaissance CSS**, tout en exposant le CSS brut pour les utilisateurs avancés. Ouvert depuis **Paramètres → Thème**.

| Fonction | Description |
| :--- | :--- |
| **12 presets intégrés** | Thèmes prêts à l'emploi (BMM Default, Sombre, Void, Full White, Discord, Orange, Spotify Green, Brutalist, Glass, Clay, Nord, Sakura), thèmes clairs inclus. |
| **Auto-palette** | Choisissez une seule couleur et générez un thème complet et cohérent, sombre ou clair. |
| **Pioche d'éléments** | Clic droit sur n'importe quel élément pour éditer ses couleurs texte/fond/bordure, états survol & actif, CSS perso, icône (swap SVG) ou image. |
| **Tokens de design** | Les thèmes sont du JSON de variables CSS `--bmm-*` injectées en blocs `<style>` — les fichiers sources ne sont jamais modifiés, tout est réversible. |
| **Patcheur inline** | Un MutationObserver réécrit les couleurs inline codées en dur sur le contenu dynamique pour qu'il suive le thème. |
| **Contraste auto** | Sur les thèmes clairs, les textes/surfaces clairs illisibles sont assombris automatiquement (désactivable). |
| **Suivi des modifs** | Un panneau « Vos modifications » liste chaque édition avec revert individuel ; Discard / Tout annuler restaurent instantanément (y compris les cartes mods/profils dynamiques, sans rafraîchir). |
| **Partage & installation** | Exportez un `.bmmtheme` (ZIP avec assets/polices), copiez un lien `bmm://theme/import-inline` en un clic, ou installez depuis le catalogue de thèmes. |

---

## 49. Bac à sable de traduction (v1.0.0)

Un outil intégré (Paramètres → Bac à sable de traduction) qui permet à n'importe qui de créer ou corriger une langue sans toucher au code — il étend le système d'internationalisation dynamique (§6).

| Fonction | Description |
| :--- | :--- |
| **Bac à sable sûr** | Éditez les clés de traduction de façon isolée ; rien ne change dans BMM avant l'export ou l'application. |
| **Mode pointeur** | Cliquez sur n'importe quel élément de l'app pour sauter directement à sa clé i18n (ou signaler du texte codé en dur). |
| **Scanner de texte codé en dur** | Analyse la source à la recherche de chaînes sans clé i18n, pour repérer les manques. |
| **Mode overlay** | Détachez le bac à sable en un overlay déplaçable et redimensionnable pour éditer tout en utilisant l'app. |
| **Export** | Sauvegardez votre langue en fichier `.json` (fichier complet, ordre préservé). |
| **Partage en un clic** | Un bouton **Partager** produit un lien `bmm://language/import-inline` (compressé en gzip) ; pour les traductions complètes qui dépassent la taille limite du lien, il bascule sur l'export du `.json` à partager en fichier. |

## 50. Navbar personnalisable & Pages en sandbox (v1.0.0+)

- **Réordonner / personnaliser la navbar** — organiser la navigation du haut à sa guise.
- **Pages `bmmpage://` en sandbox** — les entrées de navbar personnalisées peuvent
  ouvrir des pages isolées via un broker à permissions, pour que le contenu des pages
  tierces ne touche pas le cœur de l'app.

## 51. Planificateur de plugins & Catalogue web (v1.0.0+)

- **Planificateur** — faire s'exécuter automatiquement des actions de génération de
  plugins/scripts à des horaires choisis (déclenchées via deeplinks).
- **Catalogue BetterCommunity Web** — parcourir & installer les apps, plugins et thèmes
  communautaires directement depuis BMM (flux `catalog.json` de BCWEB), et ouvrir les
  deeplinks web d'**installation / d'ajout de source** qui passent la main à l'app.

## 52. Boutique de thèmes & Partage (v1.0.0+)

- Une bibliothèque croissante de thèmes intégrés (Sombre, White, Discord, Spotify,
  Brutal, Claude, Nord, Sakura…) plus un **mode clair de première classe**, et des
  fichiers `.bmmtheme.json` partageables exportés/importés depuis l'éditeur de thèmes.

## 53. Hub de tutoriels interactif (v1.0.0+)

- Un **Hub de tutoriels** guidé pas à pas qui accompagne les nouveaux utilisateurs dans
  les principaux workflows de l'app, en complément de l'onboarding au premier lancement.

---

## 54. Palette de commandes & raccourcis réassignables (v1.0.0+)

Une seule barre de recherche sur toute l'app : appuyez sur **Ctrl/⌘+K** n'importe où.

| Fonctionnalité | Description |
| :--- | :--- |
| **Aller partout** | Sautez sur n'importe quel écran — y compris vos pages de navbar personnalisées, détectées en direct. |
| **Lancer des actions** | Ajouter un mod, scanner, vérifier l'intégrité, importer des profils (OvGME/OMM), piloter toute la surface Dépôt Serveur (sync/host, générer un serveur, start/stop, monitoring, copier l'ID créateur), vérifier les mises à jour, ouvrir les stats de stockage/hachage. |
| **Deux modes de recherche** | Classique (littéral) et **Sémantique** — étendue par synonymes : « mise à jour » trouve aussi « upgrade / nouvelle version ». |
| **Tout réassigner** | Réglages → Raccourcis clavier liste chaque commande : enregistrez une combinaison, revenez au défaut, ou effacez ; les conflits sont signalés. Les pages perso ont aussi leurs raccourcis. |

## 55. Confidentialité, télémétrie & mode hors ligne (v1.0.0+)

| Fonctionnalité | Description |
| :--- | :--- |
| **Télémétrie strictement opt-in** | Rien n'est collecté avant l'acceptation explicite de la boîte de consentement ; refuser efface tout tampon. |
| **Ce qui part** | Pages, clics (libellés seulement — jamais les valeurs tapées), échantillons de perf, erreurs, un profil matériel anonyme. Pas de chemins, pas de contenu de mods, pas d'identité. |
| **Replay de session masqué** | Replay rrweb optionnel avec noms de mods/profils et chemins rendus en •••• ; le démasquage est un interrupteur séparé et explicite. |
| **Pipeline local-first** | Les événements s'accumulent dans un fichier local plafonné à 10 Mo ; l'envoi se fait en lots gzip via HTTPS uniquement. Pas d'endpoint configuré = les données ne quittent jamais la machine. |
| **Contrôles RGPD** | Exportez le tampon brut ; consultez chaque paquet envoyé (noms/comptes d'événements seulement) et demandez sa suppression, honorée sous 72 h. |
| **Mode hors ligne** | Vraies sondes de connectivité (pas juste le drapeau OS) ; bandeau discret, fonctions réseau en pause avec toasts clairs, tout le local continue, reprise auto (re-sonde 15 s). |

## 56. Suite documentation & tutoriels (v1.0.0+)

| Fonctionnalité | Description |
| :--- | :--- |
| **Hub Help & Other** | Articles bilingues pilotés par les données (parties utilisateur + développeur), recherche classique & sémantique, 41 diagrammes Mermaid interactifs avec explications par nœud. |
| **Site BMM Docs** | Le site miroite le contenu in-app (sans les éléments interactifs) avec diagrammes Mermaid et une référence API complète — prêt pour le PDF. |
| **Tutoriels interactifs** | Tutoriels guidés (coach-card) pilotant la vraie UI, avec un bac à sable auto-nettoyant (profil d'exemple, mods avec conflit volontaire, modpack d'exemple). Couvre désormais aussi la palette de commandes & les raccourcis. |
| **Traduire BMM** | Le Bac à sable de traduction : créez une langue, traduisez clé par clé avec aperçus en direct et barre de progression, exportez/importez — sans recompilation. |

---

*Better Mod Manager est développé par FreeProject089.*

## 57. Bibliothèque d'icônes partagée (v1.0.0+)

2017 icônes **Lucide** et 3453 marques **Simple Icons**, plus tes propres images, derrière
un sélecteur unique (recherche, onglets, import). Branchée sur les **tags**, l'**icône
visuelle de profil** et la **création de plugin**.

Une icône est une chaîne (`lucide:x`, `si:x`, `data:image/…`) : c'est de la donnée, donc
elle suit tous les partages existants — profil exporté, dépôt, catalogue — sans traitement
particulier. Les packs sont chargés à la demande et **shardés par lettre**, pour qu'afficher
une icône stockée coûte ~150 Ko et non 4,6 Mo.

## 58. Tags : icônes, dégradés, édition (v1.0.0+)

Un tag porte un nom, une couleur, désormais une **icône** et une **seconde couleur**
optionnelle (dégradé). Les tags s'éditent sur place ; l'ancien formulaire ne savait que
créer. Les cinq endroits qui dessinent un tag passent par un rendu unique, ce qui garantit
qu'un même tag a la même tête partout.

## 59. Panneaux latéraux ancrables (v1.0.0+)

Le tutoriel interactif, l'éditeur de thèmes et le bac à sable de traduction s'ancrent au
bord de la fenêtre en colonne pleine hauteur, largeur réglable et mémorisée. L'application
se réorganise autour d'eux plutôt que d'être recouverte. Chaque panneau adapte sa **forme**
au mode : empilement des colonnes, barre d'outils sur deux rangées.

## 60. Planificateur : contrôle de flux complet (v1.0.0+)

En plus de Si/Sinon, Attendre et Répéter : **Pour chaque** (sur une collection vivante, avec
substitution de `{item.*}`), **Switch** (cas ordonnés + défaut) et **do… while**. De quoi
écrire « pour chaque mod activé, vérifie l'intégrité puis notifie » sans une étape par mod.

## 61. Autorat par IA et par script (v1.0.0+)

Le serveur MCP et le CLI ne se contentent plus de lire : ils **créent**. Automatisations
complètes (blocs de contrôle inclus) et brouillons de plugins. Une tâche créée arrive
désactivée, à inspecter avant d'être armée ; un plugin arrive en brouillon, à installer par
le flux normal de l'app avec ses permissions.

## 62. Des scripts dans une tâche planifiée (v1.0.0+)

Une étape de workflow peut désormais **exécuter un script que vous écrivez** — PowerShell,
CMD, Bash ou Python — et non plus seulement lancer un programme avec des arguments. BMM
enregistre le corps dans un fichier temporaire et remet ce fichier à l'interpréteur : rien de
ce que vous tapez n'est jamais placé sur une ligne de commande, il n'y a donc aucun
échappement à réussir et un guillemet égaré ne peut pas changer ce qui s'exécute. Dans un
**POUR CHAQUE**, `{item.name}` et `{item.id}` sont remplacés avant le démarrage du script.

Dans *Avancé*, vous pouvez nommer une variable. La première ligne de sortie du script en
devient la valeur, et les étapes suivantes peuvent s'y brancher — sans cela, un script ne
pouvait que signaler une réussite ou un échec, ce qui rendait « si le script dit oui,
alors… » impossible à exprimer.

## 63. Permissions de tâche, une autorisation par capacité (v1.0.0+)

Une tâche portait un unique interrupteur « autoriser les commandes personnalisées ». Il vous
annonçait qu'une permission était accordée sans dire laquelle, et il ne couvrait pas du tout
les deeplinks — alors qu'un lien `bmm://` atteint tout ce que l'app expose.

Il y a maintenant quatre autorisations distinctes, chacune nommant ce qu'elle débloque :
**lancer des programmes externes**, **exécuter des scripts**, **déclencher des deeplinks** et
**arrêter un programme en cours**. Chacune est désactivée tant que vous ne l'activez pas, et
une étape dont la permission manque échoue avec un message indiquant laquelle accorder, au
lieu de s'exécuter en silence.

Arrêter un programme est séparé de le lancer parce que le risque est d'une autre nature :
démarrer quelque chose s'annule, tuer quelque chose peut perdre un travail non enregistré
sans rien pour revenir en arrière.

Les tâches construites avant la séparation gardent tout ce qu'elles avaient — sauf *exécuter
des scripts* et *arrêter un programme*, qu'aucune tâche existante ne reçoit : ces capacités
n'existaient pas quand vous avez coché l'ancienne case.

**Une tâche qui arrive dans un fichier n'en reçoit aucune.** Importer un `.bmmpa`, ou ajouter
un `.bmmscript` partagé à vos tâches, retire les quatre et laisse la tâche **désactivée** —
puis vous dit ce que le fichier demandait, pour que vous accordiez ce que vous voulez
vraiment. L'automatisation est intacte et à un interrupteur de fonctionner ; ce qu'elle ne
peut pas faire, c'est arriver en tenant déjà le droit de lancer des programmes à intervalle
régulier.

## 64. Centre de notifications (v1.0.0+)

Une cloche se trouve à côté de **Vérifier les mises à jour**. Elle conserve chaque message
que BMM vous a affiché, avec sa source, son heure d'arrivée et son texte complet — un toast
est une fenêtre de trois secondes sur un événement déjà passé, et le manquer signifiait
jusqu'ici le perdre. Les entrées peuvent être marquées comme lues, supprimées une à une ou
vidées, et les messages répétés d'une opération par lot se regroupent en une seule ligne.

## 65. De meilleurs rapports de bug (v1.0.0+)

L'export de diagnostics emporte désormais l'**environnement de la vue web** en plus de celui
de l'app : les préférences d'accessibilité et de couleurs de votre système, la taille de la
fenêtre et sa densité de pixels, ainsi que les erreurs non capturées de la session. Ces
éléments modifient silencieusement le comportement de l'app tout en étant invisibles sur une
capture d'écran — un spinner qui refusait de tourner a été remonté jusqu'à un interrupteur
d'accessibilité de Windows que rien n'avait jamais rapporté.

## 66. Choisir le démarrage de BMM depuis l'installateur (v1.0.0+)

La page Configuration de l'installateur n'est pas décorative : ce que vous y choisissez est
appliqué au premier lancement, pour que BMM s'ouvre déjà configuré au lieu de vous reposer
les mêmes questions.

- **Thème.** Le sélecteur affiche une tuile par thème intégré avec ses vraies couleurs
  (fond, surface, accent, texte), et se propose une seconde fois sur la page finale — un
  thème est une décision sur une image, et c'est le premier moment où vous n'avez plus rien
  d'autre en tête. Votre choix est désormais réellement appliqué au premier lancement.
- **Langue.** `auto` suit votre système ; choisir explicitement une langue saute aussi
  l'invite de langue au premier démarrage de BMM.
- **Télémétrie anonyme** et **Discord Rich Presence** arrivent **déjà cochées**. Les deux
  sont bien visibles sur cette page, vous pouvez les décocher avant d'installer, et changer
  d'avis à tout moment dans les Réglages. Ce que la télémétrie envoie est décrit dans
  **PRIVACY_FR.md**, qui énonce explicitement ce pré-cochage plutôt que de vous le laisser
  découvrir.
- **Les Conditions et la Politique de confidentialité** affichées pendant l'installation le
  sont dans votre langue lorsqu'une traduction est fournie, et leurs tableaux — dont le
  récapitulatif « ce qui quitte votre PC » — sont maintenant lisibles, et non du markdown
  brut.

Chacun de ces choix est facultatif, et les valeurs par défaut de BMM s'appliquent
inchangées à une installation qui n'est jamais passée par l'installateur.


---

## 67. Écrire ton propre tutoriel interactif (v1.0.0+)

Le hub des tutoriels propose **Créer…**, **Importer…** et **Catalogues…** au bas de sa liste.

Un tutoriel que tu écris est fait de **parties** et d'**étapes**, et une étape peut tout ce
que fait une étape officielle : ouvrir une vue, surligner un élément, attendre que tu réalises
réellement une action avant de débloquer Suivant, ou simplement expliquer. Le bouton
**Tester**, à côté du champ de sélecteur, fait clignoter ce qu'il trouve maintenant — pratique
pour attraper une faute de frappe, et il te dit franchement qu'il ne peut pas valider le
tutoriel sur l'écran de quelqu'un d'autre.

**Partage-le.** *Partager (.bmmtut)* écrit un fichier unique, signé avec ta clé de créateur.
Celui qui l'importe est informé si la signature est valide, absente ou **invalide** — un
fichier modifié après signature est signalé plutôt qu'accepté en silence comme ton travail.

**Suis un catalogue.** *Catalogues…* prend l'adresse d'un catalogue de tutoriels et liste ce
qu'il propose ; installer tient en un clic. Un catalogue protégé demande son mot de passe ou
ta clé d'identité dans le même bloc que tous les autres écrans de catalogue.

Les tutoriels personnalisés tournent sur le même moteur que ceux d'origine : ils se comportent
à l'identique. Ce qu'ils ne peuvent pas faire, c'est exécuter du code — un tutoriel affiche du
texte et surligne des parties de l'interface, et le texte partagé est réduit aux balises de
mise en forme.

---

## 68. Fermer un serveur que tu as généré (v1.0.0+)

Chaque serveur généré par BMM — le Multi-Repo Hub, le standalone Express, et le couple
`.bat` / `.sh` léger dans ses deux versions — lit désormais un **`access.json`** posé à côté
de lui :

```json
{
  "password": "",
  "pubkeys": ["ssh-ed25519 AAAAC3Nza… toi@machine"],
  "audience": "http://depot.exemple.com:3000"
}
```

- Laisse-le vide et le serveur reste ouvert, exactement comme avant.
- Un **mot de passe** est demandé à chaque requête de contenu.
- Les **clés autorisées** exigent une preuve signée — et la première clé listée la rend
  obligatoire pour *tout le monde* : ajoute la tienne avant celle des autres.
- **`audience`** est l'adresse que tapent tes abonnés, exactement telle qu'ils la tapent. BMM
  signe l'adresse qu'il a composée : c'est ce qui empêche de rejouer ici une preuve captée
  ailleurs — et c'est la seule valeur qui, mal réglée, refuse tout le monde.

Le fichier est lu **à l'arrivée d'une requête** : ajouter la clé d'un abonné prend effet
immédiatement, sans régénérer ni réenvoyer quoi que ce soit. Dans le Multi-Repo Hub, chaque
dossier de dépôt a son propre fichier : un même hub peut donc porter un dépôt ouvert à côté
d'un dépôt fermé.

Un export de hub **statique** n'a aucun processus et ne peut rien appliquer ; il embarque un
README qui le dit.

---

## 69. Atteindre un dépôt qui n'existe qu'en SSH (v1.0.0+)

**Mettre à jour depuis le serveur** lit maintenant en SFTP autant qu'en HTTP. C'est important
parce qu'un serveur HTTP doit publier un index de répertoire pour que BMM le lise, et qu'une
machine atteinte en SSH n'en publie généralement aucun — précisément le cas où les mods
n'existent nulle part ailleurs.

Ouvre **Ce dépôt est sur une machine SSH** et choisis un des serveurs déjà configurés dans
*Publier par SSH*. L'hôte, le port, le compte et le dossier viennent de là ; tu fournis les
deux choses que BMM n'enregistre jamais — le **mot de passe du compte** et la **phrase secrète
de la clé**. Le même bloc figure dans *Mettre à jour le Server Repo*, où il rend en plus
utilisable, pour la première fois, un serveur authentifié par mot de passe.

**Publier par SSH** peut désormais prendre sa clé privée dans tes **clés d'identité** : le
sélecteur sous le champ du chemin les liste par leur nom. En choisir une remplit le chemin —
configurer un serveur ne change jamais l'identité que BMM présente aux catalogues.

Et quand *Tester la connexion* refuse une écriture, il dit pourquoi : le propriétaire et le
mode du dossier distant, le compte utilisé, et la commande qui corrige. `/srv`, `/var/www` et
`/opt` appartiennent à root sur la plupart des systèmes — tout le monde peut les lister, seul
root peut y créer un fichier — et ni ton compte ni ta clé n'ont de problème.

---

## 70. Plusieurs clés d'identité, pas une seule (v1.0.0+)

**Paramètres → Identité & API → Clés d'identité** contient autant de clés que tu veux, chacune
sous un nom que tu choisis. L'une est celle par défaut, présentée à tout ce qui en demande une ;
n'importe quel serveur peut être dirigé vers une autre. Une identité professionnelle et une
personnelle cohabitent sans échanger de fichiers entre deux exécutions.

**ed25519, RSA et ECDSA** sont tous acceptés, au format OpenSSH ou en `.ppk` PuTTY. Seul le
**chemin** est conservé — le fichier est lu au moment de signer, et ce qui circule est une
attestation signée à durée de vie courte, jamais la clé.

Tous les sélecteurs de clé de l'application listent ces mêmes clés, et un choix fait pour un
serveur est retenu pour ce serveur.

---

## 71. Publier une liste, pas seulement un catalogue (v1.0.0+)

Sur BetterCommunity, **Proposer du contenu → Héberger mon propre catalogue** peut maintenant
héberger deux choses qui sont des documents plutôt que des collections d'items :

- une **liste de Server-Repos** — le fichier que lit *Parcourir les Server-Repos* dans BMM,
  pour publier ta propre sélection de dépôts ;
- un **index de catalogues** — un catalogue de catalogues, qui donne à quelqu'un une seule
  adresse ramenant d'un coup des catalogues d'applications, de plugins, de thèmes,
  d'automatisations, de modpacks, de tutoriels et de dépôts.

Les deux s'exportent depuis BMM (le constructeur de catalogue de dépôts, et celui d'index de
catalogues dans les Paramètres), s'envoient comme un fichier JSON unique, et sont servis à une
adresse stable avec le même contrôle d'accès que n'importe quel catalogue. Il n'y a rien à
héberger par entrée : c'est donc gratuit.

La page propose aussi désormais **Héberger un Server-Repo** — les mods eux-mêmes, qui sont
autre chose qu'un catalogue et n'avaient jusque-là aucun panneau indicateur ici.


## 72. BMMScript — les automatisations en texte (v1.0.0+)

Le planificateur a une seconde façon d'écrire la même chose : l'automatisation en texte, dans
l'onglet **Code** de l'éditeur de tâche.

Ce n'est pas un langage séparé avec ses propres actions. Il **compile vers les blocs** — le
texte devient exactement les étapes que produit l'éditeur de blocs, et le même exécuteur les
lance. Trois conséquences, et c'est tout le principe :

- **Il n'est jamais en retard sur l'app.** Une action s'écrit `do <nom>(…)` et le langage ne
  contient aucune liste de noms d'actions : une action ajoutée à BMM est écrivable le jour même.
- **Dans les deux sens.** Le code s'ouvre en blocs ; les blocs s'impriment en code. Aucune
  direction ne perd quoi que ce soit, sauf vos commentaires et lignes vides, que l'arbre de
  blocs n'a nulle part où ranger.
- **Il ne peut pas faire plus qu'un bloc.** Permissions, substitution de variables, limites de
  boucle et gestion d'erreur restent celles de l'exécuteur. Le code est une façon d'*écrire*
  une automatisation, pas de contourner ses règles.

Il a les conditions et les groupes booléens, quatre sortes de boucles, les branches
`parallel`, `try`/`catch`, `switch`, les variables avec typage optionnel, l'arithmétique, les
comparaisons, les blocs partagés, les sous-tâches (en attendant ou non), et des corps `script`
bruts en PowerShell, CMD, Bash, Python, Node ou Rust — pris exactement tels qu'écrits,
accolades comprises.

Ce qu'il n'a délibérément **pas** : vos propres fonctions, et la récursivité.

L'éditeur compile pendant que vous tapez et place le curseur sur la première erreur quand vous
le demandez — jamais pendant que vous êtes encore sur la ligne. L'autocomplétion propose ce
qui va à cet endroit (actions après `do`, moteurs après `script`, conditions dans un
emplacement de condition) et **Entrée n'accepte jamais une suggestion** : Entrée est un retour
à la ligne, Tab accepte.

La liste complète de tout ce qui s'écrit est générée depuis le registre de BMM, elle ne peut
donc pas décrire une version qui n'existe pas : **Aide & autres → BMMScript — toutes les
actions, conditions et valeurs**, et la même page sur le site de documentation.

## 73. Publier un catalogue d'automatisations (v1.0.0+)

BMM savait suivre un catalogue d'automatisations et n'avait aucun moyen d'en fabriquer un.
Publier voulait dire écrire `catalog.json` à la main en devinant les noms de champs.

**Paramètres → Planificateur → Fichiers… → Mes catalogues… → En créer un** choisit vos
automatisations et écrit **un seul fichier** : un `.bmmbundle` contenant le `catalog.json` et
chaque automatisation emballée dedans, ou un `catalog.json` d'adresses pour des
automatisations déjà hébergées. Envoyez le bundle, ou déposez le fichier de catalogue sur
GitHub, GitHub Pages ou n'importe quel hébergement statique — voir §77.

Les adresses écrites sont **relatives** — `nightly.bmmpa`, pas une URL complète — parce qu'un
catalogue qui nomme son propre hébergeur cesse de fonctionner dès qu'il est déplacé, copié ou
forké, et être forké est la vie normale d'un dossier sur GitHub. BMM les résout par rapport à
l'endroit d'où il a récupéré le catalogue.

Tout ce qu'une automatisation appelle voyage avec elle : sous-tâches, blocs partagés, launch
packs et plugins. Deux automatisations du même nom reçoivent des fichiers différents, pour
qu'une entrée ne serve jamais en silence le contenu d'une autre.

## 74. Les catalogues de thèmes peuvent pointer vers un fichier (v1.0.0+)

Tous les autres types de catalogue listent une *adresse* et récupèrent le fichier. Un catalogue
de thèmes devait porter le thème entier en ligne : la façon évidente de publier — un dossier
de `.bmmtheme` avec un `catalog.json` à côté — était donc la seule qui ne marchait pas. Il
fallait coller le corps complet de chaque thème dans le flux à la main, et le recoller pour
publier un correctif.

Une entrée avec un `download_url` et sans `vars` est désormais récupérée à l'installation.
L'inline fonctionne toujours et reste ce qu'écrit le constructeur : rien de déjà publié ne
change. Les adresses relatives se résolvent comme pour les automatisations.

## 75. La vue compacte s'étend au panneau de détail (v1.0.0+)

Compact voulait dire des cartes plus courtes, et en ouvrir une donnait le panneau pleine
taille — un long formulaire lâché dans une liste dont les lignes font 54 pixels. Le panneau
suit le réglage maintenant : champs resserrés et boîte plus courte, parce que ce réglage porte
sur la place que prend la bibliothèque et que le panneau en fait partie. Tout défile toujours,
donc rien n'est masqué.

## 76. Conflits : ce que Intra et Inter veulent dire (v1.0.0+)

Le panneau des conflits affichait des mots colorés et permettait de les trier. Il n'a jamais
dit ce que les mots signifiaient, et ce ne sont pas le même genre de problème :

- **Intra** — l'autre mod est dans le **même profil**. Les deux peuvent être activés ensemble :
  c'est le conflit qui compte tout de suite.
- **Inter** — l'autre mod est dans un **autre profil** partageant le même dossier de jeu. Ils
  ne peuvent jamais être actifs en même temps ; ça ne mord qu'au changement de profil.
- **Actif** — les deux activés : le recouvrement est sur le disque maintenant, et le mod
  activé en dernier (le numéro `#` de la ligne) gagne.
- **Potentiel** — les fichiers se recouvrent mais l'autre mod est désactivé.

Ces quatre définitions sont une légende en haut du panneau, toujours visible. Les filtres ont
gagné un axe **état** — est-ce que ça se produit maintenant, ou seulement si vous changez
quelque chose — et une liste vide distingue enfin « aucun conflit » de « vos filtres ont tout
masqué », qui se ressemblent et veulent dire le contraire.

---

## 77. Un seul écran de catalogue (v1.0.0+)

Automatisations, listes de mods, thèmes et tutoriels partagent un même écran. Ce que contient
un catalogue diffère ; ce qu'on en fait, non.

| Onglet | À quoi il sert |
|---|---|
| **Parcourir** | Ce que contiennent les catalogues suivis, avec une action par entrée. |
| **Suivre** | Ajouter une source par adresse **ou par fichier**, voir ce qu'on suit, en désactiver un ou le retirer. Les sources protégées sont traitées ici, une fois, pour tous les types. |
| **En créer un** | Choisir ce qui entre dedans, et décider **par entrée** si son fichier voyage avec le catalogue ou est récupéré à une adresse. |

**Deux formes en sortie.** Un **`.bmmbundle`** porte le `catalog.json` et chaque fichier qu'il
emballe, en une seule chose à envoyer — rien à héberger, aucune adresse à maintenir en vie.
Un **`catalog.json`** ne porte que des adresses, pour du contenu déjà hébergé. Seul ce que le
catalogue nomme est emballé, et c'est toi qui choisis où va le fichier.

**Les index marchent dans la case « suivre ».** Coller un index de catalogues suit ceux de ce
type-là et laisse les autres — tous les suivre serait une action plus grande que celle
demandée.

**Les thèmes ont un troisième choix par entrée**, *le garder dans le catalogue* : le thème
entier écrit en ligne, ce que contient tout catalogue de thèmes publié jusqu'ici et toujours
leur défaut. Ça marche pour un thème custom avec images, parce qu'un thème est du JSON
auto-contenu dont l'aperçu, les assets et les polices sont en base64 dedans — au prix de tous
ceux qui suivent le catalogue et téléchargent l'ensemble juste pour lire la liste.

**Deux types gardent leur écran, exprès.** Le catalogue de plugins est un éditeur de
brouillons enregistrés, parce que c'est celui qu'on rouvre pour le modifier ; cet écran-ci
écrit un fichier puis oublie. Les catalogues de modpacks gardent le leur parce qu'un `.cbmp`
**est** déjà un bundle.

**Un catalogue peut porter ce que tu n'as pas installé.** Les modpacks acceptent une adresse
ou un fichier `.bmp` ; les plugins acceptent un `.bmmplug`. Les deux sont lus et vérifiés au
moment où tu les choisis, pas quand le catalogue est écrit, et un pack qu'on te passe garde la
signature avec laquelle il est arrivé — re-signer mettrait ton nom sur le travail d'un autre.
---

## 78. Phrases secrètes, et les clés qu'elles protègent (v1.0.0+)

Trois choses dans BMM peuvent contenir un secret — une sauvegarde, une liste de mods
partagée, tes clés d'identité — et une seule enveloppe les couvre : Argon2id vers une clé,
AES-256-GCM pour sceller.

**Ça chiffre.** Une invite qui se contente de faire refuser l'écran d'import est un panneau
sur une porte : le fichier est un zip et quiconque a 7-Zip le lit quand même. Un `.DATABMM`
verrouillé cesse d'être un zip.

Une **liste de mods** verrouillée est l'exception, exprès : elle garde un en-tête lisible —
nom, auteur, jeu, nombre de mods — et scelle le reste. Un `.mm` est lu par BMM, par
l'inspecteur de BetterCommunity et par quelqu'un qui décide s'il fait confiance : une liste
que personne ne peut vérifier est pire qu'une liste au contenu privé. La signature est
appliquée AVANT le verrou, parce qu'une signature sur l'enveloppe ne dirait que qui a chiffré.

**Aucune récupération.** Pas de réinitialisation, pas d'indice, personne qui puisse l'ouvrir.

**Les clés d'identité** se fabriquent dans Paramètres → Identity & API. ed25519 par défaut,
ECDSA et RSA pour un hôte plus ancien, et chaque type est testé pour **signer**, pas seulement
pour se générer. La ligne publique va au presse-papiers ; la moitié privée n'est jamais
affichée, seulement l'endroit où elle est allée. Elles peuvent voyager dans une sauvegarde, et
BMM refuse de les écrire sans phrase — c'est le seul export que supprimer le fichier ensuite
ne rattrape pas.

**Une liste partagée peut porter des identifiants**, décochés et demandés séparément. BMM
garde les mots de passe en mémoire seulement et jamais sur disque, parce que les réglages
finissent dans les sauvegardes et les rapports de crash ; les écrire dans un fichier qu'on
donne annule ça exprès — donc ce qui est écrit est illisible sans la phrase, ne couvre que les
hôtes que cette liste vise, et n'inclut que les mots de passe tapés depuis le lancement : il
n'y en a pas d'autres.

L'import pose deux questions. Les mots de passe sont proposés pour la session. Les clés ont
leur propre question et un avertissement direct, et un nom déjà sur ton trousseau est ignoré
plutôt qu'écrasé : importer une liste ne peut pas remplacer la clé avec laquelle tu signes.

Détail complet : **Guides → Catalogs and Repos → Phrases secrètes et clés d'identité**.
