# Créer son propre thème


> Chaque token exposé par l'éditeur, expliqué — plus le format du fichier thème et un
> parcours depuis zéro. La page [Thèmes & Apparence](doc-page:features/themes) fait le tour de l'éditeur ;
> celle-ci est la référence à garder ouverte **pendant** qu'on construit.

## Le modèle mental

Un thème BMM est un ensemble de **surcharges**. L'application embarque un look complet (le
thème *Default* est littéralement un ensemble de surcharges vide) ; votre thème ne remplace
que les tokens que vous touchez, tout le reste retombe sur le défaut. C'est pour ça qu'un
thème de trois lignes est valide — et que **Réinitialiser cette section** peut annuler une
zone sans toucher au reste.

Un token est une variable CSS, toujours nommée `--bmm-*`. Changez `--bmm-accent` et chaque
bouton, lien et état actif qui l'utilise suit. Vous ne courez jamais après des éléments
individuels — sauf si vous le voulez, et c'est à ça que servent l'onglet **CSS** et
**+ Éléments**.

Trois règles gardent un thème lisible, apprises des thèmes intégrés :

1. **Le contraste avant la beauté.** BMM est un écran qu'on *lit* — noms de mods, chemins,
   versions. Testez vos tokens de texte contre vos fonds avant tout le reste.
2. **La teinte de surface est l'interrupteur clair/sombre.** Presque chaque panneau est
   construit à partir d'une seule teinte translucide (voir [Surfaces](#surfaces)).
   Réglez-la d'abord ; le reste est du détail.
3. **Déclarez votre `mode`.** Un thème clair avec `mode: "light"` reçoit des correctifs de
   contraste automatiques sur les éléments qui codent en dur du texte clair. Sans ça,
   certains textes deviennent invisibles.

## Partir de zéro, dans l'ordre

1. Ouvrez l'éditeur : **Paramètres → Thèmes → Éditeur**, ou [ce lien](bmm://theme/editor).
2. Prenez le thème intégré le plus proche de ce que vous voulez et **Enregistrez-sous** une
   copie — hériter d'un thème qui marche bat la page blanche.
3. Réglez **Surfaces** (la teinte) puis **Arrière-plan** (base, cartes, sidebar). Regardez
   l'app après chaque changement — l'éditeur applique en direct.
4. Réglez le **Texte** et vérifiez chaque niveau (primaire/secondaire/atténué) contre vos
   nouvelles surfaces.
5. Choisissez votre famille d'**Accents**, puis **Bordures**, **Forme**, **Typographie**.
6. Seulement ensuite : wallpaper, effets, Tasky, graphiques — la couche décorative.
7. **Exportez** (ou **Partagez**) depuis le menu *Fichier* du pied de l'éditeur.

La **pipette** est le raccourci à travers tout ça : cliquez-la, puis cliquez n'importe quel
élément de BMM, et l'éditeur saute au token qui le style.

## Chaque token, par groupe

Les tableaux ci-dessous sont l'onglet **Simple** de l'éditeur, au complet. *Type* dit à quoi
ressemble une valeur : une `couleur` accepte tout ce que le CSS accepte (`#0af`, `rgb(...)`,
`rgba(...)` pour la transparence) ; une `taille` est une longueur CSS ou un nombre selon le
cas ; `police` est une liste de font-family ; `image` est une URL ou un fichier choisi
(embarqué dans le thème).

### Arrière-plan

Les couleurs derrière toute l'app, les cartes et les barres.

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-bg-base` | Le fond le plus extérieur, derrière tout | couleur |
| `--bmm-bg-elevated` | Cartes, panneaux, modales et menus déroulants | couleur |
| `--bmm-bg-overlay` | La surface translucide des cartes et modales « verre » | couleur |
| `--bmm-bg-hover` | Tout ce qui est sous le curseur — lignes, items de nav, boutons | couleur |
| `--bmm-bg-active` | L'état sélectionné / pressé | couleur |
| `--bmm-bg-sidebar` | La barre de navigation gauche | couleur |
| `--bmm-bg-titlebar` | La barre de fenêtre du haut (logo & boutons de fenêtre) | couleur |
| `--bmm-titlebar-bg` | Fond exact de la barre de titre — accepte `rgba()` pour la transparence | couleur |
| `--bmm-loader-bg` | L'écran de démarrage & de fermeture | couleur |
| `--bmm-app-bg-image` | Wallpaper plein-app — fichier ou URL collée | image |
| `--bmm-app-bg-blur` | Flou appliqué au wallpaper, ex. `8px` | taille |
| `--bmm-app-bg-opacity` | Opacité du wallpaper, `0` (caché) à `1` (plein) | taille |

!!! note "Pourquoi le wallpaper a trois tokens"

    Une image détaillée entre en concurrence avec le texte posé dessus. Une photo à pleine
    force rend une liste de mods difficile à parcourir ; la même photo à `8px` de flou et
    `0.35` d'opacité se lit comme une couleur. Effacer le wallpaper depuis **Assets** efface
    les trois.

### Surfaces

La teinte translucide dont chaque panneau est construit — **l'interrupteur clair/sombre d'un
thème**.

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-surface-r` | Canal rouge (0–255) de la teinte de surface | taille |
| `--bmm-surface-g` | Canal vert (0–255) de la teinte de surface | taille |
| `--bmm-surface-b` | Canal bleu (0–255) de la teinte de surface | taille |
| `--bmm-glass-bg` | Fond des panneaux « verre dépoli » | couleur |
| `--bmm-glass-border` | Bordure des panneaux « verre dépoli » | couleur |
| `--bmm-color-scheme` | `light` ou `dark` — pilote les scrollbars et popups **natifs** | taille |

