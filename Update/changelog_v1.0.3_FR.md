# Changelog v1.0.3 (depuis e4b7943d, la build 1.0.2)

1.0.3 relie Better Mods Manager à BetterCommunity v2. Tout est livré désactivé : BMM continue de parler à BetterCommunity v1 exactement comme la 1.0.2. Le jour où BetterCommunity v2 ouvre, son équipe change une valeur dans le fichier de liens que BMM lit à chaque démarrage, et les copies 1.0.3 installées suivent sans nouvelle version.

## [NOUVEAU] BetterCommunity v2, prêt et en sommeil
### Un interrupteur, décidé au démarrage
- BMM lit l'interrupteur dans cet ordre : votre `app.cfg` (`BCApiVersion`, `BCv2Base`), puis le fichier de liens publié par BetterCommunity (`bc_api`, `bc_v2_base`), puis v1. Un `BCApiVersion=v1` explicite dans `app.cfg` garde une installation sur v1 quoi que dise le fichier de liens.
- v2 n'est utilisé qu'après que BetterCommunity v2 a répondu à son contrôle de santé pendant la session. S'il ne répond pas, BMM reste sur v1 pour la session et en écrit la raison dans son journal. Tant que le contrôle n'a pas répondu, BMM est sur v1.
- Sans l'interrupteur rien ne change : chaque adresse appelée par BMM est celle de la 1.0.2 (vérifié par un test, adresse par adresse).

### Compte BetterCommunity lié (v2)
- Les Paramètres affichent une carte « Compte BetterCommunity lié » quand la session tourne sur v2. « Se connecter avec BetterCommunity » affiche un code court ; vous l'approuvez sur le site. Aucun mot de passe n'est saisi dans BMM.
- La connexion est gardée comme BMM garde ses autres secrets : protégée par Windows pour votre compte utilisateur (le trousseau du système sur macOS et Linux). Si aucun des deux ne fonctionne, elle dure jusqu'à la fermeture de BMM, et la carte le dit. BMM ne l'affiche jamais et ne l'envoie qu'à l'adresse BetterCommunity v2 qui l'a délivrée.
- Se déconnecter révoque la connexion sur le site et l'oublie sur ce PC.
- En mode v1 la carte est masquée et la liaison de compte existante fonctionne comme avant.

