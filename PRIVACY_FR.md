# Politique de confidentialité — Better Mod Manager (BMM)

_Dernière mise à jour : 2026-06_

Better Mod Manager est une application de bureau **locale d'abord, open‑source** (licence GPL‑3.0).
Elle fonctionne sur votre machine et, par défaut, ne vous piste pas et n'affiche pas de publicité.
BMM inclut une **télémétrie optionnelle, sur consentement** qui est **DÉSACTIVÉE tant que vous ne
l'activez pas explicitement**. Ce document explique les cas où des données quittent votre ordinateur,
et exactement ce qui est envoyé.

---

## 1. Ce que nous ne faisons PAS

- **Aucun pistage sans consentement.** La télémétrie est **désactivée par défaut** dans BMM
  lui-même. **Une exception, dite clairement :** lors d'une installation via BetterInstaller, la
  page Configuration affiche la case télémétrie **déjà cochée**. Elle est visible et vous pouvez
  la décocher avant d'installer — mais si vous passez cette page sans la lire, la télémétrie
  finit activée. Réglages → Confidentialité permet de la couper à tout moment.
  Hors installateur, rien n'est collecté ni envoyé tant que vous ne l'activez pas sur l'écran de
  consentement au premier lancement (ou plus tard dans Réglages → Confidentialité).
