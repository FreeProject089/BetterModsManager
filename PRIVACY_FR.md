# Politique de confidentialité — Better Mod Manager (BMM)

_Dernière mise à jour : 2026-06_

Better Mod Manager est une application de bureau **locale d'abord, open‑source** (licence GPL‑3.0).
Elle fonctionne sur votre machine et, par défaut, ne vous piste pas et n'affiche pas de publicité.
BMM inclut une **télémétrie optionnelle, sur consentement** qui est **DÉSACTIVÉE tant que vous ne
l'activez pas explicitement**. Ce document explique les cas où des données quittent votre ordinateur,
et exactement ce qui est envoyé.

---

## 1. Ce que nous ne faisons PAS

- **Aucun pistage sans consentement.** La télémétrie est **opt‑in** et **désactivée par défaut**.
  Rien n'est collecté ni envoyé tant que vous ne l'activez pas sur l'écran de consentement au premier
  lancement (ou plus tard dans Réglages → Confidentialité).
- **Aucun compte requis.** Pas besoin de vous connecter pour utiliser BMM.
- **Aucune revente de données.** Nous n'avons rien à vendre — la plupart des fonctions sont 100 % hors‑ligne.
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
- **Identité anonyme :** votre **Creator ID** (un identifiant public, de type clé — ni nom ni e‑mail),
  ou un identifiant aléatoire par installation si vous n'en avez pas.
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
- **Localisation approximative :** déduite **côté serveur à partir de votre IP** (pays / région /
  ville). La localisation est **arrondie et jamais précise** — votre position exacte n'est jamais
  stockée ni affichée.

### 2.2 Ce qui n'est PAS collecté
Le contenu des fichiers, les noms ou contenus de mods, le texte/les valeurs que vous saisissez, votre
identité réelle, votre position GPS précise, et tout ce qui provient de fonctions non utilisées.

### 2.3 Consentement et contrôle
- La télémétrie est **désactivée par défaut**. Vous choisissez au premier lancement et pouvez changer
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

### 3.5 Intégrations optionnelles
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

---

## 5. Votre contrôle

- La télémétrie est **opt‑in** ; laissez‑la désactivée (ou restez hors‑ligne) pour éviter tout le §2.
- Désactivez la télémétrie quand vous voulez ; exportez ou effacez le cache local ; demandez
  l'effacement par paquet.
- Le Creator ID est un identifiant public de type clé, pas votre nom ni e‑mail.

## 6. Contact

Des questions ? Ouvrez une issue sur le dépôt GitHub :
<a href="https://github.com/FreeProject089/BetterModsManager" target="_blank" rel="noopener noreferrer">
BetterModsManager
</a>

> Cette politique peut évoluer avec l'application. Les changements importants seront notés dans les
> notes de version.
