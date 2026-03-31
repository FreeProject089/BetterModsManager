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
| **Activer un mod** | BMM parcourt l'arborescence des fichiers du mod et copie chaque fichier dans la RACINE du jeu. Si un fichier de jeu existe déjà au chemin cible, il est d'abord déplacé vers le dossier de sauvegarde (en préservant la structure exacte des sous-répertoires). |
| **Désactiver un mod** | BMM supprime les fichiers installés et replace tous les originaux sauvegardés exactement là d'où ils venaient. |
| **Résolution de conflits** | Si deux mods actifs écrivent dans le même fichier, BMM suit la propriété du fichier et garantit que le bon fichier est toujours restauré lorsque l'un ou l'autre mod est désactivé. |
| **Verrouillage d'opération concurrente** | Un `MOD_OP_LOCK` global empêche deux opérations de s'exécuter simultanément, éliminant le risque de corruption du système de fichiers dû à des doubles-clics ou des bascules rapides. |

---

## 4. Détection de conflits

| Fonctionnalité | Description |
| :--- | :--- |
| **Avertissement pré-activation** | Avant d'activer un mod, BMM compare son arborescence de fichiers à tous les mods actuellement actifs. Si une collision est détectée, une boîte de dialogue d'avertissement apparaît identifiant les mods conflictuels. |
| **Priorité par ordre** | L'ordre dans lequel les mods sont activés détermine celui qui prime. Les fichiers du dernier mod activé ont la priorité. |
| **Ignorer l'avertissement** | Les utilisateurs peuvent choisir d'ignorer s'il s'agit d'un conflit connu pour une combinaison spécifique. |
| **Vérification sélective rapide** | Pour garantir des performances maximales, BMM ne vérifie les conflits qu'entre les mods actifs et le mod en cours de bascule, évitant ainsi des scans inutiles de toute la bibliothèque. |
| **Cache de modification (mtime)** | (v0.9.9) BMM suit désormais les dates de modification des dossiers de mods. Si aucun changement n'est détecté, les scans sont ignorés, accélérant le démarrage de 80%. |

---

## 5. Partage de mods — Le format .MM

Le format `.MM` est le standard de partage propriétaire de BMM basé sur JSON.

| Fonctionnalité | Description |
| :--- | :--- |
| **Export** | Exporte toute la collection de mods du profil actif dans un seul fichier `.mm` contenant les noms de mods, versions, auteurs, descriptions, tags, liens de téléchargement, priorités d'installation et l'arborescence complète de chaque mod. |
| **Import** | Chargez n'importe quel fichier `.mm` pour prévisualiser son contenu (liste de mods, tailles de fichiers, tags, liens) avant l'installation. |
| **Installer depuis la liste** | Un seul clic déclenche le téléchargement, l'extraction et l'enregistrement automatique de chaque mod de la liste par BMM. |
| **Progression en temps réel** | Une barre de téléchargement en direct affiche le pourcentage, le nom du mod actuel et la progression pour chaque téléchargement dans la file d'attente. |
| **Mutualisation locale (Pooling)** | Avant d'initier tout téléchargement réseau, BMM vérifie si le même mod existe déjà sur le disque (dans n'importe quel profil). S'il est trouvé, il copie les fichiers localement, économisant de la bande passante et du temps d'installation. |
| **Création auto de profil** | Lors de l'importation d'une liste `.MM`, BMM peut optionnellement créer un tout nouveau profil à partir des métadonnées de la liste. |
| **Détection de conflits de fichiers** | Les mods déjà présents dans le profil actif sont signalés comme "Déjà présent" lors de l'aperçu de l'importation. |

---

## 6. Internationalisation dynamique

BMM dispose d'un moteur de traduction robuste et extensible par l'utilisateur.

| Fonctionnalité | Description |
| :--- | :--- |
| **Auto-découverte des langues** | Déposez n'importe quel fichier de traduction `.json` dans le dossier `frontend/Lang`. BMM le détecte instantanément au démarrage. |
| **Sélecteur unifié** | Un menu déroulant premium simplifié dans les Paramètres permet un changement de langue instantané. |
| **Intégration FlagCDN** | Des drapeaux de haute qualité sont rendus sur la base des codes ISO à 2 lettres fournis dans les fichiers de traduction. |
| **Secours hors ligne** | Si l'accès Internet n'est pas disponible, les drapeaux sont rendus sous forme de texte stylisé pour maintenir la cohérence de l'interface. |
| **Outils pour traducteurs** | Boutons intégrés "Copier le modèle" et "Guide de traduction" dans les Paramètres pour les contributeurs de la communauté. |

---

## 7. Système automatisé de versionnage et de build

