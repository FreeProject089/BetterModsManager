# Le format de dépôt, et comment le générateur le construit


Un **Dépôt Serveur** est un dossier que vous pouvez placer derrière n'importe quel serveur
web. Il contient les fichiers de mods et un manifeste, `repo.json`, qui les décrit assez
précisément pour qu'un autre BMM sache ce qu'il possède déjà et ce qu'il doit récupérer.

Cette page documente le format lui-même — chaque champ, ce qui est obligatoire, et ce que
chacun change — pour que vous puissiez générer un dépôt sans BMM, lire celui qu'on vous a
transmis, ou comprendre pourquoi une synchronisation retélécharge ce qu'elle aurait dû
sauter.

Tout ce qui suit est tiré de `src-tauri/src/models/repo.rs` et
`src-tauri/src/commands/repo.rs`. En cas de désaccord entre eux et cette page, ce sont eux
qui ont raison et cette page qui est un bug.

---

## 1. Ce que le générateur écrit

L'export d'un dépôt produit un dossier contenant :

| Chemin | Ce que c'est |
|---|---|
| `repo.json` | Le manifeste. Le seul fichier strictement nécessaire à un consommateur. |
| `mods/` | Les fichiers de mods, un dossier par id de mod. |
| `Info.json` | Un résumé lisible (compteurs, taille totale). Non consommé par BMM. |
| `bans.json` | Liste de bannissement, utilisée uniquement par le mini-serveur fourni. |
| `BMM-Standalone-Server.bat` / `.sh` | Lanceurs du mini-serveur. |
| `Dockerfile`, `docker-compose.yml`, `package.json`, `public/` | Le mini-serveur, si vous l'avez demandé. |
| `.env` (+ une ligne `.env` dans `.gitignore`, `.dockerignore`) | Le mot de passe admin du mini-serveur, lu par `docker-compose.yml` (`env_file`). Jamais servi, jamais commité. |

Seuls `repo.json` et `mods/` comptent pour un consommateur. Le reste est un confort pour
héberger le dépôt vous-même, et vous pouvez le supprimer si vous servez le dossier avec
votre propre nginx, Caddy, ou l'hébergement BetterCommunity.

---

## 2. `repo.json` — le niveau racine

```json
{
  "name": "Mon dépôt",
  "description": null,
  "author": "Quelqu'un",
  "author_id": null,
  "signature": null,
  "version": "1.0",
  "game_name": "DCS World",
  "created_at": "2026-08-13T04:51:49Z",
  "seed": null,
  "upload_limit": null,
  "profiles": [ … ],
  "modpacks": null
}
```

**Obligatoires** — la clé doit être présente, même si plusieurs acceptent `null` :

| Champ | Type | Remarques |
|---|---|---|
| `name` | chaîne | Nom du dépôt. |
| `description` | chaîne \| null | |
| `author` | chaîne \| null | Nom affiché. |
| `author_id` | chaîne \| null | Identifiant BetterCommunity de l'auteur, s'il en a un. |
| `signature` | chaîne \| null | Signature d'intégrité optionnelle sur le manifeste. |
| `version` | chaîne | La version **du dépôt** — le numéro de l'auteur. Pas le format : c'est `format_version`. |
| `game_name` | chaîne | Texte libre ; regroupe les profils par jeu. |
| `created_at` | chaîne | Horodatage, RFC 3339. |
| `seed` | chaîne \| null | |
| `upload_limit` | nombre \| null | Plafond suggéré par l'auteur, en Ko/s. |
| `profiles` | tableau | Le contenu. Voir §3. |
| `modpacks` | tableau \| null | Modpacks partagés. Voir §6. |

**Optionnels** — omettez-les entièrement et BMM applique la valeur par défaut documentée :

| Champ | Type | Défaut | Rôle |
|---|---|---|---|
| `require_login` (`requireLogin`) | booléen | `false` | Chaque téléchargement doit présenter une identité BetterCommunity. |
| `files_base_url` (`filesBaseUrl`) | chaîne | l'URL du dépôt | Servir les fichiers depuis un autre hôte que le manifeste. |
| `files_layout` (`filesLayout`) | chaîne | `mods/{id}/{path}` | Où se trouve un fichier, relativement à la base. Voir §5. |
| `format_version` (`formatVersion`) | chaîne | aucun (ancien) | Le **format** dans lequel le manifeste est écrit. BMM écrit `"1.0"`, signé avec le reste. Voir §9. |

