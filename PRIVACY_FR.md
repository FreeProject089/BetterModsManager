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
| Requêtes de démarrage vers BetterCommunity (§2.1) | Actif, toujours — **sans votre Creator ID** | Actif, toujours — **sans votre Creator ID** |
| Vérification des mises à jour (§2.2) | Actif | Actif |
| Tests de connectivité et polices web (§2.3) | Actif, toujours | Actif, toujours |
| **Télémétrie** (§3) | Désactivée. La case de l'installateur est **décochée** ; la cocher ne fait que pré‑sélectionner la réponse sur l'écran de consentement de BMM, qui doit encore être accepté | Désactivée jusqu'à votre réponse à l'écran de consentement du premier lancement |
| Replay de session envoyé avec la télémétrie (§3.2) | Désactivé tant que la télémétrie n'est pas acceptée ; actif ensuite, sauf si vous le décochez | Pré‑coché dans la section « Personnaliser » de l'écran de consentement |
| Benchmark hebdomadaire + rapport matériel détaillé (§3.3) | **Désactivé**, et l'installateur pose désormais la question comme une option distincte | **Désactivé** — décoché dans la section « Personnaliser » de l'écran de consentement |
| **Discord Rich Presence** (§4) | **Désactivé** : la case de l'installateur est décochée | Désactivé |
| Rapports de bug, de plantage et retours (§5) | Seulement quand vous cliquez sur Envoyer | Seulement quand vous cliquez sur Envoyer |

Chacun de ces éléments peut être désactivé dans les paramètres de BMM (Paramètres → Confidentialité
pour la télémétrie et ses options, les interrupteurs Discord et mises à jour dans les Paramètres).
Tout ce qui envoie des données hors de ce PC est **opt‑in** : la page Configuration de
BetterInstaller affiche chaque case décochée, avec une description et une marque « Envoie des
données », avant toute installation, et cocher la case de télémétrie y est une pré‑sélection — BMM
pose quand même la question sur son propre écran de consentement, et la collecte ne démarre que si
vous acceptez là.

---

## 2. Ce qui se produit quel que soit votre choix de télémétrie

### 2.1 Configuration au démarrage, avec votre Creator ID
À chaque démarrage, BMM télécharge sa liste de liens (`links.json`) et la liste des contributeurs
depuis `bettercommunity.ch`, avec les copies sur GitHub en secours. **Ces deux téléchargements de
démarrage ne portent plus votre Creator ID.** Ils sont récupérés anonymement — pas d'en‑tête
`X-Creator-ID`, pas de preuve de clé — donc ce que BetterCommunity reçoit au lancement est une
requête web ordinaire pour deux fichiers publics : son serveur voit votre adresse IP, comme tout
serveur web, et rien qui identifie cette installation.

Les autres requêtes que la partie native de BMM envoie à une adresse bettercommunity.ch portent
**bien** votre Creator ID dans un en‑tête `X-Creator-ID` — récupérer un catalogue ou un dépôt, où
l'identifiant est ce qui donne accès au contenu privé, ainsi que les fonctions de retour, de rapport
et de compte que vous déclenchez vous‑même. Elles ont lieu quand vous utilisez la fonction, pas à
chaque lancement.

**Ce qu'est le Creator ID.** C'est la moitié publique d'une paire de clés Ed25519 que BMM crée au
premier lancement. La clé est **dérivée d'identifiants de ce PC** (MachineGuid, identifiant de
produit et date d'installation de Windows ; numéros de série de la carte mère, du BIOS, du processeur
et du disque ; numéro de série du volume C:) par une dérivation à sens unique. Depuis la **clé créateur v5**, elle est conservée, avec le reste du
matériel de clé, dans un magasin chiffré par Windows (DPAPI, lié à votre compte Windows) dans le
dossier de données de BMM et dans votre registre utilisateur ; les anciennes copies non chiffrées sont
supprimées une fois la copie chiffrée vérifiée. Conséquences :

- il ne contient ni nom ni e‑mail, et les identifiants dont il est dérivé ne peuvent pas en être
  extraits ;
- il est **stable** : le même PC obtient le même Creator ID, même après une réinstallation de BMM ;
  tout ce qui est envoyé sous cet identifiant est donc **rattachable à cette machine dans le temps** ;
- il signe ce que vous publiez (dépôts, modpacks, tutoriels) : il est donc aussi visible par toute
  personne qui les reçoit (§6.3).

Le passage à la v5 **ne change pas** votre Creator ID. Il ajoute une seconde clé, aléatoire, qui signe
les preuves que BMM donne à BetterCommunity, et ces preuves peuvent porter une empreinte hachée de
l'appareil (§2.4). Les requêtes de démarrage ci‑dessus ne portent toujours que le Creator ID : ni
preuve ni empreinte.

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

