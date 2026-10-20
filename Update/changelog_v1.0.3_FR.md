# Changelog v1.0.3 (depuis 627f956c, le build 1.0.2)

La 1.0.3 apporte un centre de notifications, une vue Conflits qui montre quel mod l'emporte sur chaque fichier partagé, des panneaux qui s'ouvrent dans leur propre fenêtre, sept nouveaux Outils BMM, le suivi d'un dépôt par son adresse ou sa simple IP, un dialogue Serveurs SSH refait, une seule liste pour toutes les sources de catalogues, un créateur de plugins guidé et un éditeur de thème reconstruit. C'est aussi le premier build capable de se relier plus tard à BetterCommunity v2 : cette liaison est livrée désactivée, et rien ne change tant qu'elle n'est pas annoncée.

> La 1.0.3 prolonge la version 1.0. L'histoire de la 1.0 dans son ensemble est épinglée en haut de la liste des versions : **Les nouveautés de la 1.0**. Commencez par là si vous découvrez BMM, ou si vous avez sauté les versions 1.0.0 à 1.0.2.

## [NEW] Centre de notifications
- Un seul endroit pour tous les messages, avec un seul compteur de non lus (aussi sur l'icône de la barre des tâches). Les messages sont groupés selon leur origine : Mises à jour, Dépôts suivis, Planificateur, Tâches de fond, BetterCommunity et BMM lui-même.
- Ouvrez un message quand il mène quelque part (une mise à jour disponible, un dépôt suivi), reportez-le (1 heure, 4 heures, demain 9 h) ou retirez-le. Un message reporté revient non lu à l'heure prévue.
- **Paramètres → Notifications** : chaque groupe s'affiche dans l'application, dans l'application et en notification Windows (seulement quand BMM est en arrière-plan), ou pas du tout (il reste dans la liste). Vos anciens réglages par source sont repris.
- **Ne pas déranger**, depuis la cloche ou dans les Paramètres, et des heures calmes chaque jour. Pendant ce temps rien ne s'affiche ; les erreurs s'affichent quand même dans l'application, et tout reste dans la liste.
- Le même événement deux fois donne un seul message avec un compteur, pas une pile de copies. La liste garde les 200 derniers messages, aucun de plus de 30 jours.
- Une tâche de fond longue qui se termine pendant que BMM est en arrière-plan vous le signale.
- Clavier : Haut et Bas pour se déplacer, Entrée ouvre, Suppr retire, S reporte d'une heure, Échap ferme.

## [NEW] Vue Conflits
- Pour chaque fichier partagé par deux mods actifs, la vue Conflits indique quelle copie est sur le disque avec l'ordre d'activation actuel, avec un résumé par paire de mods.
- Résolvez un conflit en réordonnant (monter ou descendre, « Faire gagner X »), en gardant la copie d'un mod pour certains fichiers quel que soit l'ordre (retenu par profil), ou en désactivant un mod. Cochez plusieurs fichiers pour décider pour tous d'un coup.
- Rien ne change avant **Appliquer**. BMM indique d'abord combien de fichiers il recopierait, et « Voir les changements » les liste un par un. Appliquer passe par le centre d'activité et ne recopie que ces fichiers.
- Elle s'ouvre depuis le badge de conflit d'un mod dans la bibliothèque, depuis les détails du mod, ou depuis la palette de commandes (« Résoudre les conflits »).

## [NEW] Des panneaux dans leur propre fenêtre
- L'éditeur de thème, le studio de traduction et le débogueur de tâches peuvent sortir de la fenêtre de BMM : « Ouvrir dans sa propre fenêtre » dans leur en-tête, ou glisser l'en-tête au-delà du bord de la fenêtre. Placez le panneau où vous voulez, sur un autre écran aussi, à côté de ce qu'il modifie plutôt que par-dessus.
- Le panneau continue de fonctionner, reste synchronisé avec BMM et suit le thème clair ou sombre.
- La fenêtre de chaque panneau retient sa taille et sa place. « Remettre dans la fenêtre de BMM », ou fermer cette fenêtre, replace le panneau là où il était.

## [IMPROVED] Outils BMM : 14 outils
- Sept nouveaux outils : **Vérification des fichiers déployés** (fichiers disparus du dossier du jeu, liens cassés, fichiers absents d'un mod), **Gros fichiers**, **Noms et versions** (suggestions de rangement, rien n'est renommé), **Profils en double**, **Nettoyage des caches** (mesure, puis vide seulement ce que vous cochez, après confirmation), **Lecteur de journaux** (le journal de cette session et les rapports enregistrés, filtrés par niveau et par mots) et **Différences de catalogues** (deux versions d'un catalogue ou d'un repo.json comparées).
- La liste des outils a une recherche, des groupes et une ligne de description pour chaque outil.
- Chaque outil dit où il en est (pas lancé, en cours avec progression et Annuler, échec avec la raison et Réessayer, terminé) et propose les mêmes boutons Copier le JSON, Enregistrer en JSON et Enregistrer en CSV.
- Les analyses longues apparaissent dans le centre d'activité et peuvent y être arrêtées.

## [IMPROVED] Dépôts suivis : en suivre un par son adresse ou son IP
- « Suivre un dépôt » se trouve dans la carte Dépôts suivis et ouvre un seul dialogue : l'adresse, un mot de passe de téléchargement et une clé facultatifs, « Tester la connexion », la fréquence de vérification, et quoi faire d'une mise à jour (me prévenir, la télécharger, la télécharger et l'appliquer).
- Le test affiche le nom du dépôt, sa version, son format, sa signature (valide, ne correspond pas, ou non signé) et le nombre de mods proposés, ou dit clairement pourquoi il a échoué (rien n'a répondu, délai dépassé, erreur HTTP, mot de passe nécessaire).
- Un bouton « Suivre » partout où BMM connaît déjà un dépôt : celui qui vient d'être lu, les résultats de la liste des dépôts et les entrées de l'historique.
- Saisissez l'adresse comme vous joignez la machine : `192.168.1.20:8000`, `[::1]:8000`, `nas.local:8080/mods/` ou un `http://…/repo.json` complet. BMM affiche l'adresse du repo.json qu'il utilisera. Le http simple convient sur votre PC et votre réseau local ; sur Internet, BMM prévient qu'un mot de passe circulerait en clair.
- Les dépôts sur votre PC et votre réseau local ne passent plus par le proxy du système, qui ne pouvait pas les joindre.

## [IMPROVED] Serveurs SSH
- Un dialogue refait : vos serveurs enregistrés avec leur état (incomplet, pas testé, clé approuvée, test réussi, dernier test échoué) et un formulaire qui dit ce qui ne va pas dans chaque champ. Coller `moi@nas.local:2222` dans l'hôte remplit l'utilisateur et le port.
- « Tester la connexion » procède par étapes : joindre le serveur, vérifier sa clé, se connecter, examiner le dossier de base (existe, inscriptible, et sinon, à qui il appartient).
- Les erreurs SSH se lisent comme des phrases au lieu de détails bruts. Envoyer ou récupérer un seul fichier en SSH apparaît dans le centre d'activité.
- Clavier : Haut et Bas parcourent les serveurs, Entrée ou Ctrl+S enregistre, Échap ferme.

## [IMPROVED] Sources de catalogues
- Une seule liste de sources, la même dans le catalogue d'applications (onglet Sources) et dans **Paramètres → Index de catalogues** : nom, adresse, type (officielle, partenaire ou la vôtre), signature, dernière actualisation, nombre d'éléments, état et un interrupteur.
- Ajouter et Modifier ouvrent un dialogue avec **Tester**, qui lit l'adresse comme BMM le fera. Un index de catalogues est reconnu et ses catalogues peuvent être ajoutés d'un coup.
- Réordonnez vos sources (la première l'emporte quand deux listent le même élément), renommez, retirez, importez ou exportez-les en JSON. Les sources officielles sont affichées en lecture seule.
- Quand une source échoue vraiment, le message la nomme, dit pourquoi et propose Réessayer, Désactiver, Retirer et Détails.

## [IMPROVED] Plugins & API
- **Créer** : un formulaire guidé en six étapes (point de départ, identité, contenu, à l'application, permissions, enregistrer et partager) avec une barre d'étapes qui montre ce qui demande encore de l'attention. Partez d'un modèle (liste de mods, mods d'un serveur, pack de scripts, mods + scripts, pack d'automatisations, catalogue groupé, vierge).
- Chaque permission affiche un niveau de risque (faible, moyen, élevé), et le risque global du plugin s'affiche au fil de la création.
- Un aperçu en direct montre la carte du plugin, une liste de ce qui manque ou présente un risque, et le `plugin.json` qui sera écrit.
- Après l'enregistrement : « Essai à blanc » montre ce que l'application changerait sans rien changer, « Voir les fichiers » ouvre ce qui a été empaqueté, et les étapes suivantes expliquent comment exporter et partager le plugin.
- **Installés** : des filtres (mise à jour disponible, listes de mods, scripts, automatisations, catalogues, demande des permissions), le nombre de permissions et le risque le plus élevé sur chaque carte, et « vX disponible » quand une version plus récente n'a pas été installée automatiquement.
- **Référence de l'API** : les endpoints sont groupés par domaine (mods, profils, plugins, dépôts serveur, …) au lieu de l'être par méthode HTTP, avec des filtres par méthode ou « sans jeton ».

## [IMPROVED] Éditeur de thème, reconstruit
- Les sections à gauche (Essentiel, Tous les jetons, Images, Éléments, CSS, Bibliothèque), un aperçu en direct de vrais éléments de BMM à droite, les vérifications de contraste dessous. Il flotte toujours, s'ancre sur le côté, et peut désormais s'ouvrir dans sa propre fenêtre.
- L'aperçu ne porte que le thème en cours d'édition ; BMM change à l'enregistrement, ou pendant la saisie si vous cochez « Appliquer à BMM pendant la saisie ». L'éditeur lui-même reste lisible quelles que soient les couleurs essayées.
- **Essentiel** : sombre ou clair, une palette entière à partir d'une couleur, un thème intégré comme point de départ. Changer de mode reconstruit les fonds et le texte et garde votre accent : la version claire d'un thème sombre tient en un clic.
- **Tous les jetons** : chaque réglage de couleur et de style utilisé par BMM, expliqué et cherchable, avec un filtre « Modifiés seulement ».
- **Contraste** : chaque paire qui doit rester lisible affiche son niveau WCAG ; « Corriger » choisit la couleur la plus proche qui passe, « Tout corriger » les corrige toutes.
- Annuler et rétablir (Ctrl+Z, Ctrl+Y), Ctrl+S pour enregistrer, Enregistrer comme nouveau, et un menu Fichier pour exporter, importer, copier en JSON et le lien de partage. Un thème intégré n'est jamais écrasé.
- Les fichiers de thème portent désormais une version de format. Les fichiers plus anciens sont mis à niveau à la lecture et réécrits seulement quand vous enregistrez ; rien de ce que vous avez créé n'est perdu.

## [IMPROVED] Paramètres, raccourcis et navigation
- **Paramètres** : toutes les cartes ont la même anatomie (une phrase d'aide, des lignes, un pied de carte, une zone de danger) et un lien « En savoir plus » vers la documentation. Les cartes sont réordonnées selon l'usage, par groupes : Identité & API passe dans Comptes et services, l'enregistreur de session dans Application. **Interface et notifications** est une carte à onglets (Notifications, Tasky, Son, Barre d'outils) avec un repli « Plus d'options ». **Modifier la disposition** permet de faire glisser ou de masquer des cartes, et la recherche trouve un réglage par ses mots.
- **Raccourcis clavier** : une table avec recherche, un filtre « Modifiés seulement », import et export, et un « Tout réinitialiser » qui garde vos propres raccourcis. **Nouveau raccourci** lie des touches à une commande, une carte des Paramètres, un profil, un modpack ou une automatisation, partout ou sur une seule page ; les touches réservées à Windows ou à BMM sont refusées, et un conflit dit ce qui utilise déjà les touches.
- **Personnaliser la navigation**, refaite : un aperçu de la barre latérale à faire glisser, des sections, et un « Ajouter un bouton » guidé (une page BMM, un outil BMM, un site web ou votre propre page). Vos pages partent d'un modèle avec toutes les permissions désactivées, chacune avec un niveau de risque, un aperçu en bac à sable et un sélecteur d'icônes. Le réglage rapide « Local + internet » n'active plus le presse-papiers.

## [IMPROVED] Détails d'un mod, Modpacks et Dépôt Serveur
- **Détails d'un mod** : un tiroir latéral à onglets (Aperçu, Détails, Fichiers, Conflits et ordre, Mises à jour et liens). Les flèches haut et bas, ou les boutons ‹ ›, passent au mod suivant ou précédent ; Échap le ferme, et les modifications non enregistrées demandent confirmation avant d'être abandonnées.
- **Modpacks** : une barre d'aperçu (recherche, Actifs ou Inactifs, tri, grille ou liste), une action principale par carte avec un menu « … », une création en quatre étapes (Bases, Mods, Options, Récapitulatif), et l'import depuis un fichier, un lien ou un catalogue. « Exporter et partager » affiche les ID du pack.
- **Dépôt Serveur** : l'onglet Sync tient en trois étapes (adresse, où vont les mods, synchroniser) et l'onglet Host en deux groupes, avec une bande de quatre étapes pour servir. Une source protégée sans clé privée propose « En créer une » ou « Ajouter… » au lieu d'une impasse, et « Gérer les clés » mène au trousseau.

## [NEW] Historique des changements, Studio de traduction et notes de version
- **L'historique des changements** est une chronologie jour par jour des mods, profils, réglages, mises à jour et dépôts, avec des filtres par type, une recherche et un Avant et Après pour chaque changement. L'annulation est proposée pour la modification d'un mod, son activation ou désactivation, et les réglages. Vous choisissez combien de temps il est gardé, et l'exportez en CSV ou JSON. Les secrets ne sont jamais stockés.
- **Les notes de version** ont un onglet **Versions** : chaque version dans une liste avec recherche, avec les compteurs de nouveautés, d'améliorations et de corrections.
- **Le Studio de traduction** remplace le bac à sable de traduction : une fenêtre flottante qui peut se détacher, des filtres (Manquantes, Modifiées, Identiques), des pastilles de variables avec vérifications, vos brouillons visibles en direct dans toute l'app, import et export, et une nouvelle langue en quelques clics.

## [IMPROVED] Tutoriels, thèmes et intro de démarrage
- **Le guide des tutoriels** peut se détacher dans sa propre fenêtre. Tous les tutoriels ont été réécrits, avec de nouvelles parties (suivre un dépôt, conflits et ordre d'activation, notifications, créer un plugin, Outils BMM) ; le tutoriel des Automatisations est désormais dans Plugins & API.
- **Les thèmes** choisissent une marque : Tasky, le logo BMM ou le badge BMM (un choix « Mascotte ou logo » dans les Images de l'éditeur de thème). La plupart des thèmes intégrés utilisent le logo, Charcoal le badge. Le logotype de la barre latérale se lit « Better Mod.Manager » (Bricolage Grotesque).
- **Les fenêtres** (Conflits, le hub d'outils, stockage, intégrité, ordre d'activation et d'autres) utilisent une seule surface, avec des sections séparées par l'espacement et un filet au lieu de cadres.
- **L'intro de démarrage** rejoue sur tous les PC : elle ne suit que le réglage « Réduire les animations » de BMM et le style Désactivée, pas le réglage Windows « Effets d'animation », et un démarrage rapide joue toute l'entrée.
- Onglets de **Plugins & API** : Installés, Catalogue, Créer, API (anciennement « API & Scripts »), Automatisations, Permissions.

## [VISUAL] Cartes, Paramètres et identifiants des thèmes
- Plus de barre de couleur le long du bord gauche des cartes et des lignes, nulle part dans l'application. L'élément courant a un fond légèrement teinté, et les astuces sont des encadrés légèrement teintés.
- **Paramètres** : la colonne d'index peut être masquée pour laisser toute la largeur aux cartes (bouton à côté de la recherche), et revient avec « Index ». BMM retient votre choix.
- Les cartes des Paramètres ont un même en-tête, plus calme : icône, titre, actions, et la description juste sous le titre.
- Six thèmes intégrés avaient un identifiant reprenant le nom d'autres produits. Ces identifiants sont renommés ; les thèmes ne changent pas, et les noms affichés dans BMM restent les mêmes, sauf « Editor », désormais « Charcoal ». Les anciens identifiants fonctionnent toujours partout (votre thème enregistré, les tâches planifiées, les liens) :

| Ancien identifiant | Nouvel identifiant |
|---|---|
| `bmm-discord` | `bmm-indigo` (Indigo) |
| `bmm-spotify` | `bmm-neon` (Neon) |
| `bmm-claude` | `bmm-clay` (Clay) |
| `bmm-nord` | `bmm-arctic` (Arctic) |
| `bmm-vscode` (Editor) | `bmm-charcoal` (Charcoal) |
| `bmm-macos` | `bmm-cobalt` (Cobalt) |

## [NEW] Prêt pour BetterCommunity v2 (désactivé)
- La 1.0.3 sait parler à BetterCommunity v2, la prochaine version du service BetterCommunity. **Elle est livrée désactivée** : tant que la v2 n'est pas annoncée, BMM parle à BetterCommunity exactement comme la 1.0.2, adresse pour adresse.
- À l'ouverture de la v2, l'équipe BetterCommunity l'active depuis le fichier de liens que BMM lit déjà au démarrage : les copies 1.0.3 installées suivent sans nouvelle mise à jour. BMM n'utilise la v2 qu'après qu'elle a répondu à un contrôle de santé ; sinon il reste sur le service actuel pour la session. Une ligne dans `app.cfg` peut garder une installation sur le service actuel quoi que dise le fichier de liens.
- Une fois activée : une carte **Compte BetterCommunity lié** dans les Paramètres, où vous vous connectez en approuvant un code court sur le site (aucun mot de passe saisi dans BMM ; se déconnecter révoque la connexion). Les retours, les notifications, la page Communauté et les suggestions de Laya utilisent alors ce compte. Les mises à jour restent vérifiées avec les manifestes signés de la version, exactement comme avant.
- Le consentement reste la règle : la télémétrie et les reçus de consentement ne sont envoyés que si vous avez activé la télémétrie, et si BetterCommunity v2 publie une version plus récente des Conditions ou de la Politique de confidentialité, BMM l'affiche et demande Accepter, Refuser ou Plus tard, avec un reçu gardé dans **Mes consentements**.

## [FIXED]
- **Catalogue d'applications** : « une source n'a pas répondu » s'affichait chez des personnes qui n'avaient ajouté aucune source. Les adresses de réserve vides sont ignorées, les fichiers `.bmmbundle` suivis ne sont plus comptés comme des échecs (et en ajouter un depuis Sources survit maintenant à un redémarrage), et les adresses de flux avec des paramètres `?…` restent intactes. Sans aucune source active, la page le dit et propose d'en ajouter une.
- **Dépôts suivis avec mot de passe de téléchargement** : ils échouaient à chaque vérification planifiée. Le mot de passe est désormais enregistré scellé sur ce PC, jamais dans le fichier de réglages de BMM, et oublié quand vous cessez de suivre le dépôt.
- `192.168.1.20:8000` et `http://192.168.1.20:8000/repo.json` sont désormais le même dépôt suivi, pas deux.
- **Serveurs SSH** : la demande de phrase de passe et les confirmations Supprimer et Abandonner ne pouvaient pas recevoir de réponse. Elles utilisent maintenant les dialogues de BMM ; la phrase de passe se saisit dans le formulaire et n'est jamais enregistrée.
- **Plugins, Dupliquer** : la copie listait les scripts, dossiers, automatisations, catalogues groupés et l'icône du plugin d'origine sans les avoir. Ils sont maintenant copiés dans le nouveau plugin à l'enregistrement.
- **Plugins, Créer** : modifier un plugin sur un PC qui n'a pas tous ses mods ne les retire plus (ils sont marqués « absent de ce PC ») ; la liste des scripts affiche son état vide ; l'icône actuelle s'affiche en modification ; la liste des mods se rabat sur le profil actuel quand celle de tous les profils ne peut pas être lue.
- **Référence de l'API** : une partie n'était qu'en français et ignorait le thème ; un endpoint sans champ n'affiche plus de tableau vide.
- **Thèmes** : `bmm://theme/apply` applique aussi les thèmes intégrés (il répondait « Thème introuvable »). Importer un thème dont l'identifiant est déjà pris par un autre thème ne l'écrase plus. « Désigner à l'écran » reconnaît maintenant n'importe quelle couleur, plus seulement neuf couleurs fixes.
- Les boutons de l'éditeur de navigation suivent l'ordre de tous les autres dialogues.

## [SECURITY]
- **SSH** : un serveur vu pour la première fois affiche l'empreinte de sa clé et demande « Approuver ce serveur » avant que quoi que ce soit lui soit envoyé. Une clé changée est refusée, avec les deux empreintes côte à côte.
- **Thèmes** : une valeur de couleur qui tente de sortir de la feuille de style est ignorée, et une archive de thème importée dont l'identifiant n'est pas un nom simple est refusée (elle pouvait écrire hors du dossier des thèmes).
- **Plugins, Dupliquer** : seuls les fichiers du dossier du plugin d'origine sont copiés ; les chemins absolus, `..` et les liens sont laissés de côté.
- **Secrets** : les mots de passe de téléchargement des dépôts et la connexion BetterCommunity v2 sont gardés comme les autres secrets de BMM (protégés par Windows pour votre compte) et envoyés seulement à l'adresse à laquelle ils appartiennent.
- Le contournement du proxy du système ne concerne que les adresses de dépôts sur votre PC ou votre réseau local. Les blocages d'adresses du réseau local pour les tâches planifiées, les points d'accès IA et les pages personnalisées ne changent pas.

## Version
- Une seule version partout : 1.0.3.