BMM veille à ce que les informations de version soient toujours exactes et synchronisées.

| Fonctionnalité | Description |
| :--- | :--- |
| **Capture de build statique** | La date et l'heure exactes de la compilation sont capturées par le backend pendant le processus de build. |
| **Injection dynamique dans l'UI** | La version et la date de build sont injectées dynamiquement dans le sous-titre des Crédits, la section hero, la barre de titre et le pied de page. |
| **Suffixe basé sur la configuration** | Le label "-PTB" et le badge de version s'adaptent en temps réel selon la configuration interne de l'application. |

---

## 8. Documentation interactive et diagrammes

La version 0.9.8 de BMM introduit un système de documentation interactive de pointe.

| Fonctionnalité | Description |
| :--- | :--- |
| **Intégration Mermaid.js** | Les processus techniques (Activation de mod, Synchro, Sauvegardes) sont visualisés à l'aide de diagrammes Mermaid haute définition. |
| **Localisation dynamique** | Tous les labels et info-bulles à l'intérieur des diagrammes se traduisent instantanément lorsque vous changez de langue. |
| **Mascottes Tasky** | Notre assistant, Tasky, vous guide à travers les flux complexes directement au sein des diagrammes. |
| **Pan & Zoom interactif** | Naviguez confortablement dans les diagrammes complexes avec les commandes de panoramique et de zoom à la souris. |
| **Fenêtre persistante** | L'application se souvient de votre niveau de zoom et de votre position lors de la bascule entre différents diagrammes. |

---

## 9. Rapport d'intégrité

| Fonctionnalité | Description |
| :--- | :--- |
| **Vérification des fichiers** | Après une mise à jour du jeu, BMM peut vérifier si les fichiers de mods installés sont toujours intacts dans le répertoire RACINE du jeu. |
| **Détection d'état** | Les fichiers sont signalés comme OK, Manquants ou Modifiés (taille différente) pour chaque mod actif. |
| **Moteur d'Intégrité Deep** | (v0.9.9) Analyse cryptographique SHA-256 de chaque fichier de mod par rapport à la racine du jeu pour garantir une fidélité absolue à 100%. |

---

## 10. Explorateur d'archives

| Fonctionnalité | Description |
| :--- | :--- |
| **Naviguer sans extraire** | Ouvrez n'importe quel `.zip` dans l'application pour explorer son arborescence complète. |
| **Recherche** | Filtrez l'arborescence des fichiers par nom de fichier en temps réel. |
| **Actions de clic droit** | Ouvrez un fichier ou un dossier spécifique de l'archive directement dans l'Explorateur Windows. Copiez le chemin dans le presse-papiers. |

---

## 11. Notes de mise à jour

| Fonctionnalité | Description |
| :--- | :--- |
| **Changelog intégré** | Une modale affiche tous les fichiers `.md` trouvés dans le répertoire `Update/`, rendus avec un support Markdown complet. |
| **Accès aux archives** | Les anciens changelogs de `Update/Old_Update/` sont disponibles dans une barre latérale pour référence historique. |
| **Barre latérale de navigation** | Naviguez entre les fichiers de notes de version à l'aide du panneau latéral gauche. |

---

## 12. Rapports de crash et dépannage

BMM inclut un système de diagnostic de haute fiabilité pour garantir que tout problème peut être identifié et corrigé rapidement.

| Fonctionnalité | Description |
| :--- | :--- |
| **Journalisation en temps réel** | Chaque action est écrite instantanément dans `current_session.log`. |
| **Détection automatique de crash** | Au démarrage, BMM vérifie les fermetures anormales et emballe automatiquement les rapports de diagnostic dans des fichiers `.zip`. |
| **Bouton de rapport manuel** | Les utilisateurs peuvent déclencher manuellement un rapport de diagnostic système complet à partir du menu Paramètres. |

---

## 13. Système de mise à jour automatique

| Fonctionnalité | Description |
| :--- | :--- |
| **Vérification auto au démarrage** | BMM interroge l'API GitHub Releases (pointant désormais vers `FreeProject089/BetterModsManager`) peu après le lancement pour vérifier les nouvelles versions. |
| **Bouton de vérification manuelle** | Disponible dans la sidebar et les Paramètres pour des vérifications à la demande. |
| **Modale de mise à jour** | Affiche les comparaisons de versions, les notes de version markdown et des boutons de téléchargement direct de l'installeur. |
| **Réactivation (v0.9.8)** | Les mises à jour automatiques sont désormais réactivées par défaut dans `app.cfg`. |

---

## 14. Mode PTB (Public Test Build)