### 2.4 Clé créateur v5 : la preuve et l'empreinte de l'appareil
Quand BMM doit **prouver** son Creator ID à BetterCommunity, il signe une preuve courte et à usage
unique (valable deux minutes, liée à ce site, avec un nombre aléatoire pour qu'elle ne puisse pas
être rejouée). Cela n'arrive que quand vous **envoyez un rapport de bug, de plantage ou un retour**
(§5.1), quand vous **liez un compte BetterCommunity** (§6.6), et **une fois par clé tant que cette
installation est liée à un compte**. Rien n'est envoyé pour une installation non liée qui n'envoie
aucun rapport.

Cette preuve porte une **empreinte de l'appareil** : quatre hachages à sens unique calculés sur votre
PC, à partir

1. des identifiants de la carte mère, du BIOS et du processeur,
2. des identifiants de l'installation Windows (MachineGuid, identifiant de produit, date d'installation),
3. des identifiants du disque,
4. d'un **hachage canvas** : la façon dont votre carte graphique et ses pilotes dessinent une image de
   test fixe dans la fenêtre de BMM.

- **Seuls les hachages sont envoyés.** Aucun numéro de série, GUID ni image ne quitte votre PC.
  Chaque hachage est salé avec l'adresse du site qui le reçoit : les valeurs de BetterCommunity ne
  peuvent pas être recoupées avec celles d'un autre serveur, et chacun est itéré pour rendre coûteuse
  toute tentative de retrouver les valeurs d'origine.
- **L'empreinte canvas est une technique de pistage**, et nous le disons clairement. Elle ne sert
  qu'à la finalité ci‑dessous et change quand vous mettez à jour votre pilote graphique.
- **Finalité :** permettre aux modérateurs de BetterCommunity de voir si un nouveau Creator ID vient
  du même ordinateur qu'un identifiant banni ou ayant déjà utilisé une offre gratuite. Une personne
  examine la correspondance et décide ; aucune règle n'agit automatiquement. Elle ne sert ni aux
  statistiques, ni à la publicité, ni au profilage, et n'est pas partagée.
- **Base légale :** intérêt légitime à empêcher l'abus des offres gratuites et le contournement des
  bannissements (art. 6, par. 1, let. f RGPD ; art. 31 nLPD). Ces hachages identifient un appareil :
  ce sont des données personnelles, et vos droits (accès, effacement, opposition ; §8) s'y appliquent.
- **Conservation :** BetterCommunity supprime chaque hachage **180 jours après sa dernière
  apparition**. L'association entre une clé et un Creator ID est conservée tant que l'identifiant est
  utilisé.

---

## 3. Télémétrie

