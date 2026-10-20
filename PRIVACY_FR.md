# Politique de confidentialité — Better Mods Manager (BMM)

**Version 2026-10-13** (BMM 1.0.2 et les installeurs BetterInstaller qui le livrent) · remplace la
version du 2026-10-06 (ce qui change : §12)

Better Mods Manager est une application de bureau open source (GPL‑3.0) qui tourne sur votre
ordinateur. Vos profils, mods, modpacks, plugins et réglages sont stockés **localement**, dans le
dossier de données de BMM, et vous pouvez les exporter ou les supprimer à tout moment. BMM n'affiche
aucune publicité, ne demande aucun compte, et nous ne vendons jamais vos données.

Certaines données quittent toutefois votre ordinateur. Cette politique liste **toutes les connexions
réseau que BMM et son installeur établissent**, vérifiées dans le code source de cette version :
**ce qui** est envoyé, **quand**, **à qui**, **pourquoi**, sur quelle **base légale**, combien de
temps c'est **conservé**, comment le **désactiver**, et le **réglage par défaut**. Les Conditions
d'utilisation ne reprennent rien de tout cela : pour toute question sur les données, ce document fait
référence.

Cette politique existe en anglais et en français. **En cas de divergence, la version anglaise
prévaut.**

---

## 1. Qui est responsable

Le responsable du traitement des données que reçoit l'équipe BMM (télémétrie, rapports, preuves de
consentement, services BetterCommunity) est :

> **[RAISON SOCIALE DE L'EXPLOITANT]** — **[forme juridique, numéro d'enregistrement le cas échéant]**
> **[adresse postale]**
> Contact confidentialité : **[adresse e-mail]**
> Représentant dans l'UE / au Royaume-Uni (art. 27 RGPD), si nécessaire : **[nom et adresse, ou « aucun »]**

_Les champs entre crochets doivent être complétés par l'exploitant avant publication ; aucun ne
contient les données d'une société existante._

