# Politique de sécurité

[English](SECURITY.md) · Français

Better Mod Manager (BMM) copie des fichiers dans les dossiers de jeux, télécharge des mods, des
catalogues et des mises à jour, et fait tourner une API locale. Nous prenons les signalements au
sérieux et remercions toute personne qui révèle un problème de façon responsable.

## Versions prises en charge

| Version | Prise en charge |
|---|---|
| 1.0.x (dernière : 1.0.2) | Oui. Les correctifs de sécurité arrivent dans la version 1.0.x suivante. |
| 0.9.12 | Version passerelle uniquement : elle sert à mettre à jour les installations 0.9.x vers la 1.0.x. Mettez à jour plutôt que de signaler contre elle. |
| 0.9.11 et antérieures | Non. |

## Signaler une vulnérabilité

**N'ouvrez pas d'issue publique pour un problème de sécurité.** Signalez-le en privé :

- **Signalement privé de vulnérabilité** GitHub :
  [Signaler une vulnérabilité](https://github.com/FreeProject089/BetterModsManager/security/advisories/new)
  (onglet Security du dépôt, *Report a vulnerability*), ou
- Dans BMM : **Paramètres & Autres → Feedback & Rapports de bugs → Signaler un bug**. Le
  rapport va aux mainteneurs, pas sur un suivi public. Précisez qu'il s'agit de sécurité et restez
  bref sur les détails d'exploitation ; nous vous recontacterons en privé.
- Si aucune de ces voies ne vous convient, écrivez à **[adresse e-mail de confidentialité]** (le
  contact indiqué dans [PRIVACY_FR.md](PRIVACY_FR.md)).

Merci d'indiquer :

- ce qu'un attaquant peut faire (l'impact) et ce dont il a besoin au départ (accès, fichier piégé, position réseau) ;
- les étapes pour reproduire : un repo, un catalogue, une archive, un modpack ou une requête minimal est idéal ;
- la version de BMM, la version de Windows, et les journaux ou la preuve de concept éventuels.

## À quoi s'attendre

- Nous visons un accusé de réception sous 72 heures.
- Après analyse, nous vous disons si nous retenons le signalement et comment nous comptons le corriger.
- Laissez-nous un délai raisonnable pour publier un correctif avant toute divulgation publique. Nous
  vous créditerons volontiers dans l'avis de sécurité et le changelog.

## Périmètre

Dans le périmètre :

- **L'application** : le cœur Rust (`src-tauri/`) et l'interface (`frontend/`), y compris l'injection
  de script dans la webview, et les pages personnalisées ou plugins qui sortent de leurs permissions.
- **L'installateur et la chaîne de mise à jour** : BetterInstaller tel que configuré pour BMM
  (`BetterInstaller/examples/bmm/`), les manifestes de mise à jour signés, les attaques par retour à une
  version antérieure ou par paquet substitué.
- **Formats de repo et de catalogue** : Serveur Repo, catalogues, modpacks, listes `.MM`, packs de
  lancement, archives : traversée de chemin, contournement de signature ou de clé épinglée, contenu
  piégé qui écrit hors de sa cible.
- **API locale, CLI et serveur MCP** : authentification, permissions par plugin, tout ce qui est
  accessible depuis un autre utilisateur local ou une page web.
- **Confidentialité** : données envoyées sans consentement, ou reçu de consentement contournable ou falsifiable.

Hors périmètre :

- les attaques qui exigent une machine déjà compromise ou des droits administrateur ;
- le contenu signé d'un éditeur malveillant qui fait ce qu'il annonce (BMM vérifie qui a publié, pas si
  c'est bien) ;
- l'API locale exposée volontairement au réseau par l'utilisateur (elle écoute sur `127.0.0.1` et n'a
  pas de limitation de débit) ;
- les avertissements de réputation SmartScreen ou antivirus ;
- le site et les services de BetterCommunity (à signaler dans le dépôt BCW) ;
- les durcissements manquants sans impact démontré, et les résultats d'outils automatiques sans
  scénario qui fonctionne.

## Le modèle de sécurité en bref

- **Mises à jour signées** : `update-manifest.json` de BMM et `update.json` de BetterInstaller sont
  signés (Ed25519) et expirent ; un manifeste non signé, expiré ou incohérent est refusé. Les
  téléchargements sont vérifiés par leur SHA-256.
- **Repos et catalogues signés** : un repo ou un catalogue peut exiger une signature ; la clé de
  l'éditeur est épinglée à la première rencontre, et un changement de clé est signalé, pas accepté en silence.
- **Confinement des chemins** : chaque nom qui devient un chemin de fichier est assaini à cette
  frontière ; les archives (zip, 7z, rar) passent un contrôle zip-slip avant toute écriture.
- **API locale** : écoute sur `127.0.0.1`, par jeton, permissions déduites du jeton (jamais d'un
  en-tête), jetons comparés en temps constant.
- **Reçus de consentement** : chaque réponse de confidentialité ou de conditions laisse un reçu
  versionné, haché et en ajout seul sur le PC de l'utilisateur (Paramètres → Confidentialité → Mes consentements).
- **La télémétrie est désactivée par défaut** et ne démarre qu'après un oui explicite ; voir
  [PRIVACY_FR.md](PRIVACY_FR.md).
- **CI** : gitleaks, Semgrep, `npm audit` et `cargo audit` tournent sur les pushs vers `main` et
  `Tdev`, sur les pull requests, et chaque semaine pour les nouveaux avis.

Plus de détails : la page « Comment ça marche → Modèle de sécurité » de la documentation
(`BMM Docs/docs/how-it-works/security.fr.md`).
