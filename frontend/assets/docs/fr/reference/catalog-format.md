# Le format de catalogue universel

BMM lit des catalogues de huit sortes (apps, plugins, thèmes, presets d'automatisation,
modpacks, repos, tutoriels et listes de mods) et, avec le temps, chaque sorte a eu son propre
document. Ils fonctionnent tous encore. Cette page décrit le format **unique** qui peut porter
n'importe lequel d'entre eux, et comment chaque forme plus ancienne s'y ramène.

Tout ce qui suit vient de `src-tauri/src/commands/catalog_format.rs` (le lecteur de référence)
et de `frontend/src/core/catalog-format.ts` (son repli). Les deux sont testés sur les mêmes
fixtures dans `src-tauri/tests/catalog_format/`. Là où ils contredisent cette page, ce sont eux
qui ont raison et la page qui a un bug.

---

## 1. Le document

```json
{
  "format": "bmm-catalog",
  "format_version": 1,
  "id": "hello-catalogue",
  "name": "Hello catalogue",
  "name_i18n": { "fr": "Catalogue bonjour" },
  "description": "One of each",
  "description_i18n": { "fr": "Un de chaque" },
  "publisher": "Hello Group",
  "homepage": "https://example.org",
  "app": "bmm",
  "updated_at": "2026-10-13T00:00:00Z",
  "items": [
    {
      "kind": "plugin",
      "id": "hello",
      "name": "Hello",
      "name_i18n": { "fr": "Bonjour" },
      "version": "1.0.0",
      "author": "Me",
      "description": "Says hello",
      "tags": ["demo"],
      "game": "DCS World",
      "download": {
        "url": "https://example.org/p/hello.bmmplug",
        "sha256": "6666666666666666666666666666666666666666666666666666666666666666",
        "size": 1234
      }
    }
  ],
  "catalogs": [
    { "kind": "preset", "url": "https://example.org/presets.json", "name": "Presets" }
  ]
}
```

`format` et `format_version` permettent au document de dire ce qu'il est. La clé est
`format_version` et non `version`, exprès : tous les anciens catalogues utilisent déjà
`version` pour la version du document **selon son éditeur** (`"1.0"`), la même confusion que
`repo.json` avait avant son format 1.0 (voir [le format des repos](doc-page:reference/repo-format)). Un document
v1 converti garde cette valeur dans `catalog_version`.

### Niveau supérieur

| Champ | Obligatoire | Sens |
|---|---|---|
| `format` | oui | Toujours `"bmm-catalog"`. |
| `format_version` | oui | Un entier. BMM lit `1`. Un nombre plus grand est refusé (`format.too_new`). |
| `name` | conseillé | Le nom du catalogue. |
| `name_i18n`, `description_i18n` | non | Traductions : une table langue → texte (`{ "fr": "…" }`). |
| `id`, `description`, `publisher`, `homepage`, `app`, `updated_at` | non | Métadonnées. `app` dit pour quel produit Better* il est (`bmm`). |
| `items` | oui, sauf si `catalogs` est donné | Ce qui s'installe. |
| `catalogs` | non | Des liens vers d'autres catalogues (le document est alors aussi un index). |
| `partner_catalogs`, `community_imports` | non | Repris des catalogues d'apps v1 ; le catalogue d'apps les lit. |

### Une entrée

