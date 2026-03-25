# Guide de l'utilisateur et aperçu des fonctionnalités - Better Mod Manager (BMM)

Better Mod Manager est un gestionnaire de mods moderne et universel pour tout jeu PC. Il offre une sécurité totale des fichiers, une organisation soignée et des outils de partage puissants via une interface de style "station de travail" haut de gamme.

---

## 1. Profils

Les profils sont le fondement de BMM. Chaque profil représente un environnement complet et isolé pour un jeu spécifique.

| Fonctionnalité | Description |
| :--- | :--- |
| **Support multi-jeux** | Créez un profil par jeu (DCS World, MSFS, Skyrim, etc.). Les mods ne croisent jamais les frontières entre les profils. |
| **Trois dossiers dédiés** | Chaque profil définit une **Racine du Jeu** (où les fichiers sont installés), un **Dossier de Mods** (où vit votre collection de mods) et un **Dossier de Sauvegarde** (où les fichiers originaux sont sauvegardés avant d'être remplacés). |
| **Personnalisation visuelle** | Chaque profil reçoit un nom unique, une couleur d'accentuation et une icône pour une identification visuelle instantanée. |
| **Importation OvGME** | BMM lit les fichiers de configuration binaire OvGME `.dat` (`C:\ProgramData\OvGME`) et les convertit en profils natifs BMM en un clic. |
| **Suivi du profil actif** | BMM se souvient de votre dernier profil actif entre les sessions et le restaure au prochain lancement. |

---

## 2. Bibliothèque de Mods

La vue bibliothèque est votre centre de collections. Tous les mods pour le profil actif apparaissent ici.

| Fonctionnalité | Description |
| :--- | :--- |
| **Importation par Glisser-Déposer** | Déposez un dossier ou un fichier `.zip` directement dans la fenêtre pour l'enregistrer instantanément. |
| **Scan de dossier** | Découvre et enregistre automatiquement tous les nouveaux dossiers et fichiers `.zip` présents dans le répertoire des mods du profil. |
| **Extraction Zip à l'importation** | Quand un `.zip` est ajouté, BMM extrait son contenu dans le répertoire des mods automatiquement. |
| **Bascule Activer / Désactiver** | Un seul interrupteur active ou désactive n'importe quel mod. L'activation installe les fichiers dans le jeu. La désactivation restaure le jeu à son état original exact. |
| **Activation / Désactivation en masse** | Activez ou désactivez tous les mods de la bibliothèque en une seule opération. |
| **Suppression permanente** | Les mods peuvent être supprimés définitivement du disque (avec une étape de confirmation). Seuls les mods inactifs peuvent être supprimés. |
| **Métadonnées du mod** | Chaque mod stocke un nom, une version, un auteur, une description et une liste de liens de téléchargement arbitraires. |
| **Tags personnalisés** | Créez des étiquettes réutilisables (ex: "Audio", "Cockpit", "Multijoueur") et assignez-les aux mods pour le filtrage. |
| **Recherche et filtrage** | Recherchez des mods par nom, filtrez par état actif/inactif, ou par tag. |
| **Ouvrir la racine du mod** | Ouvrez le dossier physique d'un mod directement dans l'Explorateur Windows via le menu contextuel du clic droit. |
| **Historique d'activité** | Chaque action d'activation/désactivation est horodatée et enregistrée par profil pour le suivi d'audit. |
| **Activation par double-clic** | Activez ou désactivez rapidement un mod en double-cliquant n'importe où sur sa carte. |

---

## 3. Sécurité des fichiers — Le moteur de copie intelligent (Smart Copy)

BMM n'utilise jamais de liens symboliques (symlinks). Toutes les opérations sur les fichiers sont physiques, garanties et réversibles.

| Opération | Ce qui se passe |
| :--- | :--- |
| **Activer un mod** | BMM parcourt l'arborescence des fichiers du mod et copie chaque fichier dans la RACINE du jeu. Si un fichier de jeu existe déjà au chemin cible, il est d'abord déplacé vers le dossier de Sauvegarde (en préservant la structure exacte des sous-répertoires). |
| **Désactiver un mod** | BMM supprime les fichiers installés et déplace les originaux sauvegardés exactement là d'où ils viennent. |
| **Résolution des conflits** | Si deux mods actifs écrivent dans le même fichier, BMM suit la propriété du fichier et s'assure que le bon fichier est toujours restauré quand l'un ou l'autre mod est désactivé. |
| **Verrouillage d'opération concurrente** | Un `MOD_OP_LOCK` global empêche deux opérations de s'exécuter simultanément, éliminant le risque de corruption du système de fichiers par des doubles-clics ou des bascules rapides. |

---

## 4. Détection des conflits

| Fonctionnalité | Description |
| :--- | :--- |
| **Avertissement pré-activation** | Avant d'activer un mod, BMM compare son arborescence de fichiers avec tous les mods actuellement actifs. Si une collision est détectée, une boîte de dialogue d'avertissement apparaît identifiant les mods en conflit. |
| **Priorité par ordre** | L'ordre dans lequel les mods sont activés détermine lequel est prioritaire. Le dernier mod activé prend le dessus. |
| **Suppression d'avertissement** | Les utilisateurs peuvent choisir de supprimer définitivement la boîte de dialogue de conflit pour une combinaison spécifique. |
| **Vérification sélective rapide** | Pour assurer une performance maximale, BMM ne vérifie les conflits qu'entre les mods actifs et le mod en cours de bascule, évitant ainsi des scans inutiles de toute la bibliothèque. |
| **Cache de Modification (mtime)** | (v0.9.9) BMM suit désormais les dates de modification des dossiers de mods. Si aucun changement n'est détecté, le scan est sauté, accélérant le démarrage de 80%. |

---

## 5. Partage de mods — Le format .MM

Le format `.MM` est le standard de partage exclusif de BMM basé sur JSON.

| Fonctionnalité | Description |
| :--- | :--- |
| **Exporter** | Exporte toute la collection de mods du profil actif dans un seul fichier `.mm` contenant les noms des mods, versions, auteurs, descriptions, tags, liens de téléchargement, priorités d'installation et l'arborescence complète des fichiers de chaque mod. |
| **Importer** | Chargez n'importe quel fichier `.mm` pour prévisualiser son contenu (liste des mods, tailles de fichiers, tags, liens) avant de l'installer. |
| **Installer depuis la liste** | Un clic déclenche BMM pour télécharger, extraire et enregistrer automatiquement chaque mod de la liste. |
| **Progression en temps réel** | Une barre de téléchargement en direct affiche le pourcentage, le nom du mod actuel et la progression pour chaque téléchargement dans la file d'attente. |
| **Pool de mods locaux** | Avant d'initier tout téléchargement réseau, BMM vérifie si le même mod existe déjà sur le disque (dans n'importe quel profil). Si trouvé, il copie les fichiers localement, économisant de la bande passante et du temps d'installation. |
| **Création de profil auto** | Lors de l'importation d'une liste `.MM`, BMM peut optionnellement créer un tout nouveau profil à partir des métadonnées de la liste. |
| **Détection de conflit de fichiers** | Les mods déjà présents dans le profil actif sont signalés comme "Déjà présents" pendant l'aperçu de l'importation. |

