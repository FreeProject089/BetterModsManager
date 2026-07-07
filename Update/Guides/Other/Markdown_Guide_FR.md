# Guide Markdown — rédiger notes & articles

Les **notes de mise à jour BMM** et le **blog BetterCommunity** utilisent le même
moteur Markdown. Tout ce qui est montré ici fonctionne dans les deux. Copie/adapte.

> [!TIP]
> Fais court et lisible : un titre, quelques puces, et les badges de changement
> ci-dessous font le plus gros du travail.

---

## 1. Bases du texte

```md
**gras**   *italique*   ~~barré~~   `code en ligne`

[Un lien](https://bettercommunity.example)
```

**gras** · *italique* · ~~barré~~ · `code en ligne` · [un lien](https://example.com)

---

## 2. Titres & listes

```md
# Titre
## Section
### Sous-section

- puce
- autre puce
  - imbriquée

1. premier
2. deuxième

- [x] tâche faite
- [ ] tâche à faire
```

---

## 3. Badges de changement

Entoure un mot-clé de crochets et il devient une pastille colorée. Utilise-les en
début de puce pour indiquer ce qui a changé :

```md
- [NOUVEAU] Ajout d'un thème sombre
- [AMÉLIORÉ] Chargement du catalogue plus rapide
- [FIXÉ] Plantage à l'ouverture d'un dépôt vide
- [RAFFINEMENT] Espacement resserré sur les cartes
- [VISUEL] Nouvelle animation d'accueil
- [MAJEUR] Réécriture du moteur de mise à jour
```

- [NOUVEAU] Ajout d'un thème sombre
- [AMÉLIORÉ] Chargement du catalogue plus rapide
- [FIXÉ] Plantage à l'ouverture d'un dépôt vide

Les mots anglais marchent aussi : `[NEW]`, `[IMPROVED]`, `[FIXED]`, `[REFINE]`, `[VISUAL]`, `[MAJOR]`.

---

## 4. Encarts (alertes)

Commence une citation par `[!TYPE]` pour obtenir un encart coloré :

```md
> [!REMARQUE]
> Une information de contexte utile.

> [!ASTUCE]
> Un raccourci pratique.

> [!IMPORTANT]
> Quelque chose à ne pas manquer.

> [!AVERTISSEMENT]
> À faire avec prudence.

> [!ATTENTION]
> Cela peut casser des choses.
```

> [!AVERTISSEMENT]
> N'installe que du contenu provenant de sources fiables.

Types : `REMARQUE`, `ASTUCE`, `IMPORTANT`, `AVERTISSEMENT`, `ATTENTION` (anglais : `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`).

---

## 5. Blocs de code

Encadre le code avec trois accents graves et un langage optionnel :

````md
```json
{ "name": "exemple", "version": "1.0.0" }
```
````

---

## 6. Tableaux

```md
| Fonction | État |
|---|---|
| Thème sombre | [NOUVEAU] |
| Sync dépôt | [AMÉLIORÉ] |
```

| Fonction | État |
|---|---|
| Thème sombre | Livré |
| Sync dépôt | Plus rapide |

---

## 7. Images, vidéo & YouTube (blog)

Dans l'éditeur du blog, utilise les boutons de la barre d'outils — ils insèrent le
bon extrait pour toi :

```md
![texte alternatif](https://.../image.png)
```

```html
<video controls src="https://.../clip.mp4" style="width:100%;border-radius:12px"></video>

<div class="yt-embed">
  <iframe src="https://www.youtube-nocookie.com/embed/ID_VIDEO" allowfullscreen></iframe>
</div>
```

---

## 8. Séparateurs

Trois tirets seuls sur une ligne pour une ligne horizontale :

```md
---
```

---

## 9. Blocs enrichis — icônes, badges & cartes

Les blocs façon GitBook du site s'affichent désormais aussi dans BMM (notes de
version, notes de mise à jour **et** le blog BetterCommunity) :

```md
:icon[rocket]   :icon[simple:github]        icône en ligne (lucide / marque)
:badge[Nouveau]{color="#16a34a"}            une pastille colorée
:kbd[Ctrl+S]                                un raccourci clavier

:::note[À noter]
Un encart. Aussi : tip / warning / danger / success / info.
:::

:::details[Cliquer pour déplier]
Contenu masqué révélé au clic.
:::

::::cards
:::card[Lire la doc]{href="/docs/getting-started"}
Une carte cliquable avec un titre et un corps.
:::
::::
```

- Les **icônes** viennent de **lucide** (ex. `rocket`, `download`, `shield`) ou de
  **Simple Icons** avec le préfixe `simple:` (ex. `simple:discord`, `simple:steam`).
- Les **couleurs** et URLs contenant `#` doivent être entre guillemets : `{color="#16a34a"}`.
- Les conteneurs externes ont **plus de deux-points** que les internes (`::::cards` entoure `:::card`).

Voilà tout. Combine badges + encarts + puces courtes pour des notes propres et lisibles.
