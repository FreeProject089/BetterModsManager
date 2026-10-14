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

## [AMÉLIORÉ] Version
- Une seule version partout : 1.0.3.
