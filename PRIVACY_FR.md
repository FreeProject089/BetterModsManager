# Politique de confidentialité — Better Mod Manager (BMM)

_Dernière mise à jour : 2026-06_

Better Mod Manager est une application de bureau **locale d'abord, open‑source** (sous licence GPL‑3.0).
Elle s'exécute sur votre machine et, par défaut, ne vous **pister** pas, n'affiche pas de publicité et
n'envoie aucune analyse/télémétrie. Ce document explique les rares cas où des données quittent votre
ordinateur, et précisément ce qui est envoyé.

---

## 1. Ce que nous ne faisons PAS

- **Aucune analyse ni télémétrie.** BMM n'intègre aucun SDK de pistage et ne « téléphone pas à la maison ».
- **Aucun compte requis.** Vous n'avez pas besoin de vous connecter pour utiliser BMM.
- **Aucune vente de données.** La plupart des fonctions sont 100 % hors ligne.

Toutes vos données — profils, mods, modpacks, plugins, réglages — sont stockées **localement** sur
votre disque (dans le dossier de données de BMM). Vous pouvez les exporter ou les supprimer à tout moment.

---

## 2. Quand des données quittent votre machine

### 2.1 Connexion / synchronisation d'un Server Repo
Lorsque vous **vous connectez** ou **synchronisez** depuis un Server Repo (un dépôt hébergé par un autre
utilisateur ou par vous), votre ordinateur effectue des requêtes HTTP vers ce serveur. Comme pour toute
requête réseau, le serveur peut voir :

- votre **adresse IP publique** (inévitable pour toute connexion réseau), et
- votre **Creator ID** (un identifiant public généré par BMM), envoyé pour que le propriétaire du dépôt
  puisse appliquer les listes blanches / bannissements et afficher des statistiques de connexion.

C'est le **propriétaire du dépôt** — et non l'équipe BMM — qui contrôle ce serveur et ses journaux.
Si vous utilisez BMM uniquement hors ligne, rien de cela ne se produit.

### 2.2 Héberger un Server Repo
Si **vous** hébergez un dépôt (host HTTP / génération), les personnes qui s'y connectent exposent **leur**
IP et Creator ID à **votre** machine (pour gérer bannissements/liste blanche). Vous devenez responsable de
ces journaux. Traitez les IP et Creator IDs des autres de façon responsable.

### 2.3 Rapports BetaHub (bugs & retours)
Lorsque vous soumettez volontairement un **rapport de bug** ou un **retour** via le formulaire BetaHub
intégré, les informations **que vous saisissez** sont envoyées au service BetaHub pour traitement. Cela
peut inclure : le titre/la description, la catégorie, et tout journal ou capture que vous choisissez de
joindre. Rien n'est envoyé tant que vous n'avez pas cliqué sur « Envoyer ».

### 2.4 Vérification des mises à jour & téléchargements
- BMM vérifie GitHub pour les nouvelles versions (et peut télécharger les plugins / apps du catalogue que
  vous demandez). Ce sont des requêtes HTTPS standard ; l'hôte distant voit votre IP.
- Télécharger un plugin communautaire ou une app du catalogue contacte l'URL indiquée pour cet élément.

### 2.5 Intégrations optionnelles
Toute fonction que vous configurez explicitement (ex. un webhook Discord, un tunnel Cloudflare) envoie des
données au service concerné, selon les conditions de confidentialité de ce service.

---

## 3. Tableau récapitulatif

| Action | Quitte votre PC ? | Données envoyées | Destinataire |
|---|---|---|---|
| Gérer mods, profils, modpacks | Non | — | — |
| Connexion / sync d'un Server Repo | Oui | IP publique, Creator ID | Propriétaire/serveur du dépôt |
| Héberger un Server Repo | Oui (entrant) | IP + Creator ID des visiteurs (stockés localement) | Vous (hôte) |
| Soumettre un rapport/retour BetaHub | Oui | Ce que vous saisissez + pièces jointes | Service BetaHub |
| Vérifier MAJ / télécharger plugin·app | Oui | Votre IP (HTTPS standard) | GitHub / hôte de téléchargement |

---

## 4. Votre contrôle

- Restez entièrement hors ligne pour éviter toute la section 2.
- Le Creator ID est un identifiant public (de type clé), pas votre nom ni votre email.
- Vous pouvez effacer les données stockées localement dans le dossier de données de BMM.

## 5. Contact

Une question ? Ouvrez une issue sur le dépôt GitHub :
<https://github.com/FreeProject089/BetterModsManager>

> Cette politique peut évoluer avec l'application. Les changements importants seront indiqués dans les
> notes de version.
