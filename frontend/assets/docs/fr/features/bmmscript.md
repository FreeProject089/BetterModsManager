# BMMScript — les automatisations en code


> Les mêmes automatisations que les briques du [planificateur](doc-page:features/scheduler.fr), écrites en
> texte. Tout ce que vous pouvez construire en cliquant, vous pouvez le taper — et tout ce
> que vous tapez, vous pouvez le rouvrir en briques.

## Pourquoi ce n'est pas un langage à part

BMMScript **se compile vers les briques**. Ce n'est pas un second moteur avec ses propres
actions : le texte que vous écrivez devient exactement les étapes que produit l'éditeur de
briques, et c'est le même exécuteur qui les fait tourner.

Trois conséquences, et c'est toute la raison de ce choix.

- **Il n'est jamais en retard sur les briques.** Une action s'écrit `do <nom>(…)`, et le
  langage ne contient aucune liste de noms d'actions. Une action ajoutée à BMM demain
  s'écrit déjà aujourd'hui.
- **Vous pouvez changer de mode.** Une tâche écrite en code s'ouvre en briques ; une tâche
  construite en briques s'imprime en code. Aucun sens ne perd quoi que ce soit.
- **Il ne peut pas faire plus qu'une brique.** Permissions, substitution des variables,
  limites de boucle et gestion d'erreur sont celles de l'exécuteur, inchangées. Le code est
  une façon d'*écrire* une automatisation, pas de contourner ses règles.

Ce qu'il ne gère volontairement **pas** : les expressions, vos propres fonctions, la
récursion. L'arithmétique reste où elle est déjà — l'action `math.set`. Ce sont des
extensions à ajouter par-dessus plus tard, pas des raisons de bâtir un second moteur.

## Une tâche complète

```bmms
task "Ménage nocturne" {
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

## L'en-tête

Tout ce qui précède la première instruction.

| Ligne | Signifie |
|---|---|
| `every day at 03:00` | chaque jour, à cette heure |
| `every week on mon, fri at 09:30` | ces jours — `mon tue wed thu fri sat sun` |
| `every month on 1 at 00:00` | ce jour du mois |
| `every 30m` · `every 2h` | un intervalle. Un nombre entier d'heures devient un déclencheur horaire |
| `once at "2026-01-01T09:00"` | un instant unique |
| `on app start` | une fois par lancement de BMM |
| `manual` | seulement sur le bouton Exécuter, ou via un deeplink |
| `describe "…"` | la description affichée dans la liste |
| `disabled` | garder la tâche sans l'exécuter |
| `allow command, script, deeplink, stopProcess` | ce que la tâche peut faire hors de BMM |

`allow` correspond aux quatre mêmes permissions que les cases de l'éditeur de briques, et
elles sont exigées pour les mêmes étapes. Une tâche qui lance un script sans `allow script`
échoue à cette étape, exactement comme une tâche en briques.

## Les instructions

### Actions

```bmms
do mods.scan()
do notify(message: "terminé", level: info)
do mod.disable(id: "{item.id}")
```

`do <action>(nom: valeur, …)`. Le nom de l'action est celui de l'éditeur de briques, et les
noms de paramètres sont ceux de son formulaire — ouvrez une étape en code une fois et vous
aurez l'orthographe exacte.

Les valeurs sont du texte entre guillemets, des nombres, `true` / `false`, ou un mot nu (qui
est du texte — `level: info` et `level: "info"` sont identiques).

### Choix

```bmms
if online { do mods.scan() }
if not fileExists(path: "C:\mods\sortie.txt") { do mods.scan() } else { stop }
if online and modEnabled(id: "x") { do mods.scan() } else if always { stop }
```

Les conditions s'écrivent comme les actions. `and` / `or` les combinent, `not` en inverse
une, les parenthèses regroupent. `a and b and c` fait un seul groupe de trois, ce qui est
ce qu'affiche l'éditeur de briques.

### Boucles

```bmms
for item in enabledMods { do mod.disable(id: "{item.id}") }   # mods, enabledMods, disabledMods, profiles, modpacks, themes
for item in list "file" { do notify(message: "{item.name}") }  # une liste construite avec list.push
repeat 3 times { do mods.scan() }
repeat while online { wait 1m }
repeat until fileExists(path: "x") { wait 10s }
```

Dans une boucle, `{item.id}` et `{item.name}` sont remplacés dans chaque valeur texte.
`break` quitte la boucle, `continue` passe à l'élément suivant, `stop` termine la tâche.

### Attendre

```bmms
wait 30s                                    # aussi 5m, 2h, ou un nombre nu de secondes
waitfor fileExists(path: "x") timeout 2h poll 10s
waitfor online timeout 30s orcontinue       # continuer au lieu d'échouer
```

### Erreurs et branches

```bmms
try {
    do repo.sync()
} catch {
    do notify(message: "échec de la synchro")
}

switch {
    case online { do repo.sync() }
    case fileExists(path: "cache.json") { do modlist.import() }
    default { do notify(message: "rien à faire") }
}
```

Un `switch` exécute le **premier** cas dont la condition est vraie, puis s'arrête.

## Commentaires

`//` et `#` vont tous deux jusqu'à la fin de la ligne.

## Exécuter du code depuis un enchaînement de briques

Vous n'avez pas à choisir. L'action **Exécuter du BMMScript (avancé)** prend un extrait sans
enveloppe `task` :

```bmms
do mods.scan()
if online {
    do notify(message: "bonjour")
}
```

Il s'exécute dans la tâche qui l'entoure : mêmes variables, mêmes permissions, mêmes
garde-fous de boucle. L'éditeur le compile pendant que vous tapez et affiche le numéro de
ligne de la première erreur, pour qu'une faute se trouve pendant que vous la regardez plutôt
qu'à 3 h du matin.

## Exécuter un autre langage

BMMScript sert aux étapes *propres à BMM*. Pour exécuter du vrai code, utilisez l'action
**Exécuter un script**, qui accepte PowerShell, CMD, Bash, Python, JavaScript (Node) ou
Rust. BMM n'en embarque aucun — l'éditeur indique si chacun peut réellement tourner sur
cette machine, et quel binaire il a trouvé, avant même que vous enregistriez la tâche.

Rust est compilé avant de s'exécuter, donc il démarre bien plus lentement que les autres ;
pour une tâche qui se déclenche toutes les quelques minutes, un moteur interprété est
généralement le meilleur choix.

## Les erreurs

Chaque erreur nomme une ligne et une colonne. Deux méritent d'être connues parce qu'elles
ressemblent à autre chose :

- **« There is more text after the task ended »** — presque toujours une `}` qui ferme une
  ligne trop tôt. BMM refuse plutôt que d'abandonner silencieusement le reste de votre
  automatisation.
- **« `x` is given twice »** — un paramètre en double. Garder le dernier en silence rendrait
  la faute de frappe invisible.

## Ce que l'aller-retour ne garde pas

Les commentaires et les lignes vides. Ils sont à vous, pas à la tâche, et l'arbre de briques
n'a nulle part où les mettre : ouvrez une tâche en briques puis réimprimez-la en code, et
les commentaires ont disparu. Gardez une copie de ce à quoi vous tenez.
