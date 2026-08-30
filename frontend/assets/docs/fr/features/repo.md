# Dépôt Serveur


Un **Dépôt Serveur** est une collection de mods partagée et versionnée. Deux flux le
traversent : tu **synchronises** des mods *depuis* un dépôt vers un profil, et BMM s'en sert
pour te prévenir quand ces mods ont une **mise à jour**. Tu peux aussi en **héberger** un
toi-même. Sans dépôt, un mod installé à la main reste à la version installée, indéfiniment, en
silence.

> Parcourir les dépôts serveur — dépôts officiels et partenaires.

![L'écran Dépôt Serveur](assets/docs/media/screens/repo.annotated.png)

| | | |
|---|---|---|
| **1** | **Liste des dépôts** | Les sources que tu as ajoutées. |
| **2** | **Parcourir** | Dépôts officiels et partenaires. |
| **3** | **Ajouter** | Pointe BMM vers l'URL d'un dépôt. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/repo.bmmreplay" data-page="features/repo" data-title="Se connecter à un dépôt et synchroniser"></div>


## Se connecter à un dépôt

Parcours la liste officielle et partenaire, ou colle une URL de dépôt directement. Une fois
connecté, les mods du dépôt apparaissent dans ta [Bibliothèque](doc-page:features/library) à côté des tiens,
marqués du nom du dépôt.

## Synchroniser les mods d'un dépôt

Un dépôt protégé demande son **mot de passe de téléchargement** une fois — et si tu sais
déjà que le dépôt est protégé, ouvre la ligne *« Ce dépôt a un mot de passe de
téléchargement »* sous le champ URL et tape-le avant Fetch, au lieu de récupérer, échouer,
puis taper. Un serveur **sans `repo.json`** fonctionne aussi : Fetch lit son index de
dossiers à la place, et chaque mod trouvé s'installe marqué *non vérifié*, la carte le
disant en toutes lettres.

La synchro tire les mods du dépôt sur ta machine et dans un profil. BMM fait une
**synchro delta** : il compare ce que le dépôt a avec ce que tu as déjà et ne télécharge **que
les fichiers modifiés** — mettre à jour un dépôt de 5 Go après un petit patch coûte quelques
mégaoctets, pas cinq gigas. Une longue synchro peut être **annulée** en cours de route, et tu
peux plafonner sa vitesse de téléchargement pour ne pas saturer ta connexion.

## Détection de mises à jour

Une fois un mod lié à un dépôt, *Vérifier les mises à jour de mods* compare ta version
installée à la version courante du dépôt et propose la mise à jour quand elles diffèrent. Lier
est une étape distincte de se connecter :

> Lie ce mod à un ou plusieurs dépôts pour que BMM détecte ses mises à jour.

Un mod peut viser plusieurs dépôts. C'est voulu : si une source disparaît, le mod reste suivi
par l'autre. Il existe aussi un réglage de **dépôts de mise à jour globaux** dans les
[Paramètres](doc-page:features/settings) — mettez-y un dépôt et il s'ajoute à la vérification de chaque mod
qui porte **déjà** un identifiant de mod de dépôt.

!!! warning "Un dépôt global n'atteint que les mods déjà reliés"

    L'application énonce la règle : un dépôt global est apparié *par le `repo_mod_id` du mod*.
    Un mod que vous avez ajouté à la main depuis un `.zip` n'en a pas, donc aucun dépôt global
    ne le trouvera — reliez ce mod à un dépôt une fois, et les globaux s'appliquent ensuite.

### Un téléchargement direct n'a pas de version

À comprendre, parce que ça ressemble à un bug sans en être un :

> Aucune mise à jour détectée. Un téléchargement direct n'a pas de version, BMM ne peut donc
> pas savoir s'il est plus récent.

L'URL d'un fichier brut ne porte aucun numéro de version : BMM n'a rien à comparer. Il propose
un **retéléchargement direct** plutôt que de faire semblant de savoir. Pour une vraie détection
de mises à jour, lie le mod à un dépôt qui publie des versions.

## Héberger ton propre dépôt

Tu peux transformer tes propres mods en un dépôt d'où d'autres synchronisent. L'onglet Host
est séparé en deux : **produire le `repo.json`**, puis **servir les fichiers**.

### Trois façons de produire le manifeste

Ce sont des alternatives — choisis celle qui correspond à l'endroit où tes mods se trouvent
déjà.

| Voie | Ce qu'elle fait | Quand l'utiliser |
|---|---|---|
| **Export complet** | Copie chaque mod dans un dossier de sortie, à côté du manifeste. | Tu pars de zéro ; les mods sont sur cette machine. |
| **Manifeste seul** | Écrit seulement `repo.json` pour des dossiers que BMM peut lire ici — un, plusieurs, ou un ensemble de profils. **Rien n'est copié.** | Les mods sont déjà là où tu les veux. |
| **Mettre à jour depuis le serveur** | Lit ce que contient ton serveur — en HTTP, ou en SFTP sur une machine SSH — et écrit le manifeste sans rapatrier le dépôt. | Les mods n'existent que sur le serveur. |

Quelle que soit la voie, le manifeste liste chaque mod, sa version, les hachages SHA-256 par
fichier (plus des hachages de blocs de 4 Mo sur les gros fichiers) et le changelog éventuel,
et il est **signé avec ta clé de créateur** — pour que quiconque le synchronise confirme qu'il
vient de toi et n'a pas été altéré. Chaque génération resigne, y compris les mises à jour.

**Ton serveur n'a pas à bouger.** Le manifeste porte un gabarit de disposition — `{id}` et
`{path}`, par défaut `mods/{id}/{path}` — donc des fichiers déjà servis sous, par exemple,
`addons/<mod>/` sont décrits plutôt que déplacés. En *Manifeste seul*, la disposition est
déduite de la position du manifeste par rapport au dossier, si bien que `repo.json` et le
dossier restent portables ensemble.

**Plusieurs dossiers, un seul dépôt.** *Manifeste seul* prend une liste : ajoute autant de
dossiers de mods que tu veux, ou passe en *Depuis des profils* et coche-en plusieurs — des
profils rangés dans des dossiers de mods différents n'ont plus à devenir des dépôts séparés.
L'id d'un mod est son nom de dossier : deux dossiers contenant un dossier du même nom
décriraient deux choses différentes sous une seule id — la paire est signalée et rien n'est
écrit, plutôt que fusionnée en un dépôt où la moitié des fichiers répondent 404. Avec plus
d'un dossier la disposition n'est plus déduite (il n'y a pas de répertoire unique d'où la
déduire) — `mods/{id}/{path}` par défaut s'applique, et le rapport dit ce que chaque dossier
a apporté, y compris ceux qui n'ont rien apporté.

### Mettre à jour

Relance la même génération. Le dépôt garde son identité — même seed, même id — donc les
abonnés voient une mise à jour et non un dépôt inconnu, et on te dit ce qui a été **ajouté**,
**modifié** et **retiré**. Ce dernier compte : un chemin mal tapé écrit un manifeste
parfaitement valide décrivant un serveur vide.

Il n'y a aucun numéro de version à incrémenter ; les changements sont détectés par hachage.

*Mettre à jour depuis le serveur* va plus loin : elle compare les tailles et dates du listing
à ton dernier manifeste et ne télécharge que ce qui a réellement changé, réutilisant le
hachage enregistré pour le reste. Elle sépare **ce qui manque au manifeste** de ce qui a
simplement changé — un dépôt incomplet et un dépôt périmé sont deux problèmes différents.
Elle écrit `repo.json` en local ; tu envoies ce seul fichier avec le client dont tu te sers
déjà, donc BMM n'a jamais besoin d'un accès en écriture à ton serveur.

Tu n'as pas besoin d'un manifeste local pour commencer. Donne-lui une URL de base et, si le
serveur publie déjà un `repo.json`, BMM va le chercher comme point de départ à la place de ta
dernière copie — un dépôt que tu héberges mais dont tu n'as plus le manifeste sur cette
machine reste donc mettable à jour, et une machine qui n'a jamais vu le dépôt peut en produire
un correct. Sans chemin local, le résultat est écrit dans `RemoteRepos/` plutôt qu'à côté de
fichiers que tu n'as pas choisis.

!!! note "En HTTP, il faut l'index de répertoire"
    Lire un serveur HTTP, c'est lire son propre index : `autoindex on` (nginx) ou l'équivalent
    doit être activé. Sans lui, BMM ne peut pas voir ce que le serveur contient.

    **En SSH, non.** SFTP liste les dossiers lui-même, et c'est tout l'intérêt de la route
    ci-dessous : une machine que tu atteins en SSH ne publie généralement aucun index, et c'est
    exactement le cas où les mods n'existent nulle part ailleurs.

### Lire une machine SSH à la place

Ouvre **Ce dépôt est sur une machine SSH** sur le même écran et choisis un des serveurs que tu
as configurés dans *Serveurs SSH*. L'hôte, le port, le compte et le dossier viennent de là :
les redemander serait une seconde copie des mêmes informations, libre de diverger, et une
empreinte de confiance connue d'un côté et inconnue de l'autre.

Deux champs te reviennent, parce que ce sont les deux choses que BMM n'enregistre jamais :

| Champ | Remarques |
|---|---|
| **Mot de passe du compte** | Le remplir signifie « authentifier cette exécution par mot de passe », et cela l'emporte sur la clé. |
| **Clé privée** | Facultatif. Vide = la clé déjà enregistrée sur le serveur choisi ; remplis-le — ou prends une clé du trousseau d'identité — pour utiliser une autre clé le temps d'une exécution, sans modifier le serveur. |
| **Phrase secrète** | Pour la clé, si elle en a une. |

Le même bloc figure dans **Mettre à jour le Server Repo**, où il fait une chose de plus : un
serveur qui s'authentifie par *mot de passe* n'y était pas utilisable du tout auparavant. Les
raccourcis vers les cibles enregistrées le refusent volontairement — rien du mot de passe n'est
écrit quelque part, donc une tâche planifiée n'a personne à qui le demander. Devant une boîte
de dialogue, il y a quelqu'un à qui le demander.

**Héberger.** Sers le dépôt généré via le serveur HTTP intégré de BMM pour que d'autres y
accèdent. Des options facultatives le rendent public sans gymnastique de port-forwarding :

| Option | Rôle |
|---|---|
| **Tunnel Cloudflare** | Expose ton serveur local à une URL publique sans config routeur. |
| **UPnP** | Ouvre le port sur ton routeur automatiquement, pour une connexion directe. |
| **Limite d'upload** | Plafonne la vitesse sortante pour que l'hébergement n'affame pas ta connexion. |
| **Mot de passe de téléchargement** | Optionnel. Les abonnés doivent le saisir à la première connexion (envoyé en `X-Repo-Password`) ; vide = dépôt ouvert. Distinct du mot de passe admin. |

Les propriétaires disposent aussi d'un **contrôle d'accès** — listes d'autorisation et bans
par IP, par clé de créateur, ou par **compte BetterCommunity** — pour qu'un dépôt privé reste
privé.

Les entrées par compte sont à préférer. `X-Creator-ID` est fourni par l'appelant : un ban
dessus se contourne en retirant l'en-tête, et une liste d'autorisation se franchit en
réclamant un id qui y figure. Une entrée par compte est vérifiée contre une attestation
courte signée par BetterCommunity et validée hors ligne, et elle correspond à **tous** les
identifiants de ce compte — son bcid, ses clés de créateur et ses comptes Discord liés — donc
bannir le compte suit la personne plutôt qu'un seul de ses pseudonymes. Ces entrées ne
s'appliquent que si le dépôt exige un compte, seul cas où une identité signée existe.

## Panneau d'admin & monitoring

L'hébergement s'accompagne de deux outils côté hôte, tous deux sur l'écran Dépôt Serveur :

**Monitoring** — un tableau en direct rafraîchi chaque seconde : IP de chaque client connecté,
creator ID, protocole (**Local / LAN / WAN**), fichier en cours avec progression et vitesse,
plus les sessions inactives et les totaux (clients, vitesse cumulée, fichiers actifs). Depuis
chaque ligne, tu peux **autoriser** (liste blanche) ou **bannir** ce client en un clic. Il
agrège aussi le `monitoring.json` d'un serveur autonome en cours — les deux serveurs au même
endroit.

**Liste blanche & bans** — deux gestionnaires avec recherche, ajout manuel (par IP et/ou clé
créateur), retrait en un clic et export JSON. La liste blanche a un interrupteur on/off :
off = tout le monde peut télécharger (moins les bannis) ; on = seules les identités listées
passent.

Le serveur autonome généré expose les endpoints correspondants :

| Endpoint | Accès |
|---|---|
| `/dashboard`, `/monitoring.json` | Public, état en lecture seule. |
| `/admin/data`, `/admin/update`, `/admin/logs` | Mot de passe admin (header Authorization, comparaison en temps constant). |

```mermaid
graph LR
    subgraph Host["Hôte (BMM)"]
        MON["Tableau de monitoring (rafraîchi 1 s)"]
        WL["Gestionnaires liste blanche / bans"]
    end
    subgraph Server["Serveur généré"]
        MJSON["/monitoring.json"]
        ADMIN["/admin/* (mot de passe)"]
        GATE["Porte d'accès : bans → login → liste blanche → mot de passe de téléchargement"]
    end
    MJSON --> MON
    WL -- "pousse la config" --> ADMIN
    CLIENT["Abonné"] --> GATE
```

### Publier une nouvelle version

Quand tu mets à jour tes mods, utilise **Mettre à jour un dépôt existant** : un flux
incrémental qui monte les versions et te laisse écrire un changelog par mod (montré aux
utilisateurs quand la mise à jour est détectée). Il ne réécrit que ce qui a changé, en miroir
de la synchro delta côté téléchargement. Le pas-à-pas côté auteur vit dans le guide développeur
*Rendre ton mod actualisable*.

## Mettre le dossier sur le serveur (SSH/SFTP)

L'export ecrit un dossier. Le poser sur la machine qui le sert, c'est un panneau — et c'est le
meme partout ou cette phrase a un sens : aucun logiciel de transfert entre les deux, et aucun
ecran a visiter d'abord.

Il y a deux moities, et elles ne formaient qu'une carte auparavant :

- **Serveurs SSH** — les machines qui sont a toi. Configurees une fois, depuis n'importe ou :
  le bouton est sur chaque panneau qui publie, et il s'ouvre par-dessus ce que tu regardais.
- **Le panneau de publication** — choisis un de ces serveurs, dis ou ca atterrit, tape la
  phrase de passe, envoie.

Cette separation est le fond du sujet. Un serveur n'est pas une propriete d'un export : c'est
une machine, et on s'en sert depuis l'ecran des depots, celui du manifeste et depuis un
catalogue. Le configurer a l'interieur de « Generer un depot » voulait dire que publier un
catalogue commencait par une page qui parlait d'autre chose.

### Ou apparait le panneau

Partout ou « publier ceci » ou « recuperer ceci » est vrai :

| Ecran | Ce qu'il envoie sans qu'on le lui dise | Sens |
|---|---|---|
| **Generer un depot** | le dossier exporte | publier · recuperer |
| **Mettre a jour un depot** | le dossier en cours d'edition | publier · recuperer |
| **Manifeste seul** | le `repo.json` qu'il vient d'ecrire — le fichier, pas le dossier autour | publier |
| **Un catalogue en cours** | le fichier que tu as enregistre | publier |

Chaque carte sait deja ce qu'elle a : rien a retaper. La ou elle ne peut pas savoir — un
catalogue enregistre via une boite de dialogue systeme — le panneau demande, au lieu de deviner.

### Ce que le panneau demande

| | |
|---|---|
| **Serveur** | Un de tes serveurs enregistres. La liste se met a jour pendant que la carte est ouverte : un serveur ajoute depuis ce panneau apparait sans aller nulle part. |
| **Destination** | Le dossier de base du serveur, prerempli. Le changer ici ne vaut **que pour ce transfert** : une publication ponctuelle dans un sous-dossier ne doit pas deplacer en silence l'endroit ou toutes les autres cartes publient. **Parcourir…** ouvre les dossiers du serveur. |
| **Phrase de passe ou mot de passe** | Lue au moment de s'en servir, stockee nulle part. Une cle sans phrase de passe laisse le champ vide. |

Publier demande confirmation et **nomme le serveur**. Ca ecrase ce que des gens sont en train
de telecharger, et avec plusieurs serveurs configures, *lequel* est la question qui merite une
reponse.

### Ce que tu renseignes

| Champ | Remarques |
|---|---|
| **Hôte, port, utilisateur** | Les trois mêmes choses que demande n'importe quel client SSH. Le port vaut 22 par défaut. |
| **Clé ou mot de passe** | Deux boutons en haut. Le mot de passe est ce que la plupart des comptes ont déjà ; la clé est ce qu'exige un serveur configuré avec `PasswordAuthentication no`. |
| **Clé privée** | OpenSSH ou PuTTY `.ppk`, les deux lues telles quelles — aucune conversion. |
| **Clé d'identité** | Le sélecteur sous le champ du chemin liste les clés de *Paramètres → Identité & API*. Une entrée du trousseau est un nom et un chemin, exactement ce dont SFTP a besoin : la clé sous laquelle un catalogue te connaît peut aussi ouvrir une session. En choisir une **remplit** le champ du chemin plutôt que d'en changer le sens, et l'inverse n'est volontairement pas câblé : configurer un serveur ne doit pas modifier en douce l'identité que BMM présente aux catalogues. |
| **Dossier distant** | Un chemin absolu. **Parcourir…** ouvre les dossiers du serveur pour le choisir au lieu de le saisir. |

**Tester la connexion** fait tout ce que fait un envoi, sauf envoyer : elle s'authentifie, ouvre
le dossier, puis y écrit et efface un fichier témoin. « Le dossier existe » et « j'ai le droit
d'y écrire » sont deux questions différentes, et seule la seconde compte — la version envoi de
cet échec arrive après avoir tout transféré.

Quand le témoin est refusé, le rapport dit **pourquoi** et pas seulement qu'il l'a été : le
propriétaire et le mode du dossier distant, et le compte utilisé par BMM. C'est presque
toujours toute l'explication, et elle est invisible depuis ton côté de la connexion :

```text
/srv appartient à l'uid 0:0 avec le mode rwxr-xr-x, et BMM s'est connecté en tant que « bob ».
Sur le serveur : sudo chown bob /srv — ou publie dans un sous-dossier qui t'appartient, par ex. /srv/bmm.
```

`/srv`, `/var/www` et `/opt` appartiennent à root en mode 755 sur la plupart des distributions :
**tout le monde peut les lister, seul root peut y créer un fichier.** Ni ton compte ni ta clé
n'ont de problème — c'est bien pour ça que « permission denied » tout seul envoie les gens
vérifier la seule chose qui n'a jamais été en cause.

### Quelles clés SSH fonctionnent

Vérifié en décodant un exemplaire de chaque avec la bibliothèque que BMM utilise réellement,
pas de mémoire.

| Type de clé | Acceptée |
|---|---|
| **ed25519** | Oui — le défaut moderne, et celui à préférer |
| **RSA** (3072, 4096) | Oui |
| **ECDSA** nistp256 / nistp384 / nistp521 | Oui |
| **DSA** | Non — OpenSSH l'a retiré ; `ssh-keygen -t dsa` refuse d'en générer |

Le **conteneur** compte autant que l'algorithme. Tous ceux-ci sont lus tels quels :

| En-tête du fichier | Ce qui l'a produit |
|---|---|
| `-----BEGIN OPENSSH PRIVATE KEY-----` | `ssh-keygen` aujourd'hui |
| `PuTTY-User-Key-File-…` | PuTTY / WinSCP (`.ppk`) — aucune conversion nécessaire |
| `-----BEGIN RSA PRIVATE KEY-----` | `ssh-keygen -m PEM` (PKCS#1) |
| `-----BEGIN PRIVATE KEY-----`, `-----BEGIN EC PRIVATE KEY-----` | PKCS#8 |
| `-----BEGIN ENCRYPTED PRIVATE KEY-----` | PKCS#8 protégé par phrase secrète |

Une clé protégée par phrase secrète fonctionne : saisis-la dans le champ voisin. Elle sert à
cette connexion et n'est jamais conservée — c'est pourquoi une exécution sans surveillance
(tâche planifiée, lien profond) exige une clé **sans** phrase secrète.

!!! warning "RSA exige un serveur moderne, et BMM le lui demande"
    L'ancienne signature `ssh-rsa` est en SHA-1, refusée par défaut depuis OpenSSH 8.8. BMM
    négocie `rsa-sha2-512` / `rsa-sha2-256` avec le serveur. Si le tien est antérieur à 8.8 et
    n'offre rien d'autre, utilise une clé ed25519.

#### La moitié publique va sur le serveur

BMM ne lit jamais que la clé PRIVÉE. La PUBLIQUE doit se trouver dans
`~/.ssh/authorized_keys` sur le serveur, et au **format OpenSSH sur une seule ligne** :

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA… toi@machine
```

Le bouton *Save public key* de PuTTY écrit autre chose — le bloc RFC4716 :

```
---- BEGIN SSH2 PUBLIC KEY ----
Comment: "256-bit ED25519…"
AAAAC3NzaC1lZDI1NTE5AAAA…
---- END SSH2 PUBLIC KEY ----
```

`authorized_keys` ne sait pas le lire, et le serveur refuse la clé alors que tout a l'air
correct. Convertis-le, ou dérive la moitié publique depuis la clé privée que tu as déjà :

```bash
ssh-keygen -i -m RFC4716 -f exportee.pub    # RFC4716 → OpenSSH
ssh-keygen -y -f ~/.ssh/id_ed25519          # directement depuis la clé privée
```

Dans PuTTYgen, la même chose est la zone *Public key for pasting into OpenSSH
authorized_keys* en haut de la fenêtre — pas le bouton **Save public key**.

### Récupérer depuis le serveur

**Récupérer depuis le serveur**, c'est la même connexion dans l'autre sens : elle copie le
dépôt réellement servi vers ton dossier d'export. Utile pour modifier un dépôt depuis une
deuxième machine, retrouver une copie locale perdue, ou vérifier que ce qui est en ligne est
bien ce que tu crois.

Les fichiers de même nom sont écrasés par la version du serveur ; ceux que le serveur n'a pas
sont laissés en place. Les supprimer permettrait à une récupération pointée sur le mauvais
dossier d'y détruire autre chose.

### Ce qui est enregistré, et ce qui ne l'est pas

Hôte, port, utilisateur, dossier distant, la méthode choisie et le **chemin** de ta clé sont
conservés. La clé elle-même ne l'est jamais, ni la phrase secrète, ni le mot de passe. Une clé
copiée dans la configuration de BMM serait une clé dans chaque sauvegarde, chaque export et
chaque rapport de plantage qui joint les réglages.

L'empreinte du serveur est enregistrée à la première connexion et doit correspondre à toutes
les suivantes. Une empreinte **qui change** est refusée, pas signalée : le cas contre lequel
elle protège est précisément celui où l'on clique sur l'avertissement sans le lire.

### Ordre du transfert

Les fichiers partent d'abord et `repo.json` **en dernier**, exprès. Les abonnés lisent le
manifeste puis récupèrent ce qu'il liste : l'envoyer en premier donnerait à tous ceux qui
synchronisent pendant l'envoi un manifeste promettant des fichiers qui n'existent pas encore.

### Synchroniser DEPUIS un dépôt SSH

L'autre versant de la même connexion : installer des mods depuis un dépôt qui vit sur un
serveur SSH plutôt que derrière une URL HTTP.

Saisis **`ssh://`** dans le champ URL de la synchronisation. Cette valeur ne porte ni hôte,
ni utilisateur, ni clé — tout ce qui concerne la connexion vient de la cible configurée
ci-dessus. Le reste de l'écran fonctionne exactement comme en HTTP : liste des profils,
choix, delta par empreinte, case « ajouter comme source de mise à jour ».

Comme ce n'est qu'une URL, tous les points d'entrée existants en héritent sans nouvelle
action :

| Point d'entrée | Valeur |
|---|---|
| Écran de synchro | `ssh://` dans le champ URL |
| Lien profond | `bmm://repo/sync?url=ssh://` |
| Planificateur | *Synchroniser un dépôt*, URL `ssh://` |
| API locale | `POST /api/repo/sync` avec `"url": "ssh://"` |

!!! note "Deux différences avec HTTP"
    La **reprise par morceaux** repose sur les requêtes Range du HTTP et n'est pas utilisée
    en SFTP : un fichier à récupérer l'est en entier. Le delta par fichier, celui qui fait
    gagner du temps, s'applique toujours — la synchro compare les empreintes et ne demande
    que ce qui a changé.

    Une source authentifiée par **mot de passe** fonctionne tant que le panneau SSH est
    ouvert et rempli. Une exécution sans surveillance exige une clé sans phrase secrète,
    pour la même raison que la publication.

### Sans ouvrir l'écran

| Point d'entrée | Publier | Récupérer |
|---|---|---|
| Planificateur | *Publier le dépôt par SSH* | *Récupérer le dépôt par SSH* |
| Lien profond | `bmm://repo/publish-ssh?dir=<dossier>` | `bmm://repo/fetch-ssh?dir=<dossier>` |
| API locale | `POST /api/repo/publish-ssh` | `POST /api/repo/fetch-ssh` |

Tous utilisent la cible enregistrée dans Dépôt Serveur. **Aucun ne peut désigner un autre hôte,
une autre clé ni un mot de passe** — l'appel dit « publie (ou récupère) ce que j'ai déjà
configuré », et rien de plus. La règle compte surtout pour la récupération, qui écrit sur ton
propre disque.

Une exécution sans surveillance exige une clé **sans phrase secrète**, et ne peut pas utiliser
de mot de passe : rien n'est conservé et personne n'est là à 4 h du matin, donc elle échoue
avec un message plutôt que d'attendre indéfiniment devant une invite que personne ne verra.

## Protéger un dépôt : mot de passe, ou clé publique

Deux garanties différentes, et elles se combinent.

Un **mot de passe de téléchargement** est un secret partagé. Quiconque l'a peut synchroniser,
et quiconque l'a peut le transmettre — ce qui est précisément l'intérêt quand tu veux ouvrir
l'accès à un groupe, et le problème quand tu veux l'ouvrir à une seule machine.

Une **clé publique** ne se transmet pas aussi facilement. Tu colles la moitié publique dans la
liste d'accès du dépôt ; le client doit détenir la moitié privée et *signer* à chaque requête.
Rien de ce qui circule ne peut être rejoué ailleurs, et révoquer une clé revient à supprimer
une ligne.

!!! warning "Parente de la clé SSH ci-dessus, mais pas le même rôle"
    La clé SSH sert à ouvrir une session sur un *serveur* pour y déplacer des fichiers. Cette
    clé-ci sert à prouver *qui tu es* à un dépôt ou un catalogue que BMM récupère en HTTPS.

    Le même **fichier** peut faire les deux, et le panneau SSH te propose justement ce trousseau.
    Ce qui n'est pas partagé, c'est le *choix* : désigner une clé pour une cible SFTP ne change
    pas l'identité que BMM présente aux catalogues. L'une dit « laisse-moi entrer », l'autre dit
    « voici qui je suis » — et répondre à l'une en modifiant l'autre, c'est finir par présenter
    la mauvaise identité sans l'avoir jamais décidé.

### Côté client (BMM)

Les clés vivent dans **Paramètres → Identité & API → Clés d'identité**. Ajoutes-en autant que
tu veux, chacune sous un nom que tu choisis. L'une est la clé **par défaut** — celle présentée
à tout ce qui en demande une — et n'importe quel serveur peut être dirigé vers une autre : une
identité professionnelle et une personnelle cohabitent sans échanger de fichiers entre deux
exécutions.

Partout où un sélecteur de clé apparaît dans BMM — un catalogue protégé, un dépôt, le panneau
SSH — ce sont ces mêmes clés qui sont listées par leur nom. Le choix fait pour une source est
retenu pour l'origine de ce serveur.

Seul le **chemin** est conservé. Le fichier est lu au moment de signer et les octets sont
oubliés — BMM n'écrit jamais de matière cryptographique sur le disque, exactement comme pour la
phrase secrète SSH.

Il faut une **clé privée non chiffrée** — **ed25519, RSA ou ECDSA**, au format OpenSSH ou
PuTTY `.ppk`. Un fichier protégé par une phrase secrète est refusé : BMM n'a nulle part où la
garder, ni personne à qui la demander au moment de signer. BMM vérifie le fichier au moment où
tu le choisis plutôt que d'échouer plus tard face au serveur de quelqu'un d'autre : une erreur
de fichier est signalée comme une erreur de fichier.

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/bmm_identity
```

### Côté serveur

Colle la moitié **publique** — le fichier `.pub`, format OpenSSH sur une ligne, celui-là même
qu'attend `authorized_keys` :

- **Un dépôt hébergé sur BetterCommunity** → tableau de bord du dépôt, *Accès* → *Clés
  publiques autorisées*.
- **Un catalogue communautaire** → le panneau *Accès* de ton catalogue, même champ. Cela couvre
  tous les types qu'un catalogue peut contenir : plugin, thème, préréglage et application.
- **Un index de catalogues que tu héberges toi-même** → ce n'est qu'un fichier JSON sur ton
  serveur : il est protégé par ce qui protège ce serveur, et BMM présente à la fois le mot de
  passe et la clé en allant le chercher.

!!! note "L'index de BetterCommunity est public exprès"
    `/api/catalogs.json` est l'annuaire des catalogues publics répertoriés de la plateforme.
    Il n'a aucune garde d'accès et n'est pas destiné à en recevoir une — le fermer masquerait
    les catalogues qu'il existe pour faire connaître. Protège plutôt chaque catalogue ; un
    catalogue privé n'y apparaît de toute façon jamais.
- **Un dépôt que tu sers toi-même** depuis BMM → la même liste, transmise au serveur intégré.

Ajouter une clé la rend **obligatoire pour tout le monde**. Ce n'est pas une entrée de plus sur
une liste blanche, c'est une condition sur chaque requête : ajoute donc ta propre clé avant
celle des autres.

**ed25519, RSA et ECDSA** sont acceptés, et tout ce qui ne se lit pas est refusé au moment où
tu colles. Ce refus est voulu : une clé invérifiable enregistrerait une exigence que rien ne
pourrait jamais satisfaire, et mettrait tous les clients dehors, toi compris.

Le format précédent n'acceptait qu'ed25519. Le compromis se tenait jusqu'à rencontrer le cas
courant : quelqu'un dont la seule clé est une `.ppk` RSA de PuTTY, à qui l'on demande de
régénérer son identité parce que sa clé, parfaitement valide, n'a pas la bonne forme.

### Ce que le client envoie

Une attestation signée à durée de vie courte, pas la clé :

```
X-BMM-Key-Proof: bmmk2.<charge>.<signature>
```

La charge nomme la clé publique, l'**origine à laquelle elle s'adresse**, et une expiration à
deux minutes. C'est cette adresse qui empêche une preuve captée par un serveur d'en ouvrir un
autre — une signature pour `https://a.example` est refusée par `https://b.example`, et le
serveur la compare à sa propre adresse configurée, jamais à celle que la requête prétend viser.

La signature est mise en cache par origine : synchroniser mille fichiers coûte une signature
toutes les deux minutes, pas mille.


## Tout ce que le dépôt transporte d'autre

Un dépôt, c'était des profils de mods, plus des modpacks. Le reste d'une configuration — le
plugin qui la fait tourner, l'automatisation qui la maintient à jour, le thème, les listes de
mods, les catalogues à suivre — devait être publié ailleurs et décrit en prose : ce que
recevait la personne en face, c'était un dossier de mods et un exercice de lecture.

**Server Repo → Inclure dans le dépôt…** prend un DOSSIER de dépôt, pas un nouvel export.
C'est voulu : ça marche sur un dépôt exporté il y a cinq minutes comme sur un dépôt publié
au printemps dernier, sans regénérer un seul mod.

### Choisir ce qui y entre

**Inclure dans le dépôt…** ouvre la liste. Avant, ça ouvrait d'abord une boîte de dialogue
Windows dès que le champ du chemin d'export était vide — donc la réponse à « qu'est-ce que je
peux inclure ? » était un explorateur de fichiers, et la liste n'apparaissait qu'après s'être
engagé sur un dossier. La liste n'a jamais dépendu du dossier.

La destination est maintenant une ligne dans l'écran, avec **Choisir un dossier…** à côté.
Changer de dossier le relit et recoche en conséquence : ces cases sont un fait à propos d'UN
dépôt, et les reporter depuis le dossier regardé juste avant publierait des choses que
personne n'a choisies. Un dossier qui n'est pas un dépôt le dit à l'écran, à côté du bouton
qui permet d'y remédier.

### Choisir maintenant, publier plus tard

Le sélecteur enregistre une **décision**. Il écrivait immédiatement dans un dossier de dépôt
qui devait déjà exister — publier un plugin à côté d'un dépôt obligeait donc à générer le
dépôt, penser à revenir, ajouter le plugin, et regénérer si un profil avait changé. Choisir et
publier étaient le même geste, dans le mauvais ordre.

Ouvrez-le sans choisir de dossier et ce que vous cochez est gardé. Ça entre quand le dépôt est
fait, et **tous** les chemins qui laissent un dossier publiable l'appliquent :

| | |
|---|---|
| **Générer** | un dépôt neuf, à la fin de l'export |
| **Manifeste seul** | après l'écriture de `repo.json` |
| **Mettre à jour un dépôt existant** | à la fin de la mise à jour |
| **Mettre à jour depuis le serveur** | le même gestionnaire que ci-dessus |

Un badge à côté du bouton dit combien attendent, parce qu'une sélection appliquée plus tard
est une sélection qu'on oublie avoir faite — et il disparaît dès qu'elles sont écrites.

!!! note "Ça se vide une fois, et pas sur un échec"

    Appliquée, la sélection cesse d'être en attente : sinon la même atterrit dans chaque dépôt
    généré ensuite, y compris ceux auxquels elle n'était pas destinée. Un **échec** la garde —
    c'est en général un fichier qui a bougé ou un dossier non inscriptible, et la vider
    ferait de la correction « recocher les quatorze » au lieu de « regénérer ».

Choisir un dossier écrit toujours dedans immédiatement, ce qui est juste quand le dépôt est
déjà publié et qu'on y ajoute. Le bouton dit lequel des deux il va faire.

### Deux formes, et la différence compte

=== "Les fichiers voyagent avec le dépôt"

    Un **plugin**, une **automatisation**, un **thème**, une **liste de mods** (`.mm`), un
    **bundle de catalogue** (`.bmmbundle`) et un **launch pack** (`.bmmlaunch`) sont copiés
    dans `extras/<kind>/` et listés dans `repo.json` avec un sha256. Ils sont vérifiés à
    l'arrivée exactement comme un fichier de mod.

    Ce sont des instantanés par nature. Ce que tu as publié est ce que les autres reçoivent.

=== "Les catalogues et sources d'apps voyagent comme adresses"

    Un **catalogue** est une chose qui CHANGE. En copier un dans un dépôt publierait un fork
    gelé qui cesse discrètement de correspondre à sa source, sans que le lecteur puisse s'en
    apercevoir — donc seule l'adresse voyage, et celui qui la suit obtient le catalogue tel
    qu'il sera le jour où il regarde.

!!! tip "D'où vient le bundle"

    Le sélecteur liste chaque catalogue que vous suivez. Un catalogue `https://` apparaît
    comme une adresse à recommander ; un `.bmmbundle` suivi apparaît comme un fichier à
    emporter — le format autorisait les deux depuis toujours et le sélecteur n'offrait que le
    premier, si bien que le seul type de catalogue n'ayant besoin d'aucun hébergeur était le
    seul qu'un repo ne pouvait pas transmettre.

    **Emporter un fichier de catalogue…** en prend un qui n'est pas du tout dans votre liste :
    un bundle qu'on vous a envoyé, ou celui que vous venez de publier depuis l'écran Créer du
    catalogue d'applications. Il est ouvert et vérifié avant d'être proposé, donc un zip qui
    n'est pas un catalogue échoue là plutôt que sur la machine de quelqu'un d'autre.

### Les modpacks sont aussi sur cet écran

C'était une liste sur le formulaire d'export, donc un modpack ne pouvait être partagé qu'en
ré-exportant tous les mods du repo. C'est précisément ce que cet écran existe pour éviter.

Un modpack n'est **pas** un extra et n'est pas traité comme tel : un extra est un fichier sous
`extras/` listé dans `repo.extras`, alors qu'un modpack est une entrée de `repo.modpacks` avec
son propre **mode de partage** — public, la whitelist du repo, ou une liste d'ids que vous
tapez. Le contrôle correspondant n'apparaît que sur les lignes de modpack, les autres types
n'ayant rien de tel.

Cocher et décocher, c'est toute la liste : cet écran montre ce que le repo publie et vous
l'éditez, donc décocher le dernier modpack signifie que le repo cesse de le partager.

!!! warning "Un ré-export jetait tout ça"

    `repo.json` est reconstruit de zéro par un export, et seule la **graine** était reportée —
    parce que la perdre casse tous les clients d'un coup. Tout ce que cet écran publiait
    échouait en silence : plugins, thèmes, automatisations, listes de mods, catalogues, bundles
    et modpacks partagés cessaient simplement d'être proposés, sans un mot.

    C'est reporté désormais. Un export fournit les mods ; ce dont il ne dit rien, il n'y
    touche pas.

### Ce qui arrive, et ce que ça a le droit de faire

Rien de ce qui vient d'un dépôt ne s'exécute.

| Type | À l'arrivée |
|---|---|
| Plugin | Installé **désactivé**, **sans aucune permission** — et toute permission déjà accordée à cet id est effacée. |
| Automatisation | Ajoutée au planificateur, **désactivée**. |
| Thème | Installé. C'est de la donnée. |
| Liste de mods · bundle | Enregistré, et BMM **demande** avant de l'ouvrir. |
| Catalogue · source d'apps | Suivi, et listé avec le dépôt comme origine pour pouvoir le retirer plus tard. |

!!! warning "Pourquoi les plugins et les automatisations sont décochés par défaut"

    Un plugin est du code qui tourne dans BMM ; une automatisation peut lancer des commandes
    sur ta machine. Synchroniser un dépôt est une décision à propos de mods. Une case cochée
    par défaut en ferait une décision d'exécuter le code d'un inconnu que personne n'a prise
    à voix haute.

    L'effacement des permissions est la moitié moins évidente. Les ids sont choisis par celui
    qui écrit le manifeste : sans ça, un dépôt pourrait nommer son plugin comme un que tu
    avais déjà approuvé et hériter de l'autorisation en silence.

!!! note "Un type que cette version ne connaît pas"

    Il est quand même **listé**, nommé, et refusé avec une raison. Un dépôt publié par un BMM
    plus récent ne doit pas ressembler à un dépôt auquel il manque des choses.

### Le manifeste

```json
{
  "extras": [
    { "kind": "plugin", "id": "dcs-helper", "name": "DCS Helper", "version": "1.2",
      "file": { "relative_path": "dcs-helper.bmmplug", "size": 40122, "sha256_hash": "…" } },
    { "kind": "catalog", "id": "…", "name": "Thèmes de l'escadron",
      "url": "https://example.org/themes/catalog.json", "catalog_type": "theme" },
    { "kind": "modlist", "id": "ops", "name": "Liste Ops", "locked": true,
      "file": { "relative_path": "ops.mm", "size": 8210, "sha256_hash": "…" } }
  ]
}
```

`kind` vaut `plugin` · `task` · `theme` · `modlist` · `bundle` · `launchpack` · `catalog` ·
`app`. Une liste verrouillée le dit dans le manifeste, pour que l'écran puisse annoncer qu'il
faudra une phrase secrète *avant* le téléchargement plutôt qu'après — sinon ce qui arrive est
un fichier qui ne s'ouvre pas, sans moyen de savoir si c'est voulu ou si le transfert a
échoué.

!!! warning "Un launch pack n'est jamais installé par une synchro"

    Un launch pack est une **liste de programmes à lancer sur ta machine**, choisis par qui a
    publié le dépôt. Tous les autres extras peuvent s'appliquer en fin de synchro ; celui-ci
    est écrit puis proposé, avec une confirmation qui dit ce que c'est, et le message qui suit
    annonce combien de ces programmes ne sont pas là où le fichier le prétend. Un pack dont
    les jeux sont sur `D:` chez l'auteur et sur `C:` chez toi est le cas ordinaire, et
    importer en silence un truc qui ne lance rien — comme en jeter la moitié sans le dire —
    sont deux façons d'être pires que de le signaler.

**Ajouter des extras resigne `repo.json`**, parce qu'ils sont à l'intérieur de ce que la
signature couvre. Laisser l'ancienne signature publierait un manifeste qui échoue à sa propre
vérification — ce qui, pour celui qui télécharge, ressemble à une falsification et en est
indiscernable.

!!! tip "Les noms de fichiers sont restreints exprès"

    Le nom d'un fichier transporté ne garde que `A-Z a-z 0-9 . _ -`. Les hébergeurs normalisent
    les chemins — BetterCommunity remplace tout le reste, espaces compris — donc un caractère
    gardé ici que l'hébergeur ne garde pas mettrait `Mon Thème.bmmtheme` dans le manifeste,
    `Mon_Th_me.bmmtheme` sur le serveur, et un 404 sur un fichier pourtant bien présent.
    L'erreur ressemble à un éditeur qui aurait oublié d'uploader quelque chose.

### Depuis un script, la CLI ou un assistant

```bash
bmm repo-extras https://example.org/repo
bmm repo-take https://example.org/repo theme night-ops
```

`POST /api/repo/extras` fait la même chose en HTTP (`repo.write`). Lire ne demande aucun
nouvel endpoint — `/api/repo/info` renvoie le manifeste, et `extras` en fait partie. Les
outils MCP sont `bmm_repo_extras` et `bmm_repo_extra_take`.

!!! note "L'entrée est cherchée, pas décrite"

    L'endpoint prend une URL de dépôt plus un `kind` et un `id`, et trouve l'entrée dans le
    manifeste qu'il a récupéré. Un appelant qui pourrait fournir ses propres
    `{kind, url, sha256}` se servirait de l'installeur de BMM pour installer des fichiers
    arbitraires — et la vérification de hash vérifierait son propre chiffre.