> Un champ obligatoire de type `… | null` exige quand même sa clé. L'omettre est une erreur
> d'analyse, et une erreur d'analyse fait lire le dépôt entier comme **vide** — pas comme
> « partiellement cassé ». C'est de loin la façon la plus courante dont un manifeste écrit
> à la main échoue.

---

## 3. Profils

```json
{
  "id": "prof-1",
  "name": "Principal",
  "game_name": "DCS World",
  "mods": [ … ],
  "icon": null,
  "color": null,
  "icon_image": null
}
```

`id`, `name`, `game_name` et `mods` sont obligatoires. `icon`, `color` et `icon_image` sont
optionnels et n'affectent que l'apparence du profil une fois importé — ils existent pour
que le destinataire voie le profil tel que son auteur l'a arrangé.

---

## 4. Mods et fichiers

```json
{
  "id": "cool-mod",
  "name": "Cool Mod",
  "version": "1.0",
  "author": null,
  "description": null,
  "tags": [],
  "files": [ … ],
  "download_links": []
}
```

Obligatoires : `id`, `name`, `version`, `author`, `description`, `tags`, `files`,
**`download_links`**.

> `download_links` est obligatoire et **sans valeur par défaut**. Un mod sans ce champ fait
> échouer le document entier. Cela mérite d'être dit fort, car l'échec est silencieux : le
> manifeste est rejeté, et le dépôt semble simplement ne rien contenir.

Optionnels : `archive`, `dependencies`, `changelog`, `update_url`, `direct_url`,
`update_sources`.

`archive` concerne les dépôts générés avec « mods zippés » : les fichiers du mod sont
empaquetés dans une archive unique et `files` est alors vide. Son absence signifie la
disposition classique, fichier par fichier.

### Une entrée de fichier

```json
{
  "relative_path": "Data/textures/a.dds",
  "size": 2048,
  "sha256_hash": "…",
  "chunks": null,
  "mtime": 1786593318
}
```

| Champ | Obligatoire | Remarques |
|---|---|---|
| `relative_path` | oui | Relatif au **mod**, pas au dépôt. Barres obliques. |
| `size` | oui | Octets exacts. Jamais arrondis — voir ci-dessous. |
| `sha256_hash` | oui | Du fichier entier. Peut valoir `""` s'il est réellement inconnu. |
| `chunks` | oui (peut valoir `null`) | Hachages par bloc pour les gros fichiers. Voir §4.1. |
| `mtime` | non | Secondes Unix. Son absence signifie « inconnu ». |

**Pourquoi les tailles doivent être exactes.** Un rafraîchissement compare la taille et la
date qu'il voit à celles du manifeste pour décider si un fichier a changé. Un « 1,2 K »
lisible comparé à un décompte exact marque *tous* les fichiers comme modifiés : la
synchronisation retélécharge alors tout — ça marche encore, ça cesse juste discrètement de
servir à quelque chose.

**Pourquoi `mtime` compte.** C'est ce qui permet à un rafraîchissement de sauter un fichier
déjà présent. Sans lui, le planificateur lit « inconnu » et re-hashe, à chaque fois. Il
n'est jamais utilisé pour valider un téléchargement — c'est toujours le hachage. Son
absence est sûre, seulement coûteuse.

### 4.1 Découpage en blocs

Les fichiers de plus de **4 Mio** (`CHUNK_SIZE`) portent en plus un tableau `chunks` :

```json
"chunks": [ { "size": 4194304, "sha256_hash": "…" }, { "size": 1048576, "sha256_hash": "…" } ]
```

Les deux champs sont obligatoires sur chaque bloc. Les fichiers plus petits portent
`"chunks": null`. Les blocs permettent de reprendre et de vérifier un gros téléchargement
par morceaux au lieu de le recommencer.

---

## 5. Où se trouvent réellement les fichiers

Par défaut, un fichier de mod est récupéré à :

```
<URL de base du dépôt>/mods/<id du mod>/<relative_path>
```

Deux champs optionnels modifient cela, et tous deux existent pour la même raison — un
hébergement qui sert déjà vos mods à un endroit de son choix :

- **`files_base_url`** remplace la base. À utiliser quand le manifeste et les fichiers sont
  sur des hôtes différents. La barre finale est normalisée pour vous, car `host//mods/…` et
  `hostmods/…` n'échouent pas bruyamment — ils renvoient juste un 404 sur chaque fichier.
- **`files_layout`** est un gabarit sur `{id}` et `{path}`. La valeur par défaut,
  `mods/{id}/{path}`, est exactement ce que signifie tout manifeste écrit avant l'existence
  de ce champ. Un `/` initial est retiré : il se lirait comme « racine de l'hôte » et
  effacerait silencieusement tout chemin déjà présent dans l'URL de base.