Les trois canaux sont une seule couleur séparée, pour que l'app la réutilise à plusieurs
opacités. Les thèmes sombres teintent vers le blanc (ex. `255,255,255` à faible alpha = léger
voile clair) ; **pour un thème clair, mettez les trois à `0`** pour que les panneaux ombrent
vers le sombre. Alignez `--bmm-color-scheme`, sinon vos scrollbars contrediront votre thème.

### Texte

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-text-primary` | Titres et texte important | couleur |
| `--bmm-text-secondary` | Texte secondaire — descriptions et libellés | couleur |
| `--bmm-text-muted` | Texte atténué — indices, placeholders, métadonnées | couleur |
| `--bmm-text-on-accent` | Le texte posé **sur** un fond couleur accent (boutons primaires, badges) | couleur |

`--bmm-text-on-accent` est celui qu'on oublie : si votre accent est clair, il doit être
sombre, sinon les boutons primaires deviennent illisibles — ce bug exact a existé dans cinq
thèmes intégrés.

### Accent

Les couleurs de mise en avant — boutons, items actifs, états. Le premier est *l'*accent ; le
reste est la palette sémantique des badges, états et tags dans toute l'app.

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-accent` | La mise en avant principale — boutons, items actifs, liens | couleur |
| `--bmm-cyan` | Mise en avant secondaire (chemins, badges info) | couleur |
| `--bmm-success` | États succès / activé / vérifié | couleur |
| `--bmm-warning` | Avertissements et états de prudence | couleur |
| `--bmm-danger` | Erreurs, actions de suppression, conflits | couleur |
| `--bmm-purple` | Accent tertiaire (deeplinks, tags de plugins) | couleur |
| `--bmm-info` | Badges et encarts informatifs | couleur |
| `--bmm-amber` | Ton de prudence plus doux (certains badges et graphiques) | couleur |

Gardez succès/avertissement/danger *reconnaissables* — un thème où le danger est vert se bat
contre dix ans d'instinct utilisateur.

### Bordures

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-border` | Bordure subtile par défaut des cartes & champs | couleur |
| `--bmm-border-hover` | Bordure quand le curseur survole une carte ou un champ | couleur |
| `--bmm-border-accent` | Bordure des éléments focalisés / actifs | couleur |

### Typographie

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-font-sans` | La police utilisée partout dans l'interface | police |
| `--bmm-font-mono` | Code, chemins et hashs | police |
| `--bmm-font-size-base` | Taille de base (ex. `13px`) — met toute l'UI à l'échelle | taille |

Des polices personnalisées peuvent être **embarquées** dans le thème depuis l'éditeur — elles
voyagent avec le fichier, pas de README « installez d'abord cette police ».

### Forme

L'arrondi des choses. `0` = carré partout, pour le look brutaliste.

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-radius-card` | Rayon des coins des cartes (ex. `14px`) | taille |
| `--bmm-radius-btn` | Rayon des boutons | taille |
| `--bmm-radius-input` | Rayon des champs texte et sélecteurs | taille |
| `--bmm-radius-chip` | Rayon des petites puces et pastilles | taille |

### Boutons

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-btn-primary-bg` | Fond des boutons primaires (action principale) — hérite de l'accent | couleur |

Ce token existe pour recolorer l'action principale **sans** repeindre tout ce que l'accent
touche.

### Toasts