Les tiers auxquels vous choisissez de vous connecter (le propriétaire d'un Server Repo, Discord, un
fournisseur d'IA que vous configurez, GitHub, Google, Cloudflare) sont responsables de ce qu'ils font
de ce qu'ils reçoivent, selon leurs propres politiques.

---

## 2. En bref : ce qui est activé par défaut

L'installeur pose une seule question de confidentialité, à la manière d'un bandeau cookies, et **rien
n'est présélectionné** : le bouton Installer reste désactivé tant que vous n'avez pas choisi l'une des
trois réponses.

| Quoi | Installeur : *L'essentiel uniquement* | Installeur : *Tout accepter* | Installeur : *Personnaliser* | Sans l'installeur |
|---|---|---|---|---|
| Requêtes au démarrage, vérification des mises à jour, tests de connexion, polices (§4.1–4.4) | Activé | Activé | Activé (la vérification des mises à jour peut être décochée) | Activé |
| **Téléchargement du modèle Laya hors ligne** pendant l'installation (§4.5) | Question distincte, **cochée par défaut** | idem | idem | — (Paramètres → IA le télécharge à la demande) |
| **Télémétrie** et ses catégories : utilisation, performances, erreurs en direct, statistiques Laya, relecture de session masquée (§5) | **Désactivée** | **Activée** (c'est votre consentement ; BMM ne redemande pas) | Chacune comme vous la réglez | Désactivée jusqu'à votre réponse à l'écran de consentement de BMM |
| **Benchmark hebdomadaire + rapport matériel** (§5.4) | Désactivé | **Désactivé** (jamais compris dans *Tout accepter*) | Désactivé sauf si vous le cochez | Désactivé (jamais compris dans *Tout activer*) |
| **Discord Rich Presence** (§6) | Désactivé | **Activé** | Comme vous le réglez | Désactivé |
| Rapports de bug, de plantage et suggestions (§7) | Seulement quand vous appuyez sur Envoyer | idem | idem | idem |
| Fournisseurs d'IA qui envoient des données (§8.10) | Désactivés | Désactivés | Désactivés | Désactivés |
| Preuves de consentement envoyées au serveur (§9) | Non (télémétrie désactivée) | Oui, avec la télémétrie | Avec la télémétrie | Avec la télémétrie |

Tout cela se modifie ensuite dans BMM : Paramètres → Confidentialité pour la télémétrie, ses
catégories et vos preuves de consentement ; les interrupteurs Discord et mises à jour dans
Paramètres ; Paramètres → IA pour Laya.

---

## 3. Inventaire des flux de données

Toutes les connexions, dans un seul tableau. « Base légale » renvoie au RGPD (art. 6(1)) et, pour la
Suisse, à la loi fédérale révisée sur la protection des données (nLPD, art. 31). La conservation est
celle de l'équipe BMM ; les tiers conservent ce que prévoient leurs propres politiques.

| # | Ce qui est envoyé | Quand | À qui | Pourquoi | Base légale | Conservé | Désactivation | Par défaut |
|---|---|---|---|---|---|---|---|---|
| 1 | Adresse IP, en-têtes de requête (sans Creator ID) | À chaque démarrage | bettercommunity.ch, puis GitHub en secours (§4.1) | Télécharger la liste des liens et des contributeurs | Intérêt légitime : l'application fonctionne avec des liens à jour (f) | Journaux d'accès du serveur, court terme | Rester hors ligne | Activé |
| 2 | Adresse IP, user-agent nommant BMM | ~3 s après le démarrage, et quand vous vérifiez | API GitHub, bettercommunity.ch en secours ; manifestes de mise à jour de l'installeur (§4.2) | Proposer les mises à jour de sécurité et correctifs | Intérêt légitime (f) | Journaux d'accès | Paramètres → vérification automatique des mises à jour | Activé |
| 3 | Adresse IP | Quand vous installez une mise à jour | Releases GitHub (l'installeur et son manifeste signé) | Télécharger la mise à jour demandée | Votre demande (b) | Journaux d'accès | Ne pas mettre à jour | Quand vous cliquez |
| 4 | Adresse IP | Toutes les 2 minutes | Google (`gstatic.com`), Cloudflare (§4.3) | Savoir si BMM est en ligne | Intérêt légitime (f) | Leurs politiques | Rester hors ligne | Activé |
| 5 | Adresse IP | Quand une page en a besoin | Google Fonts, jsDelivr, Simple Icons, flagcdn.com, YouTube (nocookie) (§4.4) | Polices, icônes, drapeaux des langues, vidéos intégrées | Intérêt légitime (f) | Leurs politiques | Rester hors ligne | Activé |
| 6 | Adresse IP | Pendant l'installation si *Laya hors ligne* est coché ; ensuite seulement à votre demande | Releases GitHub, miroir BetterCommunity (§4.5) | Télécharger le modèle d'IA local (327 Mo), vérifié contre un SHA-256 épinglé | Votre choix (b) | Journaux d'accès | Décocher *Laya hors ligne* ; Paramètres → IA | **Coché** dans l'installeur |
| 7 | Creator ID, identifiant d'installation, profil système, utilisation, interactions, journaux, performances (§5.1) | Toutes les 90 s quand la télémétrie est activée | Serveur de télémétrie BetterCommunity | Trouver les bugs, mesurer ce qui est utilisé | **Consentement** (a) | 180 jours (réglable par l'exploitant) | Paramètres → Confidentialité | **Désactivé** (*Tout accepter* : activé) |
| 8 | Enregistrement masqué de la fenêtre de BMM (§5.2) | Avec la télémétrie | Serveur de télémétrie | Reproduire les bugs | Consentement (a) | 180 jours | Paramètres → Confidentialité | Avec la télémétrie |
| 9 | Erreurs et plantages, nettoyés des secrets, chemins, e-mails, IP ; un hachage du Creator ID (§5.5) | Quelques secondes après une erreur, avec la télémétrie | Serveur de télémétrie (classé par Laya sur les mêmes serveurs) | Corriger vite les erreurs | Consentement (a) | 180 jours | Paramètres → Confidentialité | Avec la télémétrie |
| 10 | Statistiques d'utilisation de Laya, jamais de texte (§5.6) | Avec la télémétrie | Serveur de télémétrie | Savoir si Laya est utile | Consentement (a) | 180 jours | Paramètres → Confidentialité | Avec la télémétrie |
| 11 | Temps du benchmark et identifiants matériels : numéros de série, UUID de la machine, adresses MAC (§5.4) | Chaque semaine, seulement si vous l'avez coché | Serveur de télémétrie | Compatibilité matérielle | Consentement (a), demandé à part | 180 jours | Paramètres → Confidentialité | **Désactivé** partout |
| 12 | Preuves de consentement : document, version, empreinte du texte, langue, réponse, heure, source, version de l'app, identifiant d'installation aléatoire (§9) | Après une réponse, si la télémétrie est activée ou si vous appuyez sur *Envoyer au serveur* | Serveur de télémétrie | Prouver quel texte vous avez accepté ou refusé | Obligation légale de démontrer le consentement (c), intérêt légitime (f) | 3 ans après qu'une preuve est remplacée ou que l'installation se tait (réglable) | Ne pas envoyer ; effacement par identifiant d'installation | Avec la télémétrie |
| 13 | Nom du profil, nombre de mods actifs, version de BMM, Creator ID (§6) | Tant que Discord RPC est activé | L'application Discord de votre PC, affiché sur votre profil Discord | Montrer à quoi vous jouez | Consentement (a) | Politique de Discord | Paramètres | Désactivé (*Tout accepter* : activé) |
| 14 | Ce que vous écrivez, les pièces jointes choisies, Creator ID avec preuve signée et empreintes d'appareil hachées, détails de l'app et de l'OS (§7) | Quand vous appuyez sur Envoyer | Centre de retours BetterCommunity | Traiter votre rapport | Votre demande (b) ; pièces jointes cochées | Selon les conditions de la plateforme BetterCommunity | Ne pas envoyer | Seulement sur Envoyer |
| 15 | Creator ID, preuve signée, empreintes d'appareil hachées (§4.6) | Rapports, liaison de compte, une fois par clé tant que lié | bettercommunity.ch | Empêcher le contournement des bannissements et l'abus des offres gratuites | Intérêt légitime (f) | Empreintes : 180 jours après la dernière vue | Ne pas lier, ne pas envoyer de rapport | Seulement alors |
| 16 | Adresse IP, Creator ID, mot de passe de téléchargement s'il y en a un (§8.1) | Quand vous vous connectez à un Server Repo ou le synchronisez | Le propriétaire de ce dépôt | Contrôle d'accès par son propriétaire | Votre demande (b) | Au choix du propriétaire | Ne pas se connecter | Seulement alors |
| 17 | Creator ID, vérification d'un code à usage unique (§8.6) | Quand vous liez un compte | bettercommunity.ch | Lier votre compte | Votre demande (b) | Tant que lié | Délier | Seulement alors |
| 18 | Votre clé d'API BetterCommunity (§8.7) | Toutes les 10 min, seulement si vous avez enregistré une clé | bettercommunity.ch | Vos notifications | Votre demande (b) | — | Supprimer la clé | Pas de clé, pas de requête |
| 19 | Nom, auteur, description d'un mod, noms de fichiers, noms de vos tags, ou le texte d'un rapport, masqués d'abord (§8.10) | Seulement quand vous cliquez *Suggérer*, *brouillon* ou *indice IA* avec un fournisseur réseau | Le fournisseur choisi | Suggestions par IA | Consentement (a) | Politique de ce fournisseur | Paramètres → IA | **Désactivé** |
| 20 | Ce qu'envoient vos propres intégrations (§8.9) | Comme vous l'avez configuré | Le service configuré | Votre automatisation | Votre demande (b) | Politique de ce service | Les supprimer | Désactivé |

Rien d'autre ne quitte votre PC. Parcourir et gérer mods, profils et modpacks n'envoie rien.

---

## 4. Ce qui se passe quel que soit votre choix de télémétrie

### 4.1 Configuration au démarrage
À chaque démarrage, BMM télécharge sa liste de liens (`links.json`) et la liste des contributeurs
depuis `bettercommunity.ch`, avec les copies GitHub en secours. **Ces téléchargements ne portent pas
votre Creator ID** : pas d'en-tête `X-Creator-ID`, pas de preuve de clé. Le serveur de BetterCommunity
voit votre adresse IP, comme tout serveur web, et rien qui identifie cette installation.

D'autres requêtes de BMM vers une adresse bettercommunity.ch **portent** votre Creator ID dans un
en-tête `X-Creator-ID` : récupérer un catalogue ou un dépôt (l'identifiant contrôle l'accès au contenu
privé), et les fonctions de retour, de rapport et de compte que vous lancez vous-même.

**Ce qu'est le Creator ID.** C'est la moitié publique d'une paire de clés Ed25519 que BMM crée au
premier lancement. La clé est **dérivée d'identifiants de ce PC** (MachineGuid, ID de produit et date
d'installation de Windows ; numéros de série de la carte mère, du BIOS, du processeur et des disques ;
numéro de série du volume C:) par une dérivation à sens unique. Elle est conservée, avec le reste du
matériel de clé, dans un magasin chiffré par Windows (DPAPI, lié à votre compte Windows) dans le
dossier de données de BMM et votre registre utilisateur ; sous macOS et Linux sous une clé gardée dans
le trousseau du système (Keychain, Secret Service), ou, sans trousseau, dans un fichier lisible par
votre seul compte. Le Creator ID est **épinglé** (un fichier `creator_v5.pin` et une entrée de registre
/ trousseau ne contenant que des valeurs publiques) : un magasin copié d'une autre machine ou modifié
est refusé. Une réinitialisation, que vous lancez vous-même dans Paramètres, est notée dans un
`creator_v5.log` local qui ne quitte jamais votre ordinateur. Conséquences :

- il ne contient ni nom ni e-mail, et les identifiants dont il est dérivé ne peuvent pas en être extraits ;
- il est **stable** : le même PC obtient le même Creator ID, même après réinstallation, donc tout ce qui
  est envoyé sous cet identifiant est **reliable à cette machine dans le temps** ;
- il signe ce que vous publiez (dépôts, modpacks, tutoriels), donc quiconque les reçoit le voit (§8.3).

### 4.2 Vérification et installation des mises à jour
Environ trois secondes après le démarrage, BMM interroge l'API des releases de GitHub
(`api.github.com/repos/FreeProject089/BetterModsManager/releases`), avec
`bettercommunity.ch/api/updates/bmm` en secours. Si BMM a été installé avec BetterInstaller, la
vérification passe par le programme de maintenance de l'installeur, qui lit les manifestes de mise à
jour signés sur GitHub et `bettercommunity.ch`. Ces hôtes voient votre adresse IP et un user-agent
nommant le programme. Désactivez la vérification automatique dans Paramètres (ou décochez-la dans
*Personnaliser* de l'installeur).

Quand **vous** choisissez d'installer une mise à jour, BMM télécharge le manifeste signé et
l'installeur (`BMM-Setup.exe`) depuis la release GitHub, vérifie la signature de l'éditeur et le
SHA‑256 avant de lancer quoi que ce soit, et garde un téléchargement interrompu dans son propre dossier
pour le reprendre. Rien vous concernant n'est envoyé avec ces téléchargements.

### 4.3 Tests de connexion
Toutes les deux minutes, BMM vérifie s'il est en ligne en interrogeant `www.gstatic.com/generate_204`
(Google) et `cloudflare.com/cdn-cgi/trace` (Cloudflare). Ils voient votre adresse IP et les en-têtes
ordinaires de la requête.

### 4.4 Polices, icônes, drapeaux, vidéos et catalogues
- L'interface charge ses polices depuis **Google Fonts**.
- Les icônes non intégrées viennent de **jsDelivr** et **Simple Icons** ; le sélecteur de langue
  affiche des drapeaux de **flagcdn.com**.
- Au démarrage, BMM lit le catalogue d'applications sur GitHub (`raw.githubusercontent.com`), et
  vérifie le catalogue de plugins si vous en avez installé depuis celui-ci.
- Des pages de la documentation intégrée peuvent contenir des vidéos **YouTube** via
  `youtube‑nocookie.com` ; Google/YouTube voit alors votre adresse IP et peut conserver des données
  selon la politique de Google.

Ces services voient votre adresse IP et les en-têtes ordinaires, selon leurs propres politiques.

### 4.5 BetterInstaller
Pendant l'installation, l'installeur ne contacte rien, **sauf** pour télécharger :

- le **pack du modèle Laya hors ligne** (327 Mo, depuis la release GitHub du projet, avec le miroir
  BetterCommunity en secours) quand *Laya hors ligne* est coché, **ce qui est le cas par défaut**. Le
  pack est refusé s'il ne correspond pas à un SHA‑256 épinglé. Le téléchargement ne porte rien vous
  concernant ; GitHub voit votre adresse IP, comme pour tout téléchargement. Décochez *Laya hors
  ligne* (« Pas maintenant ») pour l'éviter ;
- un composant optionnel que vous cochez vous-même (comme Python, depuis `python.org`).

Quand vous le rouvrez pour réparer, mettre à jour ou désinstaller, il vérifie les mêmes manifestes
qu'au §4.2.

Vos choix dans l'installeur sont transmis à BMM par un fichier local (`installer-handoff.json`) que
BMM lit une fois puis renomme ; il n'est envoyé nulle part. Il contient désormais aussi une **preuve**
pour chaque document légal accepté (§9).

### 4.6 Preuve de votre Creator ID et empreinte de l'appareil
Quand BMM doit **prouver** son Creator ID à BetterCommunity, il signe une preuve courte à usage unique
(valable deux minutes, liée à ce site, avec un nombre aléatoire pour qu'elle ne puisse pas être
rejouée). Cela n'arrive que quand vous **envoyez un rapport de bug, de plantage ou une suggestion**
(§7), quand vous **liez un compte BetterCommunity** (§8.6), et **une fois par clé tant que cette
installation est liée à un compte**.

Cette preuve porte une **empreinte de l'appareil** : quatre hachages à sens unique calculés sur votre
PC, (1) des identifiants de la carte mère, du BIOS et du processeur, (2) des identifiants de
l'installation de Windows, (3) des identifiants des disques, (4) un **hachage canvas** (la façon dont
votre carte graphique et ses pilotes dessinent une image de test fixe).

- **Seuls les hachages sont envoyés.** Chacun est salé avec l'adresse du site qui le reçoit et itéré,
  il ne peut donc pas être rapproché des valeurs d'un autre serveur.
- **L'empreinte canvas est une technique de pistage**, et nous le disons clairement. Elle sert au seul
  but ci-dessous et change quand vous mettez à jour votre pilote graphique.
- **But :** permettre aux modérateurs de BetterCommunity de voir si un nouveau Creator ID vient d'un
  ordinateur banni ou ayant déjà utilisé une offre gratuite. Une personne examine la correspondance et
  décide ; aucune règle n'agit automatiquement. Ni analyse, ni publicité, ni profilage, ni partage.
- **Base légale :** intérêt légitime à prévenir les abus et le contournement des bannissements (RGPD
  art. 6(1)(f) ; nLPD art. 31). Les hachages identifient un appareil, vos droits (§11) s'y appliquent.
- **Conservation :** chaque hachage est supprimé **180 jours après sa dernière apparition**.

---

## 5. Télémétrie

La télémétrie envoie des données d'utilisation et de diagnostic au **serveur de télémétrie de
BetterCommunity** (`telemetry.bettercommunity.ch`, exploité par le responsable du §1). Elle est mise en
tampon sur votre disque (10 Mo au plus), compressée et envoyée en **HTTPS** toutes les 90 secondes
quand la fenêtre est visible, quand elle est masquée et à la fermeture de BMM. Chaque lot porte un
**identifiant de paquet** aléatoire pour que vous puissiez le faire effacer.

**Par défaut : désactivée.** La télémétrie est **sur consentement**, demandé une seule fois :

- **Dans l'étape de confidentialité de l'installeur.** *Tout accepter* (ou *Personnaliser* avec la
  télémétrie activée) **vaut consentement**, donné après l'affichage et l'acceptation de la Politique
  de confidentialité, chaque catégorie étant décrite à l'écran : BMM l'enregistre avec une preuve (§9)
  et ne redemande pas. *L'essentiel uniquement*, ou la télémétrie désactivée dans *Personnaliser*, est un
  refus enregistré.
- **Les installeurs antérieurs à cette étape** avaient une seule case ; la cocher n'était **pas** un
  consentement : elle présélectionne seulement la réponse dans l'écran de consentement de BMM, qu'il
  faut encore accepter.
- **Sans l'installeur**, la télémétrie reste désactivée jusqu'à votre réponse à l'écran de
  consentement de BMM. Il propose quatre réponses, toutes des boutons : **Tout activer** (les cinq
  catégories du §5.0), **Choisir** (un interrupteur par catégorie), **Non merci** (désactivé,
  enregistré) et **Plus tard** (aussi Échap : n'enregistre rien, redemande au lancement suivant). Un
  clic à côté de l'écran n'est pas une réponse.

Paramètres → Confidentialité la désactive à tout moment ; désactivée, rien du §5 n'est collecté ni
envoyé, et le tampon local est supprimé. Un lien `bmm://telemetry/…` (qu'une page web peut ouvrir) ne
peut pas modifier ces réglages seul : il ouvre l'écran de consentement de BMM, ou une confirmation s'il
ne fait que désactiver quelque chose. Une réponse donnée par l'API locale, la ligne de commande ou le
serveur MCP est enregistrée comme telle dans vos preuves.

Si le texte du consentement change de façon significative, ou si BMM trouve la télémétrie activée sans
preuve de votre consentement (par exemple après une mise à jour depuis 1.0.x ou l'import d'anciens
réglages), la télémétrie repasse à « pas encore demandé » et la question vous est reposée.

### 5.0 Catégories
Un consentement, cinq catégories. Chacune se désactive séparément, dans l'écran de consentement
(*Choisir*), dans l'installeur (*Personnaliser*) et dans Paramètres → Confidentialité.

| Catégorie | Ce qu'elle couvre |
|---|---|
| Statistiques d'utilisation | Pages, dialogues, clics, parcours, début et fin de session (§5.1) |
| Performances | Images par seconde, temps d'image, mémoire de l'interface, temps de chargement (§5.1) |
| Erreurs envoyées en direct | Erreurs et plantages au moment où ils arrivent (§5.5), et les journaux d'avertissements et d'erreurs du §5.1 |
| Statistiques d'utilisation de Laya | Comment Laya est utilisée, sans aucun contenu (§5.6) |
| Relecture de session | L'enregistrement masqué de la fenêtre de BMM (§5.2) |

L'identité et le profil système du §5.1 accompagnent la catégorie activée. Deux options ne font
**jamais** partie de *Tout activer* ni de *Tout accepter* : le rapport matériel hebdomadaire (§5.4) et
la relecture non masquée (§5.2).

### 5.1 Ce qui est envoyé
- **Identité :** votre Creator ID (§4.1) et un identifiant d'installation aléatoire.
- **Profil système :** système d'exploitation et version, processeur et nombre de cœurs, RAM, chaque
  GPU, carte mère, modèle et fabricant de la machine, si BMM tourne dans une machine virtuelle, vos
  disques (taille, point de montage), vos écrans (fabricant, modèle, année) et résolutions, la version
  et la langue de BMM, et pour chaque profil le **nom du jeu**, son nombre de mods et la répartition de
  ses dossiers sur les disques. **Aucune adresse IP ne fait partie du profil**, et BMM ne demande jamais
  à un service tiers votre adresse ou votre position.
- **Préférences et comptes :** thème actif, langue, réglages de Tasky, mode de sécurité du système de
  fichiers, et combien de mods, profils, plugins, modpacks, tags, packs de lancement et applications
  vous avez (des nombres, pas des noms).
- **Utilisation :** pages ouvertes et durée, parcours de navigation, dialogues ouverts (avec leurs
  titres), début et fin de session.
- **Interactions :** le texte des boutons cliqués, l'**adresse complète des liens externes** ouverts,
  le nom des champs modifiés (jamais leur valeur), les messages d'erreur.
- **Journaux :** avertissements et erreurs de la console de l'interface et, toutes les 15 secondes,
  les lignes d'avertissement et d'erreur du journal de BMM. **Ces lignes peuvent contenir des chemins
  de fichiers et de dossiers**, qui peuvent inclure votre nom d'utilisateur Windows.
- **Performances :** images par seconde, temps d'image, pire image, mémoire de l'interface, temps de
  chargement des pages.
- **Dépôts :** quand vous vous connectez à un Server Repo, son adresse, son hôte et son nom ; quand
  vous en hébergez un, le nom d'auteur saisi.

### 5.2 Relecture de session
Tant que la télémétrie et cette catégorie sont activées, BMM envoie un **enregistrement de la fenêtre
de BMM** : disposition, clics, défilement, navigation. **Le texte saisi dans les champs est masqué**,
ainsi que les éléments marqués comme noms ou chemins. Les autres fenêtres et le reste de votre écran ne
sont jamais enregistrés. Un mode **« complet (non masqué) »** distinct existe pour votre propre
débogage : désactivé sauf si vous l'activez à la main dans Paramètres → Confidentialité, jamais par un
lien `bmm://`, jamais par *Tout accepter*.

### 5.3 Ce que la télémétrie n'envoie jamais
Le contenu de vos mods, fichiers de jeu ou autres fichiers ; les valeurs saisies dans les champs (sauf
si vous activez la relecture non masquée) ; votre nom ou e-mail.

### 5.4 Benchmark hebdomadaire et rapport matériel détaillé
**Désactivé par défaut, partout, et demandé à part.** Quand vous l'activez *et* que la télémétrie est
activée, BMM lance un court benchmark une fois par semaine et envoie ses temps avec un **rapport
matériel détaillé** d'**identifiants matériels stables** : modèle et numéro de série de la carte mère,
version, date et éditeur du BIOS, UUID de la machine, détails du cache et des threads du processeur,
modèle, numéro de série, taille et interface de chaque disque, **adresse MAC de chaque carte réseau
physique**, build de l'OS, démarrage UEFI ou legacy, état de Secure Boot et du TPM. **Ni *Tout
accepter* dans l'installeur ni *Tout activer* dans BMM ne l'activent** : seul son propre interrupteur,
dans *Personnaliser* de l'installeur ou dans Paramètres → Confidentialité de BMM, le fait.

### 5.5 Erreurs envoyées en direct
Quelques secondes après une erreur, tant que la télémétrie est activée : erreurs JavaScript, plantages
du côté Rust, commandes en échec réel, et déploiements, installations, sauvegardes et tâches planifiées
en échec. Pour chacune : le message, l'endroit du code de BMM (noms de fonction et de fichier), une
gravité, combien de fois et quand, la version de BMM, le nom et l'architecture de l'OS, l'identifiant
de session de télémétrie et, pour un plantage, le **nom du fichier** du rapport local (jamais son
contenu). Jamais les arguments d'une commande, le contenu d'un fichier ni ce que vous avez saisi.

- **Retiré sur votre PC avant l'envoi :** tout secret que BMM conserve (jetons, mots de passe, clés,
  identifiants dans des adresses), le nom de votre dossier utilisateur Windows, les adresses e-mail et
  IP, les noms de votre PC et de votre compte. Le serveur retire ces formes une seconde fois.
- **Identité :** un **hachage à sens unique** de votre Creator ID, pas le Creator ID ; une demande de
  copie ou d'effacement pour votre Creator ID atteint quand même ces rapports.
- **Volume :** la même erreur dans les 10 minutes n'incrémente qu'un compteur ; 60 nouvelles erreurs
  par heure au plus ; une file d'attente de 200 lignes au plus, gardée sur le disque.
- **Qui les lit :** l'équipe BMM, dans le tableau de bord de télémétrie. Chaque nouveau groupe
  d'erreurs est classé par **Laya**, le classifieur de BetterCommunity qui tourne sur les mêmes
  serveurs ; le texte n'est jamais envoyé à un fournisseur d'IA extérieur.

### 5.6 Statistiques d'utilisation de Laya
Pour chaque utilisation d'une fonction de Laya : **quelle fonction** et **où elle a tourné** (intégrée
à BMM, serveur BetterCommunity, votre propre serveur Laya, une API externe, des règles simples) ;
**combien de temps** (arrondi) et si elle a répondu ou s'est abstenue ; pour les suggestions, **le nom
des champs** suggérés et ceux que vous avez **gardés ou refusés** ; pour Demander à Laya, **le nombre
de résultats** et le **type** de résultat ouvert ; l'installation, la suppression ou l'annulation du
modèle intégré ; une erreur sous forme de **code court**. **Jamais envoyé :** votre question, un texte
lu ou écrit par Laya, la valeur d'une suggestion, un nom de mod, de fichier ou de profil, un chemin ou
un message d'erreur.

### 5.7 Stockage, localisation, conservation, effacement
- **Où :** un serveur exploité par le responsable du §1. Lire les données stockées exige une clé
  d'administration ; la clé intégrée à BMM permet seulement d'envoyer des données et de déposer des
  demandes d'effacement ou d'accès.
- **Votre adresse IP est tronquée, jamais stockée entière :** avant tout stockage, une adresse est
  réduite à son réseau (`203.0.113.45` → `203.0.113.0` ; les trois premiers groupes en IPv6). L'adresse
  exacte n'existe que dans la mémoire du serveur le temps d'une requête, comme clé du compteur
  anti‑flood.
- **Localisation :** l'adresse tronquée est recherchée auprès du service tiers **ipwho.is** ; pays,
  région et ville sont stockés, coordonnées arrondies au dixième de degré (environ 11 km).
- **Conservation :** tout est supprimé automatiquement après **180 jours** sauf autre valeur fixée par
  l'administrateur, y compris les réseaux stockés, leur localisation et la liste des instances en direct.
- **Effacement par paquet :** Paramètres → Confidentialité liste chaque paquet envoyé ; « Demander la
  suppression » l'efface sous 72 heures (immédiatement si un administrateur l'approuve).
