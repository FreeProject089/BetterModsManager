# Server Repo — comment ça marche, de bout en bout

État au 11 août 2026. Écrit depuis le code, pas depuis la doc.

---

## 1. Ce qu'est un repo

Un **dossier servi en HTTP** contenant un fichier `repo.json` et les fichiers des mods.
Rien d'autre. Pas de service, pas de base, pas de Node : nginx qui sert des fichiers suffit.

```
https://ton-serveur.tld/
├── repo.json          ← le manifeste (signé)
└── mods/
    ├── cool-mod/
    │   ├── Data/textures/a.dds
    │   └── readme.txt
    └── other-mod/
        └── b.pak
```

### Le manifeste

`repo.json` est un `ServerRepo` sérialisé (`models/repo.rs`). Les champs qui comptent :

| Champ | Rôle |
|---|---|
| `seed` | **L'identité du repo.** Les clients y reconnaissent « le même repo » d'une version à l'autre. La changer largue tous les abonnés. |
| `author_id` | Clé publique ed25519 de l'auteur (= son Creator ID). |
| `signature` | Signature ed25519 du manifeste **sans** ces deux champs. |
| `files_base_url` | Où sont les fichiers si ce n'est pas à côté du manifeste. |
| `files_layout` | Gabarit `{id}`/`{path}`. Défaut : `mods/{id}/{path}`. |
| `profiles[].mods[]` | Les mods, chacun avec ses fichiers. |
| `modpacks` | Modpacks embarqués, partageables. |
| `require_login` | Exige un compte BetterCommunity pour télécharger. |

Chaque fichier porte : chemin relatif, taille, **SHA-256**, `mtime` optionnel, et pour les
fichiers > 4 Mo une liste de **hashes de blocs de 4 Mo**.

### Comment une URL de fichier est construite

Un seul endroit dans le code : `mod_file_url()` (`commands/repo.rs`).

```
base = files_base_url ?? (dossier contenant repo.json)
url  = base + files_layout.replace("{id}", mod_id).replace("{path}", chemin)
```

C'est ce qui permet à un serveur existant de **ne pas bouger** : si tes mods sont sous
`addons/<mod>/`, tu mets `addons/{id}/{path}` et rien ne se déplace.

---

## 2. Les trois façons de publier

### ① Export complet — `export_server_repo`

BMM **copie** chaque mod dans un dossier de sortie, écrit `repo.json`, signe, et tu
uploades le tout. Peut aussi générer un **serveur autonome** (exécutable léger) et zipper
les mods (`mods/<id>.zip`) au lieu de fichier par fichier.

Pour partir de zéro. Coût : la taille du repo, à chaque fois.

### ② Manifeste seul — `generate_repo_manifest`

Tu indiques un **dossier de mods existant**, il écrit **seulement** `repo.json`.
Rien n'est copié, rien n'est uploadé, le dossier n'est pas modifié.

- Un sous-dossier = un mod, et **le nom du dossier est l'id**.
- `only_dirs` restreint à une sélection (profils, modpacks). Une sélection **vide est
  refusée** — publier tout parce que la sélection n'a rien résolu, c'est comme ça qu'un mod
  privé atterrit sur un serveur public.
- `files_layout` est **déduit** de la position du manifeste par rapport au dossier scanné.
  Choisis `test/`, tu obtiens `test/{id}/{path}` — donc `repo.json` + le dossier copiés
  ensemble ailleurs fonctionnent tels quels.
- Les modpacks sélectionnés sont embarqués, avec leurs références **remappées** des ids
  BMM vers les noms de dossier. Un pack dont les mods ne sont pas tous publiés est
  **écarté et signalé**, jamais livré à moitié.

### ③ Liens directs

Une URL de téléchargement par mod, sans repo. Rien ne change côté serveur, mais aucune
information de version : BMM peut retélécharger, il ne peut pas annoncer une mise à jour.

---

## 3. Mettre à jour un repo

### En local — relancer la génération

Le manifeste précédent est **lu avant d'être remplacé**, et son identité est reprise :
`seed`, `created_at`, id de profil, description. Puis **resigné** sur le nouveau contenu.

Le rapport dit ce qui a changé : `added`, `changed`, `removed`. Ce dernier existe parce
qu'un chemin mal tapé écrit un manifeste parfaitement valide décrivant un serveur vide.

Il n'y a **aucun numéro de version à incrémenter** — tout est détecté par hash.

### À distance — sans rapatrier le repo *(logique faite, exécution à finir)*

Le problème : mettre à jour supposait que BMM voie le dossier. Avec un serveur distant,
chaque ajout devenait « tout télécharger, régénérer, tout ré-uploader ».

La solution, en trois couches déjà écrites et testées :

