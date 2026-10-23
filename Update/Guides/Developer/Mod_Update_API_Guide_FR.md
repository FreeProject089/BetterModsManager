# API de mise à jour des mods — Guide développeur

Ce guide documente le **système de mise à jour des mods** du point de vue
développeur/intégrateur : les endpoints HTTP, les deep links, le modèle de
données et le fonctionnement de la détection. Pour le côté auteur de mod (rendre
un mod « updatable », écrire des changelogs), voir le guide **Modding**
*« Rendre votre mod updatable »*.

---

## 1. Les concepts en 30 secondes

- Chaque mod installé peut être **lié** à un ou plusieurs dépôts servant de
  sources de mise à jour.
- Un lien est une paire : **`repo_url`** (où chercher) + **`repo_mod_id`** (l'id
  *stable* du mod dans ce repo — survit aux changements de version, contrairement
  à `content_id`).
- BMM compare la version installée à la version actuelle du repo. Si elles
  diffèrent → une mise à jour est disponible.
- L'application d'une mise à jour réutilise le **delta-sync** normal (seuls les
  fichiers modifiés sont téléchargés).

Un mod est lié automatiquement lors de la synchronisation depuis un repo, ou
manuellement via l'API / la boîte de dialogue *Configurer les mises à jour*.

---

## 2. API HTTP

URL de base : `http://127.0.0.1:<port>` (serveur API local de BMM). Les endpoints
qui modifient ou déclenchent l'UI requièrent le jeton (`Authorization: Bearer <token>`).

### 2.1 `POST /api/mod/config` — configurer les sources *(auth, mods.write)*

Lie un mod à son/ses repo(s) de mise à jour.

```json
{
  "modId": "id-local-du-mod",
  "repoModId": "id-stable-dans-le-repo",       // optionnel, "" l'efface
  "updateUrl": "https://site.com/repo.json",    // URL principale optionnelle (mods de site)
  "updateSources": [                             // optionnel, repos additionnels
    { "repoUrl": "https://host/repo.json", "repoModId": "abc" },
    { "repoUrl": "https://mirror/repo.json" }   // repoModId retombe sur celui ci-dessus
  ],
  "directUrl": "https://host/mod-v2.zip"         // optionnel, "" l'efface — URL d'archive en téléchargement direct
}
```

Réponse `200` : `{ "ok": true, "mod_id": "…" }`. Les URLs sont normalisées
(`/repo.json` et slashs finaux retirés, mis en minuscules).

### 2.2 `POST /api/mod/check-updates` — lancer une vérification *(auth)*

Déclenche une vraie vérification. Chaque mod lié (origine de sync + `updateSources`
configurées + les **dépôts globaux** des Paramètres) est comparé à la version
actuelle de son repo. Piloté via l'UI BMM, qui ouvre la modale de résultats. Les
repos injoignables sont remontés comme erreurs (pas ignorés silencieusement).

Réponse `202` : `{ "ok": true, "driven_by": "bmm-ui", "action": "mod/check-updates" }`.

### 2.3 `POST /api/mod/update` — appliquer une mise à jour *(auth)*

```json
{ "repoUrl": "https://host/repo.json" }   // optionnel
```

Saute au flux de sync pré-rempli avec `repoUrl`, où le delta-sync ne télécharge
que les fichiers modifiés. Omettez `repoUrl` pour seulement ouvrir la
vérification.

Réponse `202` : `{ "ok": true, "driven_by": "bmm-ui", "action": "mod/update" }`.

### 2.4 Connexe : `POST /api/repo/update`

Côté auteur — bumper les versions et écrire des changelogs par mod dans un repo
que vous hébergez. Accepte un objet `modChangelogs` (`{ "<modId>": "ce qui a changé" }`).
Voir son entrée dans **Documentation → Plugins & API**.

---

## 3. Deep links

Les mêmes actions sont disponibles en deep links `bmm://` (pas de jeton ;
l'utilisateur confirme dans l'app) :

| Deep link | Action |
|-----------|--------|
| `bmm://mod/check-updates` | Lancer une vérification |
| `bmm://mod/update?url=<repo_url>` | Appliquer la MAJ depuis un repo (sans `url` = juste vérifier) |
| `bmm://repo/update?dir=<repoDir>` | Ouvrir la modale auteur « Update repo » |

---

## 4. Modèle de données

`ModEntry` (par mod installé) porte :

| Champ | Signification |
|-------|---------------|
| `source_repo` | URL du repo depuis lequel le mod a été synchronisé (auto). |
| `repo_mod_id` | Id stable du mod dans ce repo. |
| `update_url` | URL de « repo propre » optionnelle (mods de site). |
| `update_sources` | `[{ repo_url, repo_mod_id? }]` — repos additionnels configurés. |

`RepoMod` (par mod dans un manifeste de repo) porte `id` (l'id stable pointé par
`repo_mod_id`), `version`, et un `changelog` auteur optionnel.

---

## 5. Algorithme de détection (`check_mod_updates`)

1. Pour chaque mod installé, rassemble les couples candidats `(repo_url, repo_mod_id)`
   depuis `source_repo`, `update_url`, chaque entrée `update_sources`, et chaque
   repo global (matché par le `repo_mod_id` du mod). Les doublons sont retirés.
2. Récupère chaque manifeste de repo **unique** une fois. Les échecs sont
   collectés comme erreurs.
3. Construit `repo_mod_id → (version, changelog)` depuis chaque profil du
   manifeste.
4. Émet une mise à jour partout où `version_repo != version_installée`.

La commande renvoie `{ updates: [...], errors: [...], checked: <n>, baselined: [...] }`.
`checked` est le nombre de mods traçables — `0` signifie que rien n'est encore lié
(l'UI affiche un message *« aucun mod n'est lié à un repo »* au lieu de *« à jour »*).
`baselined` liste les mods vus pour la première fois contre un repo et enregistrés
comme référence (pour qu'une première détection ne soit pas prise pour une mise à jour).

---

## 6. Paramètres

- **Intervalle de vérification** (minutes, `0` = manuel) — déclenche une
  vérification automatique en arrière-plan.
- **Dépôts de mise à jour globaux** — une URL par ligne ; chaque mod installé est
  aussi vérifié contre ces repos (matché par `repo_mod_id`).

Les deux sont dans les Paramètres et stockés côté client (localStorage :
`bmm_update_check_min`, `bmm_update_repos`).

---

*Voir aussi : Modding → « Rendre votre mod updatable », et l'onglet in-app
Documentation → Plugins & API pour la référence complète des endpoints.*