| Champ | Obligatoire | Sens |
|---|---|---|
| `kind` | oui | `app` · `plugin` · `theme` · `preset` · `modpack` · `repo` · `tutorial` · `list`. |
| `id` | oui | Identifiant stable. `kind` + `id` (sans tenir compte de la casse) est unique dans un catalogue ; un doublon est un avertissement et le premier l'emporte. |
| `name`, `name_i18n` | conseillé | Nom affiché et ses traductions. |
| `summary`, `description`, `description_i18n` | non | Un résumé d'une ligne ; une description plus longue (B.MD). |
| `version`, `author`, `tags`, `game`, `icon`, `homepage`, `source_url`, `license`, `compatibility` | non | Métadonnées. |
| `download` | oui pour toutes les sortes sauf un thème en ligne et un modpack empaqueté | `{ url, sha256, size, file_type }`. Pour `repo`, `url` est l'adresse du repo. |
| `versions` | non | Les versions précédentes et leurs fichiers (`{ version, published_at, changelog, files: [{ name, size, sha256, url }] }`), comme BetterCommunity v2 les publie. |
| `extra` | non | Les champs propres à une sorte, gardés tels quels : `category`, `price`, `requirements`, `images` d'une app ; les `vars` d'un thème en ligne ; le nombre `mods` ou le `file` `.cbmp` d'un modpack ; le nombre `tasks` d'un preset. |

`download.url` est une adresse `https://` (ou `http://`), ou un nom relatif à l'adresse du
catalogue lui-même (`themes/aurora.bmmtheme`), pour qu'un dossier change d'hébergeur sans être
réécrit. Tout autre schéma (`javascript:`, `file:`, `data:`) est une erreur. `download.sha256`
fait 64 chiffres hexadécimaux en minuscules ; `sha256:ABC…` est accepté et normalisé. Un plugin
sans empreinte n'est pas installé par BMM 1.1 et suivants.

---

## 2. Toutes les formes que BMM lit, et ce qu'elles deviennent

BMM reconnaît la forme d'un document, jamais son adresse. Chaque variante est convertie dans le
document universel ci-dessus ; le lecteur existant de chaque sorte reçoit ensuite **sa propre
vue v1**, si bien qu'un catalogue universel apparaît dans le navigateur de plugins, la galerie
de thèmes et chaque autre écran sans que ces écrans changent.

