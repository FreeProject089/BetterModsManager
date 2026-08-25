# BMMScript — les automatisations en code


> Les mêmes automatisations que les briques du [planificateur](doc-page:features/scheduler.fr), écrites en
> texte. Tout ce que vous pouvez construire en cliquant, vous pouvez le taper — et tout ce
> que vous tapez, vous pouvez le rouvrir en briques.


**[Toutes les actions, conditions et valeurs](doc-page:features/bmmscript-reference.fr)** — la liste complète, générée depuis le registre de BMM pour qu'elle ne puisse pas devenir fausse.

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

Ce qu'il ne gère volontairement **pas** : vos propres fonctions, et la récursion. Tout ce
qu'une brique sait faire, il sait le faire — y compris les variables, l'arithmétique et
les comparaisons, qui sont de la syntaxe au-dessus des briques `var.set`, `math.set` et
`value` plutôt qu'un second évaluateur.

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

### Variables et arithmétique

```bmms
set count = 0
set count = count + 1
set moyenne = (a + b) / 2
set label = "bonjour"
shared set equipe = "rouge"
clear count
```

La règle pour distinguer les deux est celle que vous devineriez : **une valeur entre
guillemets est du texte, une valeur sans guillemets est un nombre**. `set n = 0` compte ;
`set s = "0"` est le caractère zéro.

Les nombres passent par le même évaluateur d'expressions que l'action `math.set` —
parenthèses, `+ - * / % ^`, et ses fonctions. Le texte va dans `var.set`, et `shared set`
écrit la variable que toutes les tâches peuvent lire. `clear` en supprime une.

Un nom doit être fait de lettres, chiffres et `_`, en commençant par une lettre. Tout le
reste est refusé pendant que vous tapez plutôt qu'à l'exécution : un nom que le
substituteur ne sait pas retrouver stockerait quelque chose qui a l'air enregistré et ne
pourra jamais être relu.

Une expression s'arrête en fin de ligne. Il n'y a pas de continuation — l'alternative
serait de deviner où s'arrête une instruction.

### Comparer

```bmms
if count >= 3 { stop }
if disk.write_mbps < 50 { do notify(message: "disque lent") }
```

`== != > >= < <=` contre un nombre ou un nom. C'est la ligne de comparaison de l'éditeur de
briques, donc une comparaison écrite ici s'y ouvre comme telle.

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

### En même temps

```bmms
parallel {
    branch { do repo.sync() }
    branch { do benchmark.run() }
}

parallel settle {
    branch { do mods.checkUpdates() }
    branch { do mods.scan() }
}
```

Chaque branche démarre en même temps et l'étape se termine quand toutes ont fini.

`parallel` seul arrête l'étape dès qu'une branche échoue — ce qu'aurait fait une séquence.
`parallel settle` les laisse toutes finir puis indique combien ont échoué, ce qui est le
choix honnête pour « fais ces cinq-là, dis-moi lesquelles n'ont pas marché ».

Les branches partagent les variables de la tâche. Deux branches qui écrivent la même se font
la course, et la dernière écriture gagne — servez-vous en pour du travail indépendant.

### Les autres tâches

```bmms
run "Ménage nocturne"    # attend, et note si ça a marché
spawn "Long téléchargement"  # démarre et continue
```

`run` attend ; un `if lasttask.ok == 1` derrière peut brancher sur le résultat. `spawn`
n'attend pas, et refuse une tâche déjà en cours — y compris elle-même.

### Du vrai code, sur place

```bmms
script python {
    import os
    print(os.getcwd())
}

script bash {
    for f in *.zip; do echo "$f"; done
}
```

`powershell`, `cmd`, `bash`, `python`, `node`, `rust`. Le corps est pris **exactement tel
qu'écrit** — pas d'échappement, pas de guillemets à doubler, les accolades à l'intérieur ne
posent pas de problème. Il faut `allow script`, comme pour la forme en briques.

L'indentation est désindentée de la marge commune et restaurée quand le fichier est
réimprimé, donc Python garde sa forme à travers un aller-retour.

### Les types

```bmms
set count: number = 0
set label: text = "bonjour"
```

Optionnels, et vérifiés à l'écriture : `set n: number = "0"` est refusé, `set s: text = 5`
aussi. L'exécuteur n'a pas de types à l'exécution, donc c'est le seul endroit où l'erreur
peut être attrapée — et ça dit au lecteur suivant à quoi sert la variable.

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

## Partager un script

Un `.bmmscript` est un simple fichier texte, il se partage comme n'importe quel autre.
Double-cliquez dessus et BMM l'ouvre — il ne l'**exécute pas**.

Ce que vous obtenez est un écran de relecture : le fichier est compilé d'abord (s'il est
cassé, il nomme la ligne au lieu de s'exécuter à moitié), chaque étape est listée, et chaque
corps de `script` est imprimé en entier plutôt que résumé en « exécute un script ».

Ensuite, deux cas :

- **Il ne demande rien** — un clic pour l'exécuter. Tout ce qu'il peut faire, vous pourriez
  le faire à la main avec les boutons déjà présents ; l'exécuter n'ajoute aucune capacité.
- **Il s'accorde quelque chose** — `command`, `script`, `deeplink` ou `stopProcess` — et le
  bouton reste désactivé tant que vous n'avez pas coché *J'ai lu ce qu'il fait*. Ces quatre
  capacités sont les seules qu'une tâche peut avoir et que les boutons de l'app n'ont pas.

**Exécuter maintenant** et **Ajouter à mes tâches** sont deux boutons distincts : exécuter
un fichier une fois et le garder pour toujours sont deux intentions différentes. Ni l'un ni
l'autre n'hérite d'`osSchedule` : enregistrer une tâche planifiée Windows est votre
décision, jamais celle de l'auteur du fichier.

Un fichier écrit par un BMM plus ancien, qui ne porte que l'ancien drapeau de permission,
est lu correctement — il annonce ce qu'il accorde vraiment, pas rien.

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
