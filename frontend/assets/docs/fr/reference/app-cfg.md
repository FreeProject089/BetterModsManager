# `app.cfg` — les interrupteurs de la build


Un fichier texte plat, à côté de l'exécutable, qui décide du comportement d'une **build** :
si le menu de débogage existe, si l'application peut se mettre à jour elle-même, si le blog
s'adresse à un serveur local plutôt qu'au vrai site.

Il est lu une fois au démarrage et jamais réécrit. Rien dans l'interface ne le modifie — pour
changer l'une de ces valeurs, éditez le fichier et redémarrez. Les réglages que vous changez
depuis BMM vivent ailleurs ; ce fichier est destiné à celui qui *compile ou distribue* BMM.

Tout ce qui suit est tiré de `src-tauri/src/commands/settings.rs` et
`src-tauri/src/fs_utils.rs`. En cas de désaccord, ce sont eux qui ont raison et cette page qui
est en tort.

## Le fichier tel qu'il est livré

```ini
Prod=true
PTB=true
DisableUpdate=false
EnableBenchmark=true
FSDM=true
AutoEULA_on_first_Start=true
BCTestMode=false
BCTestBase=http://localhost:5176
```

La copie dans `BetterInstaller/examples/bmm/payload/_up_/app.cfg` est identique octet pour
octet. Gardez-les ainsi, sans quoi un BMM installé se comporte autrement qu'un BMM compilé.

## Trois choses qui vont vous piéger

!!! danger "Il n'existe aucune syntaxe de commentaire"

    Ni `#`, ni `//`, ni `;`. La plupart des clés sont détectées en cherchant une sous-chaîne
    dans **tout le fichier passé en minuscules** : une ligne que vous croyiez commentée compte
    quand même.

    ```ini
    #Prod=false
    ```

    Ce fichier contient `prod=false`. Le mode débogage est **activé**. Pour désactiver un
    drapeau, supprimez la ligne ou écrivez l'autre valeur.

!!! warning "Les espaces autour du `=` cassent certaines clés, et pas les autres"

    Le fichier est analysé deux fois, par deux morceaux de code différents, qui ne sont pas
    d'accord.

    | Analyseur | Clés | `Clé = valeur` fonctionne ? |
    |---|---|---|
    | recherche de sous-chaîne sur le fichier en minuscules | `Prod`, `PTB`, `DisableUpdate`, `FSDM`, `AutoEULA_on_first_Start`, `quicklink1_disabled`, `quicklink2_disabled` | **Non** — lu silencieusement comme la valeur par défaut |
    | analyseur ligne à ligne, découpe au premier `=` | `BCTestMode`, `BCTestBase` | Oui |

    Ainsi `BCTestMode = true` fonctionne et `PTB = true` non, dans le même fichier, sans le
    moindre avertissement dans un sens ou dans l'autre. Écrivez chaque clé serrée :
    `Clé=valeur`.

!!! note "Un fichier absent n'est pas une erreur"

    Chaque drapeau vaut `false` par défaut et l'application démarre normalement — pas de menu
    de débogage, mises à jour actives, pas de PTB, pas d'EULA automatique. C'est exactement
    l'allure d'une build de sortie ordinaire : un drapeau « qui ne fait rien » est donc le plus
    souvent un fichier qui n'a jamais été trouvé.

Les noms de clés sont insensibles à la casse. Les valeurs ne sont pas libres : à part
`BCTestBase`, la seule valeur qui fasse quelque chose est celle listée plus bas. `Prod=maybe`
et `Prod=true` sont tous deux simplement « pas `prod=false` », donc désactivé.

## Où le fichier est cherché

`resolve_path()` essaie dans cet ordre et s'arrête au premier qui existe :

| # | Chemin | Pourquoi c'est important |
|---|---|---|
| 1 | `app.cfg` dans le dossier de ressources | Une copie égarée ici **l'emporte sur celle embarquée** |
| 2 | `_up_/app.cfg` dans le dossier de ressources | Là où un BMM empaqueté le trouve |
| 3 | `frontend/app.cfg`, puis le nom nu | |
| 4 | jusqu'à cinq dossiers au-dessus du dossier de ressources | Là où `tauri dev` trouve la copie à la racine du dépôt |
| 5 | `app.cfg` à côté du dossier de travail | Dernier recours |