- **Effacement par personne / copie de vos données :** une demande liée à votre Creator ID supprime, ou
  exporte, tout ce qui est conservé sous cet identifiant. La copie est renvoyée par e-mail à l'adresse
  que vous indiquez.
- Exportez ou videz le tampon local de BMM à tout moment dans Paramètres → Confidentialité.

---

## 6. Discord Rich Presence
Activé, BMM indique à l'**application Discord de votre PC** quoi afficher sur votre profil : le nom de
votre profil BMM actif, le nombre de mods actifs, la version de BMM avec votre **Creator ID**, et un
bouton « Site web » dont le lien contient votre Creator ID. Discord l'affiche à **quiconque peut voir
votre profil**, selon sa politique. Chaque mise à jour relit aussi la liste de liens de BMM sur GitHub.

**Par défaut : désactivé** dans BMM ; dans l'installeur, *Tout accepter* l'active (la carte le dit),
*L'essentiel uniquement* le laisse désactivé, *Personnaliser* vous laisse choisir. Désactivez-le à tout
moment dans Paramètres. Un lien `bmm://discord/rpc` ne fait que demander : rien ne change sans votre
confirmation dans BMM.

---

## 7. Rapports de bug, de plantage et suggestions

### 7.1 Envoyer un rapport
Une suggestion, un rapport de bug ou de plantage va au **centre de retours BetterCommunity**
(`bettercommunity.ch/api/feedback/bmm`) et nulle part ailleurs. **Rien n'est envoyé avant que vous
appuyiez sur Envoyer.** BMM envoie alors :

