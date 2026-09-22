# Politique de confidentialité — Better Mods Manager (BMM)

_Dernière mise à jour : 2026-09-22_

Better Mods Manager est une application de bureau open‑source (GPL‑3.0) qui fonctionne sur votre
ordinateur. Vos profils, mods, modpacks, plugins et réglages sont stockés **localement**, dans le
dossier de données de BMM, et vous pouvez les exporter ou les supprimer à tout moment. BMM
n'affiche aucune publicité et ne demande aucun compte.

Certaines données quittent toutefois votre ordinateur. Cette politique liste chaque cas que nous
connaissons : **ce qui** est envoyé, **à qui**, et si cela se fait **par défaut** ou seulement si vous
l'activez. Les Conditions d'utilisation ne reprennent rien de tout cela : pour toute question
relative aux données, c'est ce document qui fait référence.

---

## 1. En bref : ce qui est actif par défaut

| Quoi | Par défaut si vous installez avec BetterInstaller | Par défaut si BMM tourne sans l'installateur |
|---|---|---|
| Requêtes de démarrage vers BetterCommunity (portent votre Creator ID, §2.1) | Actif, toujours | Actif, toujours |
| Vérification des mises à jour (§2.2) | Actif | Actif |
| Tests de connectivité et polices web (§2.3) | Actif, toujours | Actif, toujours |
| **Télémétrie** (§3) | **Activée** : la case de l'installateur est pré‑cochée | Désactivée jusqu'à votre réponse à l'écran de consentement du premier lancement |
| Replay de session envoyé avec la télémétrie (§3.2) | **Actif** tant que la télémétrie l'est : pré‑coché dans l'installateur | Pré‑coché dans la section « Personnaliser » de l'écran de consentement |
| Benchmark hebdomadaire + rapport matériel détaillé (§3.3) | **Actif** tant que la télémétrie l'est : l'installateur ne pose pas la question | Pré‑coché dans la section « Personnaliser » de l'écran de consentement |
| **Discord Rich Presence** (§4) | **Activé** : la case de l'installateur est pré‑cochée | Désactivé |
| Rapports de bug, de plantage et retours (§5) | Seulement quand vous cliquez sur Envoyer | Seulement quand vous cliquez sur Envoyer |

Chacun de ces éléments peut être désactivé dans les paramètres de BMM (Paramètres → Confidentialité
pour la télémétrie et ses options, les interrupteurs Discord et mises à jour dans les Paramètres). La
page Configuration de BetterInstaller affiche chaque case pré‑cochée avec une description et une
marque « Envoie des données » avant toute installation.

---

## 2. Ce qui se produit quel que soit votre choix de télémétrie

### 2.1 Configuration au démarrage, avec votre Creator ID
À chaque démarrage, BMM télécharge sa liste de liens (`links.json`) et la liste des contributeurs
depuis `bettercommunity.ch`, avec les copies sur GitHub en secours. **Les requêtes que la partie
native de BMM envoie à une adresse bettercommunity.ch portent votre Creator ID** dans un en‑tête
`X-Creator-ID` : BetterCommunity reçoit donc votre Creator ID et votre adresse IP à chaque lancement,
**avant le consentement à la télémétrie et indépendamment de celui‑ci**.

**Ce qu'est le Creator ID.** C'est la moitié publique d'une paire de clés Ed25519 que BMM crée au
premier lancement. La clé est **dérivée d'identifiants de ce PC** (MachineGuid, identifiant de
produit et date d'installation de Windows ; numéros de série de la carte mère, du BIOS, du processeur
et du disque ; numéro de série du volume C:) par une dérivation à sens unique, puis stockée dans
votre registre utilisateur et dans le dossier de données de BMM. Conséquences :

- il ne contient ni nom ni e‑mail, et les identifiants dont il est dérivé ne peuvent pas en être
  extraits ;
- il est **stable** : le même PC obtient le même Creator ID, même après une réinstallation de BMM ;
  tout ce qui est envoyé sous cet identifiant est donc **rattachable à cette machine dans le temps** ;
- il signe ce que vous publiez (dépôts, modpacks, tutoriels) : il est donc aussi visible par toute
  personne qui les reçoit (§6.3).