Comme 1 est essayé avant 2, déposer un `app.cfg` à côté de l'exécutable est une façon
assumée de surcharger une build livrée — et une façon commode de se perdre à cause d'un
fichier qu'on a oublié d'enlever.

## Les clés

| Clé | Valeur qui fait quelque chose | Effet |
|---|---|---|
| `Prod` | `Prod=false` | Affiche le **menu de débogage**. Se lit à l'envers : `Prod=true` n'active rien, il échoue simplement à valoir `prod=false`. |
| `PTB` | `PTB=true` | Marque la build comme **build de test public** — l'écran et les notes de mise à jour suivent le canal de test. |
| `DisableUpdate` | `DisableUpdate=true` | Coupe entièrement la **vérification des mises à jour**. Rien n'est contacté, rien n'est proposé. |
| `FSDM` | `FSDM=true` | Affiche le **menu de débogage plein écran**, plus lourd que celui de `Prod=false`. Indépendant de `Prod`. |
| `AutoEULA_on_first_Start` | `=true` | Affiche la licence automatiquement au premier lancement. Sinon elle reste lisible depuis Aide &amp; autres. |
| `BCTestMode` | `BCTestMode=true` | Pointe le blog et les écrans communautaires vers `BCTestBase` au lieu du vrai site. |
| `BCTestBase` | un hôte, port facultatif | La base de test ou locale, p. ex. `http://localhost:5176`. Ignorée si `BCTestMode` n'est pas `true`. |

`DisableUpdate` décide *si* la vérification a lieu ; `autoupdate_api` dans `links.json` décide
*où elle regarde*. Les deux sont sans rapport — voir
[D'où viennent les liens de BMM](doc-page:reference/links-and-updates.fr).

`Prod` est également sans rapport avec le fait que le binaire soit une build de débogage :
le clic droit « Inspecter » et F12 de WebView2 dépendent d'un fait de compilation
(`cargo run` oui, `tauri build` non) qui ignore ce fichier.

Laisser un `BCTestBase` périmé dans un fichier livré est sans conséquence. Laisser
`BCTestMode=true` ne l'est pas — le blog de chaque utilisateur pointerait alors vers une
machine qui n'est pas la sienne.

## Les clés qui sont là et ne font rien

Écrit ici plutôt que passé sous silence, parce qu'une clé de configuration qui a l'air vivante
sans l'être coûte un après-midi à quelqu'un.

**`EnableBenchmark`** figure dans le fichier livré et **personne ne la lit**. Une recherche
dans tout le dépôt — Rust, TypeScript, scripts de build — ne trouve aucun lecteur, quelle que
soit l'orthographe. La définir, l'effacer ou supprimer la ligne ne change rien. La suite de
tests de performance se lance en ligne de commande et ne consulte pas ce fichier.

**`quicklink1_disabled`** et **`quicklink2_disabled`** masquent les deux cartes de raccourcis
en haut d'Aide &amp; autres, et la commande Rust qui les lit fonctionne toujours — mais son
unique appelant est un module que plus rien n'importe depuis la refonte d'Aide &amp; autres. La
commande n'est donc jamais appelée et les drapeaux ne prennent jamais effet. Ils sont absents
du fichier livré, ce qui explique que personne ne l'ait remarqué ; les ajouter ne masquera pas
les cartes.

## Vérifier ce qu'une build a réellement lu

- **Réglages → Débogage** affiche le mode test BetterCommunity et sa base, en lecture seule.
- **Réglages → Débogage → chemins de ressources** affiche chaque chemin essayé pour `app.cfg`
  et s'il existe — le moyen le plus rapide de découvrir que le fichier lu n'est pas celui que
  vous avez modifié.
- Le journal note `[DEBUG_SYSTEM] Resolution: … is_debug: …` au démarrage et
  `[BC] test_mode=… base_url='…'`. Un `app.cfg could not be resolved` signifie qu'aucun
  drapeau de cette page n'est en vigueur.
