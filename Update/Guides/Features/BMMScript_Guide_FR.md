# ⌨️ BMMScript — écrire et partager une automatisation en texte

Le planificateur construit les automatisations avec des blocs. **BMMScript** est la même
automatisation écrite en texte, dans l'onglet **Code** de l'éditeur de tâche.

Ce guide parle de *ce qu'on en fait*. La liste complète de chaque action, condition et valeur
est générée depuis le registre de BMM et vit à deux endroits, pour qu'elle ne puisse jamais
décrire une version de l'application qui n'existe pas :

- dans l'app : **Aide & autres → BMMScript — toutes les actions, conditions et valeurs**
- sur le site : la page de référence BMMScript

---

## 🧠 La seule chose à comprendre

BMMScript **compile vers les blocs**. Ce n'est pas un second moteur avec ses propres actions —
le texte devient exactement les étapes que produit l'éditeur de blocs, et le même exécuteur les
lance.

Trois conséquences :

1. **Il n'est jamais en retard sur l'app.** `do <nom>(…)` prend ce que l'éditeur de blocs
   appelle l'action. Le langage ne contient aucune liste de noms, donc une action ajoutée à BMM
   est écrivable le jour même, sans mise à jour du langage.
2. **Vous pouvez changer en cours de route.** Écrivez en code, appuyez sur **Blocs**, ça
   s'ouvre en blocs. Construisez en blocs, appuyez sur **Code**, ça s'imprime en texte.
3. **Il ne peut pas faire plus qu'un bloc.** Permissions, substitution de variables, limites de
   boucle et gestion d'erreur appartiennent à l'exécuteur. Le code est une façon d'*écrire* une
   automatisation, pas un moyen de contourner ses règles.

La seule chose qu'un aller-retour ne conserve pas : **vos commentaires et vos lignes vides**.
Ils sont à vous, pas à la tâche, et l'arbre de blocs n'a nulle part où les ranger. Gardez une
copie de ce à quoi vous tenez.

---

## ✍️ Une tâche entière

```text
task "Nettoyage nocturne" {
    every day at 03:00
    describe "Scanner, puis désactiver ce qui est énorme"
    allow script

    do mods.scan()

    if online and not modEnabled(id: "garde-moi") {
        do notify(message: "Analyse…")
        wait 30s
    } else {
        stop
    }

    for item in enabledMods {
        try {
            do mod.disable(id: "{item.id}")
        } catch {
            do notify(message: "Impossible de désactiver {item.name}")
        }
    }
}
```

L'en-tête — tout ce qui précède la première instruction — porte le déclencheur, la description
et les permissions. `allow` correspond aux quatre mêmes cases que l'éditeur de blocs, et il est
requis pour les mêmes étapes : une tâche qui exécute un script sans `allow script` échoue à
cette étape, exactement comme une tâche en blocs.

---

## 🧩 Ce qu'il sait faire

| | |
|---|---|
| Actions | `do <nom>(k: v)` — toutes les actions de l'éditeur de blocs |
| Conditions | `if` / `else if` / `else`, avec `and` · `or` · `not` et parenthèses |
| Boucles | `for x in <source>`, `repeat N times`, `repeat while`, `repeat until` |
| En même temps | `parallel { branch { } branch { } }`, et `parallel settle` |
| Erreurs | `try { } catch { }` |
| Choix | `switch { case <cond> { } default { } }` |
| Variables | `set n = 0`, `set s = "texte"`, `set n: number = 0`, `shared set`, `clear` |
| Maths | `+ - * / % ^`, parenthèses, et les fonctions de l'évaluateur |
| Comparaisons | `== != > >= < <=` |
| Attente | `wait 30s`, `waitfor <cond> timeout 2h poll 10s orcontinue` |
| Blocs | `call "mon bloc partagé"` |
| Autres tâches | `run "T"` (attend), `spawn "T"` (non) |
| Vrai code | `script python { … }` — PowerShell, CMD, Bash, Python, Node ou Rust |
| Flux | `break`, `continue`, `stop` |

Délibérément absents : **vos propres fonctions, et la récursivité.**

