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

<div class="bmm-replay" data-page="features/themes" data-title="Restyler BMM avec l'éditeur de thèmes (clip placeholder)"></div>

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

<!-- TODO(contenu) : le sélecteur d'emplacement de « + Éléments » et les réglages
     flou/opacité du fond d'écran méritent chacun leur capture. -->