- le titre, la description et les étapes que vous saisissez, et les captures jointes ;
- un `.zip` de rapport de plantage que vous choisissez (§7.2) ;
- en option le journal de l'application (`bmm_frontend.log`), précoché pour les bugs et plantages ;
- en option un **rapport DxDiag**, précoché pour les plantages : un inventaire du matériel et des
  pilotes qui contient aussi des identifiants de la machine et de l'OS et votre **nom de compte
  Windows** ;
- votre **Creator ID** (avec une preuve signée portant l'empreinte d'appareil hachée du §4.6), la
  version de l'application, l'OS, la langue et le user-agent ;
- l'e-mail ou le pseudo Discord que vous saisissez, le cas échéant, pour qu'on puisse vous répondre.

Une petite preuve de travail anti‑spam s'exécute d'abord ; elle n'envoie rien de plus. Si le site est
injoignable, le rapport est gardé localement et renvoyé après le lancement suivant. Avant l'envoi, BMM
analyse le texte **sur votre PC** à la recherche de secrets, chemins contenant votre nom d'utilisateur,
adresses e-mail et IP et noms de compte, et propose de les masquer (coché par défaut). Une fois reçu,
un rapport est conservé selon les conditions de la plateforme BetterCommunity.

### 7.2 Contenu d'un zip de rapport de plantage
Quand BMM plante, il écrit un `.zip` **sur votre disque** : les journaux de BMM, un instantané des
informations système, l'enregistrement de session masqué du §7.3 avec la sortie console et journal,
et, pour un rapport écrit à une fermeture normale, un **instantané du fichier de données de BMM**
(profils et réglages, y compris adresses et chemins de dossiers). **Les secrets sont masqués avant
l'écriture du zip** (`[REDACTED: N chars]`). Un zip de plantage ne contient pas DxDiag. Ces fichiers
restent sur votre ordinateur sauf si vous en envoyez ou partagez un vous-même.