---

## 🖊️ Écrire dans l'éditeur

- Il **compile pendant que vous tapez** et montre la première erreur avec sa ligne et sa
  colonne.
- Le curseur n'est déplacé sur une erreur que si vous le **demandez** — en appuyant sur Blocs,
  ou Enregistrer. Jamais pendant la frappe : une demi-ligne est une erreur de syntaxe, et une
  boîte qui projette votre curseur à l'autre bout du fichier en plein milieu d'une phrase est
  inutilisable.
- La ligne où vous êtes **actuellement** est laissée tranquille par la vérification en direct.
  Éloignez-vous et l'erreur apparaît.
- **Autocomplétion** : actions après `do`, moteurs après `script`, listes après `in`,
  conditions et valeurs dans un emplacement de condition. Elle reste fermée dans une chaîne et
  dans un corps `script`. **Entrée n'accepte jamais une suggestion** — Entrée est un retour à la
  ligne. **Tab** accepte. `Ctrl+Espace` demande la liste.
- Enregistrer depuis l'onglet Code enregistre le **code**, pas les blocs qu'il a remplacés.

---

## 📤 Partager un `.bmmscript`

Un `.bmmscript` est un simple fichier texte. Envoyez-le comme vous voulez.

Double-cliquez dessus et **BMM l'ouvre — il ne l'exécute pas.** Vous obtenez un écran de
revue :

- le fichier est **compilé d'abord**, donc un fichier cassé nomme la ligne au lieu de s'exécuter
  à moitié ;
- chaque étape est listée ;
- chaque corps `script` est affiché **en entier**, pas résumé en « exécute un script ».

Puis deux cas :

| Le fichier | Ce que vous pouvez faire |
|---|---|
| ne demande rien | **L'exécuter** en un clic — tout ce qu'il fait, vous pourriez le faire avec les boutons de l'app |
| s'accorde `command`, `script`, `deeplink` ou `stopProcess` | Exécuter reste **désactivé** tant que vous n'avez pas coché *j'ai lu ce qu'il fait* |

Ces quatre capacités sont les seules qu'une tâche peut avoir et que les boutons de l'app n'ont
pas.

**L'exécuter maintenant** et **L'ajouter à mes tâches** sont deux boutons séparés, parce
qu'exécuter un fichier une fois et le garder pour toujours sont deux intentions différentes.

### Ce que « L'ajouter à mes tâches » ajoute vraiment

La tâche arrive **désactivée**, avec les quatre permissions **retirées**, et n'enregistre jamais
de tâche planifiée Windows. BMM vous dit ensuite ce que le fichier demandait.

Ce n'est pas une restriction contre vous — c'est la différence entre choisir d'exécuter quelque
chose et découvrir après coup que ça tourne à intervalle régulier depuis mardi. Activez ce que
vous voulez, puis activez la tâche.

---

## 🧪 En vérifier un avant de le publier

Les outils développeur de BetterCommunity ont un vérificateur de `.bmmscript` : accolades
déséquilibrées, et noms que BMM n'a pas. Ce n'est **pas** le compilateur — BMM a le seul — donc
un fichier qu'il accepte peut quand même refuser de compiler. Il attrape les deux erreurs qui
méritent d'être attrapées avant que quelqu'un d'autre télécharge le fichier.

---

## 🔁 Exécuter du code depuis un flux en blocs

Vous n'avez pas à choisir. L'action **Exécuter du BMMScript (avancé)** prend un extrait sans
l'enveloppe `task` :

```text
do mods.scan()
if online {
    do notify(message: "bonjour")
}
```

Il s'exécute dans la tâche qui l'entoure : mêmes variables, mêmes permissions, mêmes gardes de
boucle.

---

## ⚠️ Deux erreurs à savoir reconnaître

- **« Il y a du texte après la fin de la tâche »** — presque toujours un `}` qui ferme une ligne
  trop tôt. BMM refuse au lieu d'abandonner discrètement le reste de votre automatisation.
- **« `x` est donné deux fois »** — un paramètre dupliqué. Garder le dernier en silence rendrait
  une faute de frappe invisible.