### 2.2 Vérification des mises à jour
Environ trois secondes après le lancement, BMM interroge l'API des versions de GitHub
(`api.github.com/repos/FreeProject089/BetterModsManager/releases`), avec
`bettercommunity.ch/api/updates/bmm` en secours. Si BMM a été installé avec BetterInstaller, il
interroge aussi l'installateur, qui lit les manifestes de mise à jour sur GitHub et
`bettercommunity.ch`. Ces hôtes voient votre adresse IP et un user‑agent qui nomme le programme.
Désactivez la vérification automatique dans les Paramètres.

BetterInstaller lui‑même ne contacte rien pendant l'installation, sauf pour télécharger un
composant optionnel que vous cochez (comme Python, depuis `python.org`). Quand vous le rouvrez pour
réparer, mettre à jour ou désinstaller, il consulte les mêmes manifestes de mise à jour.

### 2.3 Tests de connectivité, polices et catalogues
- Toutes les deux minutes, BMM vérifie s'il est en ligne en interrogeant
  `www.gstatic.com/generate_204` (Google) et `cloudflare.com/cdn-cgi/trace` (Cloudflare).
- L'interface charge ses polices depuis Google Fonts.
- Au démarrage, il lit le catalogue d'applications sur GitHub (`raw.githubusercontent.com`), et
  consulte le catalogue de plugins si vous en avez installé depuis celui‑ci.

Ces services voient votre adresse IP et les en‑têtes ordinaires d'une requête, selon leurs propres
politiques de confidentialité.

---

## 3. Télémétrie