### 7.3 Enregistrement local de la session
BMM garde un enregistrement masqué de la session en cours **sur votre disque** (segments de travail
dans son dossier de données, la dernière session dans `last_crash_session.bmmreplay`), pour qu'un
rapport de plantage montre ce qui s'est passé. Le journal et la sortie console enregistrés avec ne sont
pas masqués. L'**Enregistreur de session** (Paramètres → Débogage & dépannage) garde en plus chaque
session dans une liste locale. **Rien de tout cela n'est envoyé**, sauf si vous envoyez un rapport qui
le contient, ou si la relecture de session de la télémétrie (§5.2) est activée.

---

## 8. Autres fonctions qui contactent un serveur quand vous les utilisez

### 8.1 Server Repos
Se connecter à un Server Repo ou le synchroniser envoie des requêtes à son serveur, qui voit votre
**adresse IP** et votre **Creator ID**, pour que son propriétaire applique listes blanches et
bannissements. C'est le propriétaire du dépôt, pas l'équipe BMM, qui contrôle ce serveur. Un **mot de
passe de téléchargement** est envoyé avec vos requêtes pendant la session et jamais écrit sur le
disque. Les dépôts qui exigent une **clé d'identité** reçoivent une attestation signée de courte durée,
jamais la clé.

### 8.2 Héberger un Server Repo, publier en SSH
Si **vous** hébergez un dépôt, les personnes qui s'y connectent exposent **leur** adresse IP et leur
Creator ID à **votre** machine, et vous devenez responsable de ces journaux. Le flux d'état public
(`monitoring.json`) ne montre que des agrégats. Publier en SSH se connecte au serveur que **vous** avez
configuré ; la phrase de passe de la clé et les mots de passe sont lus au moment de l'usage et jamais
stockés.

