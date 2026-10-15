# Thèmes & Apparence


> Personnalise chaque couleur, police et élément de BMM. Partage tes thèmes en un clic.
> Tu construis le tien ? La référence token par token est
> **[Créer son propre thème](doc-page:features/making-themes)**.

Ce n'est pas un interrupteur clair/sombre. BMM livre **quatorze** thèmes intégrés — neuf
sombres (*Arctic*, *Charcoal*, *Cobalt*, *Indigo*, *Neon*…) et cinq clairs, dont *BMM Logo*
(les couleurs du logo, et le logo à la place de Tasky) — et un éditeur capable de refaire toute
l'allure de l'app — puis de l'exporter en un fichier que quelqu'un importe en un clic.

!!! note "Renommés en 1.0.3"

    Six thèmes intégrés qui portaient le nom d'autres produits ont maintenant des noms
    neutres : Indigo, Neon, Clay, Arctic, Charcoal et Cobalt. Seuls le nom et l'id ont changé ;
    un thème choisi sous l'ancien nom reste appliqué. La table des anciens et nouveaux ids est
    dans [Créer son propre thème](doc-page:features/making-themes#renommes-en-103).

<div class="bmm-replay" data-src="assets/docs/media/replays/themes.bmmreplay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/themes.bmmreplay" data-page="features/themes" data-title="Restyler BMM avec l'éditeur de thèmes"></div>



<!-- story:make-it-yours -->
![Personnaliser BMM](assets/docs/media/gifs/make-it-yours.gif)

*Personnaliser BMM. Un thème créé dans l’éditeur de thèmes, une barre de navigation réorganisée avec une page personnalisée, et une chaîne traduite dans le studio de traduction.*

<div class="bmm-replay" data-src="assets/docs/media/replays/make-it-yours.bmmreplay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/make-it-yours.bmmreplay" data-page="features/themes" data-title="Personnaliser BMM"></div>
<!-- /story:make-it-yours -->

## La marque que porte chaque thème

Chaque thème porte une **marque**. Parmi les thèmes intégrés, ceux qui utilisent le **logo BMM**
sont Graphite, Pure Black, Daylight, Indigo, Arctic, Cobalt et BMM Logo ; **Charcoal** utilise le
**badge BMM** ; les autres (le thème par défaut et les plus chauds ou plus vifs) gardent **Tasky**.
Le logotype de la barre latérale se lit *Better Mod.Manager*, dessiné en vectoriel en Bricolage
Grotesque avec un petit badge BMM : il reste net à toute taille et prend les couleurs du thème.

## L'éditeur

L'éditeur est un seul panneau en trois parties : les **sections** à gauche, un **aperçu** à
droite avec les **contrôles de contraste** dessous, et un pied qui dit si le fichier est
valide, s'il reste des modifications non enregistrées, et porte **Fichier**, **Enregistrer
comme nouveau** et **Enregistrer le thème**.

Six sections, du changement le plus rapide au plus profond :

=== "Essentiel"

    Les quatre choses que la plupart des thèmes changent, et trois façons de démarrer.

    - **Mode** — *Sombre* ou *Clair*. Changer de mode reconstruit les fonds et le texte pour
      l'autre mode ; ton accent et tout le reste sont conservés, et **Annuler** rétablit le
      mode précédent. Tu veux les deux ? Change, puis **Enregistrer comme nouveau**.
    - **Une palette à partir d'une couleur** — choisis un accent : les fonds, les surfaces et
      le texte en sont déduits, dans le mode actuel.
    - **Partir de** — une vignette par thème intégré. Elle reprend les couleurs de ce thème ;
      ton nom, tes images, tes éléments et ton CSS restent.
    - **Les quatre familles** — *Fond*, *Surfaces*, *Texte*, *Accent et états* : la poignée
      de jetons qui décident de l'allure, chacun avec une ligne qui dit ce qu'il peint.

    L'interrupteur **Contraste auto sur thèmes clairs** est là aussi.

=== "Tous les jetons"

    Chaque jeton `--bmm-*`, par groupe (fond, surfaces, bordures, texte, accent et états,
    typographie, formes, effets, notifications et bulles d'aide, fond d'écran et images,
    diagrammes et graphiques). **Rechercher un jeton par nom ou usage** le trouve par son nom
    *ou* par ce qu'il fait — « sidebar », « coins », « notification ». **Modifiés seulement**
    cache tout ce que le thème laisse par défaut : c'est la façon la plus rapide de lire ce
    qu'un thème fait vraiment.

    Un jeton que le fichier pose mais que BMM ne connaît pas (un BMM plus récent, une faute de
    frappe) est listé aussi, pour pouvoir le modifier ou le retirer.

=== "Images"

    > Remplace les images intégrées de BMM. Les fichiers sont embarqués dans ton thème.

    La **mascotte Tasky** (la flottante *et* le Tasky tournant de l'écran de démarrage,
    remplacés ensemble), le **logo de la sidebar** et le **fond d'écran de l'app** (image ou
    vidéo), avec juste dessous son ajustement, sa position, son flou et son opacité.

    **Mascotte ou logo** choisit ce que BMM montre partout où il montrerait sa mascotte — le coin,
    l'écran de démarrage, les pages vides et les fenêtres : **Tasky**, le **logo BMM** (celui de
    l'icône de l'app) ou le **badge BMM** (les lettres BMM sur une tuile à la couleur d'accent). Le
    choix est enregistré dans le thème.

=== "Éléments"

    Deux choses. **Styles des éléments** restyle un type d'élément — couleurs, survol,
    dégradé, image, tout CSS : **Désigner à l'écran**, ou le choisir dans *Modals & éléments
    partagés* (boutons, champs, fenêtres, notifications, la sidebar…). **Tes éléments** ajoute
    ton propre HTML n'importe où dans BMM ; voir [plus bas](#elements-mettre-tes-propres-choses-dans-bmm).

=== "CSS"

    Du CSS brut, pour quand les champs ne suffisent plus — pour toute l'app, ou limité à un
    écran. Utilise les jetons `var(--bmm-…)` pour qu'il suive le thème.

=== "Bibliothèque"

    Tes thèmes et les intégrés : **Modifier**, **Appliquer**, exporter, supprimer (un intégré
    est masqué à la place, et revient depuis le Catalogue de thèmes), plus **Importer un
    fichier de thème** et le catalogue.

### L'aperçu est un bac à sable

L'aperçu de droite est fait de vrais composants de BMM — une liste de mods, des boutons, une
fenêtre, des notifications — peints avec **le brouillon seulement**. Modifier ne repeint ni
l'app, ni l'éditeur lui-même : un thème à moitié fini ne peut pas rendre illisible le panneau
dont tu te sers.

Quand tu veux que toute l'app suive, coche **Appliquer à BMM pendant la saisie**. Décoché,
seul l'aperçu change jusqu'à l'enregistrement ; coché, chaque modification arrive sur l'app
tout de suite.

### Les contrôles de contraste

Sous l'aperçu, BMM vérifie les paires qui comptent — le texte principal sur le fond et sur les
cartes, le texte secondaire et discret, les éléments de la sidebar, le texte des boutons
principaux, les notifications, les infobulles de Tasky, les erreurs et les succès sur les
cartes — contre les ratios WCAG. Chaque ligne montre le ratio et une note (*Trop faible*,
*Grand texte seulement*, ou réussi). Une ligne en échec a un bouton **Corriger** : il prend la
couleur la plus proche qui passe. **Tout corriger** traite toutes les lignes en échec d'un
coup.

### Annuler, rétablir, et sortir

- **Annuler** (<kbd>Ctrl</kbd>+<kbd>Z</kbd>) et **Rétablir** (<kbd>Ctrl</kbd>+<kbd>Y</kbd>)
  couvrent chaque modification, changement de mode compris.
- **Réinitialiser** demande ce que tu veux dire : *Annuler les modifications non
  enregistrées*, ou *Repartir de l'apparence par défaut*.
- Fermer avec des modifications non enregistrées demande d'abord.

!!! tip "Pointe ce que tu veux changer"

    Ne cherche pas la bonne variable. Clique la **pipette** dans l'en-tête de l'éditeur, puis
    fais un clic droit (ou un clic molette) sur **n'importe quel élément dans BMM** —
    l'éditeur saute au jeton qui le peint. Dans *Tous les jetons*, cliquer le nom d'un jeton
    te montre tout ce qu'il peint à l'écran. (Plus de contrôles dans
    [Astuces & contrôles](doc-page:reference/tips).)

### Flottant, ancré, ou dans sa propre fenêtre

Le panneau flotte au-dessus de l'app, s'ancre sur le côté, ou — avec le bouton **Ouvrir dans
sa propre fenêtre** de son en-tête — part dans une fenêtre à lui, que tu peux poser sur un
second écran pendant que BMM garde toute sa taille. **Remettre dans la fenêtre de BMM** le
ramène.

### Le fichier

L'état en bas à gauche lit le thème comme BMM le lira : *Fichier de thème valide*, *Valide,
N avertissement(s)*, ou *N problème(s) à corriger avant d'enregistrer*. Clique dessus pour la
liste (*Ce que dit le fichier de thème*). Le menu **Fichier** importe un fichier de thème,
exporte un `.bmmtheme`, copie le thème en JSON, ou copie un lien de partage.

## Le partage

Un thème s'exporte et s'importe en fichier. Au-delà, un **catalogue de thèmes** fonctionne
comme l'[App Catalog](doc-page:features/apps) :

> Choisis les thèmes à inclure, puis exporte le catalogue ou ajoute-le comme source. Héberge-
> le sur BetterCommunity pour le partager.

Héberge-le et tu as un canal — quiconque ajoute ta source voit tes thèmes, et leurs mises à
jour.

## Le fond d'écran, et pourquoi il a trois réglages

Un thème peut poser un fond plein écran — image ou vidéo — depuis **Images** dans l'éditeur,
où ses autres réglages sont juste dessous :

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

Retirer le fond depuis Images efface aussi le token, donc la suppression ne laisse pas un
arrière-plan à moitié posé.

## Éléments : mettre tes propres choses dans BMM

**Tes éléments**, dans la section **Éléments**, ajoute ton propre HTML — un bouton, une
bannière, un badge, un widget — n'importe où dans l'app. C'est un formulaire en trois étapes,
et la première est celle qui compte.

**1. Où le placer ?** Soit tu appuies sur la pipette et tu fais un clic droit sur l'élément
dans BMM, soit tu écris un sélecteur CSS toi-même. La pipette est la façon honnête de faire :
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

**2 et 3** sont le contenu : partir d'un modèle (Bouton, Bannière, Badge, Note, Lien) ou écrire
le HTML, puis le styler.

Tes éléments sont listés au-dessus du formulaire, chacun avec son sélecteur, son placement et sa
portée, pour qu'un thème qui en contient une douzaine reste lisible. Ils voyagent avec le
thème — qui l'installe les reçoit aussi, ce qui mérite d'être gardé en tête avant d'y mettre
quelque chose de personnel.