| Fonctionnalité | Description |
| :--- | :--- |
| **Modale de Bienvenue** | Au premier lancement, une modale de bienvenue à thème affiche les notes de version du PTB. |
| **Marqueurs dynamiques** | Des badges spéciaux et des suffixes de version apparaissent en fonction de ce mode. |

---

## 15. Gestion de la performance et du stockage

BMM propose une suite d'outils de diagnostic et d'optimisation haut de gamme pour garantir une stabilité maximale.

| Fonctionnalité | Description |
| :--- | :--- |
| **Limiteur d'E/S disque** | Prévient les gels système en plafonnant la vitesse de transfert pendant l'activation/désactivation des mods. Des limites personnalisées peuvent être définies par disque. |
| **Dashboard de performance** | Une superposition de surveillance en temps réel (PiP) suivant l'activité CPU, RAM et Disque. Supporte le défilement temporel et l'exportation des données historiques (CSV). |
| **Gestionnaire de stockage** | Détecte les types SSD/HDD, les systèmes de fichiers et identifie automatiquement les lecteurs cloud (Google Drive, MEGA, etc.) ou réseau. |
| **Outil de Benchmark** | Testez les performances réelles de votre disque directement dans BMM pour trouver la limite de vitesse optimale. |
| **Guide de performance interactif** | Des diagrammes intégrés expliquent exactement comment le limiteur d'E/S et le moteur de transfert par morceaux fonctionnent ensemble. |

---

## 16. Dépôt Serveur (Mode Serveur)

Le Mode Serveur est le système de synchronisation premium pour le partage de mods à grande échelle.

| Fonctionnalité | Description |
| :--- | :--- |
| **Serveur HTTP intégré** | BMM peut agir comme un serveur web, hébergeant vos profils directement depuis votre PC. |
| **Manifeste repo.json** | Génération automatisée d'un manifeste contenant tous les fichiers, tailles et empreintes SHA-256. |
| **Synchronisation intelligente** | Les clients comparent leur état local avec celui du serveur et ne téléchargent que les fichiers manquants ou modifiés. |
| **Vérification de sécurité** | Chaque fichier téléchargé est vérifié par rapport à son empreinte cryptographique avant l'installation. |
| **Support de tunneling** | Support intégré pour le partage local (LAN) et le partage public via UPnP ou redirection de port manuelle. |

---

## 17. Suite d'administration serveur (v0.9.8)

Des outils premium pour les propriétaires de serveurs afin de gérer leur dépôt et leurs utilisateurs via une interface glassmorphic haut de gamme.

| Fonctionnalité | Description |
| :--- | :--- |
| **Surveillance en direct** | Vue en temps réel des clients connectés, des téléchargements actifs et suivi des IPs. |
| **Gestionnaire de Whitelist** | Contrôlez qui peut accéder à votre dépôt. Support de la saisie manuelle et de la bascule d'état. |
| **Système de Ban** | Bloquez des IDs de créateur spécifiques ou des adresses IP. |
| **Recherche et Filtrage** | Barres de recherche intégrées dans toutes les modales d'administration (Surveillance, Whitelist, Bans). |
| **Boutons de copie directe** | Copie en un clic pour les IPs et IDs de Créateurs pour faciliter la gestion. |
| **Retour visuel** | Barres de progression pour les transferts actifs et toasts de statut localisés. |

---

## 18. Améliorations techniques (v0.9.8)

| Fonctionnalité | Description |
| :--- | :--- |
| **Stabilité de la bibliothèque** | Correction des problèmes critiques des boutons "Comment ça marche" et "Créer un profil" dans l'état vide de la bibliothèque de mods. |
| **Sécurités RPC** | Les commandes backend incluent désormais des vérifications de sécurité (détection de profil actif) pour prévenir les erreurs de console et les crashs. |
| **Audit i18n** | Couverture de traduction à 100 % pour l'anglais et le français, y compris tous les nouveaux messages d'administration serveur. |
| **Refonte des Crédits** | Fond vidéo haute performance avec régulation automatique de la lecture lorsqu'il n'est pas visible. |

---

## 19. Installation en un clic (bmm://)

L'installation en un clic simplifie le partage de mods en permettant aux utilisateurs d'installer des mods directement à partir de liens web.

| Fonctionnalité | Description |
| :--- | :--- |
| **Gestionnaire de protocole** | BMM enregistre le protocole `bmm://` dans Windows, permettant aux navigateurs web de lancer directement le gestionnaire. |
| **Analyse d'URL** | Le gestionnaire extrait automatiquement les noms de mods, auteurs, versions et multiples liens de téléchargement à partir du lien profond. |
| **Création de profil en un clic** | Si un lien fait référence à un jeu que vous n'avez pas encore configuré, la modale permet de créer un nouveau profil instantanément avec validation de chemin intégrée. |
| **Support DDL** | Optimisé pour les liens de téléchargement direct (GitHub, Discord, serveurs personnels), assurant une expérience fluide "Cliquez et Jouez". |

