# Dépendances et conflits, en arbre

Chaque mod porte déjà la liste des mods dont il a besoin, et BMM sait déjà quels mods se disputent
quels fichiers. Ce qui manquait, c'est la **forme**. Une liste plate de paires répond à *« est-ce que
A est en conflit avec B ? »* et ne répond jamais à la question qu'on se pose vraiment avant
d'installer ou de retirer quelque chose : *qu'est-ce que ça entraîne, et lesquels se percutent ?*

Ouvrez-le avec ++ctrl+k++ → **Dépendances et conflits**.

---

## Ce que montre l'arbre

Chaque racine est un mod **dont rien d'autre ne dépend** — ce que vous avez choisi, plutôt que ce
qui a été entraîné derrière. En dessous viennent ses dépendances, puis les leurs, jusqu'en bas.

```
Weapon Overhaul                          3 conflit(s)
 ├── Core Framework
 │    └── Asset Library
 └── Sound Pack                          1 conflit(s)
Texture Pack HD
```

Le compte à droite, c'est le nombre d'autres mods **activés** qui partagent au moins un fichier avec
celui-là.

---

## Trois choses qu'il refuse de lisser

Chacune produirait un arbre qui a l'air correct et qui ne l'est pas.

### Une dépendance manquante est un nœud, pas un trou

Si un mod nomme une dépendance que rien dans votre bibliothèque ne fournit, elle est dessinée à sa
place et marquée **non installé**, et le résumé les compte :

> *3 dépendance(s) nommée(s) par un mod et fournie(s) par rien :*

Supprimer la ligne ferait dire à l'arbre qu'une bibliothèque cassée va bien. C'est souvent la ligne
la plus utile de l'écran.

### Un cycle est dessiné une fois et marqué

`A → B → A`, ça se construit par accident. Un rendu qui le suit récursionne jusqu'à épuiser la pile :
la deuxième visite est donc dessinée comme **cycle** et n'est pas suivie.

### Un mod atteint deux fois apparaît deux fois

Atteint par deux chemins, il est montré sous les deux — le second marqué **déjà vu plus haut**. Le
dédupliquer cacherait que deux choses différentes en dépendent, ce qui est exactement ce qu'il faut
savoir avant de le retirer.

---

## Copier en texte

Le bouton **Copier en texte** met tout l'arbre dans le presse-papiers, en caractères de dessin de
boîte. C'est cherchable et citable dans un ticket ou un message, contrairement à une capture.

---

## Où vit la logique

`mod-graph.ts` est pur — construction de l'arbre, recherche des racines, marquage des cycles, rendu
texte — et il est testé directement. `mod-graph-view.ts` est la partie qui parle à Tauri et au DOM.
C'est la règle de tout ce dossier : ce qui importe Tauri ne peut pas être chargé par un test, donc le
raisonnement vit là où il peut être vérifié et seule la plomberie vit à côté.

Le côté conflits lit `get_all_mod_conflicts`, qui rapporte **une entrée par côté** — la même paire
arrive deux fois. Les paires sont aplaties sur les ids triés avant le comptage, sinon chaque nombre
du résumé serait doublé.

---

## Ce que cette page n'est pas

Elle ne décide rien. Quel mod gagne un conflit reste l'ordre d'activation, inchangé et expliqué dans
**[Conflits](doc-page:how-it-works/conflicts)** — ceci est la vue qui vous montre la forme du problème avant d'agir.