- **Aucun compte requis.** Pas besoin de vous connecter pour utiliser BMM.
- **Nous ne vendons jamais vos données personnelles.** Vos données ne sont pas le produit et ne sont
  jamais vendues ni partagées à des fins publicitaires. (Ceci concerne vos données — ce n'est pas une
  déclaration sur les produits de BMM ni sur d'éventuels services payants, présents ou futurs.)
- **Jamais le contenu de vos fichiers ou mods.** Nous ne lisons ni n'envoyons jamais le contenu de
  vos mods, fichiers, ou ce que vous saisissez dans les champs.

Toutes vos données — profils, mods, modpacks, plugins, réglages — sont stockées **localement** sur
votre disque (dans le dossier de données de BMM). Vous pouvez les exporter ou les supprimer à tout moment.

---

## 2. Télémétrie optionnelle (opt‑in)

Si — et seulement si — vous activez la télémétrie, BMM envoie des **données d'usage anonymes et
agrégées** à un tableau de bord BMM auto‑hébergé, pour aider l'équipe à améliorer l'application. Les
données sont mises en cache localement et envoyées par lots via **HTTPS** ; chaque lot porte un
**identifiant de paquet** aléatoire pour pouvoir le faire effacer plus tard (voir §2.4).

### 2.1 Ce qui est collecté (si activé)
- **Identité pseudonyme — votre Creator ID.** Ce **n'est pas un hash aléatoire.** Votre Creator ID est
  la **moitié publique d'une paire de clés cryptographiques Ed25519** que BMM génère **une seule fois,
  sur votre machine** (la **clé privée correspondante ne quitte jamais votre PC** — stockée dans votre
  registre utilisateur et scellée à cette machine, donc la copier ailleurs est rejeté). Le Creator ID
  s'affiche en chaîne hexadécimale de 64 caractères et sert à **signer cryptographiquement** les repos
  que vous publiez, pour que d'autres vérifient l'authenticité et appliquent listes blanches/bans.
  Deux conséquences : **(a)** il ne contient **ni** nom, ni e‑mail, ni détail personnel — c'est une clé
  publique, pas une pièce d'identité ; mais **(b)** comme il est **stable** (il ne tourne pas), la
  télémétrie envoyée sous le même Creator ID au fil du temps est **rattachable à la même installation**.
  Si vous n'avez pas encore de clé, un identifiant aléatoire par installation est utilisé. Vous pouvez
  voir votre Creator ID à tout moment dans BMM.
- **Profil système (type DxDiag) :** OS, CPU, GPU(s), RAM, nombre/taille des disques, exécution en
  machine virtuelle, carte mère, langue. Informations matérielles/diagnostic uniquement.
- **Usage de l'app :** quelles pages/vues vous ouvrez, quelles fonctions vous utilisez, quels
  **modals** vous ouvrez, tutoriels lancés, durée de session et parcours de navigation.
- **Performance :** images par seconde, temps de frame, pire frame (jank), tas JavaScript (mémoire),
  et Web‑Vitals (temps de chargement) de l'interface.
- **Benchmarks :** chronométrage du benchmark interne de BMM, dont les temps par opération et le
  **débit (Mo/s)** — aucun contenu de fichier.
- **Préférences :** thème actif (et s'il est intégré ou personnalisé), langue, réglages Tasky, et le
  **mode d'accès au système de fichiers** que vous avez choisi.
- **Décomptes de contenu uniquement :** combien de mods / profils / plugins / modpacks / tags /
  launch packs / apps vous avez — **des nombres, jamais les noms ni le contenu**.
- **Capture d'interaction (respectueuse) :** **libellés** des boutons cliqués, soumissions de
  formulaire, **noms** des champs modifiés, copies, clics sortants, et erreurs — **jamais les valeurs
  que vous saisissez**.
- **Relecture de session (rrweb, masquée par défaut) :** si la capture de relecture est activée, BMM
  enregistre une reconstruction de l'**interface** pendant votre session — structure du DOM et
  événements d'interface (clics, défilement, navigation) — pour que l'équipe voie *comment* un
  problème est survenu. **Tous les champs de saisie sont masqués par défaut** : les caractères que
  vous tapez sont remplacés par des points et ne sont jamais enregistrés. Une option distincte et
  explicite **« complet (non masqué) »** existe pour votre propre débogage local ; elle reste
  désactivée tant que vous ne l'activez pas. La relecture ne couvre que la fenêtre BMM — jamais les
  autres applications ni votre écran.
- **Enregistrement local de crash (toujours actif, jamais envoyé) :** pour aider à diagnostiquer les
  plantages, BMM garde en continu un court enregistrement **en mémoire** de la session en cours (même
  masquage que ci-dessus). Il n'est **jamais sauvegardé en fichier ni transmis** — *sauf* que, **si
  BMM plante**, le dernier enregistrement est écrit dans le **rapport de crash `.zip` local** afin que
  vous (ou, uniquement si vous choisissez de partager ce zip) puissiez voir ce qui s'est passé juste
  avant. Activer l'**Enregistreur de session** (Paramètres → Débogage & dépannage) sauvegarde en plus
  chaque session dans une liste de relectures **locale** sur votre disque. Rien n'est téléversé ; les
  rapports de crash restent sur votre machine tant que vous n'en envoyez pas un vous-même.
- **Localisation approximative :** déduite **côté serveur à partir de votre IP** (pays / région /
  ville). La localisation est **arrondie et jamais précise** — votre position exacte n'est jamais
  stockée ni affichée.

### 2.1.b Rapport matériel étendu (opt‑in, lié au benchmark hebdomadaire)
Si vous laissez l'option **« Benchmark automatique (tous les 7 jours) + rapport matériel étendu »**
**activée** (écran de consentement, ou Réglages → Confidentialité), BMM envoie en plus un rapport
**d'identité matérielle précise** pour corréler performances/benchmarks avec des configurations
exactes. Il n'est envoyé **que** lorsque cette option est active, et l'écran de consentement en
affiche la liste complète avant que vous acceptiez. Il inclut : **carte mère** (modèle + numéro de
série), **BIOS** version/date/fabricant, **UUID machine**, **CPU** processeurs logiques + cœurs/threads
+ cache L2/L3, **disques** (modèle, série, taille, interface), **adresse(s) MAC réseau physique**,
**version + build de l'OS / noyau**, et **UEFI vs Legacy**, état **Secure Boot** et **TPM** si
disponibles. Ce sont des **identifiants matériels stables** — plus identifiants que le profil de base
— d'où leur caractère **opt‑in et signalé séparément**. Désactivez l'option pour n'envoyer que le
profil système de base (§2.1) et ignorer tout ceci. Toujours aucun contenu de fichier, aucune valeur
saisie, aucune identité personnelle.

### 2.2 Ce qui n'est PAS collecté
Le contenu des fichiers, les noms ou contenus de mods, le texte/les valeurs que vous saisissez
(également masquées dans la relecture de session), votre identité réelle, votre position GPS précise,
et tout ce qui provient de fonctions non utilisées.

### 2.3 Consentement et contrôle
- La télémétrie est **désactivée par défaut** dans BMM lui-même — mais la page Configuration de
  BetterInstaller la **pré-coche** (visible, et décochable à cet endroit). Vous choisissez au premier lancement et pouvez changer
  à tout moment dans **Réglages → Confidentialité**.
- Désactivée, **rien n'est collecté** ni envoyé.
- Vous pouvez **exporter** tout ce que BMM a mis en cache, et **effacer** le cache local à tout moment.
- Le panneau Confidentialité liste chaque **paquet** envoyé (id, heure, et un résumé des *types
  d'événements* contenus — noms et nombres uniquement).

### 2.4 Droit à l'effacement (par paquet)
Pour tout paquet, vous pouvez cliquer sur **« Demander la suppression »**. La demande est appliquée
**après un court délai de vérification obligatoire (≤ 72 h)**, ou **immédiatement** si un admin BMM
l'approuve. Une fois effacé, les lignes exactes liées à cet identifiant de paquet sont supprimées du
tableau de bord et le paquet passe à **« Supprimé »**. Si une demande est refusée, le bouton
**« Demander la suppression »** réapparaît pour redemander.

### 2.5 Conservation et sécurité
- Les données collectées sont **purgées automatiquement** du tableau de bord après une durée fixe.
- L'ingestion utilise une **clé publique** qui permet seulement de *soumettre* de la télémétrie ; les
  actions d'administration (approbation des suppressions) nécessitent une **clé privée détenue
  uniquement sur le serveur**.
- Le tableau de bord est **limité en débit** par client pour empêcher les abus.

---

## 3. Quand des données quittent votre machine (hors télémétrie)

### 3.1 Connexion / synchronisation d'un Server Repo
Quand vous **vous connectez** à un Server Repo ou le **synchronisez**, votre ordinateur fait des
requêtes HTTP vers ce serveur, qui peut voir votre **adresse IP publique** et votre **Creator ID**
(pour appliquer listes blanches / bannissements et statistiques). Le propriétaire du repo — **pas**
l'équipe BMM — contrôle ce serveur. Hors‑ligne, rien de tout ceci n'arrive.

### 3.2 Héberger un Server Repo
Si **vous** hébergez un repo, ceux qui se connectent exposent **leur** IP et Creator ID à **votre**
machine (pour gérer bans/liste blanche). Vous devenez responsable de ces journaux.

### 3.3 Rapports BetaHub (bugs & retours)
Quand vous envoyez volontairement un **rapport de bug** ou un **retour**, les informations **que vous
saisissez** (plus les journaux/captures joints) sont envoyées au service BetaHub. Rien n'est envoyé
sans validation.

### 3.4 Vérifications de mise à jour & téléchargements
BMM vérifie GitHub pour les nouvelles versions et télécharge les plugins / apps du catalogue que vous
demandez — requêtes HTTPS standard ; l'hôte distant voit votre IP.

### 3.5 Vidéos tutorielles intégrées (YouTube)
La **Documentation** intégrée peut afficher des vidéos tutorielles **YouTube**. Lorsque vous êtes en
ligne et ouvrez une page avec une vidéo intégrée, votre moteur de navigation la charge directement
depuis YouTube/Google, qui peut voir votre IP et déposer des cookies selon la politique de
confidentialité de **Google** (nous utilisons l'intégration de type `youtube‑nocookie` quand c'est
possible). Hors ligne, une vidéo locale est affichée à la place et rien n'est contacté.

### 3.6 Liaison d'un compte BetterCommunity (optionnel)
Si vous choisissez de lier un compte, BMM envoie votre **Creator ID** à bettercommunity.ch pour
demander un code à usage unique, puis interroge le serveur pour savoir si ce code a été saisi. Le
Creator ID est un identifiant, pas un secret — vous le donnez déjà aux propriétaires de dépôts
pour figurer dans leurs listes blanches. Aucun mot de passe ni adresse e-mail n'est envoyé par BMM
au cours de cet échange.

### 3.7 Notifications BetterCommunity (optionnel, nécessite une clé d'API)
Si — et seulement si — vous enregistrez une **clé d'API** BetterCommunity dans *Réglages →
Identité & API*, BMM demande les notifications de ce compte à
`bettercommunity.ch/v1/notifications` **toutes les dix minutes** pendant que l'app est ouverte, et
les affiche dans son centre de notifications.

Trois points méritent d'être énoncés clairement, car c'est la seule requête de BMM qui transporte
un identifiant d'authentification :

- **La clé n'entre jamais dans la vue web.** Elle est stockée dans le dossier de données de BMM et
  lue uniquement par le processus natif, qui effectue la requête. L'interface peut en enregistrer
  une, demander s'il en existe une, et la supprimer — elle ne peut jamais la relire.
- **Elle est limitée en portée.** La clé que vous créez porte `notifications:read` et rien
  d'autre. Compromise, elle permet de lire vos notifications ; elle ne peut ni publier, ni payer,
  ni modifier votre compte.
- **Elle est stockée en clair sur le disque.** Quiconque peut lire votre dossier de données peut
  lire la clé. Vous pouvez la retirer à tout moment depuis le même écran, et la révoquer depuis
  votre page de compte sur le site — ce qui invalide aussi toute copie qui en aurait été faite.

Sans clé enregistrée, aucune requête n'est jamais effectuée.

### 3.8 Intégrations optionnelles
Toute fonction que vous configurez explicitement (webhook Discord, tunnel Cloudflare, …) envoie des
données au service configuré, selon ses propres conditions.

---

## 4. Tableau récapitulatif

| Action | Quitte votre PC ? | Données envoyées | Destinataire |
|---|---|---|---|
| Naviguer/gérer mods, profils, modpacks | Non | — | — |
| **Télémétrie OFF (défaut)** | Non | — | — |
| **Télémétrie ON (opt‑in)** | Oui | Usage anonyme, profil système, performance, géo approximative (décomptes/libellés — pas de contenu/valeurs) | Tableau de bord BMM auto‑hébergé |
| Connexion / sync d'un Server Repo | Oui | IP publique, Creator ID | Propriétaire/serveur du repo |
| Héberger un Server Repo | Oui (entrant) | IP + Creator ID des visiteurs stockés localement | Vous (hôte) |
| Envoyer un rapport/retour BetaHub | Oui | Ce que vous saisissez + pièces jointes | Service BetaHub |
| Vérifier les MAJ / télécharger plugin/app | Oui | Votre IP (HTTPS standard) | GitHub / hôte de téléchargement |
| Lier un compte BetterCommunity | Oui | Creator ID (un identifiant, pas un secret) | bettercommunity.ch |
| **Notifications BetterCommunity** (uniquement avec une clé d'API enregistrée) | Oui, toutes les 10 min | Une clé d'API limitée à `notifications:read` | bettercommunity.ch |

---

## 5. Votre contrôle

- La télémétrie est **opt‑in** ; laissez‑la désactivée (ou restez hors‑ligne) pour éviter tout le §2.
- Désactivez la télémétrie quand vous voulez ; exportez ou effacez le cache local ; demandez
  l'effacement par paquet.
- Le Creator ID est votre **clé publique de signature** (Ed25519), pas votre nom ni e‑mail ; la clé
  privée reste sur votre PC. Il est stable, donc l'activité associée est rattachable dans le temps — voir §2.1.

## 6. Contact

Des questions ? Ouvrez une issue sur le dépôt GitHub :
<a href="https://github.com/FreeProject089/BetterModsManager" target="_blank" rel="noopener noreferrer">
BetterModsManager
</a>

> Cette politique peut évoluer avec l'application. Les changements importants seront notés dans les
> notes de version.