Exemple — fichiers servis à plat, sur un CDN :

```json
"files_base_url": "https://cdn.example.com/repo/",
"files_layout": "{id}/{path}"
```

---

## 6. Modpacks partagés

`modpacks` contient des entrées de la forme :

```json
{ "modpack": { … }, "share_mode": "public", "custom_whitelist": null }
```

`share_mode` décide qui voit le pack lorsque le dépôt est servi par le mini-serveur de BMM,
qui filtre `repo.json` par demandeur :

| `share_mode` | Qui le reçoit |
|---|---|
| `public` | Tout le monde. |
| `whitelist_repo` | Toute personne non bannie et — si la liste blanche du dépôt est active — inscrite dessus. |
| `whitelist_custom` | Uniquement les Creator ID listés dans `custom_whitelist`. |

Toute autre valeur est traitée comme « personne ». À noter : ce filtrage est l'œuvre du
mini-serveur. Un hébergement statique classique sert le manifeste tel qu'il est écrit — ne
comptez donc pas sur `share_mode` comme frontière de sécurité si vous hébergez le dossier
vous-même.

---

## 7. L'héberger sans BMM

Le manifeste est un fichier statique : n'importe quel serveur web convient. Deux choses
rendent un simple serveur de fichiers agréable à synchroniser :

1. **Servir un index de répertoire.** BMM sait parcourir un listing au lieu d'un manifeste
   — il lit le format autoindex de nginx et utilise la taille et la date de chaque ligne
   pour éviter de re-hasher ce qui n'a pas changé. Le format est strict : une entrée par
   ligne, un seul segment de chemin par lien, les répertoires affichés avec `-` au lieu
   d'une taille, et les dates en `jj-Mon-aaaa HH:MM` UTC.
2. **Annoncer des tailles exactes**, pour la raison du §4.

L'hébergement BetterCommunity fait les deux, et en plus **génère le manifeste pour vous** :
vous envoyez vos fichiers et vous publiez, sans `repo.json` à écrire. Un manifeste envoyé
garde la priorité là où il existe, car il porte des noms de profils, des versions de mods,
des tags et des tables de blocs qu'aucune liste de fichiers ne peut reconstituer.

---

## 8. Diagnostiquer un manifeste

| Symptôme | Cause habituelle |
|---|---|
| Le dépôt apparaît complètement vide | Une erreur d'analyse. Le plus souvent une clé obligatoire omise au lieu d'être mise à `null` — `download_links` d'abord, puis `chunks`. |
| Chaque synchronisation retélécharge tout | Tailles arrondies, `mtime` absent, ou hachage vide. |
| Des fichiers isolés en 404 | `files_base_url` / `files_layout` ne correspondent pas à l'emplacement réel. Construisez une URL à la main depuis le §5 et ouvrez-la. |
| Un modpack manque pour certains utilisateurs | `share_mode`, et seulement quand le dépôt est servi par le mini-serveur (§6). |
| BMM affiche « format 2.0 (plus récent que ce BMM) » et refuse le dépôt | Le manifeste déclare une version majeure de format que ce BMM ne lit pas. Mettez BMM à jour ; le dépôt n'a rien. |
| Le dépôt affiche « ancien 0.x » | Écrit par un BMM d'avant les versions de format. Il se synchronise toujours ; le §9 explique comment le convertir. |

---

## 9. Versions de format, et convertir un ancien manifeste

Jusqu'au format 1.0, un manifeste ne disait rien de sa propre forme — `version` est la
version du dépôt, pas celle du format. Un manifeste la déclare désormais à la racine :

```json
{ "name": "Mon dépôt", "…": "…", "format_version": "1.0" }
```

Chaque écrivain de BMM (export, mise à jour, manifeste seul, extras, modpacks, rafraîchir
depuis le serveur) l'inscrit **avant** de signer : la signature le couvre.

### 9.1 Le registre

| Format | Nom | BMM l'écrit depuis | Ce qu'il a ajouté |
|---|---|---|---|
| `0.1` | premier export | 2026-03 | nom, description, auteur, version, jeu, profils ; mods avec tags et fichiers (chemin, taille, sha256) |
| `0.2` | signé | 2026-03 | `author_id` + `signature` (ed25519), `seed`, `upload_limit` ; `download_links` des mods ; morceaux de fichiers |
| `0.3` | modpacks | 2026-04 | `modpacks`, `require_login` ; mods zippés (`archive`), dépendances, changelog, sources de mise à jour ; icône et couleur de profil |
| `0.4` | hébergement | 2026-08 | `files_base_url`, `files_layout`, `mtime` des fichiers, `extras`, identifiants scellés |
| `1.0` | versionné | 2026-10 | `format_version` ; toutes les clés obligatoires écrites ; la signature couvre le format |

