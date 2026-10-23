# Éditer la doc « Help & Other » (et garder BMM Docs synchronisé)

BMM a **deux** surfaces de documentation qui couvrent le même terrain :

- **Help & Other** — le hub intégré (menu → *Help & other*). Concis, bilingue, ouvre les
  tutoriels/diagrammes et renvoie dans l'app.
- **BMM Docs** — le site public MkDocs (`BMM Docs/`, publié sur GitHub Pages). La version
  longue, avec captures et replays.

Ils sont **synchronisés à la main** — aucun générateur. Quand tu modifies l'un, modifie l'autre.
Ce guide traite du hub intégré ; un guide compagnon couvre les extras du site
([tabs, mermaid, captures](#8-portabilité--le-site-vs-lapp)).

> [!ASTUCE]
> Les deux moteurs partagent volontairement la syntaxe de directives **BCWEB / GitBook**
> (`:::tip`, `:::details`, `:kbd[…]`). Rédige avec ça et l'essentiel se copie-colle entre les deux.

---

## 1. Où vit le contenu

Tout Help & Other tient dans **un seul tableau** de `frontend/src/docs/docs-hub.ts` :

```ts
const CATEGORIES: Category[] = [ /* … */ ];
```

Le contenu est **bilingue co-localisé** — pas de JSON séparé, pas de fichier FR à part. Chaque
chaîne est un objet `{ en, fr }`, et l'app choisit le champ selon la langue courante.

> [!REMARQUE]
> `docs-hub.ts` est du TypeScript. Après édition, recompile le frontend (`npx tsc` depuis
> `frontend/`) pour régénérer `frontend/js/` — l'app exécute le JS compilé.

---

## 2. Le modèle de données

```ts
type L = { en: string; fr: string };   // toute chaîne visible est bilingue

interface Category {
  id: string;
  part: 'user' | 'dev';                 // l'onglet : Guide utilisateur vs Développeur
  icon: string;                         // clé du set ICON en haut du fichier
  title: L; blurb: L;
  articles: Article[];
}

interface Article {
  id: string;                           // unique — c'est aussi la cible des liens croisés + deeplink
  title: L; summary: L;
  body: L;                              // HTML *ou* markdown md-lite (voir §4)
  media?: Media;                        // un replay / image / svg affiché AU-DESSUS du corps
  tutorial?: { id: string; part?: string; step?: string };  // deep-link vers le tutoriel
  diagram?: string;                     // id de diagramme → bouton « Ouvrir le diagramme »
  docsPath?: string;                    // ajouté à l'URL BMM Docs → « Lire la doc complète »
  view?: string;                        // data-view du menu → bouton « Ouvrir dans BMM »
  keywords?: string;                    // termes de recherche supplémentaires
}
```

---

## 3. Ajouter un article (ou une catégorie)

**Nouvel article** — pousse un objet dans le `articles: [ … ]` de la catégorie visée :

```ts
{
  id: 'storage-manager',
  title: { en: 'Storage manager', fr: 'Gestionnaire de stockage' },
  summary: { en: 'Per-disk speed limits, space alerts, Smart I/O.',
             fr: 'Limites de vitesse par disque, alertes d’espace, Smart I/O.' },
  view: 'settings',                     // ajoute un bouton « Ouvrir dans BMM » vers Réglages
  docsPath: 'features/storage/',        // ajoute « Lire la doc complète » → BMM Docs
  keywords: 'disk io space cache ssd hdd throttle',
  body: {
    en: `:::tip[One knob that matters]
**Smart I/O** keeps the UI smooth during big copies. Turn it off for raw speed.
:::`,
    fr: `:::tip[Le réglage qui compte]
**Smart I/O** garde l’interface fluide pendant les grosses copies. Désactive-le pour la vitesse brute.
:::`,
  },
},
```

**Nouvelle catégorie** — pousse un `Category` (`id`, `part`, une clé `icon` présente dans le
record `ICON` en haut du fichier, `title`, `blurb`, `articles`).

> [!IMPORTANT]
> Chaque `{ en, fr }` doit être rempli dans **les deux** langues. Un `fr` manquant affiche
> l'anglais aux francophones. Les `id` doivent être uniques — ils servent aux liens croisés et au
> deeplink `bmm://docs/open?article=<id>`.

---

## 4. Rédiger le corps — directives md-lite

Si un corps **commence par `<`**, il est traité comme du HTML brut et passé tel quel. Sinon il est
rendu par **md-lite** (`frontend/src/docs/md-lite.ts`), qui parle le jeu de directives BCWEB :

```md
**gras**  *italique*  `code`  [lien externe](https://…)

:kbd[Ctrl+K]                          → touches stylisées (coupées sur + ou espace)

[Voir conflits](doc:conflicts)        → lien croisé interne vers un autre article par id

:::tip[Titre optionnel]                encadré — aussi : note info hint success warning danger
Corps en markdown, rendu récursivement.
:::

:::steps
:::step[Ouvrir Profils → Nouveau profil]
Choisis les trois dossiers.
:::
:::step[Scanner]
BMM liste ce qu'il trouve.
:::
:::

:::columns
:::column
Colonne gauche.
:::
:::column
Colonne droite.
:::
:::

:::details[Cliquer pour déplier]
Caché jusqu'au clic.
:::
```

> [!ASTUCE]
> Préfère md-lite au HTML brut pour les nouveaux articles — plus court, thémable, et portable vers
> le site MkDocs. Ne passe au HTML que pour ce que md-lite ne sait pas exprimer.

---

## 5. Médias, diagrammes et deep-links

- **Média au-dessus du corps** — `media: { kind: 'replay' | 'image' | 'svg', src, caption }`. Pour
  les replays, voir le guide compagnon *Intégrer replays & vidéo*.
- **Bouton diagramme** — `diagram: 'scheduler'` ajoute un bouton « Ouvrir le diagramme » qui
  appelle le registre de diagrammes interactifs (`interactive-docs.ts`).
- **Ouvrir dans BMM** — `view: 'settings'` (n'importe quel `data-view` du menu) ajoute un bouton
  qui amène l'app sur cette page.
- **Lire la doc complète** — `docsPath: 'features/scheduler/'` renvoie vers la page BMM Docs.
- **Tutoriel** — `tutorial: { id, part, step }` deep-linke dans le tutoriel interactif.

---

## 6. Liens croisés

Dans un corps : `[libellé](doc:article-id)` → un bouton interne qui saute vers cet article. Utilise
l'`id` de l'article cible. **Hors** de l'app, tu peux ouvrir un article précis avec le deeplink
`bmm://docs/open?article=<id>` (déclare tout nouveau deeplink/API dans la page *Plugins & API*).

---

## 7. Compiler & vérifier

```bash
# depuis frontend/
npx tsc            # recompile → régénère frontend/js/ (l'app exécute le JS compilé)
```

`npx tsc` sans erreur est le contrôle. Ensuite ouvre Help & Other dans l'app et relis ton article
dans **les deux** langues (bascule de langue) avant de commit.

---

## 8. Portabilité — le site vs. l'app

La même syntaxe marche des deux côtés, sauf mention contraire :

| Construction | BMM Docs (MkDocs) | Intégré (md-lite) |
|---|---|---|
| Encadré | `!!! tip "T"` **ou** `:::tip[T]` | `:::tip[T]` |
| Repliable | `??? note "S"` **ou** `:::details[S]` | `:::details[S]` |
| Clavier | `<kbd>Ctrl</kbd>` ou `++ctrl+k++` | `:kbd[Ctrl+K]` |
| Onglets | `=== "Tab"` | — (non supporté) |
| Mermaid | fence ```` ```mermaid ```` | — (utilise le champ `diagram:`) |
| Étapes / Colonnes | — (non supporté) | `:::steps` · `:::columns` |
| Lien croisé | `[x](page.md)` | `[x](doc:article-id)` |
| Replay | `<div class="bmm-replay" data-src=…>` | `:::replay{src=…}` ou `media` |

> [!REMARQUE]
> La convention bilingue diffère selon le système. Intégré : un fichier, champs `{ en, fr }`. BMM
> Docs : deux fichiers, `page.md` (EN) + `page.fr.md` (FR). Guides du dépôt (ce dossier) :
> `Name_EN.md` + `Name_FR.md`.
