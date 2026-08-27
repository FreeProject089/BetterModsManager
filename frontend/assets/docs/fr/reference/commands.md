# Toutes les commandes, et quand tu les veux


Pour les contributeurs. Regroupées par objectif plutôt que par outil, parce qu'au moment où tu
cherches une commande, tu connais le but, pas le paquet.

Les chemins sont relatifs à la racine du dépôt. Tout ici vient de `package.json`, de
`scripts/`, et des en-têtes des scripts eux-mêmes.

## Les deux que tu utiliseras le plus

```bash
npm run dev        # surveillance TypeScript + la fenêtre Tauri, ensemble
npm run ci         # toutes les vérifications, dans l'ordre de la CI
```

`npm run ci` fait 43 étapes. Elle est lente exprès — c'est la différence entre « ça compile »
et « ça marche ».

## Construire

```bash
npm run compile         # TypeScript → frontend/js
npm run typecheck       # types seulement, n'écrit rien
npm run watch           # compile, et continue de compiler
npm run build           # la chaîne complète de release (voir ci-dessous)
npm run release         # build, puis l'installeur
npm run build:installer # l'installeur seul
npm run gen             # régénérer tout ce qui dérive du source
npm run gen-manifest    # le manifeste de mise à jour seul
npm run tauri           # la CLI Tauri brute, pour ce qui n'est pas enveloppé ci-dessus
```

`npm run build` enchaîne : contrôle des interrupteurs de dev → garde de sécurité → **gen** →
sync des docs → contrôle d'encodage → `tsc` → contrôle des imports → `tauri build --no-bundle`
→ manifeste de mise à jour.

### Ce que produit `gen`

Trois générateurs, et l'ordre entre eux compte :

| Écrit | Depuis | Pourquoi c'est généré |
|---|---|---|
| `frontend/src/docs/bmms-reference.gen.ts` et les deux pages `bmmscript-reference` | les registres du planificateur | une référence écrite à la main est la seule partie de BMMScript qui peut périmer, et elle continuerait de promettre 75 actions pendant que l'app en aurait 90 |
| `dist-assets/bmms-vocabulary.json` | les mêmes registres, plus les mots-clés du parseur Rust | le vérificateur `.bmmscript` de BCWEB le lit au lieu de garder une seconde liste de noms d'actions — qui serait fausse le jour où quelqu'un en ajoute une |
| `src-tauri/src/mcp/actions.gen.json` | le registre d'actions | pour qu'un assistant propose exactement les actions qui existent |
| `frontend/deeplinks.json` | `deep_link_manager.ts` | pour qu'un constructeur propose exactement les liens que le routeur traite |

`gen-bmms-reference` écrit à la fois un `.ts` que lit le compilateur **et** deux pages que
`sync-docs` copie dans l'app : il doit donc passer avant les deux. C'est pour ça que `gen` est
placé là dans la chaîne et pas à la fin.

!!! note "La CI les vérifie ; le build les écrit"

    Chacun a un mode `--check` qui tourne dans `npm run ci` et échoue quand le fichier commité
    ne correspond plus au source. Ça attrape un commit périmé avant la fusion.

    `npm run build` régénère à la place, pour qu'une release ne livre jamais un artefact en
    désaccord avec le code dont il vient. Les deux moitiés sont nécessaires : le contrôle garde
    git honnête, le build garde la release honnête.

!!! warning "Le vocabulaire doit encore être téléversé"

    `dist-assets/bmms-vocabulary.json` n'est pas embarqué dans l'app et n'est publié nulle part
    par le build. BCWEB le lit comme un asset de plateforme que quelqu'un téléverse, et rien de
    ce côté-là ne peut savoir que sa copie a six mois — le symptôme est un vérificateur qui
    déclare inconnus des noms d'actions valides. Re-téléverse-le après chaque croissance du
    langage.

!!! warning "Le JavaScript compilé est commité"
    `frontend/js/**` est suivi par git, donc le JS commité doit être ce que produit le
    TypeScript commité. `check-compiled-fresh` le fait respecter, et il veut le fichier
    **commité**, pas seulement indexé :

    ```bash
    npm run compile && git add frontend/js/<le fichier> && git commit
    ```

## Les vérifications, par ce qu'elles protègent

Toutes d'un coup avec `npm run ci`. Individuellement, quand tu sais ce que tu as touché :