---

## 6. Internationalisation Dynamique

BMM dispose d'un moteur de traduction robuste et extensible par l'utilisateur.

| Fonctionnalité | Description |
| :--- | :--- |
| **Auto-détection de langue** | Déposez n'importe quel fichier de traduction `.json` dans le dossier `frontend/Lang`. BMM le détecte instantanément au démarrage. |
| **Sélecteur unifié** | Un menu déroulant premium simplifié dans les Paramètres permet un changement de langue instantané. |
| **Intégration FlagCDN** | Des drapeaux de haute qualité sont affichés en fonction des codes ISO à 2 lettres fournis dans les fichiers de traduction. |
| **Fallback hors-ligne** | Si l'accès internet est indisponible, les drapeaux sont rendus sous forme de texte stylisé pour maintenir la cohérence de l'interface. |
| **Outils de traduction** | Boutons intégrés "Copier le modèle" et "Guide de traduction" dans les Paramètres pour les contributeurs de la communauté. |

---

## 7. Système automatisé de versionnage et de compilation

BMM s'assure que les informations de version sont toujours exactes et synchronisées.

| Fonctionnalité | Description |
| :--- | :--- |
| **Capture de compilation statique** | La date et l'heure exactes de la compilation sont capturées par le backend pendant le processus de build. |
| **Injection dynamique dans l'UI** | La version et la date de build sont dynamiquement injectées dans le sous-titre des Crédits, la section principale, la barre de titre et le pied de page. |
| **Suffixe basé sur la configuration** | Le label "-PTB" et le badge de version s'adaptent en temps réel en fonction de la configuration interne de l'application. |