### 8.3 Les documents que vous partagez portent votre identifiant d'auteur
Les modpacks (`.bmp`), catalogues de modpacks (`.cbmp`), tutoriels (`.bmmtut`) et automatisations que
vous exportez sont **signés avec votre clé de créateur** : quiconque les reçoit voit votre Creator ID.

### 8.4 Téléchargements et catalogues que vous ouvrez
Télécharger des plugins, des applications du catalogue ou des thèmes et ouvrir le blog communautaire
sont des requêtes HTTPS ordinaires : l'hôte voit votre adresse IP.

### 8.5 L'API locale de plugins
L'API de plugins n'écoute que sur `127.0.0.1`. Ses requêtes et votre jeton d'API restent sur votre
ordinateur.

### 8.6 Lier un compte BetterCommunity
Lier un compte envoie votre **Creator ID** à `bettercommunity.ch`, avec une preuve signée et
l'empreinte d'appareil hachée (§4.6), pour demander un code à usage unique, puis vérifie si le code a
été saisi. Aucun mot de passe ni e-mail n'est envoyé dans cet échange.

### 8.7 Notifications BetterCommunity (seulement avec une clé d'API)
Si, et seulement si, vous enregistrez une **clé d'API** BetterCommunity (limitée à
`notifications:read`), le processus natif de BMM interroge `bettercommunity.ch/v1/notifications`
**toutes les dix minutes**. La clé n'entre jamais dans la vue web ; elle est **stockée en clair** dans
le dossier de données de BMM. Supprimez-la depuis le même écran et révoquez-la depuis la page de votre
compte.