| Variante | Reconnue par | Devient |
|---|---|---|
| Universel | `format: "bmm-catalog"` | Lui-même (empreintes en minuscules). |
| Apps v1 | `apps: [...]` | `kind: app` ; `title` → `name`, `download.*` gardé, `images.thumb` → `icon`, le reste → `extra`. |
| Plugins v1 | `plugins: [...]` | `kind: plugin` ; `download_url` + `sha256` → `download`, `icon_url` → `icon`. |
| Thèmes v1 | `themes: [...]`, ou un tableau nu dont les entrées portent `vars` | `kind: theme` ; `download_url` ou `url` → `download.url` ; `vars` en ligne → `extra`. |
| Presets v1 | `presets: [...]` | `kind: preset` ; `tasks` → `extra.tasks`. |
| Modpacks v1 | `modpacks: [...]` (aussi dans un `.cbmp`) | `kind: modpack` ; `file` (empaqueté) et `mods` → `extra`. |
| Repos v1 | `repos: [...]`, ou un tableau nu de `{name,url}` | `kind: repo` ; `url` → `download.url` et, sans `id`, l'identifiant. |
| Tutoriels v1 | `tutorials: [...]` | `kind: tutorial`. |
| Listes de mods v1 | `lists: [...]` | `kind: list` ; `downloadUrl` est accepté. |
| Entrées groupées BCWEB | `items: [{ kind, …, meta }]` | La sorte de chaque entrée ; `meta.download_url` remonté. |
| `catalog.json` BCWEB v1 | les formes v1 ci-dessus | Comme ci-dessus. |
| Index de catalogues | `catalogs: [{ type, url }]`, `kind: "catalog-index"` | `catalogs: [{ kind, url, … }]`, sans entrée. Voir [l'index de catalogues](doc-page:reference/catalog-index). |
| `catalog.json` de compatibilité BC v2 | les formes v1 ci-dessus | Comme ci-dessus (la couche de compatibilité de v2 les émet). |
| Flux BC v2 | `kind: "catalog"` + `catalog` + `items` | Modèle → sorte (`mods`→`app`, `plugins`→`plugin`, `themes`→`theme`, `presets`→`preset`, `resources`→`modpack`, `tutorials`→`tutorial`, `links`→`list`). L'identifiant est le **slug**, comme dans le flux de compatibilité de v2, si bien qu'une entrée lue par les deux portes reste une seule entrée ; l'identifiant propre de v2 est `extra.external_id`. Le premier fichier de la dernière version est `download` ; chaque version est dans `versions`. |
| Index de flux BC v2 | `kind: "index"` + `catalogs[].feed_url` | `catalogs: [{ kind, url: feed_url, … }]`. |
| Enveloppe DSSE | `payloadType` + `payload` + `signatures` | Vérifiée, puis sa charge est lue comme n'importe laquelle des formes ci-dessus. |

Un document qui porte la même entrée sous deux tableaux (les tutoriels le font, `tutorials` et
`items`) la donne une seule fois.

---

## 3. Signatures

Un catalogue peut être signé. L'enveloppe est **DSSE v1**, exactement comme BetterCommunity v2
signe ses flux (`/v2/feeds/catalogs/{c}`, ADR 0010 §2) :

```json
{
  "payloadType": "application/vnd.bettercommunity.catalog-feed+json; version=1",
  "payload": "<base64 des octets JSON exacts>",
  "signatures": [ { "keyid": "feed_…", "sig": "<base64 d'une signature Ed25519 de 64 octets>" } ]
}
```

- La signature est Ed25519 sur la **PAE** : `"DSSEv1" SP LEN(type) SP type SP LEN(corps) SP corps`,
  longueurs en octets, en décimal ASCII. Elle couvre les octets servis : rien n'est
  re-sérialisé avant la vérification.
- Deux types de charge sont acceptés : le type de flux de v2 ci-dessus, et
  `application/vnd.bettermodsmanager.catalog+json; version=1` pour un catalogue universel signé.
- De 1 à 4 signatures. Un `keyid` est un indice, jamais une preuve : chaque signature est
  essayée contre chaque clé candidate.
- Les clés sont des clés publiques Ed25519 brutes de 32 octets, en base64 : la forme que
  `/v2/feeds/keys` publie.

Les tests signent leurs fixtures avec le `crypto` de Node (celui qu'utilise v2) et les vérifient
avec le lecteur Rust : les deux s'accordent sur les octets, pas seulement sur l'idée.

### Ce que BMM indique

| Statut | Quand | Ce que fait BMM |
|---|---|---|
| `unsigned` | Pas une enveloppe. | Le lit : la plupart des catalogues ne sont pas signés. |
| `verified` | Une signature est valide pour une clé de confiance. | Le lit. |
| `unknown_key` | Signé, par aucune clé de confiance (ou aucune clé n'est de confiance). | Le lit **comme non vérifié**, avec un avertissement. Ce n'est pas pire qu'une copie non signée. |
| `invalid` | Enveloppe mal formée, type de charge inconnu, une signature qui nomme une de nos clés et ne se vérifie pas, ou une source dont la clé est épinglée et que le document n'est pas signé par elle. | **Le refuse.** Rien n'en est affiché ni installé, et la dernière bonne copie reste. |

### Clés de confiance et clés épinglées

Les clés sont gardées dans `catalog-keys.json`, dans le dossier de données de l'app (commande
`catalog_keys`). Une clé avec un `issuer` est **épinglée** : chaque catalogue que cet émetteur
couvre doit être signé par elle, et une copie non signée est refusée comme une copie falsifiée ;
c'est ainsi qu'un retour en arrière est détecté. Un émetteur est une origine
(`https://bettercommunity.ch`, qui couvre tout le serveur) ou une origine avec une portée de
chemin (`https://bettercommunity.ch/v2/feeds/`, qui ne couvre que les adresses sous ce chemin —
un segment entier : `/v2/feedsX` n'est pas couvert).

`catalog_keys` avec `op: "fetch"` et `issuer` réglé sur la racine d'un BetterCommunity v2 lit une
fois `{racine}/v2/feeds/keys` et épingle ce qui y est publié sur `{racine}/v2/feeds/`. Une
portée, pas toute l'origine : le même serveur sert aussi le `catalog.json` compatible v1, non
signé, qui doit rester lisible.

Rien n'est de confiance par défaut : v2 crée sa clé de flux au premier usage, il n'y a donc
aucune clé à livrer.

### Mode BetterCommunity v2

Avec `BCApiVersion=v2` dans `app.cfg` (voir [app.cfg](doc-page:reference/app-cfg)), BMM lit les flux signés de v2 :

- **Paramètres → Index de catalogues** propose l'index signé des catalogues publics
  (`{racine}/v2/feeds/catalog`) quand son champ d'adresse est vide. Chaque entrée qu'il liste est
  un flux signé `{racine}/v2/feeds/catalogs/{slug}`, suivi comme n'importe quel catalogue.
- La première fois qu'un flux signé de cette racine est lu, BMM récupère et épingle ses clés
  (confiance au premier usage). Ensuite, un flux de `{racine}/v2/feeds/` non signé, modifié ou
  signé par une autre clé est **refusé** ; les écrans de catalogue gardent leur dernière bonne
  copie.
- Un serveur qui ne publie aucune clé laisse ses flux lisibles en `unknown_key`, signalés.

Sans ce réglage (toutes les installations par défaut), rien de tout cela ne s'exécute : aucune
clé n'est récupérée, aucune adresse ne change.

---

## 4. Validateur et convertisseur

| Commande | Fait |
|---|---|
| `catalog_validate { text \| path, kind?, sourceUrl? }` | La variante, le statut de signature, le nombre d'entrées par sorte, et chaque problème avec un chemin JSON (`$.items[2].download.url`), une gravité (`error` · `warning` · `info`) et un code stable (`url.scheme`, `download.bad_sha256`, `item.duplicate`…). |
| `catalog_normalize { text, kind?, sourceUrl?, keys? }` | N'importe quelle variante → le document universel, avec le même rapport. |
| `catalog_convert { path, out?, dryRun?, kind? }` | Écrit le document universel (par défaut `<nom>.universal.json` à côté de l'entrée ; une sortie existante est gardée en `.bak`). Une entrée signée est convertie depuis sa charge vérifiée et écrite non signée ; une entrée refusée n'est jamais écrite. |
| `catalog_verify_signature { text, keys?, sourceUrl? }` | La vérification de signature seule. |
| `catalog_keys { op: list \| add \| remove \| fetch, issuer?, keyid?, publicKey?, label? }` | Les clés de confiance. |

Le validateur du hub **Outils**, mode « Catalogue », appelle `catalog_validate` avec le texte
collé ou le fichier choisi et liste chaque erreur et avertissement avec son chemin ; le résumé
nomme la variante et, pour un document signé, le statut de signature.

---

## 5. L'index de catalogues et son cache

Les catalogues sont récupérés à travers un cache HTTP qui survit à un redémarrage
(`catalog_fetch`) :

- l'`ETag` et le `Last-Modified` de la dernière bonne réponse sont renvoyés, et un `304`
  réutilise la copie gardée ;
- un serveur injoignable, ou qui répond 5xx, sert la dernière bonne copie, marquée `stale`, avec
  l'erreur à côté : une source en panne ne vide jamais une liste ni ne bloque les autres ;
- `403`, `404` et `410` oublient la copie : le serveur a dit qu'elle n'existe plus ;
- `catalog_cache_status` liste chaque source : dernier succès, dernière erreur, échecs
  consécutifs, taille et SHA-256.

Par-dessus, l'index de catalogues fusionne chaque catalogue suivi : les entrées de même sorte et
même identifiant, ou du même fichier (SHA-256 du téléchargement) sous deux identifiants, sont
**une seule** entrée qui liste chaque source. La recherche ignore la casse et les accents
(« eclair » trouve « Éclair »), accepte les débuts de mots, exige chaque mot, et classe le nom
avant l'identifiant, les tags, l'auteur et la description. Une actualisation ne récupère que les
sources plus vieilles que leur durée de vie.
