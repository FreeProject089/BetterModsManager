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
| **~75 endpoints** | Mods, profils, plugins, modpacks, dépôt et import/export de données sont tous contrôlables via `/api/`. |
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