### 8.8 Démarrage automatique et fichiers locaux
Démarrer BMM avec Windows (proposé décoché par l'installeur) et tout ce que BMM écrit sur votre disque
n'envoie rien.

### 8.9 Intégrations que vous configurez
Tout ce que vous configurez vous-même (un webhook Discord, un tunnel Cloudflare, une tâche planifiée
qui appelle une adresse web) envoie des données à ce service, selon ses propres conditions.

### 8.10 Laya et IA optionnelle
**Laya hors ligne** exécute le classifieur Laya **sur votre PC** : le texte d'un mod ou d'un rapport
est lu dans la mémoire de BMM et **rien n'est envoyé nulle part**. Le pack du modèle est téléchargé une
fois (§4.5). BMM désactive les événements de télémétrie de la bibliothèque ONNX Runtime qu'il utilise
(selon Microsoft, un événement minimal de démarrage peut encore être écrit dans le traçage
d'événements local de Windows, que Windows ne transmet que selon vos propres réglages de données de
diagnostic). **Demander à Laya** répond à partir de ce qui est déjà sur votre PC ; la question n'est
jamais envoyée ni conservée.

Les **fournisseurs réseau sont désactivés par défaut**. Rien ne quitte votre PC sauf si vous activez
Paramètres → IA **et** choisissez un fournisseur réseau, et alors seulement quand vous cliquez
*Suggérer*, *brouillon* ou *indice IA* :

- **Ce qui est envoyé** pour un mod : nom, auteur, description, extraits du readme ou du manifeste,
  jusqu'à 40 noms de fichiers et les noms de vos tags, masqués d'abord, 4 000 caractères au plus ; pour
  un indice de rapport, le texte masqué du rapport. Le dialogue montre le texte exact envoyé.
- **Rédaction** (*Rédiger avec Laya*, avec un rédacteur que vous avez configuré) : le texte, les
  infos et la demande affichés sous *Ce qui sera envoyé*, seulement quand vous cliquez *Générer*. Un
  rédacteur sur ce PC (LM Studio, Ollama, llama.cpp) le reçoit en boucle locale et rien ne quitte
  votre PC ; avec une API externe, les données personnelles sont d'abord masquées et le texte ne va
  qu'à cette API.
- **À qui :** *BetterCommunity* (avec votre Creator ID, sa preuve signée et, si elle est enregistrée,
  votre clé d'API, après que vous avez coché la case de consentement) ; *votre propre serveur Laya*
  (sur ce PC par défaut) ; ou *une API externe* que vous configurez, selon ses propres conditions.
- Les clés saisies pour ces fournisseurs sont stockées par le système d'exploitation (DPAPI,
  trousseau).
- Désactivez l'IA dans Paramètres → IA, dans l'installeur (« Pas maintenant »), avec
  `--set=ai_features=false`, ou pour une session avec `--no-ai` / `BMM_NO_AI=1`. *Supprimer le modèle*
  efface le pack téléchargé.

---

## 9. Preuve du consentement : vos preuves de consentement

Chaque réponse que vous donnez au sujet de ces documents laisse une **preuve** : accepter les
Conditions d'utilisation ou cette Politique de confidentialité, et accepter, choisir, refuser ou
retirer la télémétrie (et les rapports d'erreurs en direct). Une preuve enregistre :

- le **document** (`tos`, `privacy`, `telemetry`, `crash_reports`) et sa **version** (pour les textes
  légaux, une empreinte du texte anglais en vigueur ; pour la télémétrie, la version du texte de
  consentement) ;
- le **SHA‑256 du texte exact affiché**, dans la langue où vous l'avez lu ;
- la **langue**, la **réponse** (accepté, accepté en partie, refusé, retiré, redemandé) et les choix
  par catégorie ;
- l'**heure**, la **source** (installeur, premier lancement, redemandé, Paramètres, un lien `bmm://`,
  l'API locale, la ligne de commande, le serveur MCP, un import de données), la **version de BMM** ;
- un **identifiant d'installation anonyme** : un nombre aléatoire créé pour les preuves, **pas**
  dérivé de votre matériel et **pas** votre Creator ID.

**Sur votre PC**, les preuves sont conservées dans le dossier de données de BMM
(`consent-ledger.jsonl`) sous forme de chaîne en ajout seul **qui révèle toute modification** : chaque
preuve porte l'empreinte de la précédente et un sceau à clé, de sorte qu'une preuve modifiée, retirée
ou insérée est détectée. Paramètres → Confidentialité → **Mes consentements** les liste, indique si la
chaîne est intacte, et les exporte en JSON. Elles restent jusqu'à ce que vous supprimiez le dossier de
données de BMM.

**Ce que BMM en fait.** Un réglage qui dit « accepté » ne suffit pas : BMM redemande chaque fois qu'il
n'existe pas de preuve pour la version en vigueur, par exemple après une mise à jour depuis une version
qui ne gardait pas de preuves, après l'import d'anciens réglages, ou quand le texte d'un document
change.

**Sur le serveur.** Les preuves sont envoyées au serveur de télémétrie (`…/consents`) **seulement si
la télémétrie est activée**, ou quand vous appuyez sur *Envoyer au serveur* dans Mes consentements. Ce
qui est envoyé : les preuves ci-dessus, rattachées à l'identifiant d'installation anonyme ; **aucune
adresse IP n'est stockée avec elles, et aucun texte**, seulement des empreintes, versions, réponses et
heures. Un refus ou un retrait fait alors que la télémétrie est désactivée reste donc sur votre PC
sauf si vous l'envoyez vous-même. Le serveur recalcule l'empreinte de chaque preuve, refuse celle qui
ne correspond pas, et les stocke **en ajout seul** (les lignes ne peuvent pas être modifiées).

- **Pourquoi :** pouvoir démontrer quel texte vous avez accepté ou refusé, et quand (RGPD art. 7(1) ;
  base légale art. 6(1)(c) et (f) ; nLPD art. 31).
- **Conservation :** 3 ans après qu'une preuve est remplacée par une réponse plus récente, ou après que
  l'installation n'a rien envoyé pendant cette durée (l'exploitant peut fixer une autre durée) ; la
  preuve d'un consentement toujours en vigueur est conservée tant que l'installation est active.
- **Effacement et accès :** indiquez l'identifiant d'installation affiché dans Mes consentements (§11).

---

## 10. Données stockées sur votre PC

Rien dans cette liste ne quitte votre PC, sauf si une section ci-dessus le dit.

| Quoi | Où | Supprimé par |
|---|---|---|
| Profils, mods, réglages, catalogues (`data.json` et fichiers associés) | Dossier de données de BMM | Supprimer le dossier de données de BMM |
| Magasin de la clé de créateur, épingle et journal de réinitialisation | Dossier de données de BMM, registre utilisateur / trousseau | Paramètres (réinitialiser), ou les supprimer |
| Preuves de consentement (`consent-ledger.*`, `consent-install-id`) | Dossier de données de BMM | Supprimer le dossier |
| Tampon de télémétrie (10 Mo au plus) | Dossier de données de BMM | Paramètres → Confidentialité (vider), ou désactiver la télémétrie |
| Journaux, rapports de plantage, enregistrements de session | Dossier de données de BMM | Paramètres → Débogage & dépannage, ou les supprimer |
| Téléchargements de mise à jour interrompus (`updates/*.part`) | Dossier local d'application de BMM | Supprimés après usage ou après une vérification échouée |
| Pack du modèle Laya | Dossier d'installation de BMM (`models/laya`) ou dossier de données | Paramètres → IA → *Supprimer le modèle* |
| Préférences de l'interface | Stockage local de la WebView | Désinstaller, ou effacer les données de BMM |
| Clés d'API et de fournisseurs enregistrées | Dossier de données de BMM (clé BetterCommunity : en clair) / magasin de clés du système | L'écran où vous les avez saisies |

---

## 11. Vos droits

Selon votre lieu de résidence (RGPD dans l'UE/EEE, RGPD britannique, nLPD suisse), vous avez le droit :

- d'**accéder** aux données vous concernant et d'en obtenir une **copie** (portabilité) ;
- de les faire **rectifier** ou **effacer** ;
- de **limiter** un traitement fondé sur l'intérêt légitime ou de vous y **opposer** ;
- de **retirer votre consentement** à tout moment, aussi facilement que vous l'avez donné (Paramètres →
  Confidentialité), sans effet sur ce qui a été fait avant ;
- d'**introduire une réclamation** auprès d'une autorité de contrôle : en Suisse le Préposé fédéral à
  la protection des données et à la transparence (PFPDT), dans l'UE l'autorité de votre pays de
  résidence.

**Comment :** Paramètres → Confidentialité fait l'essentiel directement (exporter ou vider le tampon,
demander l'effacement par paquet, demander une copie liée à votre Creator ID, voir et exporter vos
preuves de consentement). Pour le reste, écrivez au contact confidentialité du §1 en indiquant votre
Creator ID (télémétrie, rapports) ou votre identifiant d'installation anonyme (preuves de
consentement), ou ouvrez une issue sur [GitHub](https://github.com/FreeProject089/BetterModsManager)
**sans** y publier de données personnelles. Nous répondons sous un mois.

Les requêtes au démarrage du §4.1 et les tests de connexion du §4.3 ne peuvent pas encore être
désactivés dans BMM ; rester hors ligne les empêche.

---

## 12. Modifications de cette politique

Cette politique change avec l'application ; les changements importants sont signalés dans les notes de
version. Quand son texte change, BMM vous demande de l'accepter à nouveau et garde une preuve (§9). Les
versions précédentes restent dans l'historique du dépôt.

**Version 2026-10-13 (BMM 1.0.2) :** inventaire des flux de données (§3) ; bloc du responsable (§1) ;
l'étape de confidentialité de l'installeur et l'effet de chaque réponse (§2, §5) ; le téléchargement du
modèle Laya pendant l'installation, coché par défaut (§4.5) ; Discord Rich Presence dans *Tout
accepter* (§6) ; les téléchargements de mise à jour (§4.2) ; les drapeaux de flagcdn.com (§4.4) ; les
preuves de consentement et leur copie sur le serveur (§9) ; les données locales (§10) ; les droits
(§11) ; « la version anglaise prévaut ».