Les numéros `0.x` sont attribués après coup : ces manifestes ne les portaient pas. BMM les
reconnaît à leur **forme** — le marqueur le plus récent l'emporte (un `files_layout` en fait
un 0.4 même si rien d'autre de 0.4 n'est présent).

### 9.2 Ce que BMM fait de chacun

| Ce que dit le manifeste | Étiquette sur la page Server Repo | Ce qui se passe |
|---|---|---|
| `format_version: "1.0"` | **format 1.0** | Lu tel quel. |
| rien, forme 0.2 à 0.4 | **ancien 0.x — convertir** | Lu tel quel. Convertir est conseillé, pas obligatoire. |
| rien, forme 0.1 (pas de `download_links`) | **ancien 0.1 — convertir** | Le lecteur actuel refuse cette forme en bloc — elle s'affichait comme un dépôt vide. BMM la lit maintenant via une mise à niveau en mémoire, **sauf si elle est signée** : compléter des clés change les octets signés, donc un 0.1 signé reste illisible jusqu'à ce que son propriétaire le convertisse. |
| `format_version: "1.x"`, x supérieur à 0 | format 1.x | Lu ; les champs inconnus de ce BMM sont ignorés. Jamais converti « vers le bas ». |
| `format_version: "2.0"` ou plus | format 2.0 (plus récent que ce BMM) | **Refusé**, avec cette raison. Mettez BMM à jour. |
| `format_version` qui n'est pas un nombre | — | Refusé comme invalide. |

Un manifeste qui annonce `1.0` mais à qui il manque une clé obligatoire est traité comme un
ancien : lu via la mise à niveau, proposé à la conversion.

### 9.3 Convertir

Le convertisseur est un seul code, atteint de quatre façons — le bouton **Convertir…** à côté
du badge de format sur la page Server Repo, `POST /api/repo/convert`, `bmm repo-convert`, et
l'outil MCP `bmm_repo_convert`. Il fait toujours :

1. **Un plan d'abord** (essai à blanc) : chaque clé qu'il ajouterait, chaque valeur qu'il
   normaliserait (`""` → `null` pour la description et l'auteur, graphies camelCase →
   snake_case, tags en simple chaîne → objets tag), chaque hachage qu'il remplirait ou
   corrigerait, chaque fichier introuvable.
2. **Un nouveau hachage** de chaque fichier listé depuis le dossier, avec la règle de
   l'exporteur (sha256 du fichier entier, plus une table de morceaux au-delà de 4 Mio), en
   suivant `files_layout` et les archives de mods zippés. Un chemin qui sortirait du dossier
   n'est jamais lu. Les fichiers hébergés ailleurs (`files_base_url`) sont laissés tels
   quels. Un fichier manquant garde son entrée et est signalé.
3. Une vérification que le résultat **se charge dans le vrai lecteur de BMM** avant toute
   écriture.
4. **Une sauvegarde** de l'ancien manifeste à côté, sous `repo.json.v<ancien>-<aaaammjj-hhmmss>.bak`
   (jamais servie : les serveurs ne servent que `repo.json` et `info.json` à la racine).
5. L'inscription de `format_version`, **une nouvelle signature** avec la clé de ce BMM, et
   l'écriture via un fichier temporaire renommé par-dessus l'ancien : une panne laisse
   l'ancien manifeste, jamais la moitié d'un nouveau.

Signer avec votre clé signifie qu'un dépôt signé à l'origine par **quelqu'un d'autre** change
d'identifiant d'auteur — le plan le dit avant que vous confirmiez. Les abonnés qui avaient
épinglé l'ancien identifiant voient le changement. Convertir un manifeste déjà à jour ne fait
rien : aucune écriture, la signature est conservée.

```text
bmm repo-convert "D:/Repos/MonDepot" --dry-run   # le plan ; fonctionne BMM fermé
bmm repo-convert "D:/Repos/MonDepot"             # convertir + signer (BMM ouvert)
bmm repo-convert "D:/Repos/MonDepot" --no-sign   # convertir sans l'application, NON SIGNÉ
```

Les mini-serveurs (`server.js`, le hub multi-dépôts) indiquent le format de ce qu'ils servent
dans leur journal de démarrage et dans `/monitoring.json` (`repoFormat`), et conservent
`format_version` quand le tableau de bord d'administration réécrit le manifeste.
