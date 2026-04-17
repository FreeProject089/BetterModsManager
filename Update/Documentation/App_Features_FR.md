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

*Better Mod Manager est développé par FreeProject089.*