1. **Listing** (`repo_autoindex.rs`) — nginx publie déjà l'index avec `autoindex on`. BMM
   le parcourt en HTTP, profondeur bornée (un index peut pointer sur lui-même).
2. **Plan** (`repo_remote.rs`) — compare taille + date au manifeste précédent. Inchangé →
   le hash existant est **repris**. Nouveau ou modifié → à télécharger et hasher.
3. **Exécution** — reste à écrire. Le plan est consultable en lecture seule via
   `plan_remote_repo_refresh` : il dit quoi hasher, quoi réutiliser, et **combien d'octets**
   ça coûterait.

Le renvoi du `repo.json` se fait avec ton client FTP habituel — un petit fichier. C'est
pour ça qu'aucune dépendance FTP n'a été ajoutée.

---

## 4. Ce qui se passe côté client (sync)

`sync_server_repo` :

1. Récupère `repo.json`, **vérifie la signature**.
2. Pour chaque fichier choisi, compare le hash local au hash du manifeste.
3. Ne télécharge que ce qui diffère. Pour un fichier > 4 Mo, compare les **blocs de 4 Mo**
   et ne récupère que les plages différentes, via `Range` HTTP (accepte 206 **et** 200).
4. Enregistre `source_repo` sur chaque mod installé → **ce repo devient automatiquement sa
   source de mise à jour**. Une option (activée par défaut) l'ajoute aussi comme source
   *visible*, à côté de celles de l'auteur, jamais à leur place.

Deux modes de sync : **`missing`** (n'ajoute que l'absent) et **`all`** (écrase aussi ce qui
diffère localement).

**Auto-sync** : par repo, on peut demander une vérification **au démarrage**. Elle récupère
et signale ce qui est périmé, avec l'écran de sync pré-rempli. Elle **ne synchronise pas
toute seule** — ça écrit dans un dossier de jeu, et le jeu peut tourner.

---

## 5. Héberger soi-même

`repo_server.rs` sert un dossier généré en HTTP local. Options : port, UPnP, mot de passe
de téléchargement, limite de débit, Docker.

### Contrôle d'accès

- **`require_login`** — exige une identité BetterCommunity pour chaque fichier.
- **Liste d'autorisation / de bannissement** — par IP, par clé brute, et désormais **par
  compte**.

Le point important : l'en-tête `X-Creator-ID` est **déclaratif**. Un banni le retirait, une
whitelist se franchissait en réclamant un id qui y figurait. Les entrées **par compte** se
vérifient au contraire sur une **attestation signée par BetterCommunity** (`identity.rs`) :
BCWEB signe un jeton court listant le bcid et les Creator/Discord ids liés, le client le
présente, le serveur vérifie **hors ligne** avec une seule clé publique.

Conséquence : bannir le compte suit la personne sur **tous** ses identifiants. Et la
vérification hors ligne évite un oracle qui répondrait « X est-il lié à Y ? » à quiconque
lance un serveur de repo.

---

## 6. Le modèle de confiance, résumé

| Garantie | Par quoi |
|---|---|
| Le manifeste vient bien de l'auteur | signature ed25519, produite **sur sa machine** |
| Un fichier n'a pas été altéré | SHA-256 par fichier, vérifié au téléchargement |
| Un gros fichier reprend proprement | hashes de blocs de 4 Mo |
| L'identité du repo est stable | `seed` repris à chaque régénération |
| Un banni reste banni | attestation signée, pas un en-tête déclaratif |

Ce que ça ne couvre **pas** : si ton serveur est compromis *et* que tu régénères depuis lui
sans revérifier, tu signes le contenu de l'attaquant. D'où la règle : un manifeste distant
qui n'est **pas signé par ta clé** ne voit jamais ses hashes réutilisés.

---

## 7. Où c'est dans le code

| Fichier | Contenu |
|---|---|
| `models/repo.rs` | `ServerRepo`, `RepoMod`, `RepoFile`, `RepoChunk` |
| `commands/repo.rs` | export, manifeste seul, sync, `mod_file_url`, hashing |
| `commands/repo_server.rs` | serveur HTTP local, contrôle d'accès |
| `commands/repo_remote.rs` | plan de rafraîchissement distant |
| `commands/repo_autoindex.rs` | lecture de l'index HTTP, crawl |
| `commands/repo_credentials.rs` | identifiants serveur (session seule) |
| `commands/identity.rs` | attestations BetterCommunity |
| `commands/{ban,whitelist}_manager.rs` | listes d'accès |
| `frontend/src/features/repo/` | UI : sync, host, manifeste seul, auto-sync |

API HTTP locale : `POST /api/repo/gen`, `POST /api/repo/manifest`, `POST /api/repo/host`.
