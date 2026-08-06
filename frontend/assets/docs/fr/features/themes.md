# Thèmes & Apparence


> Personnalise chaque couleur, police et élément de BMM. Partage tes thèmes en un clic.

Ce n'est pas un interrupteur clair/sombre. BMM livre **douze** thèmes intégrés (sombres et
clairs) et un éditeur capable de refaire toute l'allure de l'app — puis de l'exporter en un
fichier que quelqu'un
importe en un clic.

![L'éditeur de thèmes](assets/docs/media/screens/themes.annotated.png)

| | | |
|---|---|---|
| **1** | **Installés** | Tes thèmes. Clique pour appliquer. |
| **2** | **Éditeur** | Trois onglets — voir plus bas. |
| **3** | **Catalogue** | Thèmes officiels, partenaires et communautaires. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/themes.bmmreplay" data-page="features/themes" data-title="Restyler BMM avec l'éditeur de thèmes (clip placeholder)"></div>

*Enregistrement placeholder — un clip ciblé de cet écran le remplacera.*

## L'éditeur a trois niveaux

Prends celui qui correspond à jusqu'où tu veux aller. Tu peux t'arrêter au premier.

=== "Simple"

    > Choisis un préréglage, puis ajuste. Survole les libellés pour l'aide, clique **?** pour
    > la doc MDN.

    Couleurs, polices, espacements — en champs. Le **?** à côté d'une propriété ouvre sa page
    MDN, ce qui fait de cet onglet une façon correcte d'apprendre le CSS, pas seulement de
    l'utiliser.

    Chaque section a un **Réinitialiser cette section** : tu peux expérimenter à un endroit et
    n'annuler que là, sans perdre le reste.

=== "+ Éléments"

    > Ajoute tes propres boutons, bannières, badges ou widgets n'importe où dans BMM. Choisis
    > un emplacement, un type…

    C'est celui auquel on ne s'attend pas : tu ne restyles pas les éléments de BMM, tu
    **ajoutes les tiens**. Un bouton qui lance un [deeplink](doc-page:reference/api), une
    bannière avec les règles de ton serveur, un badge sur une carte de profil.

=== "CSS"

    Du CSS brut, pour quand les champs ne suffisent plus. Tout ce que font les deux autres
    onglets finit ici de toute façon.

!!! tip "Pointe ce que tu veux changer"

    Ne cherche pas la bonne variable. Clique la **pipette**, puis clique **n'importe quel
    élément dans BMM** — l'éditeur y saute directement. C'est la réponse la plus rapide à
    « comment je recolorie *ce* bouton ». Tu construis un thème clair ? Mets le **mode** du
    thème sur *clair* et BMM applique des correctifs de contraste automatiques pour que le texte
    reste lisible. (Plus de contrôles dans [Astuces & contrôles](doc-page:reference/tips).)

## Les assets

> Remplace les images intégrées de BMM. Les fichiers sont embarqués dans ton thème.

Le logo, le fond d'écran (avec flou et opacité), et **Tasky** — la mascotte flottante *et* le
Tasky tournant de l'écran de démarrage, remplacés ensemble.

**Embarqués** est le mot qui compte : un asset vit *dans* le fichier de thème. Partage le
thème et les images voyagent avec — pas de lien mort, pas de « ça marche chez moi ».

## Le partage

Un thème s'exporte et s'importe en fichier. Au-delà, un **catalogue de thèmes** fonctionne
comme l'[App Catalog](doc-page:features/apps) :

> Choisis les thèmes à inclure, puis exporte le catalogue ou ajoute-le comme source.

Héberge-le et tu as un canal — quiconque ajoute ta source voit tes thèmes, et leurs mises à
jour.

## Le fond d'écran, et pourquoi il a trois réglages

Un thème peut poser un fond plein écran — image ou vidéo — depuis **Assets** dans l'éditeur. Il
vient avec deux réglages que tu voudras, tous deux dans le groupe **Arrière-plan** :

| Réglage | Token | À quoi il sert |
|---|---|---|
| Fond d'écran | `--bmm-app-bg-image` | L'image elle-même, choisie ou collée en URL |
| Flou du fond | `--bmm-app-bg-blur` | Un flou en pixels, ex. `8px` |
| Opacité du fond | `--bmm-app-bg-opacity` | De `0` (invisible) à `1` (plein) |

Le flou et l'opacité ne sont pas de la déco. Un fond détaillé entre en concurrence avec le
texte posé dessus, et BMM est un écran qu'on **lit** : noms de mods, chemins de fichiers,
numéros de version. Le flou enlève le détail, l'opacité enlève le contraste. Une photo à pleine
force rend une liste de mods pénible à parcourir ; la même à `8px` et `0.35` se lit comme une
couleur, et le texte reste lisible.

Retirer le fond depuis Assets efface aussi le token, donc la suppression ne laisse pas un
arrière-plan à moitié posé.

## + Éléments : mettre tes propres choses dans BMM

L'onglet **+ Éléments** ajoute ton propre HTML — un bouton, une bannière, un badge, un widget —
n'importe où dans l'app. C'est un formulaire en trois étapes, et la première est celle qui
compte.

**1. Où le mettre ?** Soit tu appuies sur *Clique un endroit dans BMM* et tu désignes l'élément
à la pipette, soit tu écris un sélecteur CSS toi-même. La pipette est la façon honnête de faire :
tu obtiens le sélecteur qui correspond vraiment à ce que tu as cliqué, au lieu de deviner des
noms de classes.

Ensuite deux choix décident exactement où il atterrit :

| Placement | Résultat |
|---|---|
| À l'intérieur, à la fin | Ajouté comme dernier enfant de la cible |
| À l'intérieur, au début | Inséré comme premier enfant |
| Juste avant | Un frère, immédiatement avant la cible |
| Juste après | Un frère, immédiatement après |

**Afficher sur** en délimite la portée : toutes les pages, ou exactement un écran de BMM —
Bibliothèque, Profils, Modpacks, Mapper, Dépôt Serveur, Plugins & API, App Catalog, Aide &
autre, Paramètres, Crédits, BetterCommunity, Listes `.MM`. Une bannière qui n'a de sens que sur
la Bibliothèque n'a pas à te suivre dans les Paramètres.

**2 et 3** sont le contenu : partir d'un modèle ou écrire le HTML, puis le styler.

Tes éléments sont listés au-dessus du formulaire, chacun avec son sélecteur, son placement et sa
portée, pour qu'un thème qui en contient une douzaine reste lisible. Ils voyagent avec le
thème — qui l'installe les reçoit aussi, ce qui mérite d'être gardé en tête avant d'y mettre
quelque chose de personnel.