La télémétrie envoie des données d'utilisation et de diagnostic au **serveur de télémétrie de
BetterCommunity** (`telemetry.bettercommunity.ch`, exploité par l'équipe BMM). Elles sont mises en
tampon sur votre disque (10 Mo au plus), compressées et envoyées en **HTTPS** toutes les 90 secondes
tant que la fenêtre est visible, quand elle est masquée et à la fermeture de BMM. Chaque lot porte
un **identifiant de paquet** aléatoire pour que vous puissiez le faire effacer (§3.5).

**Par défaut :** désactivée dans BMM jusqu'à votre réponse à l'écran de consentement du premier
lancement. **Activée si vous installez avec BetterInstaller en laissant sa case pré‑cochée** :
l'installateur transmet votre choix à BMM, et l'écran de consentement n'est alors pas affiché.
Paramètres → Confidentialité la désactive à tout moment ; désactivée, rien du §3 n'est collecté ni
envoyé.

### 3.1 Ce qui est envoyé
- **Identité :** votre Creator ID (§2.1) et un identifiant aléatoire propre à l'installation.
- **Profil système :** système d'exploitation et version, processeur et nombre de cœurs, mémoire,
  chaque carte graphique, carte mère, modèle et fabricant de la machine, exécution ou non dans une
  machine virtuelle, vos disques (taille, et emplacement de montage), vos écrans (fabricant, modèle,
  année) et leurs résolutions, votre **adresse IP sur le réseau local** et votre **adresse IP
  publique** (que BMM obtient en interrogeant `api.ipify.org`), la version et la langue d'interface
  de BMM, et pour chacun de vos profils le **nom du jeu**, son nombre de mods et la répartition de
  ses dossiers sur les disques.
- **Préférences et décomptes :** thème actif (identifiant, nom, intégré ou personnalisé), langue,
  réglages de Tasky, mode de sécurité du système de fichiers, et combien de mods, profils, plugins,
  modpacks, tags, packs de lancement et applications vous avez (des nombres, pas leurs noms).
- **Utilisation :** les pages que vous ouvrez et le temps passé, votre parcours de navigation, les
  fenêtres de dialogue que vous ouvrez (avec leur titre), le début et la fin de session.
- **Interactions :** le texte des boutons sur lesquels vous cliquez, **l'adresse complète des liens
  externes** que vous ouvrez, le nom des champs de formulaire que vous modifiez (jamais leur valeur),
  et les messages d'erreur.
- **Journaux :** les avertissements et erreurs de la console de l'interface, et toutes les
  15 secondes les lignes d'avertissement et d'erreur du journal de BMM. **Ces lignes peuvent
  contenir des chemins de fichiers et de dossiers**, par exemple un dossier de mods, qui peut
  comporter votre nom d'utilisateur Windows.
- **Performances :** images par seconde, temps d'image, pire image, mémoire utilisée par
  l'interface, et temps de chargement des pages.
- **Dépôts :** quand vous vous connectez à un Server Repo, son adresse, son hôte et son nom ; quand
  vous en hébergez un, le nom d'auteur que vous saisissez.

### 3.2 Replay de session
Tant que la télémétrie est activée, BMM envoie aussi un **enregistrement de la fenêtre de BMM** : sa
mise en page, les clics, le défilement et la navigation. **Le texte saisi dans les champs est
masqué**, de même que les éléments marqués comme noms ou chemins. Les autres fenêtres et le reste de
votre écran ne sont jamais enregistrés.

- **Par défaut :** actif tant que la télémétrie l'est. Dans BetterInstaller, c'est la case « Replay
  de session dans la télémétrie », pré‑cochée ; dans BMM, c'est une option de Paramètres →
  Confidentialité.
- Un mode distinct **« complet (non masqué) »** existe pour votre propre débogage. Il reste
  désactivé sauf si vous l'activez ; activé, le texte saisi n'est pas masqué et les images locales
  affichées dans la fenêtre sont intégrées à l'enregistrement.

### 3.3 Benchmark hebdomadaire et rapport matériel détaillé
Tant que la télémétrie est activée, BMM lance un court benchmark interne une fois par semaine (et
lors de la première activation) et en envoie les temps. Avec lui, BMM envoie un **rapport matériel
détaillé** composé d'**identifiants matériels stables** : modèle et numéro de série de la carte mère,
version, date et fabricant du BIOS, UUID de la machine, détails du cache et des threads du
processeur, modèle, numéro de série, taille et interface de chaque disque, **adresse MAC de chaque
carte réseau physique**, build du système, démarrage UEFI ou legacy, état de Secure Boot et du TPM.

- **Par défaut :** actif dès que la télémétrie l'est. BetterInstaller ne pose pas la question ; dans
  BMM, c'est l'interrupteur « Benchmark automatique (tous les 7 jours) + rapport matériel
  supplémentaire » de Paramètres → Confidentialité (et de la section « Personnaliser » de l'écran de
  consentement), pré‑coché. Décochez‑le pour garder la télémétrie sans ce rapport.

### 3.4 Ce que la télémétrie n'envoie jamais
Le contenu de vos mods, de vos fichiers de jeu ou d'autres fichiers ; les valeurs que vous saisissez
dans les champs (sauf si vous activez le mode non masqué du §3.2) ; votre nom ou votre e‑mail.

### 3.5 Stockage, localisation, effacement
- **Où :** un serveur exploité par l'équipe BMM. La lecture des données stockées exige une clé
  d'administration ; la clé intégrée à BMM permet seulement d'envoyer des données et de déposer des
  demandes d'effacement ou d'accès.
- **Une copie de vos données :** le panneau Confidentialité peut déposer une demande portant sur tout
  ce qui est lié à votre Creator ID. Vous indiquez une adresse e‑mail, envoyée avec la demande ; un
  administrateur l'examine et vous renvoie l'export par e‑mail.
- **Votre adresse IP et votre localisation :** le serveur enregistre l'adresse IP d'où vient un lot
  et l'adresse IP publique que BMM signale (§3.1). Il localise l'adresse au moyen du service tiers
  **ipwho.is** et stocke le pays, la région, la ville et les coordonnées que ce service renvoie. La
  géolocalisation par IP situe le réseau par lequel vous vous connectez, pas votre domicile, mais elle
  est souvent précise à la ville. La carte du tableau de bord affiche ces coordonnées arrondies.
- **Conservation :** les événements d'utilisation, les benchmarks et les replays de session sont
  supprimés automatiquement après la durée de conservation, **180 jours** sauf autre valeur choisie
  par l'administrateur. **Les enregistrements d'adresses IP, leurs localisations et la liste des
  « instances en ligne » ne sont pas supprimés automatiquement** par le serveur actuel.
- **Effacement par paquet :** le panneau Confidentialité liste chaque paquet envoyé par BMM
  (identifiant, heure, types d'événements et leur nombre). « Demander la suppression » efface les
  événements, benchmarks et replays de ce paquet après un délai d'examen de 72 heures au plus, ou
  immédiatement si un administrateur l'approuve ; une demande refusée peut être refaite. **Cela ne
  retire pas les enregistrements d'IP et de localisation** ; demandez‑le par le contact du §8.
- Vous pouvez exporter ou vider le tampon local de BMM à tout moment dans le panneau
  Confidentialité.
- Le serveur limite le nombre de lots qu'une même adresse peut envoyer par minute.

---

## 4. Discord Rich Presence
Activé, BMM indique à **l'application Discord installée sur votre PC** quoi afficher sur votre
profil : le nom de votre profil BMM actif, le nombre de mods activés, la version de BMM avec votre
**Creator ID**, et un bouton « Website » dont le lien contient votre Creator ID. Discord affiche ces
informations à **toute personne qui peut voir votre profil**, selon sa propre politique de
confidentialité. Chaque mise à jour relit aussi la liste de liens de BMM sur GitHub.

**Par défaut :** désactivé dans BMM ; **activé si vous installez avec BetterInstaller en laissant sa
case pré‑cochée**. Désactivez‑le dans les Paramètres.

---

## 5. Rapports de bug, de plantage et retours

### 5.1 Envoyer un rapport
Une suggestion, un rapport de bug ou un rapport de plantage est envoyé au **centre de retours
BetterCommunity** (`bettercommunity.ch/api/feedback/bmm`) ; les anciens formulaires BetaHub ne
servent que si l'application est configurée avec une adresse de retours vide. **Rien n'est envoyé
avant que vous cliquiez sur Envoyer.** BMM transmet alors :

- le titre, la description et les étapes de reproduction que vous saisissez, et les captures
  d'écran que vous joignez ;
- le `.zip` de rapport de plantage que vous sélectionnez (contenu au §5.2) ;
- en option le journal de l'application (`bmm_frontend.log`), pré‑coché pour les bugs et
  plantages ;
- en option un **rapport DxDiag**, pré‑coché pour les plantages : un inventaire complet du matériel
  et des pilotes qui contient aussi des identifiants de la machine et du système et votre **nom de
  compte Windows** ;
- votre **Creator ID** (avec une preuve signée), la version de l'application, le système, la langue
  et le user‑agent ;
- l'e‑mail ou le pseudo Discord que vous saisissez, le cas échéant, pour qu'on puisse vous
  répondre. Avec un compte BetterCommunity lié, le rapport ouvre plutôt un fil dans votre tableau
  de bord.

Une petite preuve de travail anti‑spam s'exécute avant l'envoi ; elle n'envoie aucune donnée
supplémentaire. Si le site est injoignable, le rapport est gardé localement et renvoyé 15 secondes
après le lancement suivant, et nulle part ailleurs. BMM garde une liste locale de vos 50 derniers
envois. Une fois reçu, un rapport est conservé selon les conditions de la plateforme BetterCommunity.

### 5.2 Contenu d'un zip de rapport de plantage
Quand BMM plante, il écrit un `.zip` de rapport **sur votre disque**. Il contient les journaux de
BMM, un instantané des informations système, un **rapport DxDiag** (toujours, lors d'un plantage,
indépendamment de la case du §5.1), un **instantané du fichier de données de BMM** (vos profils et
réglages, **y compris des valeurs gardées dans les réglages comme un jeton d'accès GitHub ou le jeton
de l'API locale**), et l'enregistrement de session masqué du §5.3 avec la sortie de la console et du
journal. Un rapport semblable est aussi écrit localement à chaque fermeture normale de BMM. Ces
fichiers restent sur votre ordinateur tant que vous n'en envoyez ou n'en partagez pas un vous‑même ;
ouvrez le zip au préalable pour voir exactement ce qu'il contient.

### 5.3 Enregistrement local de la session
BMM garde toujours un enregistrement de la session en cours (masqué comme au §3.2) **sur votre
disque** : des segments de travail dans son dossier de données, et la dernière session enregistrée
sous `last_crash_session.bmmreplay` environ toutes les 45 secondes, pour qu'un rapport de plantage
montre ce qui s'est passé juste avant. Le journal de BMM et la sortie de la console enregistrés avec
lui ne sont pas masqués. Activer l'**Enregistreur de session** (Paramètres → Débogage & dépannage)
conserve en plus chaque session dans une liste de replays locale. **Rien de tout cela n'est envoyé**,
sauf si vous envoyez un rapport de plantage qui le contient (§5.1), ou si le replay de la télémétrie
(§3.2) est actif, qui est un enregistrement distinct.

---

## 6. Autres fonctions qui contactent un serveur quand vous les utilisez

### 6.1 Server Repos
Se connecter à un Server Repo ou se synchroniser avec lui envoie des requêtes à son serveur, qui
voit votre **adresse IP** et votre **Creator ID**, afin que son propriétaire puisse appliquer listes
blanches et bannissements et voir des statistiques de connexion. C'est le propriétaire du dépôt, et
non l'équipe BMM, qui contrôle ce serveur. Les dépôts qui exigent un **mot de passe de
téléchargement** le reçoivent avec vos requêtes pendant la session ; BMM ne l'écrit jamais sur le
disque. Les dépôts et catalogues qui exigent une **clé d'identité** reçoivent une déclaration signée
de courte durée, jamais la clé ; BMM ne stocke que le chemin de votre fichier de clé, et quelle clé
répond à quel serveur.

### 6.2 Héberger un Server Repo, publier par SSH
Si **vous** hébergez un dépôt, les personnes qui s'y connectent exposent **leur** adresse IP et leur
Creator ID à **votre** machine, et vous devenez responsable de ces journaux. Publier par SSH se
connecte au serveur que **vous** avez configuré ; hôte, port, utilisateur, dossier distant et
**chemin** de votre clé privée sont enregistrés localement, tandis que la phrase de passe de la clé et
tout mot de passe sont lus au moment de l'utilisation et jamais stockés. L'empreinte du serveur est
enregistrée à la première connexion pour qu'un serveur modifié soit refusé.

### 6.3 Les documents que vous partagez portent votre identifiant d'auteur
Les modpacks (`.bmp`), catalogues de modpacks (`.cbmp`) et tutoriels (`.bmmtut`) que vous exportez
sont **signés avec votre clé de créateur**. Toute personne avec qui vous partagez le fichier peut voir
votre identifiant d'auteur (votre Creator ID) et vérifier que le fichier n'a pas été modifié.

### 6.4 Téléchargements et catalogues que vous ouvrez
Télécharger des plugins, des applications de catalogue ou des thèmes, ouvrir le blog communautaire,
et les icônes affichées depuis les services jsDelivr et Simple Icons sont des requêtes HTTPS
ordinaires : l'hôte voit votre adresse IP.

### 6.5 Vidéos YouTube dans la documentation
Des pages de la documentation intégrée peuvent inclure des vidéos YouTube, chargées via l'intégration
`youtube‑nocookie.com` quand vous ouvrez une telle page en ligne. Google/YouTube peut voir votre
adresse IP et stocker des données selon la politique de confidentialité de **Google**.

### 6.6 Lier un compte BetterCommunity
Lier un compte envoie votre **Creator ID** à `bettercommunity.ch` pour demander un code à usage
unique, puis vérifie si le code a été saisi. BMM n'envoie ni mot de passe ni e‑mail dans cet échange.

### 6.7 Notifications BetterCommunity (seulement avec une clé d'API)
Si, et seulement si, vous enregistrez une **clé d'API** BetterCommunity dans Paramètres → Identité &
API, BMM demande les notifications de ce compte à `bettercommunity.ch/v1/notifications` **toutes les
dix minutes** tant qu'il est ouvert.

- **La clé n'entre jamais dans la vue web.** Elle est stockée dans le dossier de données de BMM et
  lue uniquement par le processus natif de BMM, qui fait la requête. L'interface peut en enregistrer
  une, demander s'il en existe une et la supprimer ; elle ne peut pas la relire.
- **Sa portée est limitée** à `notifications:read` : elle permet de lire vos notifications et rien
  d'autre.
- **Elle est stockée en clair sur le disque.** Toute personne qui peut lire votre dossier de données
  peut la lire. Retirez‑la depuis le même écran, et révoquez‑la depuis la page de votre compte sur le
  site.

Pas de clé enregistrée, pas de requête.

### 6.8 L'API Plugin locale
L'API Plugin (voir les Conditions d'utilisation) n'écoute que sur `127.0.0.1`. Ses requêtes et votre
jeton d'API restent sur votre ordinateur ; ils ne sont pas envoyés à l'équipe BMM.

### 6.9 Intégrations que vous configurez
Tout ce que vous configurez vous‑même (webhook Discord, tunnel Cloudflare, …) envoie des données à ce
service, selon ses propres conditions.

---

## 7. Récapitulatif

| Action | Quitte votre PC ? | Ce qui est envoyé | À qui |
|---|---|---|---|
| Parcourir et gérer mods, profils, modpacks | Non | — | — |
| Chaque lancement (liens, contributeurs) | Oui, toujours | Adresse IP, **Creator ID** | bettercommunity.ch (GitHub en secours) |
| Vérification des mises à jour | Oui, par défaut | Adresse IP, user‑agent du programme | GitHub, bettercommunity.ch |
| Tests de connectivité, polices, catalogue d'applications | Oui, toujours | Adresse IP | Google, Cloudflare, GitHub |
| **Télémétrie** (activée si vous avez gardé la case de l'installateur) | Oui | Creator ID, profil système avec IP publique et locale, utilisation, texte des boutons cliqués, adresses des liens externes, journaux, performances, noms de jeux, adresses de dépôts | Serveur de télémétrie BetterCommunity ; votre IP à ipify.org et ipwho.is |
| Replay de session (avec la télémétrie, actif par défaut) | Oui | Enregistrement masqué de la fenêtre de BMM | Serveur de télémétrie BetterCommunity |
| Benchmark hebdomadaire + rapport matériel (avec la télémétrie, actif par défaut) | Oui | Temps du benchmark, numéros de série du matériel, UUID de la machine, adresses MAC | Serveur de télémétrie BetterCommunity |
| **Discord Rich Presence** (activé si vous avez gardé la case de l'installateur) | Oui | Nom du profil, nombre de mods activés, Creator ID | Discord, affiché sur votre profil |
| Se connecter à un Server Repo ou le synchroniser | Oui | Adresse IP, Creator ID | Le propriétaire de ce dépôt |
| Héberger un Server Repo | Oui (entrant) | IP et Creator ID des visiteurs, stockés sur votre PC | Vous |
| Envoyer une suggestion, un bug ou un plantage | Oui, quand vous cliquez sur Envoyer | Ce que vous saisissez, vos pièces jointes (le zip de plantage contient journaux, DxDiag avec votre nom de compte Windows, un instantané de vos réglages), Creator ID, détails de l'application et du système | Centre de retours BetterCommunity |
| Lier un compte BetterCommunity | Oui | Creator ID | bettercommunity.ch |
| Notifications BetterCommunity (seulement avec une clé d'API enregistrée) | Oui, toutes les 10 min | La clé d'API, limitée à `notifications:read` | bettercommunity.ch |

---

## 8. Vos choix et contact

- Décochez la télémétrie, le replay de session et Discord Rich Presence dans l'installateur, ou
  désactivez‑les plus tard dans les Paramètres ; désactivez le benchmark hebdomadaire et le rapport
  matériel dans Paramètres → Confidentialité ; désactivez la vérification automatique des mises à
  jour dans les Paramètres.
- Exportez ou videz le tampon local de télémétrie, demandez l'effacement par paquet, ou demandez une
  copie de vos données (§3.5).
- Les requêtes de démarrage des §2.1 et §2.3 ne peuvent pas être désactivées dans BMM à ce jour ;
  rester hors ligne les empêche.
- Nous ne vendons jamais vos données, et elles ne servent pas à la publicité.

Pour toute autre demande concernant vos données (accès, effacement des enregistrements d'IP et de
localisation, question), ouvrez une issue sur le dépôt GitHub :
[BetterModsManager](https://github.com/FreeProject089/BetterModsManager)

> Cette politique évolue avec l'application. Les changements importants sont signalés dans les notes
> de version.