---

## 20. Discord Rich Presence

BMM s'intègre à Discord pour montrer à vos amis ce que vous gérez ou jouez actuellement.

| Fonctionnalité | Description |
| :--- | :--- |
| **Statut en direct** | Affiche le nom du profil de jeu actif et le nombre de mods activés. |
| **État du serveur** | Si vous exécutez BMM en Mode Serveur, votre statut Discord indique que vous hébergez un dépôt. |
| **Bascule de confidentialité** | Peut être activé ou désactivé instantanément depuis le menu Paramètres. |
| **Mises à jour réactives** | Votre statut se met à jour automatiquement chaque fois que vous changez de profil ou basculez un mod. |
| **Bouton Rejoindre Discord** | (v0.9.9) Bouton d'accès direct à la communauté intégré dans les rapports de crash pour un support instantané. |

---

## 21. Diagnostic de conflits avancé

BMM version 0.9.8 introduit un outil de diagnostic interactif pour résoudre les collisions complexes de fichiers de mods.

| Fonctionnalité | Description |
| :--- | :--- |
| **Graphique interactif** | Visualisez une carte des collisions de fichiers entre vos mods. |
| **Résolution rapide** | Cliquez sur n'importe quel nœud du graphique pour accéder directement à ce mod dans la bibliothèque. |
| **Hiérarchie visuelle** | Comprenez en un coup d'œil quels mods en écrasent d'autres avec une mise en page Mermaid colorée. |

---

## 22. Documentation interactive et recherche sémantique (v0.9.9)

La version 0.9.9 de BMM introduit un système de documentation révolutionnaire qui combine des guides traditionnels avec des diagrammes interactifs en temps réel et une recherche sémantique assistée par IA.

| Fonctionnalité | Description |
| :--- | :--- |
| **Diagrammes interactifs** | Propulsés par Mermaid.js, ces diagrammes visualisent la logique complexe (synchro, recherche, architecture). Les nœuds sont cliquables et fournissent des explications approfondies. |
| **Recherche sémantique** | Basculez entre les modes "Classique" (mots-clés) et "Sémantique" (indexation profonde). La recherche sémantique analyse les labels de diagramme et les métadonnées cachées pour trouver des réponses exactes. |
| **Surlignage de nœuds** | Cliquer sur un résultat de recherche issu d'un diagramme ouvre instantanément le schéma pertinent et met en évidence le nœud cible avec un effet de brillance premium et pulsé. |
| **Indicateurs visuels** | Les entrées de la FAQ disposant de diagrammes associés affichent désormais une icône "Layers", permettant d'identifier immédiatement le contenu interactif. |
| **Interface à double onglet** | Distingue entre "Basique" (tutoriels vidéo et FAQ rapide) et "Avancé" (diagrammes techniques et documentation approfondie). |
| **Secours vidéo intelligent** | Les tutoriels vidéo détectent votre connexion. Ils sont diffusés depuis YouTube si vous êtes en ligne (économisant de l'espace) ou lisent des fichiers MP4 locaux si vous êtes hors ligne. |
| **Intégration de Mascotte Tasky** | Tasky explique chaque étape d'un diagramme. Le survol ou le clic sur les nœuds déclenche des bulles d'aide contextuelle avec un contenu localisé. |

---

## 23. Migration de Javascript vers TypeScript (v0.9.9)

La version 0.9.9 de BMM marque une étape majeure avec la transition de la base de code frontend vers **TypeScript (TS)**. Cette évolution garantit la stabilité structurelle et la sécurité du typage sur toute la logique applicative, offrant une expérience utilisateur beaucoup plus fluide et sans bug.

---

## 24. Moteur multi-threadé haute performance

Le backend de BMM est propulsé par un noyau Rust multi-threadé, garantissant que les lourdes opérations sur les fichiers ne gèlent jamais l'interface utilisateur.

| Fonctionnalité | Description |
| :--- | :--- |
| **Fluidité de l'interface** | Le frontend JavaScript reste 100% interactif (60 FPS) même pendant les copies massives ou le hachage. |
| **Runtime Async Tokio** | Propulsé par le runtime Tokio de classe mondiale pour une gestion efficace des tâches d'arrière-plan. |
| **Workers d'E/S dédiés** | Les tâches gourmandes en disque (copie, suppression, scan) sont isolées dans un pool de workers d'arrière-plan. |
| **Pont UI sans latence** | Utilise un pont IPC asynchrone pour communiquer les changements d'état à l'interface en toute sécurité. |

---

*Better Mod Manager est développé par FreeProject089.*