### Texte et traduction

```bash
npm run check:i18n        # parité EN/FR — mêmes clés des deux côtés
npm run check:i18n-keys   # chaque clé t() littérale se résout
npm run check:text        # de la prose qui n'atteint jamais t()
npm run check:encoding    # mojibake et échappements parasites
npm run check:markup      # HTML que md-lite abîmerait
npm run test:i18n         # le test de parité en Python
```

### Apparence

```bash
npm run check:colors      # couleurs en dur au lieu de tokens
npm run check:neutrals    # gris en ligne qui ignorent le thème
npm run check:tokens      # deux tokens qui résolvent vers la même chose
npm run check:css         # sélecteurs qui ne matchent rien
npm run check:css-vars    # variables utilisées mais jamais définies
npm run check:kit         # composants faits à la main au lieu de ui/kit
```

### Justesse

```bash
npm run check:imports     # chemins d'import qui ne résolvent pas
npm run check:boot        # ce que le premier affichage doit télécharger
npm run check:dev-toggles # un interrupteur de debug resté allumé
npm run security-guard    # régressions CWE-95 / CWE-749
npm test                  # la suite de tests Node
```

### Fonctionnalités avec leurs propres invariants

```bash
npm run check:sched-vars    # variables du planificateur
npm run check:tutorial      # les étapes du tutoriel pointent encore sur du réel
npm run check:diagrams      # registre des diagrammes vs ce que les pages annoncent
npm run check:catalog-docs  # docs des catalogues vs le lecteur
npm run check:installer     # configuration de l'installeur
npm run check:resources     # chaque fichier réclamé par le Rust est bien embarqué
npm run check:nesting       # index.html referme ses balises ; aucun modal dans un autre
npm run check:links         # liens externes
npm run check:docs          # renvois entre pages de documentation
```

## Comprendre le code

Ces commandes affichent un rapport. Elles ne changent rien.

```bash
npm run map:deps        # graphe des modules : hubs, orphelins, cycles
npm run map:api         # appels frontend → Rust, et ce qui n'a aucun appelant
npm run map:deeplinks   # chaque action bmm:// et les paramètres qu'elle lit
npm run map:deeplinks:json  # ...et ÉCRIRE frontend/deeplinks.json (ce que BCWEB publie)
npm run impact          # quels tests couvrent ton changement — et ce que rien ne couvre
```

`npm run impact` est celle à connaître avant un gros changement : elle répond à « si je casse
ça, qu'est-ce qui me le dira ».

## Documentation

```bash
npm run sync-docs            # copie BMM Docs dans l'app
npm run sync-docs -- --check # échoue si la copie est périmée (ce que fait la CI)
npm run check:docs           # les renvois se résolvent
```

Une source, deux rendus : mkdocs construit le site et BMM rend le même markdown via md-lite.
Une page ne peut donc pas dire deux choses différentes à deux endroits — mais la copie doit
être régénérée et commitée quand la source change.

## Rust

Depuis `src-tauri/` :

```bash
cargo check           # rapide : est-ce que ça compile
cargo clippy -- -D warnings
cargo fmt --check
cargo test
```

## Enregistrer les médias de la documentation

```bash
node scripts/record-take.mjs     # met BMM dans un état connu, arme l'enregistreur, exporte un .bmmreplay
cd "BMM Docs" && python tools/check_media.py   # quels médias sont encore des substituts
```

La liste de tournage — chaque clip et capture à faire, avec ses réglages — est dans
`.Assets/MEDIA_TO_RECORD.md`.

## Pièges

Chacun a coûté du temps ici.

- **`$?` après un pipe est le statut de `tail`**, presque toujours 0. Utilise `${PIPESTATUS[0]}`.
- **Un `tsc` vert n'est pas une app qui marche.** Les fichiers marqués `@ts-nocheck` lui sont
  invisibles ; `check-undefined-names` existe à cause de l'un d'eux.
- **`export { X } from '…'` ne lie pas `X` localement.** Le module le réexporte et ne peut pas
  l'appeler.
- **Les heredocs mangent les échappements.** `\n` dans un heredoc bash devient un vrai saut de
  ligne et `\b` devient `0x08` — une regex qui ne matche alors plus rien et reste verte. Écris
  le script dans un fichier à la place.