La télémétrie envoie des données d'utilisation et de diagnostic au **serveur de télémétrie de
BetterCommunity** (`telemetry.bettercommunity.ch`, exploité par l'équipe BMM). Elles sont mises en
tampon sur votre disque (10 Mo au plus), compressées et envoyées en **HTTPS** toutes les 90 secondes
tant que la fenêtre est visible, quand elle est masquée et à la fermeture de BMM. Chaque lot porte
un **identifiant de paquet** aléatoire pour que vous puissiez le faire effacer (§3.5).

**Par défaut : désactivée.** La télémétrie est **opt‑in**, et elle se demande dans BMM, pas dans
l'installateur :

- **Si vous installez avec BetterInstaller**, sa case de télémétrie est **décochée**. La laisser
  telle quelle signifie que rien n'est jamais collecté et que BMM ne repose pas la question.
  **La cocher n'est pas un consentement** — cela ne fait que **pré‑sélectionner la réponse** sur
  l'écran de consentement du premier lancement de BMM, qui énumère ce qui est collecté ; rien n'est
  collecté si vous n'acceptez pas là. (La *décocher* explicitement est enregistré comme un refus,
  et l'écran de consentement ne vous repose alors pas la question.)
- **Si vous installez sans l'installateur**, la télémétrie est désactivée jusqu'à votre réponse à ce
  même écran.

Paramètres → Confidentialité la désactive à tout moment ; désactivée, rien du §3 n'est collecté ni
envoyé.

Un lien `bmm://telemetry/…` (que n'importe quelle page web peut ouvrir) ne peut pas modifier ces
réglages à lui seul : il ouvre l'écran de consentement de BMM, ou une confirmation s'il ne fait que
désactiver quelque chose, et rien ne change si vous n'acceptez pas à cet endroit.

### 3.1 Ce qui est envoyé
- **Identité :** votre Creator ID (§2.1) et un identifiant aléatoire propre à l'installation.
- **Profil système :** système d'exploitation et version, processeur et nombre de cœurs, mémoire,
  chaque carte graphique, carte mère, modèle et fabricant de la machine, exécution ou non dans une
  machine virtuelle, vos disques (taille, et emplacement de montage), vos écrans (fabricant, modèle,
  année) et leurs résolutions, votre **adresse IP sur le réseau local** et votre **adresse IP
  publique** (que BMM obtient en interrogeant `api.ipify.org`), la version et la langue d'interface
  de BMM, et pour chacun de vos profils le **nom du jeu**, son nombre de mods et la répartition de
  ses dossiers sur les disques. (Ce que le serveur *conserve* de ces deux adresses est moindre que
  ce que BMM envoie : l'adresse locale est supprimée à l'arrivée et l'adresse publique est tronquée
  à son réseau avant d'être stockée — voir §3.5.)
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

- **Par défaut :** actif **tant que la télémétrie l'est** — et la télémétrie est désactivée si vous
  ne l'avez pas acceptée (§3), donc cette case seule n'envoie rien. Dans BetterInstaller, c'est la
  case « Replay de session dans la télémétrie », pré‑cochée ; dans BMM, c'est une option de
  Paramètres → Confidentialité et de la section « Personnaliser » de l'écran de consentement.
- Un mode distinct **« complet (non masqué) »** existe pour votre propre débogage. Il reste
  désactivé sauf si vous l'activez ; activé, le texte saisi n'est pas masqué et les images locales
  affichées dans la fenêtre sont intégrées à l'enregistrement. Il ne s'active qu'à la main, dans
  Paramètres → Confidentialité (ou l'écran de consentement que vous ouvrez vous‑même), jamais par un
  lien `bmm://`.

### 3.3 Benchmark hebdomadaire et rapport matériel détaillé
**Désactivé par défaut, et posé comme une question distincte.** Quand vous l'activez *et* que la
télémétrie est activée, BMM lance un court benchmark interne une fois par semaine (et
lors de la première activation de la télémétrie) et en envoie les temps. Avec lui, BMM envoie un **rapport matériel
détaillé** composé d'**identifiants matériels stables** : modèle et numéro de série de la carte mère,
version, date et fabricant du BIOS, UUID de la machine, détails du cache et des threads du
processeur, modèle, numéro de série, taille et interface de chaque disque, **adresse MAC de chaque
carte réseau physique**, build du système, démarrage UEFI ou legacy, état de Secure Boot et du TPM.

- **Par défaut : désactivé**, partout et à part. BetterInstaller pose désormais la question comme
  une case distincte « Rapport matériel hebdomadaire et benchmark », décochée ; dans BMM, c'est
  l'interrupteur « Benchmark automatique (tous les 7 jours) + rapport matériel supplémentaire » de
  Paramètres → Confidentialité et de la section « Personnaliser » de l'écran de consentement,
  décoché lui aussi. **Accepter la télémétrie ne l'active pas** — les identifiants matériels
  ci‑dessus ne sont collectés que si vous cochez cette case vous‑même.

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
- **Votre adresse IP et votre localisation — tronquées, jamais stockées entières :** le serveur voit
  l'adresse d'où vient un lot, et BMM signale aussi sa propre adresse publique (§3.1). **Aucune des
  deux n'est écrite en entier.** Avant tout stockage, une adresse est réduite au réseau auquel elle
  appartient : les trois premiers nombres pour IPv4 (`203.0.113.45` → `203.0.113.0`) et les trois
  premiers groupes pour IPv6. C'est cela qui entre dans la base de données, dans la recherche de
  localisation, dans la liste des instances en ligne et dans le journal d'activité des
  administrateurs. L'adresse exacte n'existe que dans la mémoire du serveur, le temps d'une requête,
  comme clé du compteur anti‑inondation ; elle n'est jamais stockée, journalisée ni exportée.
  **L'adresse du réseau local que BMM signalait sur lui‑même n'est plus stockée du tout** — elle est
  supprimée à l'arrivée.
- **Localisation :** l'adresse tronquée est localisée au moyen du service tiers **ipwho.is**, et le
  pays, la région et la ville sont stockés. Les coordonnées sont **arrondies à un dixième de degré
  (environ 11 km)** avant d'être stockées : ce qui est conservé est une ville, pas un lieu. La
  géolocalisation par IP situe le réseau par lequel vous vous connectez, pas votre domicile.
- **Conservation :** tout est supprimé automatiquement après la durée de conservation, **180 jours**
  sauf autre valeur choisie par l'administrateur : les événements d'utilisation, les benchmarks et
  les replays de session, **ainsi que les réseaux stockés, leurs localisations et la liste des
  « instances en ligne »** — ces trois‑là étaient auparavant conservés indéfiniment et sont
  désormais purgés dans la même passe.
- **Effacement par paquet :** le panneau Confidentialité liste chaque paquet envoyé par BMM
  (identifiant, heure, types d'événements et leur nombre). « Demander la suppression » efface les
  événements, benchmarks et replays de ce paquet après un délai d'examen de 72 heures au plus, ou
  immédiatement si un administrateur l'approuve ; une demande refusée peut être refaite. Si ce
  paquet était la dernière donnée détenue sur votre installation, l'effacement **retire aussi le
  réseau stocké, sa localisation et l'entrée « en ligne »** correspondante.
- **Effacement par personne :** une demande de suppression liée à votre Creator ID retire vos
  événements, benchmarks et replays et, dans la même passe, le réseau, l'entrée « en ligne » et la
  localisation en cache (cette dernière seulement quand plus aucune autre installation n'est vue sur
  ce même réseau).
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

**Par défaut : désactivé**, dans BMM comme dans BetterInstaller, dont la case est désormais
**décochée** — installer avec lui ne change rien ici si vous ne la cochez pas vous‑même.
Activez‑le ou désactivez‑le dans les Paramètres. Un lien `bmm://discord/rpc` (que n'importe
quelle page web peut ouvrir) ne fait que demander : BMM indique ce qui deviendra visible, et rien ne
change sans votre confirmation dans BMM.

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
- votre **Creator ID** (avec une preuve signée, qui porte l'empreinte hachée de l'appareil du §2.4),
  la version de l'application, le système, la langue et le user‑agent ;
- l'e‑mail ou le pseudo Discord que vous saisissez, le cas échéant, pour qu'on puisse vous
  répondre. Avec un compte BetterCommunity lié, le rapport ouvre plutôt un fil dans votre tableau
  de bord.

Une petite preuve de travail anti‑spam s'exécute avant l'envoi ; elle n'envoie aucune donnée
supplémentaire. Si le site est injoignable, le rapport est gardé localement et renvoyé 15 secondes
après le lancement suivant, et nulle part ailleurs. BMM garde une liste locale de vos 50 derniers
envois. Une fois reçu, un rapport est conservé selon les conditions de la plateforme BetterCommunity.

### 5.2 Contenu d'un zip de rapport de plantage
Quand BMM plante, il écrit un `.zip` de rapport **sur votre disque**. Il contient les journaux de
BMM, un instantané des informations système, et l'enregistrement de session masqué du §5.3 avec la
sortie de la console et du journal ; un rapport écrit à la fermeture normale de BMM contient aussi un
**instantané du fichier de données de BMM** (vos profils et réglages, y compris les adresses de vos
mods et dépôts et vos chemins de dossiers, qui peuvent contenir votre nom d'utilisateur Windows).
**Les secrets sont masqués avant l'écriture du zip** : le jeton d'accès GitHub, le jeton de l'API
locale, les jetons des plugins, la clé du planificateur, et toute autre valeur rangée sous un champ
token, password, key, secret, auth, cookie ou webhook, ainsi que les mots de passe contenus dans des
adresses, apparaissent sous la forme `[REDACTED: N chars]` (la longueur seulement, aucune partie de
la valeur). Les rapports écrits par des versions antérieures sont nettoyés de la même façon au
prochain démarrage de BMM. Un zip de plantage **ne contient pas de DxDiag** : celui‑ci n'est joint à
un rapport que si vous cochez sa case (§5.1). Ces fichiers restent sur votre ordinateur tant que vous
n'en envoyez ou n'en partagez pas un vous‑même ; ouvrez le zip au préalable pour voir exactement ce
qu'il contient.

### 5.3 Enregistrement local de la session
BMM garde toujours un enregistrement de la session en cours (masqué comme au §3.2) **sur votre
disque** : des segments de travail dans son dossier de données, et la dernière session enregistrée
sous `last_crash_session.bmmreplay` environ toutes les 45 secondes, pour qu'un rapport de plantage
montre ce qui s'est passé juste avant. Le journal de BMM et la sortie de la console enregistrés avec
lui ne sont pas masqués. Activer l'**Enregistreur de session** (Paramètres → Débogage & dépannage)
conserve en plus chaque session dans une liste de replays locale. **Rien de tout cela n'est envoyé**,
sauf si vous envoyez un rapport de plantage qui le contient (§5.1), ou si le replay de la télémétrie
(§3.2) est actif, qui est un enregistrement distinct. Un lien `bmm://recorder/set` demande dans BMM
avant de modifier l'enregistreur, et ne peut jamais le passer en mode non masqué.

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
Lier un compte envoie votre **Creator ID** à `bettercommunity.ch`, avec une preuve signée et
l'empreinte hachée de l'appareil (§2.4), pour demander un code à usage unique, puis vérifie si le code
a été saisi. Tant que l'installation reste liée, BMM envoie une preuve de plus à chaque changement de
clé, pour que le site sache quelle clé parle pour votre Creator ID. BMM n'envoie ni mot de passe ni
e‑mail dans cet échange.

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
| Chaque lancement (liens, contributeurs) | Oui, toujours | Adresse IP seulement — **pas de Creator ID** (§2.1) | bettercommunity.ch (GitHub en secours) |
| Vérification des mises à jour | Oui, par défaut | Adresse IP, user‑agent du programme | GitHub, bettercommunity.ch |
| Tests de connectivité, polices, catalogue d'applications | Oui, toujours | Adresse IP | Google, Cloudflare, GitHub |
| **Télémétrie** (**désactivée** sauf si vous l'acceptez dans BMM) | Oui | Creator ID, profil système avec IP publique et locale, utilisation, texte des boutons cliqués, adresses des liens externes, journaux, performances, noms de jeux, adresses de dépôts — le serveur ne conserve l'adresse publique que tronquée à son réseau et supprime l'adresse locale | Serveur de télémétrie BetterCommunity ; votre IP à ipify.org, votre réseau tronqué à ipwho.is |
| Replay de session (avec la télémétrie, actif sauf si décoché) | Oui | Enregistrement masqué de la fenêtre de BMM | Serveur de télémétrie BetterCommunity |
| Benchmark hebdomadaire + rapport matériel (**désactivé**, question à part) | Oui | Temps du benchmark, numéros de série du matériel, UUID de la machine, adresses MAC | Serveur de télémétrie BetterCommunity |
| **Discord Rich Presence** (**désactivé** par défaut, dans BMM comme dans l'installateur) | Oui | Nom du profil, nombre de mods activés, Creator ID | Discord, affiché sur votre profil |
| Se connecter à un Server Repo ou le synchroniser | Oui | Adresse IP, Creator ID | Le propriétaire de ce dépôt |
| Héberger un Server Repo | Oui (entrant) | IP et Creator ID des visiteurs, stockés sur votre PC | Vous |
| Envoyer une suggestion, un bug ou un plantage | Oui, quand vous cliquez sur Envoyer | Ce que vous saisissez, vos pièces jointes (le zip de plantage contient les journaux et, pour un rapport de fermeture normale, un instantané de vos réglages, jetons et mots de passe masqués ; le DxDiag, avec votre nom de compte Windows, seulement si vous le cochez), Creator ID avec preuve signée et empreinte hachée de l'appareil (§2.4), détails de l'application et du système | Centre de retours BetterCommunity |
| Lier un compte BetterCommunity (et une fois par clé tant qu'il est lié) | Oui | Creator ID, preuve signée, empreinte hachée de l'appareil (§2.4) | bettercommunity.ch |
| Notifications BetterCommunity (seulement avec une clé d'API enregistrée) | Oui, toutes les 10 min | La clé d'API, limitée à `notifications:read` | bettercommunity.ch |

---

## 8. Vos choix et contact

- La télémétrie, le rapport matériel hebdomadaire et Discord Rich Presence sont **désactivés sauf si
  vous les activez** : les cases de l'installateur sont décochées, et cocher celle de la télémétrie
  ne fait que pré‑sélectionner la réponse sur l'écran de consentement de BMM. Décochez le replay de
  session dans l'installateur ou dans Paramètres → Confidentialité ; activez ou désactivez chacun
  plus tard dans les Paramètres ; désactivez la vérification automatique des mises à jour dans les
  Paramètres.
- Exportez ou videz le tampon local de télémétrie, demandez l'effacement par paquet, ou demandez une
  copie de vos données (§3.5).
- Les requêtes de démarrage des §2.1 et §2.3 ne peuvent pas être désactivées dans BMM à ce jour ;
  rester hors ligne les empêche.
- Nous ne vendons jamais vos données, et elles ne servent pas à la publicité.

Pour toute autre demande concernant vos données (accès, effacement, question), ouvrez une issue sur
le dépôt GitHub :
[BetterModsManager](https://github.com/FreeProject089/BetterModsManager)

> Cette politique évolue avec l'application. Les changements importants sont signalés dans les notes
> de version.