Les petites popups de notification.

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-toast-bg` | Fond des toasts | couleur |
| `--bmm-toast-border` | Bordure des toasts | couleur |
| `--bmm-toast-text` | Texte des toasts | couleur |

### Bulles Tasky

Les bulles d'aide qui apparaissent au survol.

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-tasky-bubble-bg` | Fond des bulles (`rgba()` pour l'effet verre) | couleur |
| `--bmm-tasky-bubble-text` | Texte dans les bulles | couleur |
| `--bmm-tasky-bubble-border` | Bordure des bulles | couleur |
| `--bmm-tasky-bubble-radius` | Rayon des coins de la bulle | taille |

### Effets

Lueurs, ombres, élévation au survol et vitesse d'animation.

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-card-glow` | Lueur des cartes, ex. `0 0 20px rgba(...)` — `0 0 0 transparent` pour aucune | taille |
| `--bmm-card-hover-lift` | De combien les cartes montent au survol, ex. `-2px` — `0` pour rien | taille |
| `--bmm-shadow-card` | Ombre portée sous les cartes | taille |
| `--bmm-shadow-modal` | Ombre portée sous les modales | taille |

### Intro & Outro

L'écran de démarrage/fermeture.

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-loader-img` | L'image qui tourne pendant que BMM démarre | image |
| `--bmm-intro-duration` | Durée du fondu de démarrage/fermeture, ex. `0.65s` — plus bas = plus rapide | taille |
| `--bmm-anim-speed` | Multiplicateur global d'animation — `1` normal, `0` instantané (tout désactive) | taille |

`--bmm-anim-speed: 0` sert aussi d'interrupteur accessibilité/performance, et un thème peut
l'embarquer.

### Graphiques

Les couleurs des lignes des graphiques de performance / benchmark.

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-chart-cpu` | La ligne CPU | couleur |
| `--bmm-chart-ram` | La ligne RAM | couleur |
| `--bmm-chart-disk-read` | La ligne lecture disque | couleur |
| `--bmm-chart-disk-write` | La ligne écriture disque | couleur |

### Diagrammes

Les couleurs des nœuds des organigrammes interactifs de **Aide & autres**.

| Token | Ce qu'il style | Type |
|---|---|---|
| `--bmm-diagram-node` | Remplissage des boîtes/nœuds | couleur |
| `--bmm-diagram-node-border` | Bordure des nœuds | couleur |
| `--bmm-diagram-node-text` | Texte dans les nœuds | couleur |

### DevTools

L'overlay des outils développeur (F12) suit les mêmes tokens : un thème garde la surface de
debug lisible sans travail en plus.

## Le fichier thème (`.bmmtheme`)

Un thème s'exporte en un seul fichier JSON. Tout est optionnel sauf `id` et `name` — un
`vars` vide est un thème valide (c'est littéralement le thème Default).

```json
{
  "id": "mon-theme",
  "name": "Mon Thème",
  "author": "vous",
  "version": "1.0.0",
  "description": "Une ligne, affichée dans la liste des thèmes.",
  "mode": "dark",
  "vars": {
    "--bmm-accent": "#22c55e",
    "--bmm-bg-base": "#07100a"
  },
  "global_css": "/* tout ce que les tokens n'atteignent pas */",
  "assets": { "wallpaper": "data:image/png;base64,..." },
  "fonts": [],
  "custom_elements": [],
  "element_overrides": [],
  "html_swaps": [],
  "pages": {},
  "bmm_min_version": "1.0.0"
}
```

| Champ | Ce qu'il transporte |
|---|---|
| `vars` | Les surcharges de tokens — les tableaux ci-dessus |
| `mode` | `"dark"` ou `"light"` — **déclarez-le** ; le mode clair déclenche les correctifs de contraste |
| `global_css` | Du CSS brut appliqué après les tokens (l'onglet **CSS** de l'éditeur) |
| `assets` | Images embarquées (wallpaper, logo, Tasky) en base64 — elles voyagent avec le fichier |
| `fonts` | Fichiers de polices embarqués |
| `custom_elements` | Vos ajouts **+ Éléments** — boutons, bannières, badges |
| `element_overrides` / `html_swaps` | Surcharges de style par élément / remplacements d'innerHTML (icônes) |
| `pages` | Surcharges par vue, indexées par id de vue |
| `bmm_min_version` | Refuse de se charger sur un BMM plus ancien |

Parce qu'un thème peut transporter du CSS, des éléments HTML et des assets, **n'installez
que des thèmes de sources de confiance** — la même règle que pour tout contenu de catalogue.

## Le dossier de dépôt direct

En plus d'Importer, tout `.bmmtheme` / `.json` valide déposé dans
`<données app>/theme-presets/` apparaît à côté des presets intégrés — dans l'éditeur et dans
chaque sélecteur de thème. Le dossier est créé au premier lancement ;
**Paramètres → Stockage** montre où vivent vos données d'app. Pratique pour itérer dans un
éditeur externe, et un pack de thèmes communautaire devient « dézippez ici » au lieu d'une
boucle d'imports.

## Le partager

- **Fichier → Exporter** dans le pied de l'éditeur produit le `.bmmtheme`.
- **Fichier → Partager** copie un lien que les autres ouvrent en un clic.
- Un **catalogue de thèmes** transforme plusieurs thèmes en source abonnable — hébergez-le
  sur [BetterCommunity](doc-page:features/community) et les mises à jour atteignent tous ceux qui vous ont
  ajouté.
