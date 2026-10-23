# Intégrer replays (rrweb / .bmmreplay) & vidéo dans la doc

BMM enregistre de vrais clips rejouables de l'app elle-même en fichiers `.bmmreplay` (rrweb sous
le capot) et sait les lire en ligne — dans le hub **intégré** Help & Other *et* sur le site
**BMM Docs**. Ce guide couvre l'enregistrement d'un clip et son intégration des deux côtés, plus la
vidéo classique.

> [!ASTUCE]
> Un `.bmmreplay` est un enregistrement *vectoriel* du DOM, pas une vidéo : minuscule, net à tout
> zoom, avec lecture/pause, barre de défilement, vitesse 1×/2×/4× et plein écran. Préfère-le à un
> MP4 pour les démos d'interface.

---

## 1. Enregistrer un clip

Deux façons, dans l'app :

- **Réglages → Confidentialité → Enregistreur de session (local)** — enregistre une session, puis
  **exporte**-la en fichier `.bmmreplay`.
- **Replay Studio** (DevTools) — enregistre une région d'écran choisie, rogne, exporte.

Un `.bmmreplay` est du JSON : `{ bmmReplay, app, durationMs, events: [ … ] }` où `events` est un
tableau rrweb standard (une timeline `regions` optionnelle peut rogner/suivre un cadre).

> [!REMARQUE]
> Garde des clips de **10 à 30 secondes**, centrés sur un seul écran. Les longs enregistrements
> font de gros fichiers et une barre de défilement lente.

---

## 2. Intégrer dans le hub intégré (`docs-hub.ts`)

Deux façons équivalentes — les deux rendent une **carte de lecture** qui ouvre la visionneuse rrweb
intégrée (`playReplayFromUrl`, `frontend/src/features/settings/replay-watcher.ts`).

**A. Le champ `media`** (affiché au-dessus du corps de l'article) :

```ts
{
  id: 'scheduler',
  title: { en: 'Scheduling & automation', fr: 'Planification & automatisation' },
  media: {
    kind: 'replay',
    src: 'https://freeproject089.github.io/BMM-Docs/assets/replays/scheduler.bmmreplay',
    caption: { en: 'Building an automation', fr: 'Construire une automatisation' },
  },
  body: { en: '…', fr: '…' },
},
```

**B. En ligne dans le corps** avec la directive md-lite `:::replay` :

```md
:::replay{src="https://…/assets/replays/scheduler.bmmreplay" title="Construire une automatisation"}
:::
```

`media.kind` peut aussi valoir `'image'` (`src` → `<img>`) ou `'svg'` (SVG en ligne). Il n'y a pas
de directive `:::video` intégrée ; un corps commençant par `<` est du HTML brut, donc un `<video>`
brut marche aussi.

> [!IMPORTANT]
> La visionneuse intégrée **récupère l'URL**, donc le `.bmmreplay` doit être accessible — héberge-le
> sur le site BMM Docs (recommandé, ils partagent les mêmes enregistrements) ou toute URL joignable.

---

## 3. Intégrer dans BMM Docs (le site MkDocs)

Le site utilise un **bloc HTML brut**, pas `:::replay`. Le script/CSS du lecteur sont déjà câblés
dans `mkdocs.yml` (`assets/rrweb/*`).

```html
<div class="bmm-replay"
     data-src="../assets/replays/scheduler.bmmreplay"
     data-title="Construire une automatisation"></div>
```

- `data-src` est **relatif à la page** — `../assets/replays/…` depuis `features/` ou `reference/`,
  `assets/replays/…` depuis la racine des docs.
- `data-title` est la légende optionnelle sur l'affiche de lecture.
- Le lecteur ne charge le (gros) JSON qu'au clic.

### Ajouter le fichier avec git-lfs

Les `.bmmreplay` sont suivis par **git-lfs** — `BMM Docs/.gitattributes` contient déjà :

```
docs/assets/replays/*.bmmreplay filter=lfs diff=lfs merge=lfs -text
```

Dépose ton enregistrement dans `BMM Docs/docs/assets/replays/`, puis :

```bash
git lfs install          # une fois par machine
git add docs/assets/replays/scheduler.bmmreplay
git commit -m "docs: add scheduler replay"
```

> [!ATTENTION]
> Si git-lfs n'est pas installé, le fichier est commité comme un petit pointeur texte et le lecteur
> n'affiche rien. `git lfs ls-files` doit lister ton replay.

---

## 4. Vidéo & YouTube

Aucun des deux systèmes n'a de directive `:::video`, mais les deux acceptent le HTML brut (MkDocs
via `md_in_html`, le hub intégré via un corps HTML). N'utilise une vraie vidéo que si un
`.bmmreplay` ne peut pas la capturer (images de jeu, outils externes) :

```html
<video controls src="../assets/clips/demo.mp4"
       style="width:100%;border-radius:12px"></video>

<div class="yt-embed">
  <iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" allowfullscreen></iframe>
</div>
```

Utilise `youtube-nocookie.com` pour la confidentialité. Les MP4 auto-hébergés sont lourds — garde-les
courts, ou mets un lien plutôt qu'une intégration.

---

## 5. Checklist

- [ ] Clip enregistré, rogné à 10–30 s, exporté en `.bmmreplay`.
- [ ] Fichier dans `BMM Docs/docs/assets/replays/`, commité **via git-lfs**.
- [ ] Intégré : `media:{kind:'replay',src,caption}` **ou** `:::replay{src=… title=…}`, `src` joignable.
- [ ] BMM Docs : `<div class="bmm-replay" data-src=… data-title=…>`, chemin relatif à la page.
- [ ] Vérifié : la carte de lecture apparaît et la visionneuse s'ouvre des **deux** côtés.
