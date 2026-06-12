# Rendre votre mod updatable — Guide Modding

Ce guide s'adresse aux **auteurs de mods et hébergeurs de repos** : comment rendre
un mod que les utilisateurs de BMM peuvent garder à jour, et comment publier une
nouvelle version avec un changelog. Pour le côté API/intégration, voir
Développeur → *« API de mise à jour des mods »*.

---

## 1. Comment BMM suit les mises à jour

BMM lie chaque mod installé au repo dont il provient via deux valeurs :

- **`repo_url`** — le dépôt qui héberge le mod.
- **`repo_mod_id`** — l'**id stable du mod dans ce repo**. Il doit rester identique
  entre les versions, pour que BMM reconnaisse que « ce mod installé » est le même
  que « ce mod plus récent dans le repo ».

Quand un utilisateur synchronise votre repo, BMM enregistre les deux
automatiquement. Plus tard, *Vérifier les mises à jour* compare la version
installée à la version actuelle de votre repo — si elles diffèrent, la mise à jour
est proposée.

> L'id stable n'est **pas** l'empreinte des fichiers (`content_id`), qui change à
> chaque modification de fichiers. C'est pour ça qu'un id stable dédié existe.

---

## 2. Donnez un id stable à votre mod (recommandé)

Par défaut, l'id d'un mod est généré. Pour garantir une identité stable entre
re-packagings et machines, livrez un **`bmm.json`** à la racine du dossier du mod :

```json
{ "id": "votrenom.supermod" }
```

BMM utilise cet `id` comme `content_id` du mod et, quand vous l'hébergez dans un
repo, comme son `repo_mod_id`. Choisissez quelque chose d'unique et ne le changez
jamais.

Sans `bmm.json`, BMM dérive un id-empreinte depuis la liste des fichiers — ça
marche aussi, mais ça peut changer si vous restructurez les fichiers.

---

## 3. Publier une nouvelle version (hébergeur de repo)

1. Dans votre bibliothèque locale, **bumpez la version du mod** (ex. `1.0.0` →
   `1.1.0`). Mettez à jour les fichiers au besoin.
2. Ouvrez **Server Repo → Host → « Update an existing repo »** et choisissez le
   dossier de votre repo.
3. Dans la liste **current content** et la liste **add**, chaque mod affiche son
   **`repo_mod_id`** avec un bouton **Copier** — c'est la valeur dont vos
   utilisateurs ont besoin pour lier une copie installée manuellement.
4. Cochez le(s) mod(s) modifié(s), et **tapez un changelog** dans le champ sous
   chaque mod (ex. *« Corrige la texture cassée, ajoute 2 variantes »*). Il est
   montré aux utilisateurs quand la mise à jour est détectée.
5. Cliquez sur **Apply**. Votre `repo.json` porte maintenant la nouvelle version +
   le changelog.

Les utilisateurs verront la mise à jour à leur prochaine *Vérification des mises à
jour* (ou automatiquement, s'ils ont activé un intervalle).

---

## 4. Aider les utilisateurs à lier un mod manuellement

Certains utilisateurs installent un mod à la main (pas via votre repo). Ils
peuvent quand même recevoir les mises à jour :

1. Ils ouvrent le **menu ⋯ → Configurer les mises à jour** du mod dans leur
   bibliothèque.
2. Ils collent votre **URL de repo** et le **`repo_mod_id`** (la valeur que vous
   pouvez Copier depuis l'écran *Update an existing repo*).
3. Dès lors, BMM vérifie votre repo pour ce mod.

Vous pouvez aussi proposer un **dépôt global** : dites aux utilisateurs d'ajouter
votre URL de repo dans **Paramètres → Dépôts de mise à jour globaux**. Tout mod
dont le `repo_mod_id` existe dans votre repo est alors vérifié automatiquement —
sans configuration par mod.

---

## 5. Conseils de versioning

- Utilisez des versions claires et croissantes. BMM signale une mise à jour dès
  que la version du repo **diffère** de l'installée (il n'impose pas l'ordre
  semver), donc évitez de réutiliser un ancien numéro pour du nouveau contenu.
- Gardez le `repo_mod_id` constant pour toujours. Le changer fait que BMM le
  traite comme un mod différent (l'ancien ne reçoit plus de mises à jour).
- Écrivez un changelog court et précis à chaque fois — c'est la seule info « ce
  qui a changé » que voit l'utilisateur avant de mettre à jour.

---

*Voir aussi : Modding → « Identité de mod », et Développeur → « API de mise à jour
des mods ».*