---

---

## 8. Documentation interactive et diagrammes

BMM 0.9.8 introduit un système de documentation interactive de pointe.

| Fonctionnalité | Description |
| :--- | :--- |
| **Intégration Mermaid.js** | Les processus techniques (Activation de mod, Synchro, Sauvegardes) sont visualisés à l'aide de diagrammes Mermaid haute définition. |
| **Localisation dynamique** | Tous les labels et info-bulles dans les diagrammes se traduisent instantanément quand vous changez de langue. |
| **Mascottes Tasky** | Notre assistant, Tasky, vous guide à travers les flux complexes directement dans les diagrammes. |
| **Panoramique et Zoom interactifs** | Naviguez confortablement dans les diagrammes complexes avec les commandes de panoramique et de zoom à la souris. |
| **Viewport persistant** | L'application se souvient de votre niveau de zoom et de votre position lorsque vous passez d'un diagramme à l'autre. |

---

## 9. Rapport d'intégrité

| Fonctionnalité | Description |
| :--- | :--- |
| **Vérification des fichiers** | Après une mise à jour de jeu, BMM peut vérifier si les fichiers de mod installés sont toujours intacts dans le répertoire RACINE du jeu. |
| **Détection d'état** | Les fichiers sont signalés comme OK, Manquants ou Modifiés (différence de taille) pour chaque mod actif. |

---

## 9. Explorateur d'archives

| Fonctionnalité | Description |
| :--- | :--- |
| **Parcourir sans extraire** | Ouvrez n'importe quel `.zip` dans l'application pour parcourir son arborescence de fichiers complète. |
| **Recherche** | Filtrez l'arborescence des fichiers par nom de fichier en temps réel. |
| **Actions du clic droit** | Ouvrez un fichier ou un dossier spécifique de l'archive directement dans l'Explorateur Windows. Copiez le chemin dans le presse-papier. |

---

## 10. Notes de mise à jour

| Fonctionnalité | Description |
| :--- | :--- |
| **Changelog intégré** | Une modale affiche tous les fichiers `.md` trouvés dans le répertoire `Update/`, rendus avec un support complet du Markdown. |
| **Accès aux archives** | Les anciens journaux de modifications de `Update/Old_Update/` sont disponibles dans une barre latérale pour référence historique. |
| **Barre latérale du navigateur de fichiers** | Naviguez entre les fichiers de notes de mise à jour à l'aide de la navigation du panneau gauche. |

---

## 11. Rapports de crash et dépannage

BMM comprend un système de diagnostic haute fiabilité pour s'assurer que tout problème peut être identifié et corrigé rapidement.

| Fonctionnalité | Description |
| :--- | :--- |
| **Journalisation en temps réel** | Chaque action est écrite instantanément dans `current_session.log`. |
| **Détection automatique de crash** | Au démarrage, BMM vérifie les sorties non conformes et emballe automatiquement les rapports de diagnostic dans des fichiers `.zip`. |
| **Bouton de rapport manuel** | Les utilisateurs peuvent déclencher manuellement un rapport de diagnostic complet du système à partir du menu Paramètres. |

