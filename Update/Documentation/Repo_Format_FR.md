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
| `version` | chaîne | Version du manifeste. BMM écrit `"1.0"`. |
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