### Ce qui passe sur v2 quand l'interrupteur est activé
- Les retours, bugs et rapports de plantage vont au centre de retours v2 : sous votre compte si vous êtes connecté, sinon avec la clé d'application publique de BMM.
- Les reçus de consentement : vos réponses sur la télémétrie, et vos réponses aux Conditions d'utilisation et à la Politique de confidentialité dès que BetterCommunity v2 publie la version livrée avec cette build. Même règle qu'avant : envoyés seulement avec la télémétrie activée, ou quand vous appuyez sur « Envoyer au serveur » dans Mes consentements.
- Quand BetterCommunity v2 publie une version plus récente des Conditions ou de la Politique de confidentialité de BMM que celle que vous avez acceptée, BMM affiche la nouvelle version avec un lien pour la lire et demande Accepter, Refuser ou Plus tard. Votre réponse est enregistrée par BetterCommunity avec la version et la révision affichées, et une copie du reçu est gardée dans Mes consentements.
- Les notifications BetterCommunity sont lues avec votre connexion v2 (plus de clé d'API à coller).
- La page Communauté lit le journal sur v2. Les avatars restent sur v1 (v2 n'en a pas encore).
- Les suggestions BetterCommunity de Laya utilisent votre connexion v2.
- Le flux de secours de la vérification des mises à jour et la liste des crédits viennent de v2. Chaque mise à jour reste vérifiée avec le `update-manifest.json` ou le `update.json` signé de la version, exactement comme avant.
- Le modèle hors ligne de Laya peut aussi être téléchargé depuis v2. Son empreinte SHA-256 épinglée ne change pas.
- La télémétrie anonyme, si vous l'avez activée, va sur v2 avec seulement les catégories acceptées, lues dans vos reçus de consentement. BMM ne garde que les détails déclarés par l'équipe BetterCommunity et retire le reste avant l'envoi, dont l'identité précise du matériel. Le replay de session reste sur le serveur de télémétrie actuel.

### Toujours sur v1 en mode v2
- Les avatars, les annonces de lancement, la recherche d'auteur par identifiant de créateur et la liaison Discord. BetterCommunity v2 ne les sert pas encore.

## [AMÉLIORÉ] Notifications
- Un seul centre de notifications, un seul compteur de non lues (aussi sur l'icône de la barre des tâches). Les messages sont groupés selon leur origine : Mises à jour, Dépôts suivis, Planificateur, Tâches de fond, BetterCommunity et BMM lui-même.
- Chaque message peut être ouvert (quand il mène quelque part, par exemple une mise à jour disponible ou un dépôt suivi), reporté (1 heure, 4 heures, demain 9 h) ou retiré. Un message reporté revient non lu à l'heure prévue.
- Paramètres, Notifications : chaque groupe s'affiche dans l'application, dans l'application et en notification système (seulement quand BMM est en arrière-plan), ou est désactivé (gardé dans la liste seulement). Les anciens réglages par source sont repris.
- Ne pas déranger, depuis la cloche ou dans les paramètres, et des heures calmes chaque jour. Pendant ce temps rien ne s'affiche et aucune notification système n'est envoyée ; les erreurs s'affichent quand même dans l'application, et tout reste dans la liste.
- Le même événement deux fois donne une bulle avec un compteur et une entrée avec un compteur, pas une pile de copies. Une mise à jour retrouvée par une vérification suivante met son entrée à jour.
- La liste garde les 200 derniers messages et rien de plus de 30 jours.
- Clavier : Haut et Bas pour passer d'un message à l'autre, Entrée ouvre, Suppr retire, S reporte d'une heure, Échap ferme et revient à la cloche.
- Une tâche de fond longue (15 secondes ou plus) qui se termine pendant que BMM est en arrière-plan est signalée dans Tâches de fond.

## [AMÉLIORÉ] Conflits
- Une nouvelle vue Conflits indique, pour chaque fichier partagé par deux mods actifs, quelle copie est sur le disque selon l'ordre d'activation actuel, avec un résumé par paire de mods (combien de fichiers partagés, qui en gagne combien).
- Résoudre en réordonnant (monter ou descendre, « Faire gagner X », le plus petit déplacement qui place X après l'autre mod), en gardant la copie d'un mod pour certains fichiers quel que soit l'ordre (un choix par fichier, gardé par profil), ou en désactivant un mod. Cocher plusieurs fichiers pour choisir pour tous d'un coup.
- Rien ne change avant Appliquer. Le pied de la vue indique combien de fichiers Appliquer recopierait, et « Voir les changements » les liste un par un (de quel mod vers quel mod, ou retour au fichier d'origine du jeu). Appliquer est une tâche du centre d'activité et ne recopie que ces fichiers.
- La règle est celle du déploiement : le choix par fichier gagne tant que son mod est actif, sinon le dernier mod de l'ordre. Activer ou désactiver un mod remet ensuite les fichiers gardés en place.
- Le badge de conflit actif de la bibliothèque, les détails du mod et l'ancienne liste des conflits ouvrent la vue sur ce mod. Elle est aussi dans la palette de commandes (« Résoudre les conflits »). Les chevauchements avec des mods désactivés ou d'autres profils restent dans la liste existante, à un clic.

## [AMÉLIORÉ] Des panneaux dans leur propre fenêtre
- L'éditeur de thème, le bac à sable de traduction et le débogueur de tâches peuvent sortir de la fenêtre de BMM : « Ouvrir dans sa propre fenêtre » dans leur en-tête, ou glisser l'en-tête au-delà du bord de la fenêtre de BMM et relâcher. Le panneau devient une fenêtre à part, à placer où vous voulez, sur un autre écran aussi, à côté de ce qu'il modifie plutôt que par-dessus.
- Tout continue de fonctionner depuis cette fenêtre et reste synchronisé avec BMM : le panneau tourne toujours dans BMM, la fenêtre l'affiche et lui renvoie vos clics et votre saisie. Elle suit le thème, clair ou sombre.
- La fenêtre de chaque panneau retient sa taille et sa place. « Remettre dans la fenêtre de BMM » replace le panneau là où il était ; son bouton de fermeture ferme le panneau. Fermer la fenêtre autrement (Alt+F4, la barre des tâches) remet aussi le panneau en place.
- Dans cette fenêtre, les listes de choix s'ouvrent avec la liste du système, et ce qui se glisse à l'intérieur du panneau (réordonner, redimensionner) se fait dans la fenêtre de BMM.

## [AMÉLIORÉ] Cartes, Paramètres et dialogues
- Plus de barre de couleur le long du bord gauche des cartes et des lignes : l'entrée active des Paramètres, le menu principal, les cartes de mods, les astuces et notes, les citations, les étapes du planificateur, les cartes Sécurité et Identité, et le reste. L'élément courant a un fond légèrement teinté, une astuce est un encadré légèrement teinté, un type se reconnaît à son icône.
- Paramètres : la colonne d'index peut être masquée (bouton à côté de la recherche) pour laisser toute la largeur aux cartes, et revient avec le bouton « Index » au-dessus des cartes. BMM retient le choix, et Ctrl+F la fait revenir pour chercher. Dans une fenêtre étroite, l'index reste la bande au-dessus des cartes.
- Les cartes des Paramètres ont le même en-tête : l'icône sur une tuile discrète, le titre, les actions, et la description juste sous le titre. Plus de trait sous le titre, une carte plus calme.
- Les boutons de l'éditeur de navigation suivent l'ordre de tous les dialogues : Réinitialiser et Partager à gauche, Terminé à droite à sa taille normale.

## [CORRIGÉ] Catalogue d'applications : « une source n'a pas répondu » sans aucune source ajoutée
- Le catalogue officiel d'applications liste une adresse partenaire vide en guise de réserve. BMM essayait de lire cette adresse vide, comptait l'échec et annonçait qu'une source n'avait pas répondu à des personnes qui n'en avaient ajouté aucune. Les adresses vides ou qui ne sont pas web sont désormais ignorées, jamais comptées.
- Un `.bmmbundle` suivi était aussi passé au lecteur web et compté comme un échec alors que ses applications se chargeaient bien. Ce n'est plus le cas, et en ajouter un depuis l'onglet Sources l'enregistre maintenant pour le prochain démarrage.
- Les flux dont l'adresse a déjà des paramètres (`catalog.json?project=bmm&kind=APP`) sont lus avec leurs paramètres intacts.
- Quand une source échoue vraiment, l'avis la nomme, dit pourquoi (délai dépassé, code HTTP, signature refusée, pas un catalogue) et propose Réessayer, Désactiver, Retirer (vos sources) et Détails. Les sources désactivées ne sont jamais lues ni comptées.
- Avec le catalogue officiel désactivé et aucune source active, la page dit qu'il n'y a aucune source et propose d'en ajouter une, au lieu de « catalogue vide » ou d'une erreur.

## [AMÉLIORÉ] Sources de catalogues
- Une seule liste dans le catalogue d'applications (Sources) et dans Paramètres, Index de catalogues : nom, adresse, type, officielle, partenaire ou la vôtre, état de la signature, dernière actualisation, nombre d'éléments, état et un interrupteur.
- Ajouter et Modifier ouvrent un dialogue avec Tester, qui lit l'adresse comme BMM le fera : nombre d'éléments, format, signature. Un index est reconnu et ses catalogues peuvent être ajoutés d'un coup.
- Vos sources peuvent monter et descendre (le premier catalogue l'emporte quand deux listent le même élément), recevoir un nom, être retirées après confirmation, et être importées ou exportées en fichier JSON.
- Les sources officielles viennent du fichier de liens de BMM et sont affichées en lecture seule, avec une courte explication des catalogues officiels et partenaires face aux vôtres.

## [AMÉLIORÉ] Outils BMM
- La liste des outils a une recherche, des groupes et une ligne sous chaque outil. La zone de résultats dit toujours où elle en est : pas encore lancé, en cours (avec progression et Annuler), échec (avec la raison et Réessayer), ou terminé (résumé et les mêmes boutons Copier le JSON, Enregistrer en JSON, Enregistrer en CSV pour chaque outil).
- Nouveau : Vérification des fichiers déployés. Pour chaque mod actif, les fichiers disparus du dossier du jeu, les liens qui ne pointent nulle part, les fichiers absents du mod dans la bibliothèque, et les liens cassés restés à côté.
- Nouveau : Gros fichiers. Les plus gros fichiers des dossiers de mods et de sauvegardes d'un profil, avec leur mod.
- Nouveau : Noms et versions. Les noms et versions de mods à ranger (espaces en trop, version dans le nom, version vide ou bizarre), avec une suggestion pour chacun. Rien n'est renommé.
- Nouveau : Profils en double. Les profils aux mêmes mods actifs (ou presque), ou qui partagent un dossier de jeu ou de mods.
- Nouveau : Nettoyage des caches. Mesure le cache des catalogues, les archives de mods extraites, les restes de mises à jour et les rapports archivés, puis vide seulement ceux que vous cochez, après une confirmation qui montre la taille. Il refuse de toucher aux archives extraites pendant l'activation d'un mod.
- Nouveau : Lecteur de journaux. Le journal de cette session et les rapports de session et de plantage enregistrés, filtrés par niveau et par mots.
- Nouveau : Différences de catalogues. Deux versions d'un catalogue ou d'un repo.json : entrées ajoutées, retirées et modifiées, avec les champs qui ont changé.
- Les analyses longues (doublons, espace disque, gros fichiers, fichiers déployés, mesure des caches) apparaissent dans le centre d'activité et peuvent y être arrêtées.

## [AMÉLIORÉ] Dépôts suivis : en suivre un par son adresse ou son IP
- « Suivre un dépôt » se trouve dans la carte Dépôts suivis elle-même et ouvre un dialogue : l'adresse, un mot de passe de téléchargement et une clé facultatifs, « Tester la connexion », la fréquence de vérification, et quoi faire d'une mise à jour (me prévenir, la télécharger, la télécharger et l'appliquer). Rien n'est enregistré avant « Suivre ».
- Le test lit le dépôt une fois et affiche son nom, sa version, le format de son repo.json, sa signature (valide, NE correspond PAS, ou non signé) et le nombre de mods proposés. Les erreurs sont dites clairement : rien n'a répondu, délai dépassé, code HTTP, mot de passe nécessaire.
- Un bouton « Suivre » là où un dépôt est déjà connu : le dépôt qui vient d'être lu, chaque résultat de la liste des dépôts et chaque entrée de l'historique. Il ouvre le même dialogue, déjà rempli.
- Un mot de passe de téléchargement donné là est enregistré scellé sur ce PC (protégé par Windows pour votre compte, le trousseau du système sur macOS et Linux), jamais dans le fichier de réglages de BMM, et utilisé par les vérifications planifiées. Avant, un dépôt suivi protégé par mot de passe échouait à chaque vérification. Ne plus suivre un dépôt l'oublie.

## [AMÉLIORÉ] Dépôts joignables par simple IP
- Une adresse peut être saisie comme on joint la machine : `192.168.1.20:8000`, `http://192.168.1.20:8000/repo.json`, `[::1]:8000`, `nas.local:8080/mods/`, ou un simple nom. BMM en fait l'adresse du repo.json et l'affiche sous le champ. `HTTP://` en majuscules, une clé de partage (`?k=…`) et un `#…` final sont gérés.
- Le http simple est accepté. Sur ce PC ou le réseau local, le dialogue dit que c'est normal ; sur Internet, il prévient qu'un mot de passe de téléchargement circulerait en clair.
- Les requêtes vers ce PC et vers les adresses du réseau local ne passent plus par le proxy du système, qui ne peut pas les joindre. Les adresses Internet l'utilisent toujours. Les blocages d'adresses privées de BMM pour les tâches planifiées, les points d'accès IA et les pages personnalisées ne changent pas : ils concernent des adresses que vous n'avez pas saisies.
- `192.168.1.20:8000` et `http://192.168.1.20:8000/repo.json` sont le même dépôt suivi, pas deux.

## [AMÉLIORÉ] Serveurs SSH
- Le dialogue Serveurs SSH est refait : une liste des serveurs enregistrés avec leur état (incomplet, pas encore testé, clé du serveur approuvée, test réussi, dernier test échoué), et un formulaire dont chaque champ dit ce qui ne va pas (hôte, port de 1 à 65535, utilisateur, fichier de clé, dossier de base, un nom utilisable dans `ssh://nom/`). Coller `moi@nas.local:2222` dans l'hôte remplit l'utilisateur et le port.
- « Tester la connexion » procède par étapes : joindre le serveur, vérifier sa clé, se connecter, examiner le dossier de base (existe, inscriptible, et sinon, à qui il appartient).
- Un serveur vu pour la première fois affiche l'empreinte de sa clé (`SHA256:…`) et demande « Approuver ce serveur » avant que quoi que ce soit lui soit envoyé : ni mot de passe, ni signature de clé. Une clé changée est refusée, avec l'empreinte approuvée et la nouvelle côte à côte, et la marche à suivre si vous avez reconstruit le serveur.
- La phrase de passe ou le mot de passe se saisit dans le formulaire, sert au Test et à Parcourir, et n'est jamais enregistré. L'ancien dialogue le demandait dans une boîte que l'application ne pouvait pas afficher, et ses confirmations Supprimer et Abandonner ne pouvaient pas non plus recevoir de réponse ; les deux utilisent maintenant les dialogues de BMM.
- Clavier : Haut et Bas parcourent les serveurs, Entrée va au formulaire, Entrée ou Ctrl+S enregistre, Échap ferme.
- Les erreurs SSH se lisent comme des phrases (« Impossible de joindre nas.local : Connection refused ») au lieu d'une phrase à trous suivie des détails bruts.
- Envoyer ou récupérer un seul fichier en SSH (un repo.json, un catalogue) apparaît maintenant dans le centre d'activité, comme les transferts de dépôt entier.

## [AMÉLIORÉ] Version
- Une seule version partout : 1.0.3.