---

## 12. Système de mise à jour automatique

| Fonctionnalité | Description |
| :--- | :--- |
| **Vérification automatique au démarrage** | BMM interroge l'API GitHub Releases (pointant maintenant vers `FreeProject089/BetterModsManager`) peu après le lancement pour vérifier les nouvelles versions. |
| **Bouton de vérification manuelle** | Disponible dans la barre latérale et les Paramètres pour des vérifications à la demande. |
| **Modale de mise à jour** | Affiche les comparaisons de version, les notes de mise à jour en markdown et les boutons de téléchargement direct de l'installateur. |
| **Réactivation (v0.9.8)** | Les mises à jour automatiques sont maintenant réactivées par défaut dans `app.cfg`. |

---

## 13. Mode PTB (Public Test Build)

| Fonctionnalité | Description |
| :--- | :--- |
| **Modale de bienvenue** | Au premier lancement, une modale de bienvenue à thème affiche les notes de mise à jour du PTB. |
| **Marqueurs dynamiques** | Des badges spéciaux et des suffixes de version apparaissent en fonction de ce mode. |

---

## 14. Performance et gestion du stockage

BMM dispose d'une suite d'outils de diagnostic et d'optimisation haut de gamme pour garantir une stabilité maximale.

| Fonctionnalité | Description |
| :--- | :--- |
| **Limiteur d'E/S disque** | Empêche les gels du système en plafonnant la vitesse de transfert pendant l'activation/désactivation des mods. Des limites personnalisées peuvent être définies par disque. |
| **Tableau de bord de performance** | Un overlay de surveillance en temps réel (PiP) suivant l'activité CPU, RAM et Disque. Supporte le défilement de la chronologie et l'exportation des données historiques (CSV). |
| **Gestionnaire de stockage** | Détecte les types SSD/HDD, les systèmes de fichiers et identifie automatiquement les lecteurs cloud (Google Drive, MEGA, etc.) ou réseau. |
| **Outil de benchmark** | Testez les performances réelles de votre disque directement dans BMM pour trouver la limite de vitesse optimale. |
| **Guide de performance interactif** | Des diagrammes intégrés expliquent exactement comment le limiteur d'E/S et le moteur de transfert par morceaux travaillent ensemble. |

---

## 15. Aide à l'UI et états vides

| Fonctionnalité | Description |
| :--- | :--- |
| **Boutons "Comment ça marche"** | Des boutons d'aide contextuels apparaissent sur les vues vides (Bibliothèque, Profils) pour guider les nouveaux utilisateurs. |
| **Modales d'instruction** | Accès direct à la documentation et aux diagrammes pertinents depuis l'interface principale. |

---

## 16. Dépôt Serveur (Mode Serveur)

Le Mode Serveur est le système de synchronisation haut de gamme pour le partage de mods à grande échelle.

| Fonctionnalité | Description |
| :--- | :--- |
| **Serveur HTTP intégré** | BMM peut agir comme un serveur web, hébergeant vos profils directement depuis votre PC. |
| **Manifeste repo.json** | Génération automatisée d'un manifeste contenant tous les fichiers, tailles et empreintes SHA-256. |
| **Synchronisation intelligente** | Les clients comparent leur état local avec le serveur et ne téléchargent que les fichiers manquants ou modifiés. |
| **Vérification de sécurité** | Chaque fichier téléchargé est vérifié par rapport à son empreinte cryptographique avant installation. |
| **Support du tunneling** | Support intégré pour le partage local (LAN) et le partage public via UPnP ou redirection de port manuelle. |

---

## 17. Suite d'administration serveur (v0.9.8)

Outils premium pour les propriétaires de serveurs afin de gérer leur dépôt et leurs utilisateurs avec une interface glassmorphique haut de gamme.

