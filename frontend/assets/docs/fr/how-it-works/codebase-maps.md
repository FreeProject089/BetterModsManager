# Cartes du code

Trois outils qui répondent à des questions que le compilateur ne pose pas. Ils lisent les
sources et impriment une structure ; aucun n'est embarqué dans l'app, aucun n'a besoin
qu'elle tourne.

Ils existent parce que BMM a deux frontières sans aucun typage derrière, et une suite de
tests bien plus petite que le code — donc « est-ce que j'ai cassé quelque chose » n'avait
pas de réponse bon marché.

---

## Le graphe de modules — `npm run map:deps`

Lit chaque `import` de `frontend/src` et répond à trois choses que `tsc` ignore, parce qu'un
compilateur se satisfait de n'importe quel graphe qui résout.

| Question | Pourquoi ce n'est pas évident |
|---|---|
| Quel module est le **pivot** ? | `core/i18n.ts` est importé par 66 autres. Un changement là n'est jamais petit, et rien ne le dit. |
| Quels modules sont **injoignables** ? | `tsc` les compile et le bundle les embarque. `docs/docs-ui.ts` est resté mort des mois. |
| Quels imports forment un **cycle** ? | Les modules ES tolèrent les cycles jusqu'à ce que l'un lise une liaison à l'évaluation — c'est alors `undefined` à l'exécution, avec une pile qui pointe le mauvais fichier. |

```bash
npm run map:deps
```

`--tree <module>` dessine ce qu'importer un module tire réellement, cycles marqués et
répétitions repliées — le même rendu que l'arbre de dépendances des mods :

```
docs/docs-hub.ts
 ├── core/i18n.ts
 │    ├── types/models.ts
 │    └── core/api.ts
 │         ├── features/debug/debug.ts
 │         │    ├── core/api.ts  [cycle]
```

### La barrière

`node scripts/dep-graph.mjs --check` tourne dans `npm run ci`. C'est un **cliquet contre une
référence versionnée**, pas une exigence de zéro : ce code a aujourd'hui 77 cycles et 7
modules injoignables, et une barrière qui exige zéro dès le premier jour est une barrière
que quelqu'un désactive la deuxième semaine. Elle échoue quand un nombre *augmente*, et le
signale quand il diminue.

Abaissez-la volontairement avec `--check --update`, qui réécrit `scripts/dep-graph.baseline.json`.

---

## La surface d'API — `npm run map:api`

`invoke` n'est pas générique et renvoie `Promise<any>` : TypeScript ne vérifie **rien** d'un
appel au cœur Rust — ni le nom, ni les arguments, ni l'existence de la commande. Une faute de
frappe compile parfaitement et échoue à l'exécution en promesse rejetée.

`check-invoke-names.mjs` garde déjà un sens — tout nom passé à `invoke()` doit atteindre une
commande enregistrée. Voici le reste de la forme :

- **368** commandes enregistrées, **324** appelées depuis le frontend, **63** modules qui en
  appellent au moins une. `features/settings/scheduler.ts` en touche 54 à lui seul.
- Par module Rust, la part réellement utilisée par l'interface.
- **44 commandes sans appelant frontend.** Signalées exactement ainsi et *jamais* comme
  « inutilisées » : le serveur MCP, la CLI et les deeplinks `bmm://` atteignent des commandes
  que l'UI ne touche jamais. L'outil ne sait pas distinguer une commande réservée au MCP
  d'une commande oubliée, et ne prétend pas le savoir.
- Les **invocations dynamiques** — `invoke(nom)` plutôt que `invoke('nom')`. Il y en a 3, et
  ce compte est la mesure honnête de ce qui échappe à toute vérification.

---

---

## Toutes les actions `bmm://` — `npm run map:deeplinks`

Le constructeur de liens de BetterCommunity proposait quatre actions, tapées à la main, dans un
autre dépôt. BMM en gère **43**.

Deux problèmes, et le second est celui qui dure. Un constructeur qui propose une action que
l'app ne gère pas produit un lien qui ouvre BMM et ne fait rien — pire que pas de
constructeur, parce que ça donne l'impression que l'app est cassée. Et une liste recopiée dans
un autre dépôt est fausse dès que quelqu'un ajoute un deeplink ici, en silence.

La table est donc dérivée de `deep_link_manager.ts` et versionnée dans
`frontend/deeplinks.json` : chaque action avec les paramètres qu'elle lit réellement, y compris
ceux que personne ne devinerait — `repo/sync` en prend sept, `app/install` cinq, et huit n'en
prennent aucun.

`node scripts/deeplink-map.mjs --check` tourne dans `npm run ci` : ajouter un deeplink en
oubliant la table devient un échec de build, pas un lien faux découvert plus tard. Le parseur
refuse aussi d'émettre moins de 15 actions — un parseur qui ne matcherait rien produirait une
table vide, et une table vide se lit « BMM n'a pas de deeplinks ».

!!! note "Les chiffres de cette page sont un instantané"
    Ils étaient vrais à l'écriture, et chaque outil imprime les siens. `npm run map:deps`,
    `map:api`, `map:deeplinks` et `impact` répondent pour aujourd'hui ; cette page explique ce
    que les nombres veulent dire.

## Ce qu'un changement touche vraiment — `npm run impact`

```bash
npm run impact               # travail non commité
npm run impact -- --since main
npm run impact -- --run      # lance exactement les tests sélectionnés
```

Deux listes. La première — quels tests atteignent votre changement — est un confort. La
seconde est celle qui compte : **quels fichiers modifiés aucun test n'atteint**.

Il y a 16 fichiers de test pour 150 modules : pour la plupart des changements, la réponse
honnête est « aucun test ne te le dirait », et le seul moyen de savoir laquelle des parties
était de le tracer à la main. La couverture suit le graphe de dépendances : un test qui
importe `rich-markdown.ts` atteint donc `core/i18n.ts`, deux sauts plus bas.

!!! warning "Dans quel sens il se trompe"
    La couverture ici est une **atteignabilité structurelle**, pas une connaissance de ce
    qu'un test vérifie. Importer un module ne veut pas dire exercer tout ce qu'il importe.
    L'outil **sur-estime la couverture et sous-estime les trous** — donc un fichier qu'il
    liste comme non couvert l'est vraiment. `ui/app.ts` et `features/mods/mods.ts`, les deux
    plus gros modules du code, ne sont atteints par aucun test.

Les chemins modifiés hors du graphe — Rust, CSS, HTML, docs, c'est-à-dire l'essentiel de ce
qui change ici — sont listés à part. Les compter comme non couverts noierait les vrais trous ;
les omettre laisserait une liste courte se lire comme « votre changement est couvert ».