| Fonctionnalité | Description |
| :--- | :--- |
| **Surveillance en direct** | Vue en temps réel des clients connectés, des téléchargements actifs et suivi par IP. |
| **Gestionnaire de liste blanche** | Contrôlez qui peut accéder à votre dépôt. Support pour l'entrée manuelle et la bascule d'état. |
| **Système de bannissement** | Bloquez des identifiants de créateur ou des adresses IP spécifiques pour les empêcher d'interagir avec votre serveur. |
| **Recherche et filtrage** | Barres de recherche intégrées dans toutes les modales d'administration (Surveillance, Liste Blanche, Bannissements) pour gérer de larges bases d'utilisateurs. |
| **Boutons de copie directe** | Copie en un clic pour les IP et les IDs de Créateur pour faciliter la gestion. |
| **Retour visuel** | Barres de progression pour les transferts actifs et toasts de statut localisés. |

---

## 18. Améliorations techniques (v0.9.8)

| Fonctionnalité | Description |
| :--- | :--- |
| **Stabilité de la bibliothèque** | Correction des problèmes critiques des boutons "Comment ça marche" et "Créer un profil" dans l'état vide de la bibliothèque de mods. |
| **Gardes de sécurité RPC** | Les commandes backend incluent désormais des vérifications de sécurité (détection du profil actif) pour prévenir les erreurs de console et les crashs. |
| **Audit i18n** | Couverture de traduction à 100% pour l'Anglais et le Français, incluant tous les nouveaux messages d'administration serveur. |
| **Refonte des Crédits** | Arrière-plan vidéo haute performance avec régulation automatique de la lecture lorsqu'il n'est pas visible. |

---

## 19. Installation en 1-Clic (bmm://)

L'installation en 1-clic simplifie le partage de mods en permettant aux utilisateurs d'installer des mods directement depuis des liens web.

| Fonctionnalité | Description |
| :--- | :--- |
| **Gestionnaire de protocole** | BMM enregistre le protocole `bmm://` dans Windows, permettant aux navigateurs web de lancer le gestionnaire directement. |
| **Analyse d'URL** | Le gestionnaire extrait automatiquement les noms de mods, auteurs, versions et multiples liens de téléchargement à partir du lien profond. |
| **Création de profil en 1-clic** | Si un lien fait référence à un jeu que vous n'avez pas encore configuré, la modale vous permet de créer un nouveau profil instantanément avec validation intégrée des chemins. |
| **Support DDL** | Optimisé pour les liens de téléchargement direct (GitHub, Discord, Serveurs personnels), garantissant une expérience "Cliquez et Jouez" fluide. |

---

## 20. Discord Rich Presence

BMM s'intègre à Discord pour montrer à vos amis ce que vous jouez et gérez actuellement.

| Fonctionnalité | Description |
| :--- | :--- |
| **Statut en direct** | Affiche le nom du profil de jeu actif et le nombre de mods activés. |
| **État du serveur** | Si vous exécutez BMM en Mode Serveur, votre statut Discord indique que vous hébergez un dépôt. |
| **Bascule de confidentialité** | Peut être activée ou désactivée instantanément depuis le menu Paramètres. |
| **Mises à jour réactives** | Votre statut se met à jour automatiquement chaque fois que vous changez de profil ou basculez un mod. |
| **Bouton Rejoindre Discord** | (v0.9.9) Intégration d'un bouton d'accès direct à la communauté dans les rapports de crash pour un support instantané. |

---

## 21. Diagnostics de Conflits Avancés

La version 0.9.8 de BMM propose un outil de diagnostic interactif pour résoudre les collisions complexes de fichiers de mods.

| Fonctionnalité | Description |
| :--- | :--- |
| **Graphique interactif** | Affichez une carte visuelle de toutes les collisions de fichiers entre vos mods. |
| **Résolution rapide** | Cliquez sur n'importe quel nœud du graphique pour accéder directement à ce mod dans la bibliothèque pour sa gestion. |
| **Hiérarchie visuelle** | Comprenez d'un coup d'œil quels mods en écrasent d'autres grâce à une mise en page Mermaid avec code couleur. |

---

*Better Mod Manager est développé par FreeProject089.*
